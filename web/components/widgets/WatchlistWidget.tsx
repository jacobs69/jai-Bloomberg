"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  AreaSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { apiGet, fmt, fmtBig, fmtCurrency, pctClass, type Candle, type Quote } from "../../lib/api";
import { normalizeSymbol, symbolsParam } from "../../lib/symbol";
import { useLiveStream } from "../../lib/useLiveStream";
import { useTerminal } from "../../store/terminal";
import Flash from "../Flash";

type ScripItem = {
  id: string;
  symbol: string;
  dispName: string;
  exchange: "NSE" | "BSE";
  excToken: string;
  asset: string;
  isin: string;
  name: string;
};

type ScripsResponse = {
  totalUniverse: number;
  count: number;
  items: ScripItem[];
};

const MINI_INTERVALS = ["1m", "5m", "15m", "1D"] as const;
type MiniInterval = (typeof MINI_INTERVALS)[number];

const MINI_SEC: Record<MiniInterval, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1D": 86_400,
};

function MiniFastChart({ symbol, liveTick }: { symbol: string; liveTick?: Quote }) {
  const [interval, setInterval] = useState<MiniInterval>("1m");
  const [mode, setMode] = useState<"candles" | "area">("candles");
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<any> | null>(null);
  const lastCandleRef = useRef<Candle | null>(null);

  const { data: candles = [], isLoading } = useQuery({
    queryKey: ["watchlist-mini", symbol, interval],
    queryFn: () =>
      apiGet<Candle[]>(
        `/api/history/${encodeURIComponent(symbol)}?range=1D&interval=${encodeURIComponent(interval)}`
      ),
    enabled: Boolean(symbol),
    refetchInterval: interval === "1D" ? 30_000 : 8_000,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      layout: { background: { color: "#070707" }, textColor: "#999", fontFamily: "monospace", fontSize: 10 },
      grid: { vertLines: { color: "#151515" }, horzLines: { color: "#151515" } },
      rightPriceScale: { borderColor: "#222" },
      timeScale: { borderColor: "#222", timeVisible: interval !== "1D", secondsVisible: false },
      crosshair: { mode: 0 },
      handleScroll: true,
      handleScale: true,
    });
    chartRef.current = chart;

    const ro = new ResizeObserver(() => {
      if (el) chart.resize(el.clientWidth, el.clientHeight);
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [interval]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (seriesRef.current) {
      try {
        chart.removeSeries(seriesRef.current);
      } catch {
        // ignore stale ref
      }
      seriesRef.current = null;
    }

    if (candles.length === 0) return;

    const dedup = new Map<number, Candle>();
    for (const c of candles) dedup.set(c.time, c);
    const ordered = [...dedup.values()].sort((a, b) => a.time - b.time);
    lastCandleRef.current = ordered[ordered.length - 1] ?? null;

    if (mode === "candles") {
      const s = chart.addSeries(CandlestickSeries, {
        upColor: "#00c853",
        downColor: "#ff3d3d",
        borderVisible: false,
        wickUpColor: "#00c853",
        wickDownColor: "#ff3d3d",
      });
      s.setData(
        ordered.map((c) => ({
          time: c.time as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      );
      seriesRef.current = s;
    } else {
      const s = chart.addSeries(AreaSeries, {
        lineColor: "#ff9900",
        topColor: "rgba(255,153,0,0.30)",
        bottomColor: "rgba(255,153,0,0.02)",
        lineWidth: 2,
      });
      s.setData(ordered.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })));
      seriesRef.current = s;
    }

    chart.timeScale().fitContent();
  }, [candles, mode]);

  useEffect(() => {
    const series = seriesRef.current;
    const prev = lastCandleRef.current;
    if (!series || !prev || liveTick?.price === null || liveTick?.price === undefined) return;
    const price = liveTick.price;
    const sec = MINI_SEC[interval];
    const nowSec = Math.floor(Date.now() / 1000);
    const bucket = Math.floor(nowSec / sec) * sec;
    const t = Math.max(prev.time, bucket);
    const nextCandle: Candle =
      t === prev.time
        ? {
            time: t,
            open: prev.open,
            high: Math.max(prev.high, price),
            low: Math.min(prev.low, price),
            close: price,
            volume: prev.volume,
          }
        : { time: t, open: prev.close, high: price, low: price, close: price, volume: 0 };

    lastCandleRef.current = nextCandle;
    if (mode === "candles") {
      series.update({
        time: t as UTCTimestamp,
        open: nextCandle.open,
        high: nextCandle.high,
        low: nextCandle.low,
        close: nextCandle.close,
      });
    } else {
      series.update({ time: t as UTCTimestamp, value: price });
    }
  }, [liveTick, interval, mode]);

  return (
    <div className="border-t border-[var(--border)] bg-[#070707] flex flex-col shrink-0">
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-[#1b1b1b] text-[10px]">
        <span className="amber font-bold">{symbol}</span>
        {liveTick?.price != null && (
          <>
            <span className="font-bold text-[var(--text)]">{fmtCurrency(liveTick.price, liveTick.currency)}</span>
            <span className={pctClass(liveTick.changePercent)}>{fmt(liveTick.changePercent)}%</span>
          </>
        )}
        <div className="flex gap-0.5 ml-auto">
          {MINI_INTERVALS.map((iv) => (
            <button
              key={iv}
              className={`term-btn !px-1.5 !py-0 ${interval === iv ? "active" : ""}`}
              onClick={() => setInterval(iv)}
            >
              {iv}
            </button>
          ))}
          <button
            className="term-btn !px-1.5 !py-0 ml-1"
            onClick={() => setMode((m) => (m === "candles" ? "area" : "candles"))}
            title="Switch mini-chart style"
          >
            {mode === "candles" ? "AREA" : "OHLC"}
          </button>
        </div>
      </div>
      <div className="relative h-32 w-full">
        <div ref={containerRef} className="w-full h-full" />
        {isLoading && candles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center dim text-[10px]">
            Loading fast chart for {symbol}…
          </div>
        )}
      </div>
    </div>
  );
}

