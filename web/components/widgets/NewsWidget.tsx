"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet } from "../../lib/api";
import { isSafeHttpUrl } from "../../lib/links";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

type NewsItem = { title: string; link: string; publisher: string; publishedAt: string | null };

const SECTORS = ["IT", "Banks", "Pharma", "FMCG", "Metals", "Auto", "Energy"] as const;
const INDICES = ["NIFTY50", "SENSEX", "NIFTYNXT50", "NIFTYBANK"] as const;

export default function NewsWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const [mode, setMode] = useState<"india" | "symbol" | "sector" | "index" | "ipo">("india");
  const [sector, setSector] = useState<string>("IT");
  const [index, setIndex] = useState<string>("NIFTY50");

  const endpoint =
    mode === "symbol"
      ? `/api/india/news?symbol=${encodeURIComponent(symbol)}`
      : mode === "sector"
      ? `/api/india/sector-news?sector=${encodeURIComponent(sector)}`
      : mode === "index"
      ? `/api/india/index-news?index=${encodeURIComponent(index)}`
      : mode === "ipo"
      ? "/api/india/ipo-news"
      : "/api/india/news";

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["india-news", mode, symbol, sector, index],
    queryFn: () => apiGet<NewsItem[]>(endpoint),
    refetchInterval: 60_000,
  });

  return (
    <div>
      <div className="flex gap-1 p-1 flex-wrap items-center border-b border-[#161616]">
        <button className={`term-btn ${mode === "india" ? "active" : ""}`} onClick={() => setMode("india")}>
          INDIA TOP
        </button>
        <button className={`term-btn ${mode === "symbol" ? "active" : ""}`} onClick={() => setMode("symbol")}>
          {symbol}
        </button>
        <button className={`term-btn ${mode === "sector" ? "active" : ""}`} onClick={() => setMode("sector")}>
          SECTOR
        </button>
        <button className={`term-btn ${mode === "index" ? "active" : ""}`} onClick={() => setMode("index")}>
          INDEX
        </button>
        <button className={`term-btn ${mode === "ipo" ? "active" : ""}`} onClick={() => setMode("ipo")}>
          IPO
        </button>

        {mode === "sector" && (
          <select value={sector} onChange={(e) => setSector(e.target.value)} className="ml-auto">
            {SECTORS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
        {mode === "index" && (
          <select value={index} onChange={(e) => setIndex(e.target.value)} className="ml-auto">
            {INDICES.map((ix) => (
              <option key={ix} value={ix}>{ix}</option>
            ))}
          </select>
        )}
      </div>

      {error && <div className="p-2 down">Error: {(error as Error).message}</div>}
      {isLoading && <div className="p-2 dim">Loading Indian market news (Moneycontrol · ET · Business Today)…</div>}
      {data.map((n, i) => {
        const body = (
          <>
            <div className="truncate">{n.title}</div>
            <div className="dim text-[10px]">
              <span className="amber">{n.publisher}</span>
              {n.publishedAt ? " · " + new Date(n.publishedAt).toLocaleString("en-IN") : ""}
            </div>
          </>
        );
        const className = "block px-2 py-1 border-b border-[#161616] hover:bg-[#161616]";
        return isSafeHttpUrl(n.link) ? (
          <a key={i} href={n.link} target="_blank" rel="noreferrer" className={className}>
            {body}
          </a>
        ) : (
          <div key={i} className={className}>
            {body}
          </div>
        );
      })}
      {!isLoading && data.length === 0 && (
        <div className="p-2 dim">No recent headlines for this filter.</div>
      )}
    </div>
  );
}
