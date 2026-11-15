import * as india from "./india.js";
import * as indiaScrips from "./indiaScrips.js";
import * as yahoo from "./yahoo.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export type ShareholderBreakdownRow = {
  category: string;
  classification: string | null;
  periods: string[];
  values: number[];
  latest: number | null;
  prev: number | null;
  qoqChange: number | null;
};

export type HolderCategory =
  | "Promoter"
  | "FII"
  | "DII"
  | "Government"
  | "Public"
  | "Institution"
  | "Mutual Fund"
  | "Insider";

export type MajorHolderEntity = {
  name: string;
  category: HolderCategory;
  percentHeld: number | null;
  prevPercentHeld: number | null;
  qoqDelta: number | null;
  shares: number | null;
  value: number | null;
  reportDate: string | null;
  history?: Array<{ period: string; pct: number }>;
  profileUrl?: string | null;
};

export type InsiderRosterRow = {
  name: string;
  relation: string;
  transaction: string;
  date: string | null;
  sharesDirect: number | null;
};

export type HoldersReport = {
  symbol: string;
  companyName: string;
  exchange: string;
  currency: string;
  latestPeriod: string | null;
  sources: string[];
  summary: {
    promoterOrInsiderPct: number | null;
    fiiPct: number | null;
    diiPct: number | null;
    govtPct: number | null;
    publicPct: number | null;
    institutionsCount: number | null;
    totalShareholders: number | null;
    shareholdersDelta: number | null;
  };
  quarterlyTrend: ShareholderBreakdownRow[];
  yearlyTrend: ShareholderBreakdownRow[];
  majorHolders: MajorHolderEntity[];
  mutualFunds: MajorHolderEntity[];
  insiders: InsiderRosterRow[];
  externalLinks: {
    screener?: string;
    bse?: string;
    yahoo?: string;
    trendlyne?: string;
    sec?: string;
    whalewisdom?: string;
  };
};

type ScreenerClassification =
  | "promoters"
  | "foreign_institutions"
  | "domestic_institutions"
  | "government"
  | "public";

const CLASS_MAP: Array<{ match: string; classification: ScreenerClassification; category: HolderCategory }> = [
  { match: "promoter", classification: "promoters", category: "Promoter" },
  { match: "fii", classification: "foreign_institutions", category: "FII" },
  { match: "foreign", classification: "foreign_institutions", category: "FII" },
  { match: "dii", classification: "domestic_institutions", category: "DII" },
  { match: "domestic", classification: "domestic_institutions", category: "DII" },
  { match: "gov", classification: "government", category: "Government" },
  { match: "public", classification: "public", category: "Public" },
];

function stripHtml(raw: string): string {
  return raw
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[%,\s]/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "—") return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function parseScreenerTable(blockHtml: string): ShareholderBreakdownRow[] {
  const rows: ShareholderBreakdownRow[] = [];
  const theadMatch = blockHtml.match(/<thead>([\s\S]*?)<\/thead>/i);
  const periods: string[] = [];
  if (theadMatch) {
    for (const th of theadMatch[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)) {
      const txt = stripHtml(th[1]);
      if (txt) periods.push(txt);
    }
  }
  const tbodyMatch = blockHtml.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return rows;

  for (const tr of tbodyMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => stripHtml(c[1]));
    if (cells.length < 2) continue;
    const category = cells[0].replace(/\s*\+\s*$/, "").trim();
    const values = cells.slice(1).map((c) => parseNumber(c) ?? 0);
    const latest = values.length > 0 ? values[values.length - 1] : null;
    const prev = values.length > 1 ? values[values.length - 2] : null;
    const qoqChange = latest !== null && prev !== null ? Number((latest - prev).toFixed(2)) : null;
    const matchedClass = CLASS_MAP.find((m) => category.toLowerCase().includes(m.match))?.classification ?? null;
    rows.push({
      category,
      classification: matchedClass,
      periods: periods.slice(0, values.length),
      values,
      latest,
      prev,
      qoqChange,
    });
  }
  return rows;
}

type ScreenerHoldersResult = {
  companyName: string;
  companyUrl: string;
  quarterlyTrend: ShareholderBreakdownRow[];
  yearlyTrend: ShareholderBreakdownRow[];
  majorHolders: MajorHolderEntity[];
};

