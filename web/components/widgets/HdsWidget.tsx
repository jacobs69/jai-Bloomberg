"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from "recharts";
import { apiGet, fmt, fmtBig, fmtCurrency, pctClass } from "../../lib/api";
import { isSafeHttpUrl } from "../../lib/links";
import { normalizeSymbol } from "../../lib/symbol";
import { useTerminal, useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

type BreakdownRow = {
  category: string;
  classification: string | null;
  periods: string[];
  values: number[];
  latest: number | null;
  prev: number | null;
  qoqChange: number | null;
};

type HolderCategory =
  | "Promoter"
  | "FII"
  | "DII"
  | "Government"
  | "Public"
  | "Institution"
  | "Mutual Fund"
  | "Insider";

type MajorHolderEntity = {
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

type InsiderRosterRow = {
  name: string;
  relation: string;
  transaction: string;
  date: string | null;
  sharesDirect: number | null;
};

type HoldersReport = {
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
  quarterlyTrend: BreakdownRow[];
  yearlyTrend: BreakdownRow[];
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

const CAT_COLORS: Record<string, string> = {
  Promoter: "text-[#ff9900]",
  FII: "text-[#4fc3f7]",
  DII: "text-[#00c853]",
  Government: "text-[#ba68c8]",
  Public: "text-[#b0b0b0]",
  Institution: "text-[#4fc3f7]",
  "Mutual Fund": "text-[#80cbc4]",
  Insider: "text-[#ff8a65]",
};

export default function HdsWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const setWidgetSymbol = useTerminal((s) => s.setWidgetSymbol);

  const [lookupInput, setLookupInput] = useState("");
  const [tab, setTab] = useState<"holders" | "quarterly" | "yearly" | "funds">("holders");
  const [catFilter, setCatFilter] = useState<string>("ALL");

  const { data, isLoading, error } = useQuery({
    queryKey: ["hds-holders", symbol],
    queryFn: () => apiGet<HoldersReport>(`/api/holders/${encodeURIComponent(symbol)}`),
    enabled: Boolean(symbol),
    staleTime: 600_000,
  });

  const categories = useMemo(() => {
    if (!data?.majorHolders) return ["ALL"];
    const present = [...new Set(data.majorHolders.map((h) => h.category))];
    return ["ALL", ...present];
  }, [data]);

  const filteredHolders = useMemo(() => {
    const list = data?.majorHolders ?? [];
    if (catFilter === "ALL") return list;
    return list.filter((h) => h.category === catFilter);
  }, [data, catFilter]);

  const chartData = useMemo(() => {
    const rows = tab === "yearly" ? data?.yearlyTrend : data?.quarterlyTrend;
    if (!rows || rows.length === 0) return [];
    const base = rows.find((r) => r.periods.length > 0);
    if (!base) return [];
    const findVal = (match: string, idx: number) => {
      const row = rows.find((r) => r.category.toLowerCase().includes(match));
      return row?.values[idx] ?? null;
    };
    return base.periods.map((period, idx) => ({
      period,
      Promoters: findVal("promoter", idx) ?? findVal("insider", idx),
      FIIs: findVal("fii", idx) ?? findVal("institution", idx),
      DIIs: findVal("dii", idx),
      Public: findVal("public", idx),
    }));
  }, [data, tab]);

  const submitSymbol = (raw: string) => {
    const sym = normalizeSymbol(raw);
    if (!sym) return;
    if (widget.linked) setActiveSymbol(sym);
    else setWidgetSymbol(widget.id, sym);
    setLookupInput("");
  };

  const s = data?.summary;
  const barSegments = [
    { label: "Promoters/Insiders", val: s?.promoterOrInsiderPct ?? 0, color: "#ff9900" },
    { label: "FIIs/Institutions", val: s?.fiiPct ?? 0, color: "#4fc3f7" },
    { label: "DIIs", val: s?.diiPct ?? 0, color: "#00c853" },
    { label: "Govt", val: s?.govtPct ?? 0, color: "#ba68c8" },
    { label: "Public", val: s?.publicPct ?? 0, color: "#595959" },
  ].filter((seg) => seg.val > 0);

  return (
    <div className="flex flex-col h-full text-[11px]">
      {/* HDS Command / Filter Header */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-[var(--border)] bg-[var(--panel-2)] flex-wrap shrink-0">
        <span className="amber font-bold tracking-wider">HDS · SHAREHOLDERS</span>
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (lookupInput.trim()) submitSymbol(lookupInput);
          }}
        >
          <input
            value={lookupInput}
            onChange={(e) => setLookupInput(e.target.value)}
            placeholder="Analyze ticker (RELIANCE, 500325, AAPL)…"
            className="w-48 text-[10px]"
          />
          <button type="submit" className="term-btn !px-1.5 !py-0">GO</button>
        </form>

        <div className="flex gap-1 ml-auto flex-wrap">
          {(
            [
              { id: "holders", label: "TOP HOLDERS" },
              { id: "quarterly", label: "QUARTERLY" },
              { id: "yearly", label: "YEARLY" },
              { id: "funds", label: "FUNDS & INSIDERS" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              className={`term-btn !px-1.5 !py-0 ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <div className="p-3 dim">Fetching live shareholder registry for {symbol}…</div>}
      {error && <div className="p-3 down">Error: {(error as Error).message}</div>}

      {data && (
        <div className="flex-1 overflow-auto min-h-0 flex flex-col">
          {/* Company Banner & Sources */}
          <div className="px-2 py-1.5 border-b border-[#191919] flex items-center justify-between flex-wrap gap-2 bg-[#0d0d0d]">
            <div>
              <span className="font-bold text-[var(--text)] text-[12px]">{data.companyName}</span>
              <span className="dim ml-2 text-[10px]">
                {data.exchange} · Filing: {data.latestPeriod ?? "Latest"}
              </span>
            </div>
            <div className="flex gap-2 items-center text-[10px] flex-wrap">
              <span className="dim">Sources:</span>
              {data.externalLinks.screener && isSafeHttpUrl(data.externalLinks.screener) && (
                <a href={data.externalLinks.screener} target="_blank" rel="noreferrer" className="amber hover:underline">
                  Screener.in ↗
                </a>
              )}
              {data.externalLinks.bse && isSafeHttpUrl(data.externalLinks.bse) && (
                <a href={data.externalLinks.bse} target="_blank" rel="noreferrer" className="amber hover:underline">
                  BSEIndia ↗
                </a>
              )}
              {data.externalLinks.trendlyne && isSafeHttpUrl(data.externalLinks.trendlyne) && (
                <a href={data.externalLinks.trendlyne} target="_blank" rel="noreferrer" className="amber hover:underline">
                  Trendlyne ↗
                </a>
              )}
              {data.externalLinks.yahoo && isSafeHttpUrl(data.externalLinks.yahoo) && (
                <a href={data.externalLinks.yahoo} target="_blank" rel="noreferrer" className="amber hover:underline">
                  Yahoo Finance ↗
                </a>
              )}
              {data.externalLinks.sec && isSafeHttpUrl(data.externalLinks.sec) && (
                <a href={data.externalLinks.sec} target="_blank" rel="noreferrer" className="amber hover:underline">
                  SEC EDGAR ↗
                </a>
              )}
              {data.externalLinks.whalewisdom && isSafeHttpUrl(data.externalLinks.whalewisdom) && (
                <a href={data.externalLinks.whalewisdom} target="_blank" rel="noreferrer" className="amber hover:underline">
                  WhaleWisdom ↗
                </a>
              )}
            </div>
          </div>

          {/* Ownership KPI Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-5 border-b border-[var(--border)] bg-[#080808]">
            <div className="p-2 border-r border-[#171717]">
              <div className="dim text-[9px] uppercase">Promoters / Insiders</div>
              <div className="amber font-bold text-[13px]">{fmt(s?.promoterOrInsiderPct)}%</div>
            </div>
            <div className="p-2 border-r border-[#171717]">
              <div className="dim text-[9px] uppercase">{s?.diiPct !== null ? "FIIs" : "Institutions"}</div>
              <div className="font-bold text-[13px] text-[#4fc3f7]">{fmt(s?.fiiPct)}%</div>
            </div>
            <div className="p-2 border-r border-[#171717]">
              <div className="dim text-[9px] uppercase">{s?.diiPct !== null ? "DIIs (MF/LIC)" : "Inst. Count"}</div>
              <div className="up font-bold text-[13px]">
                {s?.diiPct !== null ? `${fmt(s?.diiPct)}%` : fmt(s?.institutionsCount, 0)}
              </div>
            </div>
            <div className="p-2 border-r border-[#171717]">
              <div className="dim text-[9px] uppercase">Public / Float</div>
              <div className="font-bold text-[13px]">{fmt(s?.publicPct)}%</div>
            </div>
            <div className="p-2">
              <div className="dim text-[9px] uppercase">Total Shareholders</div>
              <div className="font-bold text-[13px]">
                {s?.totalShareholders ? s.totalShareholders.toLocaleString("en-IN") : "—"}
                {s?.shareholdersDelta !== null && s?.shareholdersDelta !== undefined && (
                  <span className={`ml-1 text-[10px] ${pctClass(s.shareholdersDelta)}`}>
                    ({s.shareholdersDelta >= 0 ? "+" : ""}
                    {fmtBig(s.shareholdersDelta)})
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Visual Stacked Ownership Bar */}
          {barSegments.length > 0 && (
            <div className="px-2 py-1.5 border-b border-[#181818] bg-[#0a0a0a]">
              <div className="h-2.5 w-full flex overflow-hidden bg-[#1a1a1a]">
                {barSegments.map((seg) => (
                  <div
                    key={seg.label}
                    style={{ width: `${Math.min(100, seg.val)}%`, backgroundColor: seg.color }}
                    title={`${seg.label}: ${seg.val.toFixed(2)}%`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Tab 1: Top Named Major Shareholders */}
          {tab === "holders" && (
            <div className="flex flex-col flex-1 min-h-0">
              <div className="flex gap-1 px-2 py-1 border-b border-[#161616] flex-wrap">
                {categories.map((c) => (
                  <button
                    key={c}
                    className={`term-btn !px-1.5 !py-0 text-[10px] ${catFilter === c ? "active" : ""}`}
                    onClick={() => setCatFilter(c)}
                  >
                    {c.toUpperCase()}
                  </button>
                ))}
                <span className="dim text-[10px] ml-auto">{filteredHolders.length} major holders</span>
              </div>

              <div className="flex-1 overflow-auto min-h-0">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Shareholder / Institution</th>
                      <th>Category</th>
                      <th>Latest %</th>
                      <th>Prev %</th>
                      <th>QoQ Δ</th>
                      <th>Shares / Period</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHolders.map((h, i) => (
                      <tr key={`${h.name}-${h.category}-${i}`}>
                        <td className="!text-left font-bold max-w-[260px] truncate" title={h.name}>
                          {h.profileUrl && isSafeHttpUrl(h.profileUrl) ? (
                            <a
                              href={h.profileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:text-[var(--amber)] hover:underline"
                            >
                              {h.name} ↗
                            </a>
                          ) : (
                            h.name
                          )}
                        </td>
                        <td className={`font-bold text-[10px] ${CAT_COLORS[h.category] ?? "dim"}`}>{h.category}</td>
                        <td className="font-bold">{h.percentHeld !== null ? `${fmt(h.percentHeld)}%` : "—"}</td>
                        <td className="dim">{h.prevPercentHeld !== null ? `${fmt(h.prevPercentHeld)}%` : "—"}</td>
                        <td className={pctClass(h.qoqDelta)}>
                          {h.qoqDelta !== null ? `${h.qoqDelta >= 0 ? "+" : ""}${fmt(h.qoqDelta)}%` : "—"}
                        </td>
                        <td className="dim">
                          {h.shares ? fmtBig(h.shares) : h.reportDate ?? "—"}
                        </td>
                      </tr>
                    ))}
                    {filteredHolders.length === 0 && (
                      <tr>
                        <td colSpan={6} className="dim p-3 !text-center">
                          No individual disclosed holders (&gt;1% threshold) for this filter. View Quarterly Trend tab for category totals.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab 2 & 3: Quarterly & Yearly Shareholding Trend Chart + Matrix */}
          {(tab === "quarterly" || tab === "yearly") && (
            <div className="flex flex-col flex-1 min-h-0 overflow-auto">
              {chartData.length > 1 && (
                <div className="h-44 p-2 border-b border-[#1a1a1a] shrink-0">
                  <ResponsiveContainer width="100%" height="100%" debounce={50}>
                    <LineChart data={chartData}>
                      <XAxis dataKey="period" tick={{ fill: "#888", fontSize: 10 }} stroke="#262626" />
                      <YAxis tick={{ fill: "#888", fontSize: 10 }} stroke="#262626" domain={[0, "auto"]} unit="%" />
                      <Tooltip
                        contentStyle={{ background: "#0b0b0b", border: "1px solid #333", fontSize: 11 }}
                        labelStyle={{ color: "#ff9900" }}
                      />
                      <Line type="monotone" dataKey="Promoters" stroke="#ff9900" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="FIIs" stroke="#4fc3f7" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="DIIs" stroke="#00c853" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="Public" stroke="#808080" strokeWidth={1.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {(() => {
                const rows = tab === "yearly" ? data.yearlyTrend : data.quarterlyTrend;
                const periods = rows[0]?.periods ?? [];
                return (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Holder Group</th>
                        {periods.map((p) => (
                          <th key={p}>{p}</th>
                        ))}
                        <th>Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const isCount = r.category.toLowerCase().includes("shareholder");
                        return (
                          <tr key={r.category}>
                            <td className="!text-left font-bold amber">{r.category}</td>
                            {r.values.map((v, idx) => (
                              <td key={idx}>
                                {isCount ? v.toLocaleString("en-IN") : `${v.toFixed(2)}%`}
                              </td>
                            ))}
                            <td className={pctClass(r.qoqChange)}>
                              {r.qoqChange !== null
                                ? `${r.qoqChange >= 0 ? "+" : ""}${isCount ? fmtBig(r.qoqChange) : `${r.qoqChange.toFixed(2)}%`}`
                                : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          )}

          {/* Tab 4: Mutual Funds / ETFs + Executive / Insider Roster */}
          {tab === "funds" && (
            <div className="flex-1 overflow-auto min-h-0 flex flex-col gap-2 p-2">
              <div>
                <div className="amber font-bold text-[10px] mb-1 uppercase">Top Mutual Funds &amp; Global ETFs</div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Fund / ETF</th>
                      <th>Stake %</th>
                      <th>Shares</th>
                      <th>Value</th>
                      <th>Report Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.mutualFunds.map((f, i) => (
                      <tr key={`${f.name}-${i}`}>
                        <td className="!text-left font-bold max-w-[260px] truncate">{f.name}</td>
                        <td>{f.percentHeld !== null ? `${fmt(f.percentHeld)}%` : "—"}</td>
                        <td>{fmtBig(f.shares)}</td>
                        <td>{f.value ? fmtCurrency(f.value, data.currency) : "—"}</td>
                        <td className="dim">{f.reportDate ?? "—"}</td>
                      </tr>
                    ))}
                    {data.mutualFunds.length === 0 && (
                      <tr>
                        <td colSpan={5} className="dim p-2 !text-center">
                          No global mutual fund breakdown returned; see TOP HOLDERS for DII / Mutual Fund stakes.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {data.insiders.length > 0 && (
                <div>
                  <div className="amber font-bold text-[10px] mb-1 uppercase">Executive &amp; Insider Holdings</div>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Role</th>
                        <th>Latest Activity</th>
                        <th>Date</th>
                        <th>Direct Shares</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.insiders.map((ins, i) => (
                        <tr key={`${ins.name}-${i}`}>
                          <td className="!text-left font-bold">{ins.name}</td>
                          <td className="!text-left dim">{ins.relation}</td>
                          <td className="!text-left">{ins.transaction}</td>
                          <td className="dim">{ins.date ?? "—"}</td>
                          <td>{fmtBig(ins.sharesDirect)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
