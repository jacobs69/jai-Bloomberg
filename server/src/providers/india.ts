import * as yahoo from "./yahoo.js";
import * as indiaScrips from "./indiaScrips.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const TV_HEADERS = {
  "User-Agent": UA,
  "Content-Type": "application/json",
  Referer: "https://www.tradingview.com/",
  Origin: "https://www.tradingview.com",
};

export const INDIA_INDICES: Record<
  string,
  { tv: string; yahoo: string; name: string; exchange: string }
> = {
  NIFTY50: { tv: "NSE:NIFTY", yahoo: "^NSEI", name: "NIFTY 50 Index", exchange: "NSE" },
  NIFTY: { tv: "NSE:NIFTY", yahoo: "^NSEI", name: "NIFTY 50 Index", exchange: "NSE" },
  "^NSEI": { tv: "NSE:NIFTY", yahoo: "^NSEI", name: "NIFTY 50 Index", exchange: "NSE" },
  SENSEX: { tv: "BSE:SENSEX", yahoo: "^BSESN", name: "BSE SENSEX Index", exchange: "BSE" },
  "BSE:SENSEX": { tv: "BSE:SENSEX", yahoo: "^BSESN", name: "BSE SENSEX Index", exchange: "BSE" },
  "^BSESN": { tv: "BSE:SENSEX", yahoo: "^BSESN", name: "BSE SENSEX Index", exchange: "BSE" },
  NIFTYNXT50: { tv: "NSE:NIFTYJR", yahoo: "^CNX100", name: "NIFTY Next 50 Index", exchange: "NSE" },
  NIFTYJR: { tv: "NSE:NIFTYJR", yahoo: "^CNX100", name: "NIFTY Next 50 Index", exchange: "NSE" },
  NIFTYBANK: { tv: "NSE:BANKNIFTY", yahoo: "^NSEBANK", name: "NIFTY Bank Index", exchange: "NSE" },
  BANKNIFTY: { tv: "NSE:BANKNIFTY", yahoo: "^NSEBANK", name: "NIFTY Bank Index", exchange: "NSE" },
  "^NSEBANK": { tv: "NSE:BANKNIFTY", yahoo: "^NSEBANK", name: "NIFTY Bank Index", exchange: "NSE" },
  INDIAVIX: { tv: "NSE:INDIAVIX", yahoo: "^INDIAVIX", name: "India VIX", exchange: "NSE" },
  "^INDIAVIX": { tv: "NSE:INDIAVIX", yahoo: "^INDIAVIX", name: "India VIX", exchange: "NSE" },
};

export const INDEX_SYMBOLS = ["NIFTY50", "SENSEX", "NIFTYNXT50", "NIFTYBANK"] as const;

