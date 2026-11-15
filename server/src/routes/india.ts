import { Router, type Router as ExpressRouter } from "express";
import { cached } from "../cache.js";
import * as india from "../providers/india.js";
import * as indianNews from "../providers/indianNews.js";
import * as ipo from "../providers/ipo.js";

export const indiaRouter: ExpressRouter = Router();

const QUOTE_TTL = 2_000;
const HISTORY_TTL = 20_000;
const NEWS_TTL = 60_000;
const IPO_TTL = 300_000;
const SUBSCRIPTION_TTL = 30_000;

function fail(req: any, res: any, err: unknown) {
  const detail = err instanceof Error ? err.message : String(err);
  console.error("[india]", req.path, detail);
  res.status(502).json({ error: detail || "Indian market data provider unavailable." });
}

// ---- Market Data ----

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
  try {
    const data = await cached(`india:history:${symbol}:${rangeKey}`, HISTORY_TTL, () =>
      india.history(symbol, rangeKey)
    );
    if (!Array.isArray(data) || data.length === 0) throw new Error(`no history for ${symbol}`);
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- News ----

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
