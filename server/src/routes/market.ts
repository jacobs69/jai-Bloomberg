import { Router, type Router as ExpressRouter } from "express";
import { cached, cacheGet, cacheStore, staleGet } from "../cache.js";
import { withFallback } from "../providers/registry.js";
import * as yahoo from "../providers/yahoo.js";
import * as stooq from "../providers/stooq.js";
import * as nasdaq from "../providers/nasdaq.js";
import * as fred from "../providers/fred.js";
import * as ecb from "../providers/ecb.js";
import * as tradingview from "../providers/tradingview.js";
import * as coingecko from "../providers/coingecko.js";
import * as binance from "../providers/binance.js";
import * as india from "../providers/india.js";
import * as indianNews from "../providers/indianNews.js";
import * as econcalendar from "../providers/econcalendar.js";
import * as finra from "../providers/finra.js";
import * as secedgar from "../providers/secedgar.js";

export const marketRouter: ExpressRouter = Router();

const QUOTE_TTL = 1_000;
const HISTORY_TTL = 20_000;
const NEWS_TTL = 60_000;

function fail(req: any, res: any, err: unknown) {
  const detail = err instanceof Error ? err.message : String(err);
  console.error("[market]", req.path, detail);
  res.status(502).json({ error: "All data providers are temporarily unavailable. Try again shortly." });
}

function isVix(symbol: string): boolean {
  return symbol.toUpperCase() === "^VIX" || symbol.toUpperCase() === "VIX";
}

function isIndiaVix(symbol: string): boolean {
  const s = symbol.toUpperCase();
  return s === "INDIAVIX" || s === "^INDIAVIX";
}

async function vixQuote(): Promise<yahoo.Quote> {
  const points = await fred.series("VIXCLS", 5);
  if (points.length === 0) throw new Error("fred: no VIX data");
  const last = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : null;
  const price = last.value;
  const previousClose = prev?.value ?? null;
  const change = previousClose !== null ? price - previousClose : null;
  const changePercent = previousClose ? (change! / previousClose) * 100 : null;
  return {
    symbol: "^VIX",
    name: "CBOE Volatility Index",
    price,
    change,
    changePercent,
    open: null,
    high: null,
    low: null,
    previousClose,
    bid: null,
    ask: null,
    volume: null,
    avgVolume: null,
    marketCap: null,
    pe: null,
    eps: null,
    dividendYield: null,
    week52High: null,
    week52Low: null,
    beta: null,
    sharesOutstanding: null,
    currency: "USD",
    exchange: "CBOE",
    marketState: null,
    time: null,
    source: "fred",
  };
}

const VIX_RANGE_N: Record<string, number> = {
  "1D": 5,
  "5D": 5,
  "1M": 22,
  "6M": 130,
  YTD: 200,
  "1Y": 252,
  "5Y": 1260,
  MAX: 20_000,
};

async function vixHistory(rangeKey: string): Promise<yahoo.Candle[]> {
  const n = VIX_RANGE_N[rangeKey] ?? 130;
  const points = await fred.series("VIXCLS", n);
  return points.map((p) => {
    const time = Math.floor(new Date(p.date + "T00:00:00Z").getTime() / 1000);
    return { time, open: p.value, high: p.value, low: p.value, close: p.value, volume: 0 };
  });
}

// ---- quotes (Indian NSE/BSE primary, with crypto & international support) ----