export default function WatchlistWidget() {
  const watchlist = useTerminal((s) => s.watchlist);
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const addToWatchlist = useTerminal((s) => s.addToWatchlist);
  const removeFromWatchlist = useTerminal((s) => s.removeFromWatchlist);
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);

  const [input, setInput] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [exchange, setExchange] = useState<"ALL" | "NSE" | "BSE">("ALL");
  const [showDropdown, setShowDropdown] = useState(false);
  const [showMiniChart, setShowMiniChart] = useState(true);

  const searchQ = input.trim();

  // Real-time SSE stream for every stock in watchlist + active symbol
  const streamSymbols = useMemo(
    () => [...new Set([...watchlist, activeSymbol].filter(Boolean))],
    [watchlist, activeSymbol]
  );
  const { ticks, connected } = useLiveStream(streamSymbols);

  // Initial + backup snapshot query
  const { data: snapshot = [] } = useQuery({
    queryKey: ["watchlist", watchlist.join(",")],
    queryFn: () => apiGet<Quote[]>(`/api/quotes?symbols=${symbolsParam(watchlist)}`),
    enabled: watchlist.length > 0,
    refetchInterval: 10_000,
  });

  // Search full 24,000+ NSE & BSE scrip universe
  const { data: scripSearch } = useQuery({
    queryKey: ["india-scrips", searchQ, exchange],
    queryFn: () =>
      apiGet<ScripsResponse>(
        `/api/india/scrips?q=${encodeURIComponent(searchQ)}&exchange=${exchange}&limit=25`
      ),
    staleTime: 60_000,
  });

  const mergedBySym = useMemo(() => {
    const map = new Map<string, Quote>();
    for (const q of snapshot) map.set(q.symbol, q);
    for (const [sym, q] of Object.entries(ticks)) map.set(sym, q);
    return map;
  }, [snapshot, ticks]);

  const previewSymbol = watchlist.includes(activeSymbol) ? activeSymbol : watchlist[0] ?? activeSymbol;

  return (
    <div className="flex flex-col h-full relative">
      {/* Live status + universe & exchange filter bar */}
      <div className="flex items-center gap-1.5 px-1.5 py-1 border-b border-[var(--border)] bg-[var(--panel-2)] text-[10px] shrink-0 flex-wrap">
        <span className={connected ? "up font-bold" : "amber"}>
          {connected ? "● LIVE 1s STREAM" : "◌ SYNCING"}
        </span>
        {scripSearch?.totalUniverse ? (
          <span className="dim">· {scripSearch.totalUniverse.toLocaleString("en-IN")} NSE/BSE</span>
        ) : null}
        <div className="flex gap-0.5 ml-auto">
          {(["ALL", "NSE", "BSE"] as const).map((ex) => (
            <button
              key={ex}
              type="button"
              className={`term-btn !px-1.5 !py-0 ${exchange === ex ? "active" : ""}`}
              onClick={() => setExchange(ex)}
            >
              {ex}
            </button>
          ))}
          <button
            type="button"
            className={`term-btn !px-1.5 !py-0 ml-1 ${showMiniChart ? "active" : ""}`}
            onClick={() => setShowMiniChart((v) => !v)}
            title="Toggle fast inline mini-chart"
          >
            MINI CHART
          </button>
        </div>
      </div>

      {/* Add/Search bar across all NSE & BSE stocks */}
      <div className="relative shrink-0">
        <form
          className="flex gap-1 p-1 border-b border-[#1c1c1c]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!input.trim()) return;
            const sym = normalizeSymbol(input);
            if (!sym) {
              setInvalid(true);
              return;
            }
            addToWatchlist(sym);
            setActiveSymbol(sym);
            setInput("");
            setShowDropdown(false);
          }}
        >
          <input
            value={input}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 180)}
            onChange={(e) => {
              setInput(e.target.value);
              setInvalid(false);
              setShowDropdown(true);
            }}
            placeholder="Search any NSE/BSE stock, name or BSE code (e.g. RELIANCE, 500325, BSE:TCS)…"
            title={invalid ? "Not a valid ticker symbol" : undefined}
            aria-invalid={invalid}
            className={`flex-1 ${invalid ? "!border-[var(--down)]" : ""}`}
          />
          <button className="term-btn" type="submit">+</button>
        </form>

        {showDropdown && searchQ.length >= 1 && scripSearch && scripSearch.items.length > 0 && (
          <div className="absolute left-1 right-1 top-full z-40 max-h-56 overflow-auto bg-[#0c0c0c] border border-[var(--amber-dim)] shadow-lg">
            {scripSearch.items.map((item) => {
              const targetSym = item.exchange === "BSE" ? `BSE:${item.dispName}` : item.dispName;
              const added = watchlist.includes(targetSym);
              return (
                <div
                  key={item.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addToWatchlist(targetSym);
                    setActiveSymbol(targetSym);
                    setInput("");
                    setShowDropdown(false);
                  }}
                  className="flex items-center gap-2 px-2 py-1 text-[11px] hover:bg-[#1a160c] cursor-pointer border-b border-[#171717]"
                >
                  <span className="font-bold amber w-28 truncate">{targetSym}</span>
                  <span className="flex-1 truncate text-[var(--text)]">{item.name}</span>
                  <span className="dim text-[10px]">
                    {item.exchange} · {item.excToken}
                  </span>
                  <span className={`text-[10px] font-bold ${added ? "up" : "amber"}`}>
                    {added ? "✓" : "+ ADD"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Rich Numbers Watchlist Table */}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="data-table">
          <thead>
            <tr>
              <th>Sym</th>
              <th>Last</th>
              <th>Chg</th>
              <th>Chg%</th>
              <th>Open</th>
              <th>High</th>
              <th>Low</th>
              <th>Vol</th>
              <th>P/E</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {watchlist.map((sym) => {
              const q = mergedBySym.get(sym);
              const isSelected = sym === previewSymbol;
              return (
                <tr
                  key={sym}
                  onClick={() => setActiveSymbol(sym)}
                  className={isSelected ? "bg-[#191408]" : ""}
                >
                  <td className="font-bold">
                    <span className={isSelected ? "amber" : ""}>{sym}</span>
                    {q?.exchange && <span className="dim text-[9px] ml-1">{q.exchange}</span>}
                  </td>
                  <td className="font-bold">
                    <Flash value={q?.price}>{fmtCurrency(q?.price, q?.currency)}</Flash>
                  </td>
                  <td className={pctClass(q?.change)}>{fmt(q?.change)}</td>
                  <td className={pctClass(q?.changePercent)}>
                    <Flash value={q?.changePercent}>{fmt(q?.changePercent)}%</Flash>
                  </td>
                  <td className="dim">{fmt(q?.open)}</td>
                  <td className="up">{fmt(q?.high)}</td>
                  <td className="down">{fmt(q?.low)}</td>
                  <td>{fmtBig(q?.volume)}</td>
                  <td className="dim">{fmt(q?.pe, 1)}</td>
                  <td>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromWatchlist(sym);
                      }}
                      className="dim hover:text-[var(--down)]"
                      title="Remove from watchlist"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Inline Fast Real-Time Mini Chart */}
      {showMiniChart && previewSymbol && (
        <MiniFastChart symbol={previewSymbol} liveTick={mergedBySym.get(previewSymbol)} />
      )}
    </div>
  );
}