export function cleanIndianSymbol(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isExplicitNonIndianSymbol(symbol: string): boolean {
  const s = cleanIndianSymbol(symbol);
  if (INDIA_INDICES[s]) return false;
  if (s.endsWith(".NS") || s.endsWith(".BO") || s.startsWith("NSE:") || s.startsWith("BSE:")) return false;
  if (s.includes("=X") || s.includes("=F")) return false;
  if (/\.(L|DE|PA|AS|BR|LS|MI|MC|SW|ST|CO|HE|OL|TO|AX|HK|T)$/.test(s)) return true;
  return false;
}

export function toYahooIndianSymbol(raw: string): string {
  const s = cleanIndianSymbol(raw);
  if (INDIA_INDICES[s]) return INDIA_INDICES[s].yahoo;
  if (s.startsWith("^")) return s;
  if (s.includes("=X") || s.includes("=F")) return s;
  if (s.endsWith(".NS") || s.endsWith(".BO")) return s;
  const scrip = indiaScrips.resolveScripSync(s);
  if (scrip) {
    return scrip.exchange === "BSE" ? `${scrip.dispName}.BO` : `${scrip.dispName}.NS`;
  }
  if (s.startsWith("NSE:")) return `${s.slice(4)}.NS`;
  if (s.startsWith("BSE:")) return `${s.slice(4)}.BO`;
  if (/^\d{5,6}$/.test(s)) return `${s}.BO`;
  return `${s}.NS`;
}

function tvTickersForSymbol(raw: string): string[] {
  const s = cleanIndianSymbol(raw);
  if (INDIA_INDICES[s]) return [INDIA_INDICES[s].tv];
  const scrip = indiaScrips.resolveScripSync(s);
  if (scrip) return [`${scrip.exchange}:${scrip.dispName}`];
  if (s.startsWith("NSE:")) return [s];
  if (s.startsWith("BSE:")) {
    const code = s.slice(4);
    if (/^\d{5,6}$/.test(code)) return [];
    return [s];
  }
  if (s.endsWith(".NS")) return [`NSE:${s.slice(0, -3)}`];
  if (s.endsWith(".BO")) return [`BSE:${s.slice(0, -3)}`];
  if (/^\d{5,6}$/.test(s)) return [];
  return [`NSE:${s}`, `BSE:${s}`];
}

const QUOTE_COLUMNS = [
  "description",
  "close",
  "change",
  "change_abs",
  "open",
  "high",
  "low",
  "volume",
  "average_volume_30d_calc",
  "market_cap_basic",
  "price_earnings_ttm",
  "earnings_per_share_basic_ttm",
  "dividends_yield_current",
  "beta_1_year",
  "total_shares_outstanding",
  "price_52_week_high",
  "price_52_week_low",
  "sector",
  "exchange",
];

const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);

const TV_COOLDOWN_MS = 60_000;
let tvCooldownUntil = 0;

async function tvIndiaPost(body: unknown): Promise<any> {
  if (Date.now() < tvCooldownUntil) {
    throw new Error("tradingview india rate-limited / unreachable (cooling down)");
  }
  let res: Response;
  try {
    res = await fetch("https://scanner.tradingview.com/india/scan", {
      method: "POST",
      headers: TV_HEADERS,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4_500),
    });
  } catch (err) {
    tvCooldownUntil = Date.now() + TV_COOLDOWN_MS;
    throw err;
  }
  if (!res.ok) {
    if (res.status === 429) tvCooldownUntil = Date.now() + TV_COOLDOWN_MS;
    throw new Error(`tradingview india scan ${res.status}`);
  }
  return res.json();
}