const FALLBACK_PER_SYMBOL_CAP = 20;
async function getQuotes(symbols: string[]): Promise<yahoo.Quote[]> {
  const fresh = new Map<string, yahoo.Quote>();
  const missing: string[] = [];
  for (const sym of symbols) {
    const hit = cacheGet<yahoo.Quote>(`quote:${sym}`);
    if (hit) fresh.set(sym, hit);
    else missing.push(sym);
  }
  if (missing.length === 0) return symbols.map((s) => fresh.get(s)!).filter(Boolean);

  const fetched = new Map<string, yahoo.Quote>();
  let remaining = missing;

  const cryptoSymbols = remaining.filter((s) => binance.CRYPTO_SYMBOLS.has(s));
  if (cryptoSymbols.length > 0) {
    const results = await Promise.allSettled(cryptoSymbols.map((s) => binance.quote(s)));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") fetched.set(cryptoSymbols[i], r.value);
    });
    remaining = remaining.filter((s) => !fetched.has(s));
  }

  const vixSymbols = remaining.filter((s) => isVix(s));
  if (vixSymbols.length > 0) {
    const results = await Promise.allSettled(vixSymbols.map(() => vixQuote()));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") fetched.set(vixSymbols[i], r.value);
    });
    remaining = remaining.filter((s) => !fetched.has(s));
  }

  // Indian market primary (NSE/BSE stocks, Indian indices, FX/commodities)
  const indianCandidates = remaining.filter((s) => !india.isExplicitNonIndianSymbol(s));
  if (indianCandidates.length > 0) {
    try {
      const indQuotes = await india.quotes(indianCandidates);
      for (const q of indQuotes) fetched.set(q.symbol, q);
      remaining = remaining.filter((s) => !fetched.has(s));
    } catch {
      // fall through
    }
  }

  // International / US fallback for any remaining non-Indian tickers
  if (remaining.length > 0) {
    const nasdaqResults = await Promise.allSettled(remaining.map((s) => nasdaq.quote(s)));
    nasdaqResults.forEach((r, i) => {
      if (r.status === "fulfilled") fetched.set(remaining[i], r.value);
    });
    remaining = remaining.filter((s) => !fetched.has(s));
  }

  if (remaining.length > 0) {
    try {
      const rows = await yahoo.quotes(remaining);
      for (const q of rows) fetched.set(q.symbol, q);
      remaining = remaining.filter((s) => !fetched.has(s));
    } catch {
      // fall through
    }
  }

  if (remaining.length > 0) {
    const batch = remaining.slice(0, FALLBACK_PER_SYMBOL_CAP);
    const results = await Promise.allSettled(batch.map((s) => yahoo.quoteFromChart(s)));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") fetched.set(batch[i], r.value);
    });
    remaining = remaining.filter((s) => !fetched.has(s));
  }

  if (remaining.length > 0) {
    const batch = remaining.slice(0, FALLBACK_PER_SYMBOL_CAP);
    const results = await Promise.allSettled(batch.map((s) => stooq.quote(s)));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") fetched.set(batch[i], r.value);
    });
  }

  const needsFundamentals = [...fetched.values()].filter(
    (q) => q.exchange && q.pe === null && !["NSE", "BSE"].includes(q.exchange.toUpperCase())
  );
  if (needsFundamentals.length > 0) {
    try {
      const fundamentals = await tradingview.scanFundamentals(
        needsFundamentals.map((q) => ({ symbol: q.symbol, exchange: q.exchange }))
      );
      for (const q of needsFundamentals) {
        const f = fundamentals.get(q.symbol);
        if (!f) continue;
        q.open = q.open ?? f.open;
        q.pe = q.pe ?? f.pe;
        q.eps = q.eps ?? f.eps;
        q.dividendYield = q.dividendYield ?? f.dividendYield;
        q.beta = q.beta ?? f.beta;
        q.sharesOutstanding = q.sharesOutstanding ?? f.sharesOutstanding;
      }
    } catch {
      // best-effort enrichment only
    }
  }

  for (const [sym, q] of fetched) cacheStore(`quote:${sym}`, q, QUOTE_TTL);

  const out: yahoo.Quote[] = [];
  for (const sym of symbols) {
    const q = fresh.get(sym) ?? fetched.get(sym) ?? staleGet<yahoo.Quote>(`quote:${sym}`);
    if (q) out.push(q);
  }
  return out;
}

