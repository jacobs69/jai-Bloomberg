import { XMLParser } from "fast-xml-parser";

export type IndianNewsItem = {
  title: string;
  link: string;
  publisher: string;
  publishedAt: string | null;
  symbol: string | null;
};

const parser = new XMLParser({ ignoreAttributes: false });
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const RSS_FEEDS = {
  moneycontrolTop: "https://www.moneycontrol.com/rss/MCtopnews.xml",
  moneycontrolMarkets: "https://www.moneycontrol.com/rss/marketreports.xml",
  moneycontrolBusiness: "https://www.moneycontrol.com/rss/business.xml",
  moneycontrolIpo: "https://www.moneycontrol.com/rss/iponews.xml",
  etMarkets: "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
  etStocks: "https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms",
  etIpo: "https://economictimes.indiatimes.com/markets/ipos/fpos/rssfeeds/14655708.cms",
  businessToday: "https://www.businesstoday.in/rssfeeds/?id=1921",
  businessTodayMarkets: "https://www.businesstoday.in/rssfeeds/?id=1926",
};

function cleanTitle(raw: unknown): string {
  return String(raw ?? "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function safeIso(dateStr: unknown): string | null {
  if (!dateStr) return null;
  const d = new Date(String(dateStr));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

async function fetchRss(url: string, publisher: string, symbol: string | null): Promise<IndianNewsItem[]> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`rss ${res.status} ${url}`);
  const xml = await res.text();
  const doc = parser.parse(xml);
  const items = doc?.rss?.channel?.item ?? [];
  const list = Array.isArray(items) ? items : [items];
  return list
    .filter((i: any) => i?.title && i?.link)
    .map((i: any) => ({
      title: cleanTitle(i.title),
      link: String(i.link).trim(),
      publisher: i.source?.["#text"] ? cleanTitle(i.source["#text"]) : publisher,
      publishedAt: safeIso(i.pubDate),
      symbol,
    }));
}

function googleNewsIndiaUrl(query: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
}

export function dedupe(lists: IndianNewsItem[][]): IndianNewsItem[] {
  const seen = new Set<string>();
  const out: IndianNewsItem[] = [];
  for (const item of lists.flat()) {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
}

async function settleAll(jobs: Array<Promise<IndianNewsItem[]>>): Promise<IndianNewsItem[]> {
  const results = await Promise.allSettled(jobs);
  const ok = results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<IndianNewsItem[]>).value);
  if (ok.length === 0) throw new Error("All Indian news feeds unavailable");
  return dedupe(ok);
}

export async function topNews(): Promise<IndianNewsItem[]> {
  const items = await settleAll([
    fetchRss(RSS_FEEDS.moneycontrolMarkets, "Moneycontrol", null),
    fetchRss(RSS_FEEDS.moneycontrolTop, "Moneycontrol", null),
    fetchRss(RSS_FEEDS.etMarkets, "Economic Times", null),
    fetchRss(RSS_FEEDS.etStocks, "Economic Times", null),
    fetchRss(RSS_FEEDS.businessToday, "Business Today", null),
    fetchRss(googleNewsIndiaUrl("Indian stock market NSE BSE Nifty Sensex"), "Google News India", null),
  ]);
  return items.slice(0, 50);
}

export async function symbolNews(symbol: string): Promise<IndianNewsItem[]> {
  const clean = symbol.replace(/^(NSE|BSE):|\.(NS|BO)$/gi, "").trim();
  const items = await settleAll([
    fetchRss(googleNewsIndiaUrl(`${clean} NSE BSE stock share price`), "Google News India", symbol),
    fetchRss(RSS_FEEDS.moneycontrolMarkets, "Moneycontrol", symbol).then((rows) =>
      rows.filter((r) => r.title.toLowerCase().includes(clean.toLowerCase()))
    ),
    fetchRss(RSS_FEEDS.etStocks, "Economic Times", symbol).then((rows) =>
      rows.filter((r) => r.title.toLowerCase().includes(clean.toLowerCase()))
    ),
    fetchRss(RSS_FEEDS.businessTodayMarkets, "Business Today", symbol).then((rows) =>
      rows.filter((r) => r.title.toLowerCase().includes(clean.toLowerCase()))
    ),
  ]);
  return items.slice(0, 40);
}

const SECTOR_QUERIES: Record<string, string> = {
  IT: "India IT sector stocks TCS Infosys Wipro Nifty IT",
  BANKS: "India banking stocks HDFC ICICI SBI Nifty Bank",
  PHARMA: "India pharma stocks Sun Pharma Cipla Nifty Pharma",
  FMCG: "India FMCG stocks HUL ITC Nestle Nifty FMCG",
  METALS: "India metal stocks Tata Steel JSW Hindalco Nifty Metal",
  AUTO: "India auto stocks Tata Motors Maruti Mahindra Nifty Auto",
  ENERGY: "India energy oil gas stocks Reliance ONGC NTPC",
};

export async function sectorNews(sector: string): Promise<IndianNewsItem[]> {
  const key = sector.trim().toUpperCase();
  const query = SECTOR_QUERIES[key] ?? `India ${sector} sector stocks NSE BSE`;
  const items = await settleAll([
    fetchRss(googleNewsIndiaUrl(query), "Google News India", null),
    fetchRss(RSS_FEEDS.etStocks, "Economic Times", null).then((rows) =>
      rows.filter((r) => r.title.toLowerCase().includes(sector.toLowerCase()))
    ),
  ]);
  return items.slice(0, 40);
}

const INDEX_QUERIES: Record<string, string> = {
  NIFTY50: "Nifty 50 NSE stock market today",
  SENSEX: "BSE Sensex stock market today",
  NIFTYNXT50: "Nifty Next 50 NSE stocks",
  NIFTYBANK: "Bank Nifty NSE banking stocks today",
};

export async function indexNews(index: string): Promise<IndianNewsItem[]> {
  const key = index.trim().toUpperCase();
  const query = INDEX_QUERIES[key] ?? `${index} Indian stock market`;
  const items = await settleAll([
    fetchRss(googleNewsIndiaUrl(query), "Google News India", key),
    fetchRss(RSS_FEEDS.moneycontrolMarkets, "Moneycontrol", key),
    fetchRss(RSS_FEEDS.etMarkets, "Economic Times", key),
  ]);
  return items.slice(0, 40);
}

export async function ipoNews(): Promise<IndianNewsItem[]> {
  const items = await settleAll([
    fetchRss(RSS_FEEDS.moneycontrolIpo, "Moneycontrol", "IPO"),
    fetchRss(RSS_FEEDS.etIpo, "Economic Times", "IPO"),
    fetchRss(googleNewsIndiaUrl("India IPO GMP allotment listing NSE BSE"), "Google News India", "IPO"),
  ]);
  return items.slice(0, 40);
}