export async function quotes(symbols: string[]): Promise<yahoo.Quote[]> {
  const cleaned = symbols.map(cleanIndianSymbol).filter(Boolean);
  if (cleaned.length === 0) return [];
  if (cleaned.some((s) => /^\d{5,6}$/.test(s.replace(/^BSE:/, "")))) {
    await indiaScrips.getAllScrips().catch(() => []);
  }

  const tickerToRequested = new Map<string, string[]>();
  for (const sym of cleaned) {
    for (const tv of tvTickersForSymbol(sym)) {
      const list = tickerToRequested.get(tv) ?? [];
      if (!list.includes(sym)) list.push(sym);
      tickerToRequested.set(tv, list);
    }
  }

  const tickers = [...tickerToRequested.keys()];
  const bySymbol = new Map<string, yahoo.Quote>();

  try {
    const json = await tvIndiaPost({ symbols: { tickers }, columns: QUOTE_COLUMNS });
      const rows: Array<{ s: string; d: any[] }> = json?.data ?? [];
      for (const row of rows) {
        const [
          description,
          close,
          changePercent,
          changeAbs,
          open,
          high,
          low,
          volume,
          avgVolume,
          marketCap,
          pe,
          eps,
          divYield,
          beta,
          shares,
          week52High,
          week52Low,
          sector,
          exchange,
        ] = row.d;

        const price = num(close);
        const change = num(changeAbs);
        const previousClose = price !== null && change !== null ? price - change : null;
        const requestedList = tickerToRequested.get(row.s) ?? [];

        for (const reqSym of requestedList) {
          // Prefer NSE if both NSE and BSE match a bare ticker
          if (bySymbol.has(reqSym) && row.s.startsWith("BSE:") && !reqSym.startsWith("BSE:")) continue;
          const idxMeta = INDIA_INDICES[reqSym];
          bySymbol.set(reqSym, {
            symbol: reqSym,
            name: idxMeta?.name ?? description ?? reqSym,
            price,
            change,
            changePercent: num(changePercent),
            open: num(open),
            high: num(high),
            low: num(low),
            previousClose,
            bid: null,
            ask: null,
            volume: num(volume),
            avgVolume: num(avgVolume),
            marketCap: num(marketCap),
            pe: num(pe),
            eps: num(eps),
            dividendYield: divYield !== null && divYield !== undefined && isFinite(divYield) ? divYield / 100 : null,
            week52High: num(week52High),
            week52Low: num(week52Low),
            beta: num(beta),
            sharesOutstanding: num(shares),
            currency: "INR",
            exchange: idxMeta?.exchange ?? exchange ?? (row.s.startsWith("BSE:") ? "BSE" : "NSE"),
            marketState: null,
            time: Math.floor(Date.now() / 1000),
            source: "tradingview-india",
            ...(sector ? { sector } : {}),
          } as yahoo.Quote);
        }
      }
  } catch {
    // Fall through to Yahoo fallback for missing tickers
  }

  const missing = cleaned.filter((s) => !bySymbol.has(s));
  if (missing.length > 0) {
    const results = await Promise.allSettled(
      missing.slice(0, 20).map(async (sym) => {
        const ySym = toYahooIndianSymbol(sym);
        const q = await yahoo.quoteFromChart(ySym);
        const idxMeta = INDIA_INDICES[sym];
        return {
          sym,
          quote: {
            ...q,
            symbol: sym,
            name: idxMeta?.name ?? q.name ?? sym,
            currency: q.currency ?? "INR",
            exchange: idxMeta?.exchange ?? (ySym.endsWith(".BO") ? "BSE" : "NSE"),
          },
        };
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled") bySymbol.set(r.value.sym, r.value.quote);
    }
  }

  return cleaned.map((s) => bySymbol.get(s)!).filter(Boolean);
}

export async function indices(): Promise<yahoo.Quote[]> {
  return quotes([...INDEX_SYMBOLS]);
}

const RANGE_MAP: Record<string, { range: string; interval: string; mcRes: string; lookbackSec: number }> = {
  "1D": { range: "1d", interval: "5m", mcRes: "5", lookbackSec: 2 * 86_400 },
  "5D": { range: "5d", interval: "15m", mcRes: "15", lookbackSec: 7 * 86_400 },
  "1M": { range: "1mo", interval: "1h", mcRes: "60", lookbackSec: 32 * 86_400 },
  "6M": { range: "6mo", interval: "1d", mcRes: "1D", lookbackSec: 185 * 86_400 },
  YTD: { range: "ytd", interval: "1d", mcRes: "1D", lookbackSec: 365 * 86_400 },
  "1Y": { range: "1y", interval: "1d", mcRes: "1D", lookbackSec: 366 * 86_400 },
  "5Y": { range: "5y", interval: "1wk", mcRes: "1W", lookbackSec: 5 * 366 * 86_400 },
  MAX: { range: "max", interval: "1mo", mcRes: "1M", lookbackSec: 20 * 366 * 86_400 },
};

const INTERVAL_MAP: Record<
  string,
  { yahooRange: string; yahooInterval: string; mcRes: string; lookbackSec: number; resampleSec?: number }
> = {
  "1m": { yahooRange: "5d", yahooInterval: "1m", mcRes: "1", lookbackSec: 5 * 86_400 },
  "3m": { yahooRange: "5d", yahooInterval: "1m", mcRes: "1", lookbackSec: 5 * 86_400, resampleSec: 180 },
  "5m": { yahooRange: "5d", yahooInterval: "5m", mcRes: "5", lookbackSec: 7 * 86_400 },
  "15m": { yahooRange: "1mo", yahooInterval: "15m", mcRes: "15", lookbackSec: 30 * 86_400 },
  "30m": { yahooRange: "1mo", yahooInterval: "30m", mcRes: "30", lookbackSec: 30 * 86_400 },
  "1h": { yahooRange: "3mo", yahooInterval: "60m", mcRes: "60", lookbackSec: 90 * 86_400 },
  "1D": { yahooRange: "1y", yahooInterval: "1d", mcRes: "1D", lookbackSec: 366 * 86_400 },
  "1W": { yahooRange: "5y", yahooInterval: "1wk", mcRes: "1W", lookbackSec: 5 * 366 * 86_400 },
  "1MO": { yahooRange: "max", yahooInterval: "1mo", mcRes: "1M", lookbackSec: 20 * 366 * 86_400 },
};

function resampleCandles(candles: yahoo.Candle[], bucketSec: number): yahoo.Candle[] {
  if (candles.length === 0) return [];
  const buckets = new Map<number, yahoo.Candle>();
  for (const c of candles) {
    const t = Math.floor(c.time / bucketSec) * bucketSec;
    const prev = buckets.get(t);
    if (!prev) {
      buckets.set(t, { time: t, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
    } else {
      prev.high = Math.max(prev.high, c.high);
      prev.low = Math.min(prev.low, c.low);
      prev.close = c.close;
      prev.volume += c.volume;
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

async function moneycontrolHistory(symbol: string, mcRes: string, lookbackSec: number, rangeKey?: string): Promise<yahoo.Candle[]> {
  const scrip = await indiaScrips.resolveScrip(symbol).catch(() => null);
  const clean =
    scrip?.dispName ??
    cleanIndianSymbol(symbol)
      .replace(/^(NSE|BSE):/, "")
      .replace(/\.(NS|BO)$/, "");
  if (INDIA_INDICES[cleanIndianSymbol(symbol)] || clean.startsWith("^") || clean.includes("=")) return [];
  const to = Math.floor(Date.now() / 1000);
  const from =
    rangeKey === "YTD"
      ? Math.floor(new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)).getTime() / 1000)
      : to - lookbackSec;
  const url = `https://priceapi.moneycontrol.com/techCharts/indianMarket/stock/history?symbol=${encodeURIComponent(
    clean
  )}&resolution=${encodeURIComponent(mcRes)}&from=${from}&to=${to}&countback=1000`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://www.moneycontrol.com/" },
    signal: AbortSignal.timeout(4_000),
  });
  if (!res.ok) return [];
  const json: any = await res.json();
  if (json?.s !== "ok" || !Array.isArray(json?.t)) return [];
  const candles: yahoo.Candle[] = [];
  for (let i = 0; i < json.t.length; i++) {
    const o = Number(json.o?.[i]);
    const h = Number(json.h?.[i]);
    const l = Number(json.l?.[i]);
    const c = Number(json.c?.[i]);
    const t = Number(json.t[i]);
    if (!isFinite(t) || !isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) continue;
    candles.push({ time: t, open: o, high: h, low: l, close: c, volume: Number(json.v?.[i] ?? 0) || 0 });
  }
  return candles;
}

export async function history(symbol: string, rangeKey = "6M", intervalKey?: string): Promise<yahoo.Candle[]> {
  // Only block on scrip master download for numeric BSE codes; alphanumeric NSE tickers resolve synchronously
  if (/^\d{5,6}$/.test(cleanIndianSymbol(symbol).replace(/^BSE:/, ""))) {
    await indiaScrips.resolveScrip(symbol).catch(() => null);
  }
  const ivCfg = intervalKey ? INTERVAL_MAP[intervalKey] : undefined;
  const rCfg = RANGE_MAP[rangeKey] ?? RANGE_MAP["6M"];

  const yahooRange = ivCfg
    ? intervalKey === "1D" && RANGE_MAP[rangeKey]
      ? RANGE_MAP[rangeKey].range
      : ivCfg.yahooRange
    : rCfg.range;
  const yahooInterval = ivCfg ? ivCfg.yahooInterval : rCfg.interval;
  const mcRes = ivCfg ? ivCfg.mcRes : rCfg.mcRes;
  const lookbackSec = ivCfg
    ? intervalKey === "1D" && RANGE_MAP[rangeKey]
      ? RANGE_MAP[rangeKey].lookbackSec
      : ivCfg.lookbackSec
    : rCfg.lookbackSec;
  const resampleSec = ivCfg?.resampleSec;

  const finalize = (bars: yahoo.Candle[]) => (resampleSec ? resampleCandles(bars, resampleSec) : bars);

  const ySym = toYahooIndianSymbol(symbol);
  try {
    const candles = await yahoo.history(ySym, yahooRange, yahooInterval);
    if (candles.length > 0) return finalize(candles);
  } catch (err) {
    if (!symbol.includes(".") && !symbol.startsWith("NSE:") && !symbol.startsWith("BSE:") && !INDIA_INDICES[cleanIndianSymbol(symbol)]) {
      try {
        const bse = await yahoo.history(`${cleanIndianSymbol(symbol)}.BO`, yahooRange, yahooInterval);
        if (bse.length > 0) return finalize(bse);
      } catch {
        // fall through to Moneycontrol chart fallback
      }
    }
    const mc = await moneycontrolHistory(symbol, mcRes, lookbackSec, rangeKey).catch(() => []);
    if (mc.length > 0) return finalize(mc);
    throw err;
  }
  const mc = await moneycontrolHistory(symbol, mcRes, lookbackSec, rangeKey).catch(() => []);
  return finalize(mc);
}

export type IndianMarketRow = {
  symbol: string;
  name: string;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  marketCap: number | null;
  sector: string;
  exchange: string;
  currency: string;
};

export async function marketScan(limit = 5000, exchangeFilter: "NSE" | "BSE" | "ALL" = "NSE"): Promise<IndianMarketRow[]> {
  const filter: any[] = [
    { left: "type", operation: "equal", right: "stock" },
    { left: "typespecs", operation: "has", right: ["common"] },
  ];
  if (exchangeFilter !== "ALL") {
    filter.push({ left: "exchange", operation: "equal", right: exchangeFilter });
  }

  const json = await tvIndiaPost({
    columns: ["description", "close", "change", "market_cap_basic", "sector", "volume", "exchange"],
    filter,
    sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
    range: [0, limit],
  });
  const rows: Array<{ s: string; d: any[] }> = json?.data ?? [];
  return rows
    .map((r) => {
      const [name, close, change, marketCap, sector, volume, exchange] = r.d;
      const ticker = r.s.split(":")[1] ?? r.s;
      const exch = exchange ?? (r.s.startsWith("BSE:") ? "BSE" : "NSE");
      return {
        symbol: exch === "BSE" ? `BSE:${ticker}` : ticker,
        name: name ?? ticker,
        price: num(close),
        changePercent: num(change),
        marketCap: num(marketCap),
        sector: sector || "Other",
        volume: num(volume),
        exchange: exch,
        currency: "INR",
      };
    })
    .filter((r) => r.symbol);
}

export type IndianSearchResult = { symbol: string; name: string; exchange: string; type: string };

export async function search(query: string): Promise<IndianSearchResult[]> {
  const qLower = query.trim().toLowerCase();
  const indexMatches: IndianSearchResult[] = [
    { symbol: "NIFTY50", name: "NIFTY 50 Index", exchange: "NSE", type: "index" },
    { symbol: "SENSEX", name: "BSE SENSEX Index", exchange: "BSE", type: "index" },
    { symbol: "NIFTYNXT50", name: "NIFTY Next 50 Index", exchange: "NSE", type: "index" },
    { symbol: "NIFTYBANK", name: "NIFTY Bank Index", exchange: "NSE", type: "index" },
    { symbol: "INDIAVIX", name: "India VIX Volatility Index", exchange: "NSE", type: "index" },
  ].filter(
    (i) => i.symbol.toLowerCase().includes(qLower) || i.name.toLowerCase().includes(qLower)
  );

  // Query full ~24,000 NSE & BSE Scrip Master first + TradingView search in parallel
  const [scripsRes, tvRes] = await Promise.allSettled([
    indiaScrips.searchScrips(query, "ALL", 25),
    (async () => {
      const url = `https://symbol-search.tradingview.com/symbol_search/v3/?text=${encodeURIComponent(
        query
      )}&hl=1&lang=en&search_type=undefined&domain=production&sort_by_country=IN`;
      const res = await fetch(url, { headers: TV_HEADERS });
      if (!res.ok) return [];
      const json = await res.json();
      return (json?.symbols ?? []) as any[];
    })(),
  ]);

  const seen = new Set<string>(indexMatches.map((i) => i.symbol));
  const out: IndianSearchResult[] = [...indexMatches];

  if (scripsRes.status === "fulfilled") {
    for (const s of scripsRes.value) {
      if (seen.has(s.symbol)) continue;
      seen.add(s.symbol);
      out.push({
        symbol: s.symbol,
        name: s.exchange === "BSE" && s.excToken ? `${s.name} (${s.excToken})` : s.name,
        exchange: s.exchange,
        type: s.asset,
      });
      if (out.length >= 25) return out;
    }
  }

  const strip = (s: string) => String(s).replace(/<\/?em>/g, "");
  const rows = tvRes.status === "fulfilled" ? tvRes.value : [];
  const indianRows = rows.filter((r) => {
    const ex = String(r.exchange ?? "").toUpperCase();
    return (ex === "NSE" || ex === "BSE") && ["stock", "fund", "dr", "index"].includes(r.type);
  });
  const chosen = indianRows.length > 0 ? indianRows : rows.filter((r) => ["stock", "fund", "dr", "index"].includes(r.type));

  for (const r of chosen) {
    const exchange = String(r.exchange ?? "").toUpperCase();
    const rawSym = strip(r.symbol ?? "");
    const symbol = exchange === "BSE" ? `BSE:${rawSym}` : rawSym;
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push({
      symbol,
      name: strip(r.description ?? rawSym),
      exchange: exchange || "NSE",
      type: r.type ?? "stock",
    });
    if (out.length >= 30) break;
  }

  return out;
}

export type IndianEarningsInfo = {
  symbol: string;
  nextEarningsDate: number | null;
  lastEarningsDate: number | null;
  epsForecast: number | null;
};

export async function earningsCalendar(symbols: string[]): Promise<IndianEarningsInfo[]> {
  const cleaned = symbols.map(cleanIndianSymbol).filter(Boolean);
  if (cleaned.length === 0) return [];
  const tickers = cleaned.flatMap((s) => tvTickersForSymbol(s));
  const json = await tvIndiaPost({
    symbols: { tickers },
    columns: ["earnings_release_next_date", "earnings_release_date", "earnings_per_share_forecast_next_fq"],
  });
  const rows: Array<{ s: string; d: (number | null)[] }> = json?.data ?? [];

  const bySymbol = new Map<string, IndianEarningsInfo>();
  for (const row of rows) {
    const sym = row.s.split(":")[1];
    if (bySymbol.has(sym)) continue;
    const [nextEarningsDate, lastEarningsDate, epsForecast] = row.d;
    bySymbol.set(sym, { symbol: sym, nextEarningsDate, lastEarningsDate, epsForecast });
  }
  return cleaned.map(
    (s) =>
      bySymbol.get(s) ??
      bySymbol.get(s.replace(/^(NSE|BSE):/, "")) ?? {
        symbol: s,
        nextEarningsDate: null,
        lastEarningsDate: null,
        epsForecast: null,
      }
  );
}
