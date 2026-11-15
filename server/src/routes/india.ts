import { Router, type Router as ExpressRouter } from "express";
import { cached } from "../cache.js";
import * as india from "../providers/india.js";
import * as indiaScrips from "../providers/indiaScrips.js";
import * as indianNews from "../providers/indianNews.js";
import * as ipo from "../providers/ipo.js";

export const indiaRouter: ExpressRouter = Router();

const QUOTE_TTL = 1_000;
const HISTORY_TTL = 15_000;
const NEWS_TTL = 60_000;
const IPO_TTL = 300_000;
const SUBSCRIPTION_TTL = 30_000;

function fail(req: any, res: any, err: unknown) {
  const detail = err instanceof Error ? err.message : String(err);
  console.error("[india]", req.path, detail);
  res.status(502).json({ error: detail || "Indian market data provider unavailable." });
}

// ---- Market Data ----

indiaRouter.get("/scrips", async (req, res) => {
  const q = String(req.query.q ?? "");
  const exRaw = String(req.query.exchange ?? "ALL").toUpperCase();
  const exchange = exRaw === "NSE" || exRaw === "BSE" ? exRaw : "ALL";
  const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 50) || 50));
  try {
    const items = await indiaScrips.searchScrips(q, exchange, limit);
    const all = await indiaScrips.getAllScrips();
    res.json({ totalUniverse: all.length, count: items.length, items });
  } catch (err) {
    fail(req, res, err);
  }
});