async function fetchScreenerHolders(
  dispName: string,
  bseCode?: string
): Promise<ScreenerHoldersResult | null> {
  const queries = [dispName, bseCode].filter((q): q is string => Boolean(q && q.trim()));
  let target: { name: string; url: string } | null = null;

  for (const q of queries) {
    try {
      const res = await fetch(`https://www.screener.in/api/company/search/?q=${encodeURIComponent(q)}`, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(7_000),
      });
      if (!res.ok) continue;
      const list = (await res.json()) as Array<{ id: number; name: string; url: string }>;
      if (!Array.isArray(list) || list.length === 0) continue;
      // Prefer exact URL slug match first (e.g. /company/RELIANCE/)
      const upperQ = q.toUpperCase();
      target =
        list.find((item) => item.url?.toUpperCase().includes(`/COMPANY/${upperQ}/`)) ??
        list[0];
      if (target?.url) break;
    } catch {
      // try next candidate query
    }
  }

  if (!target?.url) return null;
  const fullUrl = target.url.startsWith("http") ? target.url : `https://www.screener.in${target.url}`;
  const pageRes = await fetch(fullUrl, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(9_000),
  });
  if (!pageRes.ok) return null;
  const html = await pageRes.text();

  const companyId = html.match(/data-company-id="(\d+)"/)?.[1];
  const shpSection = html.match(/<section id="shareholding"[\s\S]*?<\/section>/i)?.[0] ?? "";
  if (!shpSection) return null;

  const qStart = shpSection.search(/<div[^>]*\bid=["']quarterly-shp["']/i);
  const yStart = shpSection.search(/<div[^>]*\bid=["']yearly-shp["']/i);
  const qBlock =
    qStart !== -1
      ? shpSection.slice(qStart, yStart > qStart ? yStart : undefined)
      : shpSection;
  const yBlock = yStart !== -1 ? shpSection.slice(yStart) : "";

  const quarterlyTrend = parseScreenerTable(qBlock);
  const yearlyTrend = yBlock ? parseScreenerTable(yBlock) : [];

  const majorHolders: MajorHolderEntity[] = [];
  if (companyId) {
    const classes: Array<{ cls: ScreenerClassification; category: HolderCategory }> = [
      { cls: "promoters", category: "Promoter" },
      { cls: "foreign_institutions", category: "FII" },
      { cls: "domestic_institutions", category: "DII" },
      { cls: "government", category: "Government" },
      { cls: "public", category: "Public" },
    ];

    const settled = await Promise.allSettled(
      classes.map(async ({ cls, category }) => {
        const r = await fetch(`https://www.screener.in/api/3/${companyId}/investors/${cls}/quarterly/`, {
          headers: {
            "User-Agent": UA,
            Referer: fullUrl,
            "X-Requested-With": "XMLHttpRequest",
          },
          signal: AbortSignal.timeout(7_000),
        });
        if (!r.ok) return [];
        const data = (await r.json()) as Record<string, Record<string, any>>;
        const out: MajorHolderEntity[] = [];
        for (const [holderName, rowObj] of Object.entries(data ?? {})) {
          if (!rowObj || typeof rowObj !== "object") continue;
          const periodEntries = Object.entries(rowObj)
            .filter(([k]) => k !== "setAttributes")
            .map(([period, val]) => ({ period, pct: Number(val) }))
            .filter((e) => Number.isFinite(e.pct));
          if (periodEntries.length === 0) continue;
          const latestEntry = periodEntries[periodEntries.length - 1];
          const prevEntry = periodEntries.length > 1 ? periodEntries[periodEntries.length - 2] : null;
          const qoqDelta =
            prevEntry !== null ? Number((latestEntry.pct - prevEntry.pct).toFixed(2)) : null;
          const personPath = rowObj.setAttributes?.["data-person-url"];
          out.push({
            name: holderName,
            category,
            percentHeld: latestEntry.pct,
            prevPercentHeld: prevEntry?.pct ?? null,
            qoqDelta,
            shares: null,
            value: null,
            reportDate: latestEntry.period,
            history: periodEntries,
            profileUrl: personPath ? `https://www.screener.in${personPath}` : null,
          });
        }
        return out;
      })
    );

    for (const r of settled) {
      if (r.status === "fulfilled") majorHolders.push(...r.value);
    }
  }

  // Sort major holders descending by latest % held
  majorHolders.sort((a, b) => (b.percentHeld ?? 0) - (a.percentHeld ?? 0));

  return {
    companyName: target.name,
    companyUrl: fullUrl,
    quarterlyTrend,
    yearlyTrend,
    majorHolders,
  };
}

function mapYahooList(list: any[] | undefined, category: HolderCategory): MajorHolderEntity[] {
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const rawPct = typeof item?.pctHeld?.raw === "number" ? Number((item.pctHeld.raw * 100).toFixed(2)) : null;
    const rawDelta =
      typeof item?.pctChange?.raw === "number" ? Number((item.pctChange.raw * 100).toFixed(2)) : null;
    return {
      name: String(item?.organization ?? item?.name ?? "Unknown"),
      category,
      percentHeld: rawPct,
      prevPercentHeld: rawPct !== null && rawDelta !== null ? Number((rawPct - rawDelta).toFixed(2)) : null,
      qoqDelta: rawDelta,
      shares: typeof item?.position?.raw === "number" ? item.position.raw : null,
      value: typeof item?.value?.raw === "number" ? item.value.raw : null,
      reportDate: item?.reportDate?.fmt ?? null,
    };
  });
}

export async function getHoldersReport(rawSymbol: string): Promise<HoldersReport> {
  const symbol = rawSymbol.trim().toUpperCase();
  const explicitIndia = /^(NSE|BSE):|\.(NS|BO)$/i.test(symbol) || /^\d{5,6}$/.test(symbol);
  let isNonIndian = india.isExplicitNonIndianSymbol(symbol);
  const scrip = !isNonIndian ? await indiaScrips.resolveScrip(symbol).catch(() => null) : null;
  if (!isNonIndian && !explicitIndia && !scrip) {
    isNonIndian = true;
  }
  const cleanTicker = scrip?.dispName ?? symbol.replace(/^(NSE|BSE):|\.(NS|BO)$/gi, "").trim();
  const bseCode = scrip?.exchange === "BSE" ? scrip.excToken : undefined;
  const yahooSym = isNonIndian ? symbol : india.toYahooIndianSymbol(symbol);

  const [screenerRes, yahooRes] = await Promise.allSettled([
    !isNonIndian ? fetchScreenerHolders(cleanTicker, bseCode) : Promise.resolve(null),
    yahoo.holdersSummary(yahooSym),
  ]);

  const scr = screenerRes.status === "fulfilled" ? screenerRes.value : null;
  const yho = yahooRes.status === "fulfilled" ? yahooRes.value : null;

  if (!scr && !yho) {
    throw new Error(`No shareholding data available for ${symbol}`);
  }

  const sources: string[] = [];
  if (scr) sources.push("screener.in");
  if (yho) sources.push("finance.yahoo.com");
  if (!isNonIndian) sources.push("bseindia.com");
  else sources.push("sec.gov/edgar");

  const yBreakdown = yho?.majorHoldersBreakdown ?? {};
  const yInsidersPct =
    typeof yBreakdown.insidersPercentHeld?.raw === "number"
      ? Number((yBreakdown.insidersPercentHeld.raw * 100).toFixed(2))
      : null;
  const yInstPct =
    typeof yBreakdown.institutionsPercentHeld?.raw === "number"
      ? Number((yBreakdown.institutionsPercentHeld.raw * 100).toFixed(2))
      : null;
  const yInstCount =
    typeof yBreakdown.institutionsCount?.raw === "number" ? yBreakdown.institutionsCount.raw : null;

  const yInstitutions = mapYahooList(yho?.institutionOwnership?.ownershipList, "Institution");
  const yFunds = mapYahooList(yho?.fundOwnership?.ownershipList, "Mutual Fund");
  const insiders: InsiderRosterRow[] = Array.isArray(yho?.insiderHolders?.holders)
    ? yho.insiderHolders.holders.map((h: any) => ({
        name: String(h?.name ?? "—"),
        relation: String(h?.relation ?? "—"),
        transaction: String(h?.transactionDescription ?? "—"),
        date: h?.latestTransDate?.fmt ?? null,
        sharesDirect: typeof h?.positionDirect?.raw === "number" ? h.positionDirect.raw : null,
      }))
    : [];

  const qRow = (match: string) =>
    scr?.quarterlyTrend.find((r) => r.category.toLowerCase().includes(match));

  const promRow = qRow("promoter");
  const fiiRow = qRow("fii");
  const diiRow = qRow("dii");
  const govtRow = qRow("gov");
  const pubRow = qRow("public");
  const shCountRow = qRow("shareholder");

  const promoterOrInsiderPct = promRow?.latest ?? yInsidersPct;
  const fiiPct = fiiRow?.latest ?? (isNonIndian ? yInstPct : null);
  const diiPct = diiRow?.latest ?? null;
  const govtPct = govtRow?.latest ?? null;
  const publicPct =
    pubRow?.latest ??
    (isNonIndian && yInsidersPct !== null && yInstPct !== null
      ? Number(Math.max(0, 100 - yInsidersPct - yInstPct).toFixed(2))
      : null);

  const combinedMajorHolders: MajorHolderEntity[] = scr?.majorHolders?.length
    ? [...scr.majorHolders, ...yInstitutions]
    : [...yInstitutions, ...yFunds];

  // For global tickers when no Screener breakdown exists, synthesize high-level ownership row
  const quarterlyTrend: ShareholderBreakdownRow[] =
    scr?.quarterlyTrend.length
      ? scr.quarterlyTrend
      : [
          ...(yInsidersPct !== null
            ? [{ category: "Insiders / Promoters", classification: "promoters", periods: ["Latest"], values: [yInsidersPct], latest: yInsidersPct, prev: null, qoqChange: null }]
            : []),
          ...(yInstPct !== null
            ? [{ category: "Institutions", classification: "foreign_institutions", periods: ["Latest"], values: [yInstPct], latest: yInstPct, prev: null, qoqChange: null }]
            : []),
          ...(publicPct !== null
            ? [{ category: "Public / Float", classification: "public", periods: ["Latest"], values: [publicPct], latest: publicPct, prev: null, qoqChange: null }]
            : []),
        ];

  const latestPeriod =
    scr?.quarterlyTrend[0]?.periods?.[scr.quarterlyTrend[0].periods.length - 1] ??
    yInstitutions[0]?.reportDate ??
    yFunds[0]?.reportDate ??
    null;

  return {
    symbol,
    companyName: scr?.companyName ?? scrip?.name ?? yho?.price?.longName ?? yho?.price?.shortName ?? symbol,
    exchange: scrip?.exchange ?? yho?.price?.exchangeName ?? (isNonIndian ? "US" : "NSE"),
    currency: isNonIndian ? yho?.price?.currency ?? "USD" : "INR",
    latestPeriod,
    sources,
    summary: {
      promoterOrInsiderPct,
      fiiPct,
      diiPct,
      govtPct,
      publicPct,
      institutionsCount: yInstCount,
      totalShareholders: shCountRow?.latest ?? null,
      shareholdersDelta: shCountRow?.qoqChange ?? null,
    },
    quarterlyTrend,
    yearlyTrend: scr?.yearlyTrend ?? [],
    majorHolders: combinedMajorHolders,
    mutualFunds: yFunds,
    insiders,
    externalLinks: {
      screener: scr?.companyUrl ?? (!isNonIndian ? `https://www.screener.in/company/${encodeURIComponent(cleanTicker)}/` : undefined),
      bse: !isNonIndian ? `https://www.bseindia.com/stock-share-price/x/x/${bseCode ?? cleanTicker}/shareholding-pattern/` : undefined,
      trendlyne: !isNonIndian ? `https://trendlyne.com/equity/${encodeURIComponent(cleanTicker)}/shareholding/` : undefined,
      yahoo: `https://finance.yahoo.com/quote/${encodeURIComponent(yahooSym)}/holders/`,
      sec: isNonIndian ? `https://www.sec.gov/edgar/searchedgar/companysearch` : undefined,
      whalewisdom: isNonIndian ? `https://whalewisdom.com/stock/${encodeURIComponent(cleanTicker.toLowerCase())}` : undefined,
    },
  };
}
