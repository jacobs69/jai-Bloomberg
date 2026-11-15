import { XMLParser } from "fast-xml-parser";
import { cacheGet } from "../cache.js";
import * as india from "./india.js";
import * as nasdaq from "./nasdaq.js";
import * as tankermap from "./tankermap.js";
import * as yahoo from "./yahoo.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const xmlParser = new XMLParser({ ignoreAttributes: false });

export type ChokepointAssessment = {
  id: string;
  label: string;
  lat: number;
  lon: number;
  zoom: number;
  bounds: [number, number, number, number];
  indiaRelevance: string;
  exposedTickers: string[];
  aisCount: number | null;
  crudeCount: number | null;
  productCount: number | null;
  lngCount: number | null;
  loadedPct: number | null;
  anchoredPct: number | null;
  avgSpeedKnots: number | null;
  newsHits: number;
  disruptionHits: number;
  riskScore: number;
  status: "NORMAL" | "ELEVATED" | "CRITICAL";
  summary: string;
};

export type SeaCorridor = {
  id: string;
  name: string;
  shortName: string;
  commodity: "Crude & LNG" | "Crude & Products" | "Diversion Route";
  riskScore: number;
  status: "NORMAL" | "ELEVATED" | "CRITICAL";
  waypoints: Array<[number, number]>;
  transitNote: string;
  impactedTickers: string[];
};

export type MaritimeHeadline = {
  title: string;
  link: string;
  publisher: string;
  publishedAt: string | null;
  regions: string[];
  disruption: boolean;
};

export type BenchmarkQuote = {
  symbol: string;
  label: string;
  price: number | null;
  changePercent: number | null;
  currency: string | null;
};

export type TankerJudgmentResponse = {
  updatedAt: string;
  aisAvailable: boolean;
  aisError: string | null;
  aisTotalVessels: number | null;
  verdict: {
    overallScore: number;
    regime: string;
    indiaImpact: string;
    drivers: string[];
  };
  benchmarks: {
    brent: BenchmarkQuote;
    wti: BenchmarkQuote;
    natgas: BenchmarkQuote;
    usdinr: BenchmarkQuote;
    brentWtiSpread: number | null;
    brentInrPerBbl: number | null;
    omcAvgChangePct: number | null;
    upstreamAvgChangePct: number | null;
    tankerAvgChangePct: number | null;
    tankerStocks: BenchmarkQuote[];
    indiaEnergyStocks: BenchmarkQuote[];
  };
  chokepoints: ChokepointAssessment[];
  corridors: SeaCorridor[];
  headlines: MaritimeHeadline[];
};

type RegionMeta = {
  id: string;
  label: string;
  lat: number;
  lon: number;
  zoom: number;
  bounds: [number, number, number, number];
  indiaRelevance: string;
  exposedTickers: string[];
  keywords: RegExp;
};

