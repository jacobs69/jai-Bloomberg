const BASE = "https://api.coingecko.com/api/v3";
const COINPAPRIKA = "https://api.coinpaprika.com/v1";

export type CryptoRow = {
  id: string;
  symbol: string;
  name: string;
  price: number;
  changePercent24h: number | null;
  marketCap: number | null;
  volume24h: number | null;
  rank: number | null;
  sparkline: number[];
};

export type GlobalCryptoStats = {
  totalMarketCap: number;
  btcDominance: number;
  ethDominance: number;
};

export async function markets(perPage = 50): Promise<CryptoRow[]> {
  const url = `${BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=1&sparkline=true&price_change_percentage=24h`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`coingecko ${res.status}`);
  const rows: any[] = await res.json();
  return rows.map((r) => ({
    id: r.id,
    symbol: (r.symbol ?? "").toUpperCase(),
    name: r.name,
    price: r.current_price,
    changePercent24h: r.price_change_percentage_24h ?? null,
    marketCap: r.market_cap ?? null,
    volume24h: r.total_volume ?? null,
    rank: r.market_cap_rank ?? null,
    sparkline: r.sparkline_in_7d?.price ?? [],
  }));
}

export async function globalStats(): Promise<GlobalCryptoStats> {
  const res = await fetch(`${BASE}/global`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`coingecko ${res.status}`);
  const d = (await res.json())?.data;
  return {
    totalMarketCap: d?.total_market_cap?.usd ?? 0,
    btcDominance: d?.market_cap_percentage?.btc ?? 0,
    ethDominance: d?.market_cap_percentage?.eth ?? 0,
  };
}

export async function coinpaprikaGlobalStats(): Promise<GlobalCryptoStats> {
  const [globalRes, ethRes] = await Promise.all([
    fetch(`${COINPAPRIKA}/global`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    }),
    fetch(`${COINPAPRIKA}/tickers/eth-ethereum`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null),
  ]);
  if (!globalRes.ok) throw new Error(`coinpaprika ${globalRes.status}`);
  const g: any = await globalRes.json();
  const totalMarketCap = Number(g?.market_cap_usd ?? 0);
  const btcDominance = Number(g?.bitcoin_dominance_percentage ?? 0);

  let ethDominance = 0;
  if (ethRes?.ok && totalMarketCap > 0) {
    const ethJson: any = await ethRes.json().catch(() => null);
    const ethCap = Number(ethJson?.quotes?.USD?.market_cap ?? 0);
    if (ethCap > 0) {
      ethDominance = Number(((ethCap / totalMarketCap) * 100).toFixed(2));
    }
  }

  return { totalMarketCap, btcDominance, ethDominance };
}