indiaRouter.get("/stream", (req, res) => {
  const symbols = String(req.query.symbols ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 80);
  if (symbols.length === 0) return res.status(400).json({ error: "symbols required" });

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let closed = false;
  let busy = false;

  const pushQuotes = async (event: "snapshot" | "tick") => {
    if (closed || busy) return;
    busy = true;
    try {
      const data = await india.quotes(symbols);
      if (!closed && data.length > 0) {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify({ ts: Date.now(), quotes: data })}\n\n`);
      }
    } catch {
      // keep SSE stream alive cleanly on transient fetch error
    } finally {
      busy = false;
    }
  };

  void pushQuotes("snapshot");
  const timer = setInterval(() => void pushQuotes("tick"), 1_000);
  const keepalive = setInterval(() => {
    if (!closed) res.write(": keepalive\n\n");
  }, 15_000);

  req.on("close", () => {
    closed = true;
    clearInterval(timer);
    clearInterval(keepalive);
  });
});

indiaRouter.get("/indices", async (req, res) => {
  try {
    const data = await cached("india:indices", QUOTE_TTL, () => india.indices());
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

indiaRouter.get("/quotes", async (req, res) => {
  const symbols = String(req.query.symbols ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 150);
  if (symbols.length === 0) return res.status(400).json({ error: "symbols required" });

  try {
    const data = await cached(`india:quotes:${symbols.join(",")}`, QUOTE_TTL, () => india.quotes(symbols));
    if (data.length === 0) throw new Error("no Indian quotes returned");
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

indiaRouter.get("/history/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const rangeKey = String(req.query.range ?? "6M");
  const intervalKey = req.query.interval ? String(req.query.interval) : undefined;
  const ttl = intervalKey && ["1m", "3m", "5m"].includes(intervalKey) ? 5_000 : HISTORY_TTL;
  try {
    const data = await cached(`india:history:${symbol}:${rangeKey}:${intervalKey ?? "auto"}`, ttl, () =>
      india.history(symbol, rangeKey, intervalKey)
    );
    if (!Array.isArray(data) || data.length === 0) throw new Error(`no history for ${symbol}`);
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- News ----

function newsItemKey(item: indianNews.IndianNewsItem): string {
  const clean = item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 90);
  return `${clean}|${item.link.trim()}`;
}

async function fetchNewsByFilter(params: {
  mode: string;
  symbol: string | null;
  sector: string;
  index: string;
}): Promise<indianNews.IndianNewsItem[]> {
  const { mode, symbol, sector, index } = params;
  if (mode === "symbol" && symbol) {
    return cached(`india:news:live:sym:${symbol}`, 10_000, () => indianNews.symbolNews(symbol));
  }
  if (mode === "sector") {
    return cached(`india:news:live:sec:${sector.toLowerCase()}`, 10_000, () => indianNews.sectorNews(sector));
  }
  if (mode === "index") {
    return cached(`india:news:live:idx:${index.toUpperCase()}`, 10_000, () => indianNews.indexNews(index));
  }
  if (mode === "ipo") {
    return cached("india:news:live:ipo", 10_000, () => indianNews.ipoNews());
  }
  return cached("india:news:live:top", 10_000, () => indianNews.topNews());
}

indiaRouter.get("/news/stream", (req, res) => {
  const mode = String(req.query.mode ?? "india").toLowerCase();
  const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : null;
  const sector = String(req.query.sector ?? "IT").trim();
  const index = String(req.query.index ?? "NIFTY50").trim();

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let closed = false;
  let busy = false;
  let initialized = false;
  const seenKeys = new Set<string>();

  const pollAndPush = async () => {
    if (closed || busy) return;
    busy = true;
    try {
      const items = await fetchNewsByFilter({ mode, symbol, sector, index });
      if (closed) return;

      if (!initialized) {
        for (const item of items) seenKeys.add(newsItemKey(item));
        initialized = true;
        res.write("event: snapshot\n");
        res.write(`data: ${JSON.stringify({ ts: Date.now(), items })}\n\n`);
        return;
      }

      const newItems = items.filter((item) => !seenKeys.has(newsItemKey(item)));
      if (newItems.length > 0) {
        for (const item of newItems) seenKeys.add(newsItemKey(item));
        // Keep seenKeys bounded for long-lived sessions
        if (seenKeys.size > 500) {
          const keep = new Set(items.map(newsItemKey));
          seenKeys.clear();
          for (const k of keep) seenKeys.add(k);
        }
        res.write("event: news_update\n");
        res.write(`data: ${JSON.stringify({ ts: Date.now(), items, newItems })}\n\n`);
      } else {
        res.write("event: heartbeat\n");
        res.write(`data: ${JSON.stringify({ ts: Date.now() })}\n\n`);
      }
    } catch {
      // Keep SSE connection alive cleanly if an upstream RSS source hiccups
    } finally {
      busy = false;
    }
  };

  void pollAndPush();
  const timer = setInterval(() => void pollAndPush(), 10_000);
  const keepalive = setInterval(() => {
    if (!closed) res.write(": keepalive\n\n");
  }, 15_000);

  req.on("close", () => {
    closed = true;
    clearInterval(timer);
    clearInterval(keepalive);
  });
});

indiaRouter.get("/news", async (req, res) => {
  const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : null;
  try {
    const data = await cached(`india:news:${symbol ?? "top"}`, NEWS_TTL, () =>
      symbol ? indianNews.symbolNews(symbol) : indianNews.topNews()
    );
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

indiaRouter.get("/sector-news", async (req, res) => {
  const sector = String(req.query.sector ?? "IT").trim();
  try {
    const data = await cached(`india:sector-news:${sector.toLowerCase()}`, NEWS_TTL, () =>
      indianNews.sectorNews(sector)
    );
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

indiaRouter.get("/index-news", async (req, res) => {
  const index = String(req.query.index ?? "NIFTY50").trim();
  try {
    const data = await cached(`india:index-news:${index.toUpperCase()}`, NEWS_TTL, () =>
      indianNews.indexNews(index)
    );
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

indiaRouter.get("/ipo-news", async (req, res) => {
  try {
    const data = await cached("india:ipo-news", NEWS_TTL, () => indianNews.ipoNews());
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- IPO Tracking ----

indiaRouter.get("/ipos/upcoming", async (req, res) => {
  try {
    const data = await cached("india:ipos:upcoming", IPO_TTL, () => ipo.upcomingIpos());
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

indiaRouter.get("/ipos/recent", async (req, res) => {
  const days = Math.max(1, Math.min(365, Number(req.query.days ?? 90) || 90));
  try {
    const data = await cached(`india:ipos:recent:${days}`, IPO_TTL, () => ipo.recentIpos(days));
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

indiaRouter.get("/ipos/subscription", async (req, res) => {
  const company = req.query.company ? String(req.query.company).trim() : undefined;
  try {
    const list = await cached(
      `india:ipos:sub:${(company ?? "all").toLowerCase()}`,
      SUBSCRIPTION_TTL,
      () => ipo.ipoSubscriptions(company)
    );
    if (company) {
      return res.json(list[0] ?? { companyName: company, subscriptionStatus: "unknown", bidData: [] });
    }
    res.json(list);
  } catch (err) {
    fail(req, res, err);
  }
});
