const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export type IndianScrip = {
  id: string;        // Tradejini symId e.g. EQT_RELIANCE_EQ_NSE or EQT_RELIANCE_A_BSE
  symbol: string;    // Display symbol e.g. RELIANCE or BSE:RELIANCE
  dispName: string;  // Raw trading symbol e.g. RELIANCE
  exchange: "NSE" | "BSE";
  excToken: string;  // Exchange token / BSE scrip code e.g. 2885 or 500325
  lot: number;
  tick: number;
  asset: string;     // equity | etf
  isin: string;
  name: string;      // Company description
};

type ScripIndex = {
  loadedAt: number;
  all: IndianScrip[];
  byKey: Map<string, IndianScrip>;       // RELIANCE, NSE:RELIANCE, BSE:RELIANCE, BSE:500325, 500325, EQT_...
  byBseCode: Map<string, IndianScrip>;
};

let cache: ScripIndex | null = null;
let inflight: Promise<ScripIndex> | null = null;
const TTL_MS = 12 * 3_600_000;

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function fetchStoreCsv(store: "Securities" | "ETF"): Promise<IndianScrip[]> {
  const res = await fetch(`https://api.tradejini.com/v2/api/mkt-data/scrips/symbol-store/${store}`, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`tradejini scrip store ${store} HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/);
  const items: IndianScrip[] = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const cols = parseCsvLine(raw);
    const [id, dispName, excToken, lotStr, tickStr, asset, _freezeQty, isin, desc] = cols;
    if (!id || !dispName) continue;
    const isNse = id.endsWith("_NSE");
    const isBse = id.endsWith("_BSE");
    if (!isNse && !isBse) continue;
    const exchange: "NSE" | "BSE" = isNse ? "NSE" : "BSE";
    const symbol = exchange === "BSE" ? `BSE:${dispName.toUpperCase()}` : dispName.toUpperCase();
    items.push({
      id,
      symbol,
      dispName: dispName.toUpperCase(),
      exchange,
      excToken: (excToken ?? "").trim(),
      lot: Number(lotStr) || 1,
      tick: Number(tickStr) || 0.05,
      asset: (asset || (store === "ETF" ? "etf" : "equity")).toLowerCase(),
      isin: (isin ?? "").trim().toUpperCase(),
      name: (desc ?? dispName).trim(),
    });
  }
  return items;
}

async function loadIndex(): Promise<ScripIndex> {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const [secs, etfs] = await Promise.allSettled([fetchStoreCsv("Securities"), fetchStoreCsv("ETF")]);
      const raw: IndianScrip[] = [
        ...(secs.status === "fulfilled" ? secs.value : []),
        ...(etfs.status === "fulfilled" ? etfs.value : []),
      ];

      // Deduplicate by normalized exchange+dispName, preferring standard series (EQ on NSE, A/B on BSE)
      const dedup = new Map<string, IndianScrip>();
      const rank = (s: IndianScrip) => {
        if (s.id.includes("_EQ_NSE")) return 0;
        if (s.id.includes("_A_BSE") || s.id.includes("_B_BSE")) return 0;
        if (s.id.includes("_BE_NSE") || s.id.includes("_SM_NSE")) return 1;
        return 2;
      };
      for (const s of raw) {
        const key = `${s.exchange}:${s.dispName}`;
        const prev = dedup.get(key);
        if (!prev || rank(s) < rank(prev)) dedup.set(key, s);
      }

      const all = [...dedup.values()];
      const byKey = new Map<string, IndianScrip>();
      const byBseCode = new Map<string, IndianScrip>();

      // Pass 1: register NSE primary bare names, then BSE prefixed + numeric scrip codes
      for (const s of all) {
        byKey.set(s.id.toUpperCase(), s);
        byKey.set(`${s.exchange}:${s.dispName}`, s);
        if (s.exchange === "NSE" && !byKey.has(s.dispName)) {
          byKey.set(s.dispName, s);
        }
        if (s.exchange === "BSE" && /^\d{5,6}$/.test(s.excToken)) {
          byBseCode.set(s.excToken, s);
          byKey.set(`BSE:${s.excToken}`, s);
          if (!byKey.has(s.excToken)) byKey.set(s.excToken, s);
        }
      }
      // Pass 2: if a stock is BSE-only (not listed on NSE), allow bare lookup
      for (const s of all) {
        if (s.exchange === "BSE" && !byKey.has(s.dispName)) {
          byKey.set(s.dispName, s);
        }
      }

      cache = { loadedAt: Date.now(), all, byKey, byBseCode };
      return cache;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export async function getAllScrips(): Promise<IndianScrip[]> {
  const idx = await loadIndex();
  return idx.all;
}

export async function resolveScrip(rawSymbol: string): Promise<IndianScrip | null> {
  const clean = rawSymbol.trim().toUpperCase().replace(/\.(NS|BO)$/, (m) => (m === ".NS" ? "" : ""));
  const idx = await loadIndex().catch(() => null);
  if (!idx) return null;

  const upper = rawSymbol.trim().toUpperCase();
  if (upper.endsWith(".BO")) {
    const base = upper.slice(0, -3);
    return idx.byKey.get(`BSE:${base}`) ?? idx.byBseCode.get(base) ?? null;
  }
  if (upper.endsWith(".NS")) {
    const base = upper.slice(0, -3);
    return idx.byKey.get(`NSE:${base}`) ?? idx.byKey.get(base) ?? null;
  }
  return idx.byKey.get(upper) ?? idx.byKey.get(clean) ?? idx.byBseCode.get(upper) ?? null;
}

export function resolveScripSync(rawSymbol: string): IndianScrip | null {
  if (!cache) return null;
  const upper = rawSymbol.trim().toUpperCase();
  if (upper.endsWith(".BO")) {
    const base = upper.slice(0, -3);
    return cache.byKey.get(`BSE:${base}`) ?? cache.byBseCode.get(base) ?? null;
  }
  if (upper.endsWith(".NS")) {
    const base = upper.slice(0, -3);
    return cache.byKey.get(`NSE:${base}`) ?? cache.byKey.get(base) ?? null;
  }
  return cache.byKey.get(upper) ?? cache.byBseCode.get(upper) ?? null;
}

export async function searchScrips(
  query: string,
  exchange: "ALL" | "NSE" | "BSE" = "ALL",
  limit = 60
): Promise<IndianScrip[]> {
  const idx = await loadIndex();
  const q = query.trim().toUpperCase();

  const pool = exchange === "ALL" ? idx.all : idx.all.filter((s) => s.exchange === exchange);
  if (!q) return pool.slice(0, limit);

  const exactSym: IndianScrip[] = [];
  const prefixSym: IndianScrip[] = [];
  const containsName: IndianScrip[] = [];

  for (const s of pool) {
    const disp = s.dispName;
    const sym = s.symbol;
    if (disp === q || sym === q || s.excToken === q || s.isin === q) {
      exactSym.push(s);
    } else if (disp.startsWith(q) || sym.startsWith(q) || s.excToken.startsWith(q)) {
      prefixSym.push(s);
    } else if (s.name.toUpperCase().includes(q) || disp.includes(q)) {
      containsName.push(s);
    }
  }

  // Prefer NSE slightly ahead of BSE when both exact-match a generic query
  const sortEx = (a: IndianScrip, b: IndianScrip) =>
    a.exchange === b.exchange ? a.dispName.localeCompare(b.dispName) : a.exchange === "NSE" ? -1 : 1;

  exactSym.sort(sortEx);
  prefixSym.sort(sortEx);

  return [...exactSym, ...prefixSym, ...containsName].slice(0, limit);
}

// Kick off background warmup cleanly on module import (non-blocking)
void loadIndex().catch(() => {});