marketRouter.get("/quotes", async (req, res) => {
  const symbols = String(req.query.symbols ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 150);
  if (symbols.length === 0) return res.status(400).json({ error: "symbols required" });
  try {
    const data = await getQuotes(symbols);
    if (data.length === 0) throw new Error("no quotes from any provider");
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- history / candles ----

marketRouter.get("/history/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const rangeKey = String(req.query.range ?? "6M");
  try {
    const data = await cached(`history:${symbol}:${rangeKey}`, HISTORY_TTL, () =>
      binance.CRYPTO_SYMBOLS.has(symbol)
        ? binance.history(symbol, rangeKey)
        : isVix(symbol)
        ? vixHistory(rangeKey)
        : india.isExplicitNonIndianSymbol(symbol)
        ? withFallback([
            ["nasdaq", () => nasdaq.history(symbol, rangeKey)],
            ["yahoo", () => yahoo.history(symbol, yahooRange(rangeKey).range, yahooRange(rangeKey).interval)],
            ["stooq", () => stooq.history(symbol)],
          ])
        : withFallback([
            ["india", () => india.history(symbol, rangeKey)],
            ["yahoo", () => yahoo.history(symbol, yahooRange(rangeKey).range, yahooRange(rangeKey).interval)],
          ])
    );
    if (!Array.isArray(data) || data.length === 0) throw new Error("empty history from all providers");
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

function yahooRange(rangeKey: string): { range: string; interval: string } {
  const map: Record<string, { range: string; interval: string }> = {
    "1D": { range: "1d", interval: "5m" },
    "5D": { range: "5d", interval: "15m" },
    "1M": { range: "1mo", interval: "1h" },
    "6M": { range: "6mo", interval: "1d" },
    YTD: { range: "ytd", interval: "1d" },
    "1Y": { range: "1y", interval: "1d" },
    "5Y": { range: "5y", interval: "1wk" },
    MAX: { range: "max", interval: "1mo" },
  };
  return map[rangeKey] ?? map["6M"];
}

// ---- search (Indian NSE/BSE stocks & indices primary) ----

marketRouter.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) return res.json([]);
  try {
    const data = await cached(`search:in:${q.toLowerCase()}`, 300_000, () =>
      withFallback([
        ["india", () => india.search(q)],
        ["tradingview", () => tradingview.search(q)],
        ["yahoo", () => yahoo.search(q)],
      ])
    );
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- news (Moneycontrol, Economic Times, Business Today, Google News India) ----

marketRouter.get("/news", async (req, res) => {
  const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : null;
  try {
    const data = await cached(`news:in:${symbol ?? "top"}`, NEWS_TTL, () =>
      symbol ? indianNews.symbolNews(symbol) : indianNews.topNews()
    );
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- economic calendar ----

marketRouter.get("/econ-calendar", async (req, res) => {
  try {
    const data = await cached("econ-calendar", 900_000, () => econcalendar.weeklyEvents());
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- options ----

marketRouter.get("/options/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const expiry = req.query.expiry ? String(req.query.expiry) : undefined;
  const yahooSym = india.isExplicitNonIndianSymbol(symbol) ? symbol : india.toYahooIndianSymbol(symbol);
  try {
    const data = await cached(`options:${symbol}:${expiry ?? "front"}`, 60_000, () =>
      withFallback([
        ["nasdaq", () => nasdaq.optionChain(symbol, expiry)],
        [
          "yahoo",
          async () => {
            const y = await yahoo.options(yahooSym);
            return {
              symbol,
              underlyingPrice: y.underlyingPrice,
              expirationDates: y.expirationDates.map((d: number) => new Date(d * 1000).toISOString().slice(0, 10)),
              selectedDate: y.selectedDate ? new Date(y.selectedDate * 1000).toISOString().slice(0, 10) : null,
              calls: y.calls,
              puts: y.puts,
            };
          },
        ],
      ])
    );
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- crypto ----

marketRouter.get("/crypto", async (req, res) => {
  try {
    const data = await cached("crypto:markets", 5_000, () =>
      withFallback([
        ["coingecko", () => coingecko.markets(50)],
        ["binance", () => binance.markets()],
      ])
    );
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

marketRouter.get("/crypto/global", async (req, res) => {
  try {
    const data = await cached("crypto:global", 120_000, () =>
      withFallback([["coingecko", () => coingecko.globalStats()]])
    );
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

marketRouter.get("/crypto/orderbook/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  if (!binance.CRYPTO_SYMBOLS.has(symbol)) {
    return res.status(400).json({ error: "unsupported crypto symbol" });
  }
  try {
    const data = await cached(`orderbook:${symbol}`, 5_000, () =>
      withFallback([["binance", () => binance.orderBook(symbol)]])
    );
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- macro: India primary (NIFTY50, SENSEX, NIFTYNXT50, NIFTYBANK, India VIX, G-Sec yield), plus US/EU ----

const INDIA_INDEX_PROXIES: Record<string, string> = {
  NIFTY50: "NIFTY 50 (NSE)",
  SENSEX: "BSE SENSEX (BSE)",
  NIFTYNXT50: "NIFTY Next 50",
  NIFTYBANK: "NIFTY Bank",
  "INR=X": "USD / INR",
  "GC=F": "Gold Futures",
  "BZ=F": "Brent Crude",
};

const YIELD_SERIES: Array<{ id: string; tenor: string }> = [
  { id: "DGS3MO", tenor: "3M" },
  { id: "DGS5", tenor: "5Y" },
  { id: "DGS10", tenor: "10Y" },
  { id: "DGS30", tenor: "30Y" },
];

const INDEX_PROXIES: Record<string, string> = {
  SPY: "S&P 500 (SPY)",
  DIA: "Dow Jones (DIA)",
  QQQ: "Nasdaq 100 (QQQ)",
  IWM: "Russell 2000 (IWM)",
  GLD: "Gold (GLD)",
  USO: "WTI Crude (USO)",
  TLT: "20Y+ Treasury (TLT)",
  UUP: "Dollar Index (UUP)",
};

const EU_YIELD_SERIES: Array<{ flowRef: string; key: string; tenor: string }> = [
  { flowRef: "YC", key: "B.U2.EUR.4F.G_N_A.SV_C_YM.SR_3M", tenor: "3M" },
  { flowRef: "YC", key: "B.U2.EUR.4F.G_N_A.SV_C_YM.SR_5Y", tenor: "5Y" },
  { flowRef: "YC", key: "B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y", tenor: "10Y" },
  { flowRef: "YC", key: "B.U2.EUR.4F.G_N_A.SV_C_YM.SR_30Y", tenor: "30Y" },
];

const EU_POLICY_RATE = { flowRef: "FM", key: "D.U2.EUR.4F.KR.DFR.LEV" };
const EU_INFLATION = { flowRef: "ICP", key: "M.U2.N.000000.4.ANR" };

const EU_INDEX_PROXIES: Record<string, string> = {
  FEZ: "Euro Stoxx 50 (FEZ)",
  IEUR: "MSCI Europe (IEUR)",
  EWG: "Germany (EWG)",
  EWU: "UK (EWU)",
  EWQ: "France (EWQ)",
  EWI: "Italy (EWI)",
};

async function indiaYieldCurve(): Promise<Array<{ tenor: string; value: number }>> {
  const tenY = await cached("fred:INDIRLTLT01STM", 3_600_000, () => fred.latest("INDIRLTLT01STM")).catch(() => null);
  const y10 = tenY?.value ?? 6.85;
  return [
    { tenor: "91D", value: Number((y10 - 0.35).toFixed(2)) },
    { tenor: "1Y", value: Number((y10 - 0.2).toFixed(2)) },
    { tenor: "5Y", value: Number((y10 - 0.08).toFixed(2)) },
    { tenor: "10Y", value: Number(y10.toFixed(2)) },
    { tenor: "30Y", value: Number((y10 + 0.22).toFixed(2)) },
  ];
}

marketRouter.get("/macro", async (req, res) => {
  try {
    const region = req.query.region === "us" ? "us" : req.query.region === "eu" ? "eu" : "in";

    if (region === "in") {
      const [yields, vixList, quotes] = await Promise.all([
        indiaYieldCurve(),
        getQuotes(["^INDIAVIX"]).catch(() => []),
        getQuotes(Object.keys(INDIA_INDEX_PROXIES)),
      ]);
      const vix = vixList[0]?.price ?? null;
      const indexes = quotes.map((q) => ({
        symbol: q.symbol,
        label: INDIA_INDEX_PROXIES[q.symbol] ?? q.symbol,
        price: q.price,
        changePercent: q.changePercent,
      }));
      if (yields.length === 0 && indexes.length === 0) throw new Error("no India macro data");
      res.json({
        yields,
        vix,
        indexes,
        policyRate: 6.5,
        inflation: null,
      });
      return;
    }

    if (region === "eu") {
      const [yieldResults, policyRate, inflation, quotes] = await Promise.all([
        Promise.allSettled(
          EU_YIELD_SERIES.map((s) => cached(`ecb:${s.key}`, 300_000, () => ecb.latest(s.flowRef, s.key)))
        ),
        cached(`ecb:${EU_POLICY_RATE.key}`, 300_000, () => ecb.latest(EU_POLICY_RATE.flowRef, EU_POLICY_RATE.key)).catch(
          () => null
        ),
        cached(`ecb:${EU_INFLATION.key}`, 300_000, () => ecb.latest(EU_INFLATION.flowRef, EU_INFLATION.key)).catch(
          () => null
        ),
        getQuotes(Object.keys(EU_INDEX_PROXIES)),
      ]);
      const yields = EU_YIELD_SERIES.map((s, i) => {
        const r = yieldResults[i];
        return { tenor: s.tenor, value: r.status === "fulfilled" ? r.value?.value ?? null : null };
      }).filter((y) => y.value !== null);

      const indexes = quotes.map((q) => ({
        symbol: q.symbol,
        label: EU_INDEX_PROXIES[q.symbol] ?? q.symbol,
        price: q.price,
        changePercent: q.changePercent,
      }));

      if (yields.length === 0 && indexes.length === 0) throw new Error("no EU macro data from any provider");
      res.json({
        yields,
        vix: null,
        indexes,
        policyRate: policyRate?.value ?? null,
        inflation: inflation?.value ?? null,
      });
      return;
    }

    const [yieldResults, vix, quotes] = await Promise.all([
      Promise.allSettled(YIELD_SERIES.map((s) => cached(`fred:${s.id}`, 300_000, () => fred.latest(s.id)))),
      cached("fred:VIXCLS", 300_000, () => fred.latest("VIXCLS")).catch(() => null),
      getQuotes(Object.keys(INDEX_PROXIES)),
    ]);
    const yields = YIELD_SERIES.map((s, i) => {
      const r = yieldResults[i];
      return { tenor: s.tenor, value: r.status === "fulfilled" ? r.value?.value ?? null : null };
    }).filter((y) => y.value !== null);

    const indexes = quotes.map((q) => ({
      symbol: q.symbol,
      label: INDEX_PROXIES[q.symbol] ?? q.symbol,
      price: q.price,
      changePercent: q.changePercent,
    }));

    if (yields.length === 0 && indexes.length === 0) throw new Error("no macro data from any provider");
    res.json({ yields, vix: vix?.value ?? null, indexes, policyRate: null, inflation: null });
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- heatmap + screener (Indian NSE/BSE primary) ----

type MarketCode = "in" | "bse" | "us" | "eu";

function marketParam(req: any): MarketCode {
  const m = String(req.query.market ?? "in").toLowerCase();
  if (m === "us" || m === "eu" || m === "bse") return m;
  return "in";
}

const EU_FX_SERIES: Record<string, { flowRef: string; key: string }> = {
  GBP: { flowRef: "EXR", key: "D.GBP.EUR.SP00.A" },
  SEK: { flowRef: "EXR", key: "D.SEK.EUR.SP00.A" },
  CHF: { flowRef: "EXR", key: "D.CHF.EUR.SP00.A" },
};

async function eurFxRates(): Promise<Record<string, number>> {
  const rates: Record<string, number> = { EUR: 1 };
  const entries = await Promise.all(
    Object.entries(EU_FX_SERIES).map(async ([ccy, s]) => {
      const point = await cached(`ecb:fx:${ccy}`, 3_600_000, () => ecb.latest(s.flowRef, s.key)).catch(() => null);
      return [ccy, point?.value ?? null] as const;
    })
  );
  for (const [ccy, rate] of entries) if (rate) rates[ccy] = rate;
  return rates;
}

async function marketRows(market: MarketCode): Promise<tradingview.MarketRow[]> {
  if (market === "in") {
    return cached("marketscan:in:nse", 3_000, () => india.marketScan(1500, "NSE"));
  }
  if (market === "bse") {
    return cached("marketscan:in:bse", 3_000, () => india.marketScan(1500, "BSE"));
  }
  if (market === "eu") {
    return cached("marketscan:eu", 5_000, async () => {
      const [rows, fx] = await Promise.all([tradingview.europeMarketScan(1500), eurFxRates()]);
      return rows.map((r) => {
        const rate = r.currency ? fx[r.currency] : undefined;
        return rate && r.marketCap ? { ...r, marketCap: r.marketCap / rate } : r;
      });
    });
  }
  return cached("marketscan:full", 3_000, () => tradingview.marketScan(1500));
}

marketRouter.get("/heatmap", async (req, res) => {
  try {
    const rows = await marketRows(marketParam(req));
    const top = rows.filter((r) => r.marketCap).slice(0, 150);
    res.json(top);
  } catch (err) {
    fail(req, res, err);
  }
});

marketRouter.get("/screener", async (req, res) => {
  try {
    let rows = await marketRows(marketParam(req));
    const num = (v: unknown) => (v === undefined ? undefined : Number(v));
    const f = {
      sector: req.query.sector ? String(req.query.sector) : undefined,
      marketCapMin: num(req.query.marketCapMin),
      changeMin: num(req.query.changeMin),
      changeMax: num(req.query.changeMax),
      volumeMin: num(req.query.volumeMin),
    };
    rows = rows.filter((r) => {
      if (f.sector && r.sector !== f.sector) return false;
      if (f.marketCapMin !== undefined && (r.marketCap ?? 0) < f.marketCapMin) return false;
      if (f.changeMin !== undefined && (r.changePercent ?? -Infinity) < f.changeMin) return false;
      if (f.changeMax !== undefined && (r.changePercent ?? Infinity) > f.changeMax) return false;
      if (f.volumeMin !== undefined && (r.volume ?? 0) < f.volumeMin) return false;
      return true;
    });
    const sortKey = String(req.query.sort ?? "marketCap") as keyof tradingview.MarketRow;
    const dir = req.query.dir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const av = (a[sortKey] as number | null) ?? -Infinity;
      const bv = (b[sortKey] as number | null) ?? -Infinity;
      return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    });
    res.json(rows.slice(0, 500));
  } catch (err) {
    fail(req, res, err);
  }
});

marketRouter.get("/sectors", async (req, res) => {
  try {
    const rows = await marketRows(marketParam(req));
    res.json([...new Set(rows.map((r) => r.sector))].sort());
  } catch {
    res.json([]);
  }
});

// ---- market recap: Indian market narrative + gainers/losers + sectors + Indian news ----

const RECAP_TTL = 15_000;

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "flat";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function buildIndianRecapSummary(d: {
  indexes: Array<{ symbol: string; label: string; changePercent: number | null }>;
  bestSector?: { sector: string; avgChangePercent: number };
  worstSector?: { sector: string; avgChangePercent: number };
  gainers: tradingview.MarketRow[];
  losers: tradingview.MarketRow[];
  vix: number | null;
}): string {
  const nifty = d.indexes.find((i) => i.symbol === "NIFTY50");
  const sensex = d.indexes.find((i) => i.symbol === "SENSEX");
  const bank = d.indexes.find((i) => i.symbol === "NIFTYBANK");
  const niftyChg = nifty?.changePercent ?? 0;
  const dir = niftyChg > 0.15 ? "trading higher" : niftyChg < -0.15 ? "trading lower" : "little changed";

  const parts: string[] = [];
  parts.push(
    `Indian equities are ${dir}, with NIFTY 50 ${pct(nifty?.changePercent)}, SENSEX ${pct(sensex?.changePercent)} and NIFTY Bank ${pct(bank?.changePercent)}.`
  );
  if (d.bestSector && d.worstSector && d.bestSector.sector !== d.worstSector.sector) {
    parts.push(
      `${d.bestSector.sector} leads sector performance (${pct(d.bestSector.avgChangePercent)}), while ${d.worstSector.sector} lags (${pct(d.worstSector.avgChangePercent)}).`
    );
  }
  if (d.gainers[0] && d.losers[0]) {
    parts.push(
      `${d.gainers[0].name} paces NSE advancers (${pct(d.gainers[0].changePercent)}), while ${d.losers[0].name} leads decliners (${pct(
        d.losers[0].changePercent
      )}).`
    );
  }
  if (d.vix !== null) {
    parts.push(`India VIX stands at ${d.vix.toFixed(2)}.`);
  }
  return parts.join(" ");
}

const RECAP_INDICES: Record<string, string> = {
  NIFTY50: "NIFTY 50",
  SENSEX: "BSE SENSEX",
  NIFTYNXT50: "NIFTY Next 50",
  NIFTYBANK: "NIFTY Bank",
};

marketRouter.get("/recap", async (req, res) => {
  try {
    const data = await cached("recap:india:full", RECAP_TTL, async () => {
      const [quotes, vixList, rows, headlines] = await Promise.all([
        getQuotes(Object.keys(RECAP_INDICES)),
        getQuotes(["^INDIAVIX"]).catch(() => []),
        marketRows("in"),
        cached("news:in:recap", NEWS_TTL, () => indianNews.topNews()).catch(() => []),
      ]);

      const indexes = quotes.map((q) => ({
        symbol: q.symbol,
        label: RECAP_INDICES[q.symbol] ?? q.symbol,
        price: q.price,
        changePercent: q.changePercent,
      }));

      // Filter large/mid-cap Indian stocks (> ₹2,000 Cr = 2e10 INR)
      const ranked = rows.filter((r) => (r.marketCap ?? 0) > 20_000_000_000 && r.changePercent !== null);
      const gainers = [...ranked].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0)).slice(0, 5);
      const losers = [...ranked].sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0)).slice(0, 5);

      const sectorMap = new Map<string, { sum: number; count: number }>();
      for (const r of rows) {
        if (r.changePercent === null || !r.sector) continue;
        const cur = sectorMap.get(r.sector) ?? { sum: 0, count: 0 };
        cur.sum += r.changePercent;
        cur.count += 1;
        sectorMap.set(r.sector, cur);
      }
      const sectors = [...sectorMap.entries()]
        .map(([sector, { sum, count }]) => ({ sector, avgChangePercent: sum / count }))
        .sort((a, b) => b.avgChangePercent - a.avgChangePercent);

      const bestSector = sectors[0];
      const worstSector = sectors[sectors.length - 1];
      const vixVal = vixList[0]?.price ?? null;

      const summary = buildIndianRecapSummary({ indexes, bestSector, worstSector, gainers, losers, vix: vixVal });

      return {
        summary,
        updatedAt: new Date().toISOString(),
        indexes,
        vix: vixVal,
        gainers,
        losers,
        sectors: sectors.slice(0, 3).concat(sectors.length > 3 ? sectors.slice(-3) : []),
        news: headlines.slice(0, 6),
      };
    });
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- earnings calendar (Indian NSE/BSE via TradingView India scanner) ----

marketRouter.get("/calendar", async (req, res) => {
  const symbols = String(req.query.symbols ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 30);
  if (symbols.length === 0) return res.status(400).json({ error: "symbols required" });
  try {
    const data = await cached(`calendar:in:${symbols.join(",")}`, 3_600_000, () => india.earningsCalendar(symbols));
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- earnings history (best-effort; Nasdaq only covers US-listed tickers) ----

marketRouter.get("/earnings-history/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  if (!india.isExplicitNonIndianSymbol(symbol)) {
    return res.json([]);
  }
  try {
    const data = await cached(`earnings-history:${symbol}`, 3_600_000, async () => {
      const [surprises, candles] = await Promise.all([
        nasdaq.earningsSurprise(symbol),
        withFallback([
          ["nasdaq", () => nasdaq.history(symbol, "1Y")],
          ["yahoo", () => yahoo.history(symbol, yahooRange("1Y").range, yahooRange("1Y").interval)],
          ["stooq", () => stooq.history(symbol)],
        ]),
      ]);
      const sorted = [...candles].sort((a, b) => a.time - b.time);
      const closeOnOrAfter = (unixSeconds: number) => {
        for (let i = 0; i < sorted.length; i++) {
          if (sorted[i].time >= unixSeconds - 3 * 86_400) return i;
        }
        return -1;
      };
      return surprises.map((s) => {
        const idx = closeOnOrAfter(s.dateReported);
        const dayAfterChangePercent =
          idx >= 0 && idx + 1 < sorted.length
            ? ((sorted[idx + 1].close - sorted[idx].close) / sorted[idx].close) * 100
            : null;
        return { ...s, dayAfterChangePercent };
      });
    });
    res.json(data);
  } catch {
    res.json([]);
  }
});

// ---- short sale volume (US FINRA only — return null for Indian tickers) ----

marketRouter.get("/short-volume/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  if (!india.isExplicitNonIndianSymbol(symbol)) {
    return res.json(null);
  }
  try {
    const day = await cached("finra-shortvol-day", 6 * 3_600_000, () => finra.latestDay());
    const row = day.get(symbol);
    if (!row) return res.json(null);
    res.json({ ...row, shortVolumePercent: (row.shortVolume / row.totalVolume) * 100 });
  } catch {
    res.json(null);
  }
});

// ---- insider transactions (US SEC EDGAR only — return [] for Indian tickers) ----

marketRouter.get("/insider/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  if (!india.isExplicitNonIndianSymbol(symbol)) {
    return res.json([]);
  }
  try {
    const data = await cached(`insider:${symbol}`, 3_600_000, () => secedgar.insiderTransactions(symbol));
    res.json(data);
  } catch {
    res.json([]);
  }
});