const REGIONS: RegionMeta[] = [
  {
    id: "hormuz",
    label: "Hormuz",
    lat: 26.2,
    lon: 56.3,
    zoom: 7,
    bounds: [24.2, 27.6, 53.5, 58.6],
    indiaRelevance: "~40% of India's seaborne crude & LNG transits Strait of Hormuz",
    exposedTickers: ["IOC", "BPCL", "HINDPETRO", "RELIANCE", "GAIL", "ONGC"],
    keywords: /\bhormuz|persian gulf|iran|fujairah|kharg|qatar lng\b/i,
  },
  {
    id: "redsea",
    label: "Red Sea",
    lat: 19.0,
    lon: 39.0,
    zoom: 5,
    bounds: [11.8, 29.8, 32.0, 45.0],
    indiaRelevance: "Critical Saudi/Yanbu & Russian Urals-to-India tanker passage",
    exposedTickers: ["IOC", "BPCL", "HINDPETRO", "RELIANCE", "FRO", "INSW"],
    keywords: /\bred sea|bab el-mandeb|bab al-mandab|houthi|yemen|aden|yanbu|saudi tanker\b/i,
  },
  {
    id: "suez",
    label: "Suez Canal",
    lat: 30.5,
    lon: 32.35,
    zoom: 8,
    bounds: [29.7, 31.6, 32.0, 32.8],
    indiaRelevance: "Links Russian/Med Urals crude south to Suez & India West Coast",
    exposedTickers: ["RELIANCE", "IOC", "BPCL", "STNG", "FRO"],
    keywords: /\bsuez|sumed|mediterranean\b/i,
  },
  {
    id: "india",
    label: "India Coast",
    lat: 18.5,
    lon: 73.0,
    zoom: 5,
    bounds: [5.5, 24.5, 65.5, 89.0],
    indiaRelevance: "Direct crude discharge at Jamnagar, Vadinar, Mumbai, Kochi & Paradip",
    exposedTickers: ["RELIANCE", "IOC", "BPCL", "HINDPETRO", "MRPL", "CHENNPETRO"],
    keywords: /\bindia|jamnagar|vadinar|paradip|mumbai|mangalore|indian refiners|omcs?\b/i,
  },
  {
    id: "malacca",
    label: "Malacca",
    lat: 2.8,
    lon: 101.5,
    zoom: 6,
    bounds: [0.4, 6.8, 97.5, 105.0],
    indiaRelevance: "East-bound Asian crude/products flow; Singapore bunker & refining hub",
    exposedTickers: ["RELIANCE", "MRPL", "STNG", "DHT"],
    keywords: /\bmalacca|singapore|south china sea|east asia\b/i,
  },
  {
    id: "blacksea",
    label: "Black Sea",
    lat: 43.5,
    lon: 30.6,
    zoom: 6,
    bounds: [40.8, 46.8, 27.2, 41.8],
    indiaRelevance: "CPC & Novorossiysk Urals crude exports via Bosphorus bound for India",
    exposedTickers: ["RELIANCE", "IOC", "BPCL", "FRO", "INSW"],
    keywords: /\bblack sea|novorossiysk|bosphorus|turkish straits|cpc|kerch|crimea|ukraine tanker\b/i,
  },
  {
    id: "northsea",
    label: "North Sea",
    lat: 53.8,
    lon: 3.2,
    zoom: 5,
    bounds: [49.5, 61.0, -3.5, 9.5],
    indiaRelevance: "Brent Dated physical hub & Baltic/Urals shadow-fleet enforcement zone",
    exposedTickers: ["ONGC", "FRO", "DHT", "INSW"],
    keywords: /\bnorth sea|baltic|russia|urals|shadow fleet|rotterdam|danish strait\b/i,
  },
  {
    id: "usgulf",
    label: "US Gulf",
    lat: 27.8,
    lon: -90.5,
    zoom: 6,
    bounds: [23.5, 30.8, -98.0, -81.5],
    indiaRelevance: "WTI/USGC light sweet exports supplying India swing imports",
    exposedTickers: ["RELIANCE", "IOC", "INSW", "STNG"],
    keywords: /\bus gulf|louisiana|houston|corpus christi|wti|panama\b/i,
  },
];

const DISRUPTION_WORDS =
  /\b(attack|strike|houthi|dark|u-turn|divert|reroute|cape of good hope|seiz|hijack|blockade|sanction|surge|spike|past \$100|delay|congestion|wait|tension|war|missile|drone|shortage|stress|embargo)\b/i;

