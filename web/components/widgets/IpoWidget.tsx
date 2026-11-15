"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, fmt, pctClass } from "../../lib/api";
import { isSafeHttpUrl } from "../../lib/links";
import { useTerminal } from "../../store/terminal";

type IpoItem = {
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

type RecentIpoItem = IpoItem & {
  issuePrice: number | null;
  currentPrice: number | null;
  listingGainPercent: number | null;
};

type IpoSubscription = {
  companyName: string;
  symbol: string | null;
  closingDate: string | null;
  issueAmountCr: number | null;
  subscriptionStatus: "open" | "closed" | "upcoming";
  asOf: string | null;
  applications: string | null;
  totalTimes: number | null;
  bidData: Array<{ category: string; subscriptionTimes: number | null }>;
};

type NewsItem = { title: string; link: string; publisher: string; publishedAt: string | null };

function priceBand(min: number | null, max: number | null): string {
  if (min === null && max === null) return "TBA";
  if (min !== null && max !== null && min !== max) return `₹${fmt(min, 0)}–₹${fmt(max, 0)}`;
  return `₹${fmt(max ?? min, 0)}`;
}

export default function IpoWidget() {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [tab, setTab] = useState<"upcoming" | "recent" | "subscription" | "news">("upcoming");
  const [companyFilter, setCompanyFilter] = useState("");

  const upcoming = useQuery({
    queryKey: ["india-ipos-upcoming"],
    queryFn: () => apiGet<IpoItem[]>("/api/india/ipos/upcoming"),
    enabled: tab === "upcoming",
    refetchInterval: 300_000,
  });

  const recent = useQuery({
    queryKey: ["india-ipos-recent"],
    queryFn: () => apiGet<RecentIpoItem[]>("/api/india/ipos/recent?days=90"),
    enabled: tab === "recent",
    refetchInterval: 60_000,
  });

  const subs = useQuery({
    queryKey: ["india-ipos-subscription"],
    queryFn: () => apiGet<IpoSubscription[]>("/api/india/ipos/subscription"),
    enabled: tab === "subscription",
    refetchInterval: 30_000,
  });

  const news = useQuery({
    queryKey: ["india-ipo-news"],
    queryFn: () => apiGet<NewsItem[]>("/api/india/ipo-news"),
    enabled: tab === "news",
    refetchInterval: 60_000,
  });

  const filteredSubs = (subs.data ?? []).filter((s) =>
    companyFilter.trim()
      ? s.companyName.toLowerCase().includes(companyFilter.trim().toLowerCase()) ||
        (s.symbol ?? "").toLowerCase().includes(companyFilter.trim().toLowerCase())
      : true
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 p-1 items-center flex-wrap border-b border-[#161616] shrink-0">
        <button className={`term-btn ${tab === "upcoming" ? "active" : ""}`} onClick={() => setTab("upcoming")}>
          UPCOMING / OPEN
        </button>
        <button className={`term-btn ${tab === "recent" ? "active" : ""}`} onClick={() => setTab("recent")}>
          RECENT LISTINGS
        </button>
        <button className={`term-btn ${tab === "subscription" ? "active" : ""}`} onClick={() => setTab("subscription")}>
          SUBSCRIPTION (x)
        </button>
        <button className={`term-btn ${tab === "news" ? "active" : ""}`} onClick={() => setTab("news")}>
          IPO NEWS
        </button>
        {tab === "subscription" && (
          <input
            className="ml-auto w-40"
            placeholder="Filter company…"
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
          />
        )}
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        {tab === "upcoming" && (
          <>
            {upcoming.error && <div className="p-2 down">Error: {(upcoming.error as Error).message}</div>}
            {upcoming.isLoading && <div className="p-2 dim">Loading Indian IPO calendar…</div>}
            {!upcoming.isLoading && !upcoming.error && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Board</th>
                    <th>Open</th>
                    <th>Close</th>
                    <th>Price Band</th>
                    <th>Size (₹Cr)</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(upcoming.data ?? []).map((item, idx) => (
                    <tr
                      key={`${item.companyName}-${idx}`}
                      onClick={() => {
                        if (item.symbol) setActiveSymbol(item.symbol);
                      }}
                    >
                      <td className="!text-left font-bold">
                        {item.link && isSafeHttpUrl(item.link) ? (
                          <a
                            href={item.link}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-[var(--amber)]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {item.companyName}
                          </a>
                        ) : (
                          item.companyName
                        )}
                      </td>
                      <td className="dim">{item.category}</td>
                      <td className="dim">{item.ipoOpenDate ?? "TBA"}</td>
                      <td className="dim">{item.ipoCloseDate ?? "TBA"}</td>
                      <td>{priceBand(item.minPrice, item.maxPrice)}</td>
                      <td>{item.issueAmountCr ? `₹${fmt(item.issueAmountCr, 0)}` : "—"}</td>
                      <td className={item.status === "open" ? "up font-bold" : "amber"}>
                        {item.status.toUpperCase()}
                      </td>
                    </tr>
                  ))}
                  {(upcoming.data ?? []).length === 0 && (
                    <tr>
                      <td colSpan={7} className="dim p-3 !text-center">
                        No open or upcoming IPOs found in the current window.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </>
        )}

        {tab === "recent" && (
          <>
            {recent.error && <div className="p-2 down">Error: {(recent.error as Error).message}</div>}
            {recent.isLoading && <div className="p-2 dim">Loading recent IPO listings…</div>}
            {!recent.isLoading && !recent.error && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Sym</th>
                    <th>Listed</th>
                    <th>Issue Price</th>
                    <th>CMP</th>
                    <th>Gain %</th>
                    <th>Size (₹Cr)</th>
                  </tr>
                </thead>
                <tbody>
                  {(recent.data ?? []).map((item, idx) => (
                    <tr
                      key={`${item.companyName}-${idx}`}
                      onClick={() => {
                        if (item.symbol) setActiveSymbol(item.symbol);
                      }}
                    >
                      <td className="!text-left font-bold">{item.companyName}</td>
                      <td className="amber">{item.symbol ?? "—"}</td>
                      <td className="dim">{item.listingDate ?? "—"}</td>
                      <td>{item.issuePrice !== null ? `₹${fmt(item.issuePrice)}` : "—"}</td>
                      <td>{item.currentPrice !== null ? `₹${fmt(item.currentPrice)}` : "—"}</td>
                      <td className={pctClass(item.listingGainPercent)}>
                        {item.listingGainPercent !== null
                          ? `${item.listingGainPercent >= 0 ? "+" : ""}${fmt(item.listingGainPercent)}%`
                          : "—"}
                      </td>
                      <td>{item.issueAmountCr ? `₹${fmt(item.issueAmountCr, 0)}` : "—"}</td>
                    </tr>
                  ))}
                  {(recent.data ?? []).length === 0 && (
                    <tr>
                      <td colSpan={7} className="dim p-3 !text-center">
                        No recent IPO listings in the last 90 days.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </>
        )}

        {tab === "subscription" && (
          <>
            {subs.error && <div className="p-2 down">Error: {(subs.error as Error).message}</div>}
            {subs.isLoading && <div className="p-2 dim">Loading live IPO subscription data…</div>}
            {!subs.isLoading && !subs.error && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Close</th>
                    <th>QIB</th>
                    <th>NII</th>
                    <th>Retail</th>
                    <th>Total</th>
                    <th>Apps</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSubs.map((s, idx) => {
                    const bid = (cat: string) => s.bidData.find((b) => b.category === cat)?.subscriptionTimes ?? null;
                    const qib = bid("QIB");
                    const nii = bid("NII");
                    const retail = bid("Retail");
                    return (
                      <tr
                        key={`${s.companyName}-${idx}`}
                        onClick={() => {
                          if (s.symbol) setActiveSymbol(s.symbol);
                        }}
                      >
                        <td className="!text-left font-bold">{s.companyName}</td>
                        <td className="dim">{s.closingDate ?? "—"}</td>
                        <td>{qib !== null ? `${fmt(qib, 2)}x` : "—"}</td>
                        <td>{nii !== null ? `${fmt(nii, 2)}x` : "—"}</td>
                        <td>{retail !== null ? `${fmt(retail, 2)}x` : "—"}</td>
                        <td className="amber font-bold">{s.totalTimes !== null ? `${fmt(s.totalTimes, 2)}x` : "—"}</td>
                        <td className="dim">{s.applications ?? "—"}</td>
                        <td className={s.subscriptionStatus === "open" ? "up font-bold" : "dim"}>
                          {s.subscriptionStatus.toUpperCase()}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredSubs.length === 0 && (
                    <tr>
                      <td colSpan={8} className="dim p-3 !text-center">
                        No matching IPO subscription records.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </>
        )}

        {tab === "news" && (
          <>
            {news.error && <div className="p-2 down">Error: {(news.error as Error).message}</div>}
            {news.isLoading && <div className="p-2 dim">Loading IPO news…</div>}
            {(news.data ?? []).map((n, i) => {
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
          </>
        )}
      </div>
    </div>
  );
}
