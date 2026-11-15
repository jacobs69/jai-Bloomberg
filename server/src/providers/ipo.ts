import * as india from "./india.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export type IpoItem = {
  companyName: string;
  symbol: string | null;
  exchange: string;
  ipoOpenDate: string | null;
  ipoCloseDate: string | null;
  listingDate: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  issueAmountCr: number | null;
  status: "open" | "upcoming" | "listed";
  category: string;
  source: string;
  link: string | null;
};

export type RecentIpoItem = IpoItem & {
  issuePrice: number | null;
  currentPrice: number | null;
  listingGainPercent: number | null;
};

export type IpoBidCategory = {
  category: string;
  subscriptionTimes: number | null;
};

export type IpoSubscription = {
  companyName: string;
  symbol: string | null;
  closingDate: string | null;
  issueAmountCr: number | null;
  subscriptionStatus: "open" | "closed" | "upcoming";
  asOf: string | null;
  applications: string | null;
  totalTimes: number | null;
  bidData: IpoBidCategory[];
  source: string;
};

function stripHtml(raw: unknown): string {
  return String(raw ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractHref(raw: unknown): string | null {
  const m = String(raw ?? "").match(/href="([^"]+)"/i);
  return m ? m[1] : null;
}

function parsePriceBand(raw: unknown): { min: number | null; max: number | null } {
  const str = String(raw ?? "").replace(/,/g, "");
  const nums = str.match(/\d+(?:\.\d+)?/g)?.map(Number).filter(isFinite) ?? [];
  if (nums.length === 0) return { min: null, max: null };
  if (nums.length === 1) return { min: nums[0], max: nums[0] };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

function parseIsoDate(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function chittorgarhUrl(reportId: number, board: "mainboard" | "sme" = "mainboard"): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const fy = m >= 4 ? `${y}-${String(y + 1).slice(-2)}` : `${y - 1}-${String(y).slice(-2)}`;
  return `https://webnodejs.chittorgarh.com/cloud/report/data-read/${reportId}/1/${m}/${y}/${fy}/0/${board}/0?search=&v=17-32`;
}

async function fetchChittorgarhReport(reportId: number, board: "mainboard" | "sme" = "mainboard"): Promise<any[]> {
  const res = await fetch(chittorgarhUrl(reportId, board), {
    headers: {
      "User-Agent": UA,
      Referer: "https://www.chittorgarh.com/",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`chittorgarh ${reportId} ${res.status}`);
  const json = await res.json();
  return Array.isArray(json?.reportTableData) ? json.reportTableData : [];
}

function todayYmd(): string {
  // IST date string YYYY-MM-DD
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

function normalizeIpoRow(r: any): IpoItem {
  const companyName = stripHtml(r.Company);
  const openDate = parseIsoDate(r["~Issue_Open_Date"] ?? r["~issue_open_date_plan"] ?? r["Opening Date"]);
  const closeDate = parseIsoDate(r["~IssueCloseDate"] ?? r["Closing Date"]);
  const listingDate = parseIsoDate(r["~ListingDate"] ?? r["Listing Date"]);
  const { min, max } = parsePriceBand(r["Issue Price (Rs.)"]);
  const amtRaw = parseFloat(String(r["Issue Amount (Rs.cr.)"] ?? "").replace(/,/g, ""));
  const today = todayYmd();

  let status: IpoItem["status"] = "upcoming";
  if (listingDate && listingDate <= today && r["Listing Date"]) {
    status = "listed";
  } else if (openDate && closeDate && openDate <= today && closeDate >= today) {
    status = "open";
  } else if (closeDate && closeDate < today) {
    status = "listed";
  }

  const nse = String(r["~nse_symbol"] ?? "").trim();
  const bse = String(r["~bse_script_code"] ?? "").trim();
  const symbol = nse || (bse ? `BSE:${bse}` : null);

  return {
    companyName,
    symbol,
    exchange: String(r["Listing at"] ?? "NSE, BSE"),
    ipoOpenDate: openDate,
    ipoCloseDate: closeDate,
    listingDate,
    minPrice: min,
    maxPrice: max,
    issueAmountCr: isFinite(amtRaw) && amtRaw > 0 ? amtRaw : null,
    status,
    category: String(r["Issue Category"] ?? "Mainboard"),
    source: "chittorgarh",
    link: extractHref(r.Company),
  };
}

export async function upcomingIpos(): Promise<IpoItem[]> {
  const [mainboard, sme, nseActive] = await Promise.allSettled([
    fetchChittorgarhReport(82, "mainboard"),
    fetchChittorgarhReport(82, "sme"),
    fetch("https://www.nseindia.com/api/ipo-current-issue", {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    }).then((r) => (r.ok ? r.json() : [])),
  ]);

  const rows = [
    ...(mainboard.status === "fulfilled" ? mainboard.value : []),
    ...(sme.status === "fulfilled" ? sme.value : []),
  ];

  const mapped = rows.map(normalizeIpoRow).filter((i) => i.companyName);
  const upcomingOrOpen = mapped.filter((i) => i.status === "open" || i.status === "upcoming");

  // Merge any NSE active issues not already present
  if (nseActive.status === "fulfilled" && Array.isArray(nseActive.value)) {
    for (const item of nseActive.value) {
      const name = String(item.companyName ?? "").trim();
      if (!name) continue;
      if (upcomingOrOpen.some((u) => u.companyName.toLowerCase().includes(name.toLowerCase().slice(0, 12)))) {
        continue;
      }
      const { min, max } = parsePriceBand(item.issuePrice);
      upcomingOrOpen.push({
        companyName: name,
        symbol: item.symbol ?? null,
        exchange: "NSE",
        ipoOpenDate: parseIsoDate(item.issueStartDate),
        ipoCloseDate: parseIsoDate(item.issueEndDate),
        listingDate: null,
        minPrice: min,
        maxPrice: max,
        issueAmountCr: null,
        status: "open",
        category: String(item.series ?? "IPO"),
        source: "nse",
        link: null,
      });
    }
  }

  return upcomingOrOpen.sort((a, b) => (a.ipoOpenDate ?? "9999").localeCompare(b.ipoOpenDate ?? "9999"));
}

export async function recentIpos(days = 90): Promise<RecentIpoItem[]> {
  const lookback = Math.max(1, Math.min(365, days));
  const cutoff = new Date(Date.now() - lookback * 86_400_000).toISOString().slice(0, 10);
  const today = todayYmd();

  const [mainboard, sme] = await Promise.allSettled([
    fetchChittorgarhReport(82, "mainboard"),
    fetchChittorgarhReport(82, "sme"),
  ]);

  const rows = [
    ...(mainboard.status === "fulfilled" ? mainboard.value : []),
    ...(sme.status === "fulfilled" ? sme.value : []),
  ];

  const listed = rows
    .map(normalizeIpoRow)
    .filter((i) => i.companyName && i.status === "listed" && (i.listingDate ?? i.ipoCloseDate ?? "") >= cutoff && (i.listingDate ?? "") <= today)
    .sort((a, b) => (b.listingDate ?? b.ipoCloseDate ?? "").localeCompare(a.listingDate ?? a.ipoCloseDate ?? ""))
    .slice(0, 40);

  const quotableSymbols = [...new Set(listed.map((i) => i.symbol).filter((s): s is string => Boolean(s)))];
  let quoteMap = new Map<string, number>();
  if (quotableSymbols.length > 0) {
    try {
      const qs = await india.quotes(quotableSymbols);
      for (const q of qs) {
        if (q.price !== null) quoteMap.set(q.symbol, q.price);
      }
    } catch {
      // Price enrichment is best-effort
    }
  }

  return listed.map((i) => {
    const issuePrice = i.maxPrice ?? i.minPrice;
    const currentPrice = i.symbol ? quoteMap.get(i.symbol) ?? null : null;
    const listingGainPercent =
      issuePrice && issuePrice > 0 && currentPrice !== null
        ? ((currentPrice - issuePrice) / issuePrice) * 100
        : null;
    return {
      ...i,
      issuePrice,
      currentPrice,
      listingGainPercent,
    };
  });
}

const toNum = (v: unknown): number | null => {
  if (typeof v === "number" && isFinite(v)) return v;
  const parsed = parseFloat(String(v ?? "").replace(/,/g, ""));
  return isFinite(parsed) ? parsed : null;
};

export async function ipoSubscriptions(companyQuery?: string): Promise<IpoSubscription[]> {
  const [mainboard, sme] = await Promise.allSettled([
    fetchChittorgarhReport(21, "mainboard"),
    fetchChittorgarhReport(21, "sme"),
  ]);
  const rows = [
    ...(mainboard.status === "fulfilled" ? mainboard.value : []),
    ...(sme.status === "fulfilled" ? sme.value : []),
  ];
  const today = todayYmd();

  const mapped: IpoSubscription[] = rows
    .map((r) => {
      const companyName = stripHtml(r.Company);
      const openDate = parseIsoDate(r["~Issue_Open_Date"] ?? r["~issue_open_date_plan"]);
      const closeDate = parseIsoDate(r["~Issue_Close_Date"] ?? r["Closing Date"]);
      let subscriptionStatus: IpoSubscription["subscriptionStatus"] = "closed";
      if (openDate && closeDate && openDate <= today && closeDate >= today) {
        subscriptionStatus = "open";
      } else if (openDate && openDate > today) {
        subscriptionStatus = "upcoming";
      }
      const nse = String(r["~nse_symbol"] ?? "").trim();
      const bse = String(r["~bse_script_code"] ?? "").trim();
      const bidData: IpoBidCategory[] = [
        { category: "QIB", subscriptionTimes: toNum(r["QIB (x)"]) },
        { category: "NII", subscriptionTimes: toNum(r["NII (x)"]) },
        { category: "sNII", subscriptionTimes: toNum(r["sNII (x)"]) },
        { category: "bNII", subscriptionTimes: toNum(r["bNII (x)"]) },
        { category: "Retail", subscriptionTimes: toNum(r["Retail (x)"]) },
      ].filter((b) => b.subscriptionTimes !== null);

      return {
        companyName,
        symbol: nse || (bse ? `BSE:${bse}` : null),
        closingDate: closeDate,
        issueAmountCr: toNum(r["Issue Amount (Rs.cr.)"]),
        subscriptionStatus,
        asOf: r["Subscription as on"] ? String(r["Subscription as on"]) : null,
        applications: r.Applications ? String(r.Applications) : null,
        totalTimes: toNum(r["Total (x)"]),
        bidData,
        source: "chittorgarh",
      };
    })
    .filter((s) => s.companyName);

  if (companyQuery?.trim()) {
    const q = companyQuery.trim().toLowerCase();
    return mapped.filter(
      (m) => m.companyName.toLowerCase().includes(q) || (m.symbol ?? "").toLowerCase().includes(q)
    );
  }

  return mapped.slice(0, 40);
}
