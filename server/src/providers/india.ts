import * as yahoo from "./yahoo.js";

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
  // Forex pairs, futures, or non-Indian suffixed tickers
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
  if (s.startsWith("NSE:")) return `${s.slice(4)}.NS`;
  if (s.startsWith("BSE:")) return `${s.slice(4)}.BO`;
  return `${s}.NS`;
}

function tvTickersForSymbol(raw: string): string[] {
  const s = cleanIndianSymbol(raw);
  if (INDIA_INDICES[s]) return [INDIA_INDICES[s].tv];
  if (s.startsWith("NSE:") || s.startsWith("BSE:")) return [s];
  if (s.endsWith(".NS")) return [`NSE:${s.slice(0, -3)}`];
  if (s.endsWith(".BO")) return [`BSE:${s.slice(0, -3)}`];
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

export async function quotes(symbols: string[]): Promise<yahoo.Quote[]> {
  const cleaned = symbols.map(cleanIndianSymbol).filter(Boolean);
  if (cleaned.length === 0) return [];

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
    const res = await fetch("https://scanner.tradingview.com/india/scan", {
      method: "POST",
      headers: TV_HEADERS,
      body: JSON.stringify({ symbols: { tickers }, columns: QUOTE_COLUMNS }),
    });
    if (res.ok) {
      const json = await res.json();
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

async function moneycontrolHistory(symbol: string, rangeKey: string): Promise<yahoo.Candle[]> {
  const clean = cleanIndianSymbol(symbol).replace(/^(NSE|BSE):/, "").replace(/\.(NS|BO)$/, "");
  if (INDIA_INDICES[cleanIndianSymbol(symbol)] || clean.startsWith("^") || clean.includes("=")) return [];
  const { mcRes, lookbackSec } = RANGE_MAP[rangeKey] ?? RANGE_MAP["6M"];
  const to = Math.floor(Date.now() / 1000);
  const from =
    rangeKey === "YTD"
      ? Math.floor(new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)).getTime() / 1000)
      : to - lookbackSec;
  const url = `https://priceapi.moneycontrol.com/techCharts/indianMarket/stock/history?symbol=${encodeURIComponent(
    clean
  )}&resolution=${encodeURIComponent(mcRes)}&from=${from}&to=${to}&countback=500`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://www.moneycontrol.com/" },
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

export async function history(symbol: string, rangeKey = "6M"): Promise<yahoo.Candle[]> {
  const { range, interval } = RANGE_MAP[rangeKey] ?? RANGE_MAP["6M"];
  const ySym = toYahooIndianSymbol(symbol);
  try {
    const candles = await yahoo.history(ySym, range, interval);
    if (candles.length > 0) return candles;
  } catch (err) {
    if (!symbol.includes(".") && !symbol.startsWith("NSE:") && !INDIA_INDICES[cleanIndianSymbol(symbol)]) {
      try {
        const bse = await yahoo.history(`${cleanIndianSymbol(symbol)}.BO`, range, interval);
        if (bse.length > 0) return bse;
      } catch {
        // fall through to Moneycontrol chart fallback
      }
    }
    const mc = await moneycontrolHistory(symbol, rangeKey).catch(() => []);
    if (mc.length > 0) return mc;
    throw err;
  }
  const mc = await moneycontrolHistory(symbol, rangeKey).catch(() => []);
  return mc;
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

export async function marketScan(limit = 1500, exchangeFilter: "NSE" | "BSE" | "ALL" = "NSE"): Promise<IndianMarketRow[]> {
  const filter: any[] = [
    { left: "type", operation: "equal", right: "stock" },
    { left: "typespecs", operation: "has", right: ["common"] },
  ];
  if (exchangeFilter !== "ALL") {
    filter.push({ left: "exchange", operation: "equal", right: exchangeFilter });
  }

  const res = await fetch("https://scanner.tradingview.com/india/scan", {
    method: "POST",
    headers: TV_HEADERS,
    body: JSON.stringify({
      columns: ["description", "close", "change", "market_cap_basic", "sector", "volume", "exchange"],
      filter,
      sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
      range: [0, limit],
    }),
  });
  if (!res.ok) throw new Error(`tradingview india scan ${res.status}`);
  const json = await res.json();
  const rows: Array<{ s: string; d: any[] }> = json?.data ?? [];
  return rows
    .map((r) => {
      const [name, close, change, marketCap, sector, volume, exchange] = r.d;
      const ticker = r.s.split(":")[1] ?? r.s;
      const exch = exchange ?? (r.s.startsWith("BSE:") ? "BSE" : "NSE");
      return {
        symbol: exch === "BSE" && exchangeFilter === "BSE" ? `BSE:${ticker}` : ticker,
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

  const url = `https://symbol-search.tradingview.com/symbol_search/v3/?text=${encodeURIComponent(
    query
  )}&hl=1&lang=en&search_type=undefined&domain=production&sort_by_country=IN`;
  const res = await fetch(url, { headers: TV_HEADERS });
  if (!res.ok) throw new Error(`tradingview search ${res.status}`);
  const json = await res.json();
  const rows: any[] = json?.symbols ?? [];
  const strip = (s: string) => String(s).replace(/<\/?em>/g, "");

  const indianRows = rows.filter((r) => {
    const ex = String(r.exchange ?? "").toUpperCase();
    return (ex === "NSE" || ex === "BSE") && ["stock", "fund", "dr", "index"].includes(r.type);
  });

  const chosen = indianRows.length > 0 ? indianRows : rows.filter((r) => ["stock", "fund", "dr", "index"].includes(r.type));

  const seen = new Set<string>(indexMatches.map((i) => i.symbol));
  const out: IndianSearchResult[] = [...indexMatches];

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
    if (out.length >= 15) break;
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
  const res = await fetch("https://scanner.tradingview.com/india/scan", {
    method: "POST",
    headers: TV_HEADERS,
    body: JSON.stringify({
      symbols: { tickers },
      columns: ["earnings_release_next_date", "earnings_release_date", "earnings_per_share_forecast_next_fq"],
    }),
  });
  if (!res.ok) throw new Error(`tradingview india earnings ${res.status}`);
  const json = await res.json();
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
