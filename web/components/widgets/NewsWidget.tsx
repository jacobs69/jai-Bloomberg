"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet } from "../../lib/api";
import { isSafeHttpUrl } from "../../lib/links";
import { newsKey, useNewsStream, type LiveNewsItem } from "../../lib/useNewsStream";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";
import Flash from "../Flash";

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

  const { data: initialData = [], isLoading, error } = useQuery({
    queryKey: ["india-news", mode, symbol, sector, index],
    queryFn: () => apiGet<LiveNewsItem[]>(endpoint),
    staleTime: 30_000,
  });

  const { items, newKeys, unreadCount, connected, lastUpdatedAt, acknowledgeAll, acknowledgeOne } = useNewsStream({
    mode,
    symbol,
    sector,
    index,
    initialItems: initialData,
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 p-1 flex-wrap items-center border-b border-[#161616] shrink-0">
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
          <select value={sector} onChange={(e) => setSector(e.target.value)}>
            {SECTORS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
        {mode === "index" && (
          <select value={index} onChange={(e) => setIndex(e.target.value)}>
            {INDICES.map((ix) => (
              <option key={ix} value={ix}>{ix}</option>
            ))}
          </select>
        )}

        <div className="ml-auto flex items-center gap-2 text-[10px]">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={acknowledgeAll}
              className="news-blinker px-1.5 py-0.5 font-bold tracking-wide cursor-pointer"
              title="Click to acknowledge new incoming headlines"
            >
              ● NEWS UPDATE (+{unreadCount}) · MARK READ
            </button>
          )}
          <span className={connected ? "up flex items-center gap-1 font-bold" : "dim"}>
            <span className={connected ? "news-dot-blink" : ""}>●</span>
            {connected ? "LIVE" : "CONNECTING"}
          </span>
          {lastUpdatedAt && (
            <span className="dim">
              {new Date(lastUpdatedAt).toLocaleTimeString("en-GB", { hour12: false })}
            </span>
          )}
        </div>
      </div>

      {unreadCount > 0 && (
        <div
          onClick={acknowledgeAll}
          className="news-blinker px-2 py-1 text-[10px] font-bold flex items-center justify-between cursor-pointer shrink-0"
        >
          <span>
            ● BREAKING MARKET NEWS: {unreadCount} NEW {unreadCount === 1 ? "STORY" : "STORIES"} RECEIVED
          </span>
          <span className="underline">ACK ✓</span>
        </div>
      )}

      <div className="flex-1 overflow-auto min-h-0">
        {error && items.length === 0 && <div className="p-2 down">Error: {(error as Error).message}</div>}
        {isLoading && items.length === 0 && (
          <div className="p-2 dim">Connecting to real-time Indian market news (Moneycontrol · ET · Business Today)…</div>
        )}
        {items.map((n, i) => {
          const key = newsKey(n);
          const isNew = newKeys.has(key);
          const body = (
            <Flash value={isNew ? key : "static"}>
              <div className="flex items-center gap-1.5">
                {isNew && (
                  <span className="news-blinker px-1 py-0 text-[9px] font-bold shrink-0">
                    ● NEW
                  </span>
                )}
                <span className={`truncate ${isNew ? "font-bold text-[var(--text)]" : ""}`}>{n.title}</span>
              </div>
              <div className="dim text-[10px]">
                <span className="amber">{n.publisher}</span>
                {n.publishedAt ? " · " + new Date(n.publishedAt).toLocaleString("en-IN") : ""}
              </div>
            </Flash>
          );
          const className = `block px-2 py-1 border-b border-[#161616] hover:bg-[#161616] ${
            isNew ? "news-row-new" : ""
          }`;
          return isSafeHttpUrl(n.link) ? (
            <a
              key={`${key}-${i}`}
              href={n.link}
              target="_blank"
              rel="noreferrer"
              onClick={() => acknowledgeOne(key)}
              className={className}
            >
              {body}
            </a>
          ) : (
            <div key={`${key}-${i}`} onClick={() => acknowledgeOne(key)} className={className}>
              {body}
            </div>
          );
        })}
        {!isLoading && items.length === 0 && (
          <div className="p-2 dim">No recent headlines for this filter.</div>
        )}
      </div>
    </div>
  );
}