const STRATEGIC_PORTS_FALLBACK: tankermap.TankerPort[] = [
  { id: 9001, name: "Jamnagar / Sikka", slug: "jamnagar", country: "India", lat: 22.43, lon: 69.82, port_type: "Refinery Terminal", commodity: "Crude & Products", direction: "Import", capacity_value: "1.4M bpd", capacity_unit: "bpd", in_port_count: null },
  { id: 9002, name: "Vadinar Terminal", slug: "vadinar", country: "India", lat: 22.44, lon: 69.67, port_type: "SPM Oil Port", commodity: "Crude", direction: "Import", capacity_value: "580k bpd", capacity_unit: "bpd", in_port_count: null },
  { id: 9003, name: "Paradip Oil Terminal", slug: "paradip", country: "India", lat: 20.26, lon: 86.67, port_type: "Crude Import", commodity: "Crude", direction: "Import", capacity_value: "300k bpd", capacity_unit: "bpd", in_port_count: null },
  { id: 9004, name: "Ras Tanura", slug: "ras-tanura", country: "Saudi Arabia", lat: 26.64, lon: 50.16, port_type: "Export Mega-Terminal", commodity: "Crude", direction: "Export", capacity_value: "6.5M bpd", capacity_unit: "bpd", in_port_count: null },
  { id: 9005, name: "Fujairah Oil Hub", slug: "fujairah", country: "UAE", lat: 25.17, lon: 56.36, port_type: "Bunkering & Export", commodity: "Crude & Products", direction: "Export", capacity_value: "1.5M bpd", capacity_unit: "bpd", in_port_count: null },
  { id: 9006, name: "Al Basrah (ABOT)", slug: "basra", country: "Iraq", lat: 29.68, lon: 48.8, port_type: "Offshore Export", commodity: "Crude", direction: "Export", capacity_value: "3.3M bpd", capacity_unit: "bpd", in_port_count: null },
  { id: 9007, name: "Yanbu Terminal", slug: "yanbu", country: "Saudi Arabia", lat: 24.08, lon: 38.06, port_type: "Red Sea Bypass", commodity: "Crude & Products", direction: "Export", capacity_value: "5.0M bpd", capacity_unit: "bpd", in_port_count: null },
  { id: 9008, name: "Ras Laffan LNG", slug: "ras-laffan", country: "Qatar", lat: 25.93, lon: 51.54, port_type: "LNG Mega-Terminal", commodity: "LNG", direction: "Export", capacity_value: "77 MTPA", capacity_unit: "MTPA", in_port_count: null },
  { id: 9009, name: "Singapore Jurong", slug: "singapore", country: "Singapore", lat: 1.26, lon: 103.72, port_type: "Refining & Bunker", commodity: "Products & Crude", direction: "Transit", capacity_value: "1.5M bpd", capacity_unit: "bpd", in_port_count: null },
  { id: 9010, name: "Rotterdam Europoort", slug: "rotterdam", country: "Netherlands", lat: 51.95, lon: 4.13, port_type: "Import Hub", commodity: "Crude & Products", direction: "Import", capacity_value: "2.1M bpd", capacity_unit: "bpd", in_port_count: null },
  { id: 9011, name: "Primorsk Baltic", slug: "primorsk", country: "Russia", lat: 60.35, lon: 28.62, port_type: "Urals Export", commodity: "Crude", direction: "Export", capacity_value: "1.2M bpd", capacity_unit: "bpd", in_port_count: null },
  { id: 9012, name: "Novorossiysk", slug: "novorossiysk", country: "Russia", lat: 44.72, lon: 37.78, port_type: "CPC / Urals", commodity: "Crude", direction: "Export", capacity_value: "1.7M bpd", capacity_unit: "bpd", in_port_count: null },
  { id: 9013, name: "Corpus Christi", slug: "corpus-christi", country: "USA", lat: 27.81, lon: -97.15, port_type: "USGC Export", commodity: "Crude & LNG", direction: "Export", capacity_value: "2.4M bpd", capacity_unit: "bpd", in_port_count: null },
];

export function getStrategicPortsFallback(): tankermap.TankerPort[] {
  return STRATEGIC_PORTS_FALLBACK;
}

async function fetchYahooChartQuote(symbol: string, label: string): Promise<BenchmarkQuote> {
  try {
    const q = await yahoo.quoteFromChart(symbol);
    return {
      symbol,
      label,
      price: q.price,
      changePercent: q.changePercent,
      currency: q.currency,
    };
  } catch {
    return { symbol, label, price: null, changePercent: null, currency: "USD" };
  }
}

