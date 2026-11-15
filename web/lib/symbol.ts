// Characters seen in NSE/BSE/Yahoo tickers: RELIANCE, M&M, BAJAJ-AUTO,
// BSE:SENSEX, BSE:500051, ^NSEI, INR=X, GC=F.
const SYMBOL_RE = /^(?=.*[A-Z0-9])[A-Z0-9.\-^=&:]{1,24}$/;

/** Uppercases and trims free-text ticker input; null when it isn't a plausible symbol. */
export function normalizeSymbol(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  return SYMBOL_RE.test(s) ? s : null;
}

/** Encodes symbols for a `?symbols=` query, keeping the comma separator literal. */
export function symbolsParam(symbols: string[]): string {
  return symbols.map(encodeURIComponent).join(",");
}
