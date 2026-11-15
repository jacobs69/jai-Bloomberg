"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";
import { useNewsAlert } from "../lib/useNewsStream";
import { useTerminal } from "../store/terminal";

type Status = {
  ok: boolean;
  providers: Array<{ name: string; ok: number; failed: number; lastLatencyMs: number | null }>;
  ai: boolean;
};

function Clock({ tz, label }: { tz: string; label: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return null;
  return (
    <span className="dim">
      {label}{" "}
      <span className="text-[var(--text)]">
        {now.toLocaleTimeString("en-GB", { timeZone: tz, hour12: false })}
      </span>
    </span>
  );
}

function marketStateIndia(): { label: string; open: boolean } {
  const ist = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const day = ist.getDay();
  const mins = ist.getHours() * 60 + ist.getMinutes();
  // NSE & BSE regular equity session: 09:15–15:30 IST, Mon–Fri
  const open = day >= 1 && day <= 5 && mins >= 555 && mins < 930;
  return { label: open ? "NSE/BSE OPEN" : "NSE/BSE CLOSED", open };
}

export default function TopBar() {
  const setCommandOpen = useTerminal((s) => s.setCommandOpen);
  const addOrFocusWidget = useTerminal((s) => s.addOrFocusWidget);
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const newsUnread = useNewsAlert((s) => s.unreadCount);
  const clearNewsUnread = useNewsAlert((s) => s.clearUnread);
  const [market, setMarket] = useState<{ label: string; open: boolean } | null>(null);
  const { data: status } = useQuery({
    queryKey: ["status"],
    queryFn: () => apiGet<Status>("/api/status"),
    refetchInterval: 30_000,
  });
  const { data: tjStatus } = useQuery({
    queryKey: ["tradejini-status"],
    queryFn: () => apiGet<{ connected: boolean }>("/api/tradejini/status"),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    setMarket(marketStateIndia());
    const t = setInterval(() => setMarket(marketStateIndia()), 15_000);
    return () => clearInterval(t);
  }, []);

  const healthy = status?.providers.filter((p) => p.ok > 0) ?? [];

  return (
    <header className="flex items-center gap-4 px-3 h-8 bg-[var(--panel-2)] border-b border-[var(--border)] text-[11px] shrink-0">
      <span className="amber font-bold tracking-widest">MARKETFORGE · INDIA</span>
      {market && <span className={market.open ? "up" : "down"}>● {market.label}</span>}
      <Clock tz="Asia/Kolkata" label="IST" />
      <Clock tz="Asia/Singapore" label="SGP" />
      <Clock tz="Europe/London" label="LDN" />
      <Clock tz="America/New_York" label="NY" />
      <button
        className="term-btn flex-1 max-w-md text-left dim"
        onClick={() => setCommandOpen(true)}
      >
        {activeSymbol} — search NSE/BSE symbol… <span className="float-right">⌘K</span>
      </button>
      <span className="dim ml-auto">
        feeds:{" "}
        {healthy.length > 0
          ? healthy.map((p) => `${p.name} ${p.lastLatencyMs ?? "—"}ms`).join(" · ")
          : "live"}
      </span>
      {newsUnread > 0 && (
        <button
          type="button"
          onClick={() => {
            addOrFocusWidget("news");
            clearNewsUnread();
            setTimeout(() => {
              document.querySelector('[data-widget-type="news"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
            }, 60);
          }}
          className="news-blinker px-2 py-0.5 font-bold text-[10px] tracking-wider cursor-pointer"
          title="New real-time market news arrived — click to view"
        >
          ● NEWS (+{newsUnread})
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          addOrFocusWidget("hds");
          setTimeout(() => {
            document.querySelector('[data-widget-type="hds"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 60);
        }}
        className="term-btn"
        title="Open HDS Shareholder Analysis for active symbol (Alt+H)"
      >
        HDS
      </button>
      <button
        type="button"
        onClick={() => {
          addOrFocusWidget("tankers");
          setTimeout(() => {
            document.querySelector('[data-widget-type="tankers"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 60);
        }}
        className="term-btn"
        title="Track global oil, product & LNG tankers live via TankerMap (Alt+T)"
      >
        TANKERS
      </button>
      <button
        type="button"
        onClick={() => {
          addOrFocusWidget("cubeplus");
          setTimeout(() => {
            document.querySelector('[data-widget-type="cubeplus"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 60);
        }}
        className={`term-btn ${tjStatus?.connected ? "!text-[var(--up)] !border-[var(--up)]" : ""}`}
        title="Link or open Tradejini CubePlus broker panel"
      >
        {tjStatus?.connected ? "CUBEPLUS ● LINKED" : "LINK CUBEPLUS"}
      </button>
      <span className={status?.ai ? "up" : "dim"}>AI {status?.ai ? "●" : "○"}</span>
    </header>
  );
}