async function fetchMaritimeHeadlines(): Promise<MaritimeHeadline[]> {
  const urls = [
    "https://news.google.com/rss/search?q=oil+tanker+Hormuz+OR+Red+Sea+OR+Suez+OR+crude+India&hl=en-IN&gl=IN&ceid=IN:en",
    "https://news.google.com/rss/search?q=VLCC+OR+Brent+crude+chokepoint+OR+Malacca+OR+shadow+fleet+tanker&hl=en-US&gl=US&ceid=US:en",
  ];

  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const res = await fetch(url, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(`rss ${res.status}`);
      const xml = await res.text();
      const doc = xmlParser.parse(xml);
      const rawItems = doc?.rss?.channel?.item ?? [];
      return Array.isArray(rawItems) ? rawItems : [rawItems];
    })
  );

  const seen = new Set<string>();
  const out: MaritimeHeadline[] = [];

  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const item of r.value) {
      if (!item?.title || !item?.link) continue;
      const title = String(item.title).trim();
      const norm = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 72);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);

      const regions = REGIONS.filter((rg) => rg.keywords.test(title)).map((rg) => rg.id);
      const disruption = DISRUPTION_WORDS.test(title);
      out.push({
        title,
        link: String(item.link),
        publisher: item.source?.["#text"] ? String(item.source["#text"]) : "Maritime Feed",
        publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : null,
        regions,
        disruption,
      });
    }
  }

  return out
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, 24);
}

function avg(nums: Array<number | null | undefined>): number | null {
  const valid = nums.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export async function buildTankerJudgment(): Promise<TankerJudgmentResponse> {
  // 1. Grab cached AIS or attempt live fetch gracefully (never crashes widget)
  let aisData = cacheGet<{
    updatedAt: string;
    stats: {
      total: number;
      crude: number;
      product: number;
      lng: number;
      loaded: number;
      ballast: number;
      underway: number;
      anchored: number;
    };
    chokepoints: tankermap.ChokepointStat[];
    vessels: tankermap.TankerVessel[];
  }>("tankermap:live");

  let aisError: string | null = null;
  if (!aisData) {
    try {
      aisData = await tankermap.fetchAllLiveTankers();
    } catch (err) {
      aisError = err instanceof Error ? err.message : String(err);
    }
  }

  // 2. Fetch live energy & freight benchmarks + maritime headlines in parallel
  const [
    brent,
    wti,
    natgas,
    usdinr,
    tankerQuotesRes,
    indiaQuotesRes,
    headlinesRes,
  ] = await Promise.allSettled([
    fetchYahooChartQuote("BZ=F", "Brent Crude"),
    fetchYahooChartQuote("CL=F", "WTI Crude"),
    fetchYahooChartQuote("NG=F", "Natural Gas"),
    fetchYahooChartQuote("INR=X", "USD/INR"),
    Promise.all(["FRO", "STNG", "DHT", "INSW"].map((s) => nasdaq.quote(s).catch(() => null))),
    india.quotes(["ONGC", "OIL", "IOC", "BPCL", "HINDPETRO", "RELIANCE", "GAIL"]),
    fetchMaritimeHeadlines(),
  ]);

  const brentQ = brent.status === "fulfilled" ? brent.value : { symbol: "BZ=F", label: "Brent Crude", price: null, changePercent: null, currency: "USD" };
  const wtiQ = wti.status === "fulfilled" ? wti.value : { symbol: "CL=F", label: "WTI Crude", price: null, changePercent: null, currency: "USD" };
  const ngQ = natgas.status === "fulfilled" ? natgas.value : { symbol: "NG=F", label: "Natural Gas", price: null, changePercent: null, currency: "USD" };
  const fxQ = usdinr.status === "fulfilled" ? usdinr.value : { symbol: "INR=X", label: "USD/INR", price: null, changePercent: null, currency: "INR" };

  const tankerStocks: BenchmarkQuote[] =
    tankerQuotesRes.status === "fulfilled"
      ? tankerQuotesRes.value
          .filter((q): q is yahoo.Quote => Boolean(q))
          .map((q) => ({
            symbol: q.symbol,
            label: q.name ?? q.symbol,
            price: q.price,
            changePercent: q.changePercent,
            currency: q.currency,
          }))
      : [];

  const indiaLabels: Record<string, string> = {
    ONGC: "ONGC (Upstream)",
    OIL: "Oil India (Upstream)",
    IOC: "Indian Oil (OMC)",
    BPCL: "BPCL (OMC)",
    HINDPETRO: "HPCL (OMC)",
    RELIANCE: "Reliance Ind.",
    GAIL: "GAIL India",
  };
  const indiaEnergyStocks: BenchmarkQuote[] =
    indiaQuotesRes.status === "fulfilled"
      ? indiaQuotesRes.value.map((q) => ({
          symbol: q.symbol,
          label: indiaLabels[q.symbol] ?? q.name ?? q.symbol,
          price: q.price,
          changePercent: q.changePercent,
          currency: q.currency,
        }))
      : [];

  const headlines = headlinesRes.status === "fulfilled" ? headlinesRes.value : [];

  const brentWtiSpread =
    brentQ.price !== null && wtiQ.price !== null ? Number((brentQ.price - wtiQ.price).toFixed(2)) : null;
  const brentInrPerBbl =
    brentQ.price !== null && fxQ.price !== null ? Math.round(brentQ.price * fxQ.price) : null;

  const omcAvgChangePct = avg(
    indiaEnergyStocks.filter((s) => ["IOC", "BPCL", "HINDPETRO"].includes(s.symbol)).map((s) => s.changePercent)
  );
  const upstreamAvgChangePct = avg(
    indiaEnergyStocks.filter((s) => ["ONGC", "OIL"].includes(s.symbol)).map((s) => s.changePercent)
  );
  const tankerAvgChangePct = avg(tankerStocks.map((s) => s.changePercent));

  // Macro oil stress factor (0..35)
  let macroStress = 0;
  if (brentQ.price !== null) {
    if (brentQ.price >= 95) macroStress += 16;
    else if (brentQ.price >= 85) macroStress += 10;
    else if (brentQ.price >= 78) macroStress += 5;
  }
  if (brentQ.changePercent !== null && brentQ.changePercent >= 2) {
    macroStress += Math.min(10, brentQ.changePercent * 2);
  }
  if (brentWtiSpread !== null && brentWtiSpread >= 5) {
    macroStress += Math.min(8, (brentWtiSpread - 3) * 1.5);
  }
  if (omcAvgChangePct !== null && omcAvgChangePct <= -1) {
    macroStress += Math.min(8, Math.abs(omcAvgChangePct) * 2.5);
  }

  // 3. Evaluate each Chokepoint from real AIS + real maritime news + macro stress
  const vessels = aisData?.vessels ?? [];
  const chokepoints: ChokepointAssessment[] = REGIONS.map((rg) => {
    const [latMin, latMax, lonMin, lonMax] = rg.bounds;
    const regionVessels = aisData
      ? vessels.filter((v) => v.latitude >= latMin && v.latitude <= latMax && v.longitude >= lonMin && v.longitude <= lonMax)
      : [];

    const aisCount = aisData ? regionVessels.length : null;
    const crudeCount = aisData ? regionVessels.filter((v) => v.fleet === "crude").length : null;
    const productCount = aisData ? regionVessels.filter((v) => v.fleet === "product").length : null;
    const lngCount = aisData ? regionVessels.filter((v) => v.fleet === "lng").length : null;

    let loadedPct: number | null = null;
    let anchoredPct: number | null = null;
    let avgSpeedKnots: number | null = null;

    if (aisData && regionVessels.length > 0) {
      const cargoKnown = regionVessels.filter((v) => v.cargo_state === "loaded" || v.cargo_state === "ballast");
      if (cargoKnown.length > 0) {
        loadedPct = Math.round((cargoKnown.filter((v) => v.cargo_state === "loaded").length / cargoKnown.length) * 100);
      }
      const anchoredCount = regionVessels.filter((v) => {
        const moving = (v.speed_knots !== null && v.speed_knots >= 0.8) || (v.nav_status ?? "").toLowerCase().includes("underway");
        return !moving;
      }).length;
      anchoredPct = Math.round((anchoredCount / regionVessels.length) * 100);

      const speeds = regionVessels.map((v) => v.speed_knots).filter((s): s is number => s !== null && s >= 0.2);
      if (speeds.length > 0) {
        avgSpeedKnots = Number((speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(1));
      }
    }

    const regionHeadlines = headlines.filter((h) => h.regions.includes(rg.id));
    const newsHits = regionHeadlines.length;
    const disruptionHits = regionHeadlines.filter((h) => h.disruption).length;

    let score = 15 + macroStress * 0.7;
    score += Math.min(40, disruptionHits * 14 + newsHits * 4);
    if (anchoredPct !== null && anchoredPct > 42) {
      score += Math.min(20, (anchoredPct - 42) * 0.7);
    }
    if (avgSpeedKnots !== null && avgSpeedKnots < 9.0) {
      score += Math.min(12, (9.0 - avgSpeedKnots) * 2.5);
    }

    const riskScore = clamp(score, 5, 98);
    const status: ChokepointAssessment["status"] =
      riskScore >= 65 ? "CRITICAL" : riskScore >= 40 ? "ELEVATED" : "NORMAL";

    const parts: string[] = [];
    if (aisCount !== null) {
      parts.push(
        `${aisCount} tankers (${crudeCount ?? 0} crude${anchoredPct !== null ? `, ${anchoredPct}% waiting/anchored` : ""}${avgSpeedKnots !== null ? `, avg ${avgSpeedKnots} kt` : ""})`
      );
    } else {
      parts.push("AIS offline — assessed via World Map corridor & news");
    }
    if (disruptionHits > 0) parts.push(`${disruptionHits} live disruption headline${disruptionHits > 1 ? "s" : ""}`);
    else if (newsHits > 0) parts.push(`${newsHits} active headline${newsHits > 1 ? "s" : ""}`);

    return {
      id: rg.id,
      label: rg.label,
      lat: rg.lat,
      lon: rg.lon,
      zoom: rg.zoom,
      bounds: rg.bounds,
      indiaRelevance: rg.indiaRelevance,
      exposedTickers: rg.exposedTickers,
      aisCount,
      crudeCount,
      productCount,
      lngCount,
      loadedPct,
      anchoredPct,
      avgSpeedKnots,
      newsHits,
      disruptionHits,
      riskScore,
      status,
      summary: parts.join(" · "),
    };
  });

  const cpMap = new Map(chokepoints.map((c) => [c.id, c]));
  const scoreFor = (...ids: string[]) => Math.max(...ids.map((id) => cpMap.get(id)?.riskScore ?? 20));
  const statusFor = (score: number): SeaCorridor["status"] =>
    score >= 65 ? "CRITICAL" : score >= 40 ? "ELEVATED" : "NORMAL";

  const redSeaScore = scoreFor("redsea", "suez");
  const hormuzIndiaScore = scoreFor("hormuz", "india");
  const capeScore = clamp(Math.max(redSeaScore - 5, macroStress + 25), 10, 95);
  const uralsScore = scoreFor("blacksea", "northsea", "redsea", "india");
  const blackSeaScore = scoreFor("blacksea", "suez", "redsea");
  const malaccaScore = scoreFor("malacca");
  const usgScore = scoreFor("usgulf");

  const corridors: SeaCorridor[] = [
    {
      id: "gulf-india",
      name: "Persian Gulf → India West Coast (Hormuz → Jamnagar/Mumbai)",
      shortName: "Hormuz → India",
      commodity: "Crude & LNG",
      riskScore: hormuzIndiaScore,
      status: statusFor(hormuzIndiaScore),
      waypoints: [[26.64, 50.16], [26.2, 56.3], [24.9, 58.6], [22.44, 69.67], [19.0, 72.8]],
      transitNote: "4–6 day VLCC haul; primary crude feed for IOC, BPCL, HPCL & Reliance.",
      impactedTickers: ["IOC", "BPCL", "HINDPETRO", "RELIANCE", "GAIL"],
    },
    {
      id: "blacksea-india",
      name: "Black Sea (Novorossiysk) → Bosphorus → Suez → India",
      shortName: "Black Sea → India",
      commodity: "Crude & Products",
      riskScore: blackSeaScore,
      status: statusFor(blackSeaScore),
      waypoints: [[44.72, 37.78], [43.5, 30.6], [41.2, 29.1], [38.5, 25.5], [33.5, 29.0], [30.5, 32.35], [12.6, 43.3], [22.43, 69.82]],
      transitNote: "CPC & Black Sea Urals flow through Turkish Straits & Suez to India West Coast.",
      impactedTickers: ["RELIANCE", "IOC", "BPCL", "FRO", "INSW"],
    },
    {
      id: "redsea-suez",
      name: "Red Sea → Suez → Mediterranean Corridor",
      shortName: "Red Sea / Suez",
      commodity: "Crude & Products",
      riskScore: redSeaScore,
      status: statusFor(redSeaScore),
      waypoints: [[12.6, 43.3], [15.5, 41.8], [21.5, 38.2], [27.8, 33.8], [30.5, 32.35], [33.5, 29.0]],
      transitNote: "High diversion / dark-AIS risk forces VLCC rerouting around Southern Africa.",
      impactedTickers: ["FRO", "INSW", "STNG", "RELIANCE", "IOC"],
    },
    {
      id: "cape-diversion",
      name: "Cape of Good Hope Diversion Route",
      shortName: "Cape Diversion",
      commodity: "Diversion Route",
      riskScore: capeScore,
      status: statusFor(capeScore),
      waypoints: [[12.6, 43.3], [2.0, 48.0], [-15.0, 43.0], [-35.2, 20.0], [-24.0, 9.0], [5.0, -16.0], [35.0, -12.0]],
      transitNote: "Adds +14–18 voyage days vs Suez, absorbing VLCC/Suezmax ton-mile capacity.",
      impactedTickers: ["FRO", "DHT", "INSW", "STNG"],
    },
    {
      id: "urals-india",
      name: "Baltic Sea → India (Primorsk Long-Haul Urals)",
      shortName: "Baltic → India",
      commodity: "Crude & Products",
      riskScore: uralsScore,
      status: statusFor(uralsScore),
      waypoints: [[60.35, 28.62], [55.2, 11.0], [50.8, 1.0], [36.0, -5.5], [33.5, 16.0], [30.5, 32.35], [12.6, 43.3], [22.43, 69.82]],
      transitNote: "Long-haul Urals flow to Vadinar/Jamnagar; sensitive to Red Sea transit & sanctions.",
      impactedTickers: ["RELIANCE", "IOC", "BPCL", "MRPL"],
    },
    {
      id: "malacca-asia",
      name: "Strait of Malacca → East Asia",
      shortName: "Malacca → Asia",
      commodity: "Crude & LNG",
      riskScore: malaccaScore,
      status: statusFor(malaccaScore),
      waypoints: [[18.5, 72.5], [5.8, 95.2], [2.6, 101.2], [1.2, 103.8], [15.0, 115.0], [31.0, 123.0]],
      transitNote: "Primary East-bound oil & LNG artery via Singapore refining hub.",
      impactedTickers: ["RELIANCE", "STNG", "DHT"],
    },
    {
      id: "usgulf-atlantic",
      name: "US Gulf → Atlantic / Long-Haul Swing",
      shortName: "US Gulf Swing",
      commodity: "Crude & LNG",
      riskScore: usgScore,
      status: statusFor(usgScore),
      waypoints: [[27.81, -97.15], [24.2, -82.0], [26.0, -60.0], [35.0, -15.0]],
      transitNote: "WTI arbitrage cargoes respond when Brent–WTI spread widens above $4.50/bbl.",
      impactedTickers: ["RELIANCE", "IOC", "INSW"],
    },
  ];

  // 4. Overall Macro & India Judgment
  const maxRegionScore = Math.max(...chokepoints.map((c) => c.riskScore));
  const totalDisruptionHeadlines = headlines.filter((h) => h.disruption).length;
  const overallScore = clamp(maxRegionScore * 0.65 + macroStress * 0.8 + Math.min(15, totalDisruptionHeadlines * 2), 10, 98);

  const regime =
    overallScore >= 68
      ? "CRITICAL MARITIME REROUTING RISK"
      : overallScore >= 48
        ? "ELEVATED CHOKEPOINT & FREIGHT STRESS"
        : brentQ.price !== null && brentQ.price >= 85
          ? "FIRM CRUDE / NORMAL SEA FLOW"
          : "BALANCED MARITIME OIL FLOW";

  const indiaImpact =
    (brentQ.price !== null && brentQ.price >= 90) || (omcAvgChangePct !== null && omcAvgChangePct <= -1)
      ? "OMC MARGIN PRESSURE (IOC/BPCL/HPCL) · FAVORABLE FOR UPSTREAM (ONGC/OIL) & TANKERS"
      : overallScore >= 50
        ? "WATCH FREIGHT & SOUR CRUDE SPREADS — MODERATE REFINING COST RISK"
        : "STEADY INDIA CRUDE IMPORT COST — SUPPORTIVE FOR OMCs & REFINERS";

  const drivers: string[] = [];
  if (brentQ.price !== null) {
    drivers.push(
      `Brent at $${brentQ.price.toFixed(2)}/bbl (${brentQ.changePercent !== null ? `${brentQ.changePercent >= 0 ? "+" : ""}${brentQ.changePercent.toFixed(2)}%` : "live"})${brentInrPerBbl ? ` · ₹${brentInrPerBbl.toLocaleString("en-IN")}/bbl landed INR` : ""}${brentWtiSpread !== null ? ` · Brent–WTI spread $${brentWtiSpread.toFixed(2)}` : ""}`
    );
  }
  if (omcAvgChangePct !== null || upstreamAvgChangePct !== null) {
    drivers.push(
      `India Oil Reaction: OMCs ${omcAvgChangePct !== null ? `${omcAvgChangePct >= 0 ? "+" : ""}${omcAvgChangePct.toFixed(2)}%` : "—"} vs Upstream (ONGC/OIL) ${upstreamAvgChangePct !== null ? `${upstreamAvgChangePct >= 0 ? "+" : ""}${upstreamAvgChangePct.toFixed(2)}%` : "—"}`
    );
  }
  if (tankerAvgChangePct !== null) {
    drivers.push(
      `Global Tanker Equities (FRO/STNG/DHT/INSW): ${tankerAvgChangePct >= 0 ? "+" : ""}${tankerAvgChangePct.toFixed(2)}% reflecting VLCC/product ton-mile pricing`
    );
  }
  const topCp = [...chokepoints].sort((a, b) => b.riskScore - a.riskScore)[0];
  if (topCp) {
    drivers.push(
      `Highest Tension Zone: ${topCp.label} (${topCp.riskScore}/100 · ${topCp.status}) — ${topCp.summary}`
    );
  }
  if (!aisData) {
    drivers.push(
      "AIS vessel feed unavailable — judgment synthesized live from World Map chokepoint corridors, Brent/WTI spreads, India OMC price action & maritime RSS."
    );
  }

  return {
    updatedAt: new Date().toISOString(),
    aisAvailable: Boolean(aisData),
    aisError,
    aisTotalVessels: aisData ? aisData.stats.total : null,
    verdict: {
      overallScore,
      regime,
      indiaImpact,
      drivers,
    },
    benchmarks: {
      brent: brentQ,
      wti: wtiQ,
      natgas: ngQ,
      usdinr: fxQ,
      brentWtiSpread,
      brentInrPerBbl,
      omcAvgChangePct: omcAvgChangePct !== null ? Number(omcAvgChangePct.toFixed(2)) : null,
      upstreamAvgChangePct: upstreamAvgChangePct !== null ? Number(upstreamAvgChangePct.toFixed(2)) : null,
      tankerAvgChangePct: tankerAvgChangePct !== null ? Number(tankerAvgChangePct.toFixed(2)) : null,
      tankerStocks,
      indiaEnergyStocks,
    },
    chokepoints,
    corridors,
    headlines,
  };
}
