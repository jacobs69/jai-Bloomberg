"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  AreaSeries,
  BarSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { apiGet, fmt, fmtBig, fmtCurrency, pctClass, type Candle } from "../../lib/api";
import { sma, ema, vwap, rsi, macd, bollinger, type Point } from "../../lib/indicators";
import { useLiveStream } from "../../lib/useLiveStream";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

const INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "1D", "1W", "1MO"] as const;
const RANGES = ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"] as const;
const CHART_TYPES = ["candles", "bars", "line", "area"] as const;
const INDICATORS = ["SMA20", "SMA50", "SMA200", "EMA20", "VWAP", "BOLL", "RSI", "MACD"] as const;

type IntervalKey = (typeof INTERVALS)[number];
type Range = (typeof RANGES)[number];
type ChartType = (typeof CHART_TYPES)[number];
type Indicator = (typeof INDICATORS)[number];

const INTERVAL_SECONDS: Record<IntervalKey, number> = {
  "1m": 60,
  "3m": 180,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "1D": 86_400,
  "1W": 7 * 86_400,
  "1MO": 30 * 86_400,
};

const INTRADAY_SET = new Set<IntervalKey>(["1m", "3m", "5m", "15m", "30m", "1h"]);

const ts = (t: number) => t as UTCTimestamp;
const toMap = (pts: Point[]) => new Map(pts.map((p) => [p.time, p.value]));

const INDICATOR_COLOR: Record<string, string> = {
  SMA20: "#ffd966",
  SMA50: "#4fc3f7",
  SMA200: "#ba68c8",
  EMA20: "#ff8a65",
  VWAP: "#80cbc4",
  RSI: "#ff9900",
  BOLL: "#ff9900",
  MACD: "#4fc3f7",
};

export default function ChartWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const [intervalKey, setIntervalKey] = useState<IntervalKey>("5m");
  const [range, setRange] = useState<Range>("6M");
  const [chartType, setChartType] = useState<ChartType>("candles");
  const [active, setActive] = useState<Set<Indicator>>(new Set(["SMA20"]));
  const [legend, setLegend] = useState<Candle | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<any> | null>(null);
  const lastCandleRef = useRef<Candle | null>(null);

  const isIntraday = INTRADAY_SET.has(intervalKey);

  const { data: candles, error } = useQuery({
    queryKey: ["history", symbol, intervalKey, intervalKey === "1D" ? range : "auto"],
    queryFn: () =>
      apiGet<Candle[]>(
        `/api/history/${encodeURIComponent(symbol)}?range=${range}&interval=${encodeURIComponent(intervalKey)}`
      ),
    refetchInterval: isIntraday ? 15_000 : 60_000,
  });

  // Real-time SSE live quote ticks update the active candle immediately
  const { ticks, connected } = useLiveStream([symbol]);
  const liveQuote = ticks[symbol];

  const byTime = useMemo(() => {
    const m = new Map<number, Candle>();
    for (const c of candles ?? []) m.set(c.time, c);
    return m;
  }, [candles]);

  const indicatorData = useMemo(() => {
    if (!candles || candles.length === 0) return null;
    return {
      SMA20: active.has("SMA20") ? sma(candles, 20) : null,
      SMA50: active.has("SMA50") ? sma(candles, 50) : null,
      SMA200: active.has("SMA200") ? sma(candles, 200) : null,
      EMA20: active.has("EMA20") ? ema(candles, 20) : null,
      VWAP: active.has("VWAP") ? vwap(candles) : null,
      RSI: active.has("RSI") ? rsi(candles) : null,
      BOLL: active.has("BOLL") ? bollinger(candles) : null,
      MACD: active.has("MACD") ? macd(candles) : null,
    };
  }, [candles, active]);

  const indicatorMaps = useMemo(() => {
    const maps: Record<string, Map<number, number>> = {};
    if (!indicatorData) return maps;
    if (indicatorData.SMA20) maps.SMA20 = toMap(indicatorData.SMA20);
    if (indicatorData.SMA50) maps.SMA50 = toMap(indicatorData.SMA50);
    if (indicatorData.SMA200) maps.SMA200 = toMap(indicatorData.SMA200);
    if (indicatorData.EMA20) maps.EMA20 = toMap(indicatorData.EMA20);
    if (indicatorData.VWAP) maps.VWAP = toMap(indicatorData.VWAP);
    if (indicatorData.RSI) maps.RSI = toMap(indicatorData.RSI);
    if (indicatorData.BOLL) {
      maps.BOLL_U = toMap(indicatorData.BOLL.upper);
      maps.BOLL_M = toMap(indicatorData.BOLL.middle);
      maps.BOLL_L = toMap(indicatorData.BOLL.lower);
    }
    if (indicatorData.MACD) {
      maps.MACD_M = toMap(indicatorData.MACD.macd);
      maps.MACD_S = toMap(indicatorData.MACD.signal);
      maps.MACD_H = toMap(indicatorData.MACD.histogram);
    }
    return maps;
  }, [indicatorData]);

  const indicatorRows = useMemo(() => {
    if (!legend) return [];
    const t = legend.time;
    const get = (key: string) => indicatorMaps[key]?.get(t);
    const rows: Array<{ label: string; value: string; color: string }> = [];
    for (const key of ["SMA20", "SMA50", "SMA200", "EMA20", "VWAP"] as const) {
      const v = get(key);
      if (v !== undefined) rows.push({ label: key, value: fmt(v), color: INDICATOR_COLOR[key] });
    }
    const rsiV = get("RSI");
    if (rsiV !== undefined) rows.push({ label: "RSI", value: fmt(rsiV, 1), color: INDICATOR_COLOR.RSI });
    const bollM = get("BOLL_M");
    if (bollM !== undefined) {
      rows.push({
        label: "BOLL",
        value: `${fmt(get("BOLL_U"))} / ${fmt(bollM)} / ${fmt(get("BOLL_L"))}`,
        color: INDICATOR_COLOR.BOLL,
      });
    }
    const macdM = get("MACD_M");
    if (macdM !== undefined) {
      rows.push({
        label: "MACD",
        value: `${fmt(macdM, 2)} / ${fmt(get("MACD_S"), 2)} / ${fmt(get("MACD_H"), 2)}`,
        color: INDICATOR_COLOR.MACD,
      });
    }
    return rows;
  }, [legend, indicatorMaps]);

  useEffect(() => {
    const last = candles && candles.length > 0 ? candles[candles.length - 1] : null;
    lastCandleRef.current = last;
    setLegend(last);
  }, [candles]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !candles || candles.length === 0) return;

    const chart = createChart(el, {
      layout: { background: { color: "#0a0a0a" }, textColor: "#808080", fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: "#1a1a1a" }, horzLines: { color: "#1a1a1a" } },
      crosshair: { mode: 0 },
      timeScale: { borderColor: "#262626", timeVisible: isIntraday, secondsVisible: false },
      rightPriceScale: { borderColor: "#262626" },
      autoSize: true,
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    });
    chartRef.current = chart;

    const upColor = "#00c853";
    const downColor = "#ff3d3d";

    let mainSeries: ISeriesApi<any>;
    if (chartType === "candles") {
      mainSeries = chart.addSeries(CandlestickSeries, {
        upColor,
        downColor,
        borderUpColor: upColor,
        borderDownColor: downColor,
        wickUpColor: upColor,
        wickDownColor: downColor,
      });
      mainSeries.setData(
        candles.map((c) => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close }))
      );
    } else if (chartType === "bars") {
      mainSeries = chart.addSeries(BarSeries, { upColor, downColor });
      mainSeries.setData(
        candles.map((c) => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close }))
      );
    } else if (chartType === "line") {
      mainSeries = chart.addSeries(LineSeries, { color: "#ff9900", lineWidth: 1 });
      mainSeries.setData(candles.map((c) => ({ time: ts(c.time), value: c.close })));
    } else {
      mainSeries = chart.addSeries(AreaSeries, {
        lineColor: "#ff9900",
        topColor: "rgba(255,153,0,0.25)",
        bottomColor: "rgba(255,153,0,0)",
      });
      mainSeries.setData(candles.map((c) => ({ time: ts(c.time), value: c.close })));
    }
    mainSeriesRef.current = mainSeries;

    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" } });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    vol.setData(
      candles.map((c) => ({
        time: ts(c.time),
        value: c.volume,
        color: c.close >= c.open ? "rgba(0,200,83,0.4)" : "rgba(255,61,61,0.4)",
      }))
    );

    const overlay = (points: Point[], color: string) =>
      chart
        .addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
        .setData(points.map((p) => ({ time: ts(p.time), value: p.value })));

    if (indicatorData?.SMA20) overlay(indicatorData.SMA20, INDICATOR_COLOR.SMA20);
    if (indicatorData?.SMA50) overlay(indicatorData.SMA50, INDICATOR_COLOR.SMA50);
    if (indicatorData?.SMA200) overlay(indicatorData.SMA200, INDICATOR_COLOR.SMA200);
    if (indicatorData?.EMA20) overlay(indicatorData.EMA20, INDICATOR_COLOR.EMA20);
    if (indicatorData?.VWAP) overlay(indicatorData.VWAP, INDICATOR_COLOR.VWAP);
    if (indicatorData?.BOLL) {
      overlay(indicatorData.BOLL.upper, "rgba(255,153,0,0.5)");
      overlay(indicatorData.BOLL.middle, "rgba(255,153,0,0.8)");
      overlay(indicatorData.BOLL.lower, "rgba(255,153,0,0.5)");
    }

    let paneIdx = 1;
    if (indicatorData?.RSI) {
      const s = chart.addSeries(LineSeries, { color: INDICATOR_COLOR.RSI, lineWidth: 1 }, paneIdx++);
      s.setData(indicatorData.RSI.map((p) => ({ time: ts(p.time), value: p.value })));
    }
    if (indicatorData?.MACD) {
      const m = indicatorData.MACD;
      const pane = paneIdx++;
      chart
        .addSeries(HistogramSeries, { color: "#4fc3f7" }, pane)
        .setData(
          m.histogram.map((p) => ({
            time: ts(p.time),
            value: p.value,
            color: p.value >= 0 ? "rgba(0,200,83,0.6)" : "rgba(255,61,61,0.6)",
          }))
        );
      chart
        .addSeries(LineSeries, { color: "#ff9900", lineWidth: 1 }, pane)
        .setData(m.macd.map((p) => ({ time: ts(p.time), value: p.value })));
      chart
        .addSeries(LineSeries, { color: "#ffffff", lineWidth: 1 }, pane)
        .setData(m.signal.map((p) => ({ time: ts(p.time), value: p.value })));
    }

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setLegend(lastCandleRef.current ?? candles[candles.length - 1]);
        return;
      }
      const hit = byTime.get(param.time as number);
      if (hit) setLegend(hit);
    });

    chart.timeScale().fitContent();
    return () => {
      mainSeriesRef.current = null;
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, chartType, indicatorData, isIntraday, byTime]);

  // Real-time tick bar patch on live SSE price changes
  useEffect(() => {
    const series = mainSeriesRef.current;
    const prev = lastCandleRef.current;
    const price = liveQuote?.price;
    if (!series || !prev || price === null || price === undefined || !isFinite(price)) return;

    const bucket = INTERVAL_SECONDS[intervalKey];
    const nowSec = liveQuote.time ?? Math.floor(Date.now() / 1000);
    const barTime = Math.floor(nowSec / bucket) * bucket;
    const targetTime = Math.max(prev.time, isIntraday ? barTime : prev.time);

    const updated: Candle =
      targetTime > prev.time
        ? { time: targetTime, open: price, high: price, low: price, close: price, volume: prev.volume }
        : {
            time: prev.time,
            open: prev.open,
            high: Math.max(prev.high, price),
            low: Math.min(prev.low, price),
            close: price,
            volume: prev.volume,
          };

    lastCandleRef.current = updated;
    setLegend(updated);

    try {
      if (chartType === "candles" || chartType === "bars") {
        series.update({
          time: ts(updated.time),
          open: updated.open,
          high: updated.high,
          low: updated.low,
          close: updated.close,
        });
      } else {
        series.update({ time: ts(updated.time), value: updated.close });
      }
    } catch {
      // ignore if chart series disposed mid-update
    }
  }, [liveQuote, chartType, intervalKey, isIntraday]);

  const toggleIndicator = (ind: Indicator) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(ind)) next.delete(ind);
      else next.add(ind);
      return next;
    });

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 p-1 flex-wrap shrink-0 items-center border-b border-[#161616]">
        {INTERVALS.map((iv) => (
          <button
            key={iv}
            className={`term-btn ${intervalKey === iv ? "active" : ""}`}
            onClick={() => setIntervalKey(iv)}
            title={`Timeframe ${iv}`}
          >
            {iv}
          </button>
        ))}
        {intervalKey === "1D" && (
          <>
            <span className="w-1" />
            {RANGES.map((r) => (
              <button key={r} className={`term-btn ${range === r ? "active" : ""}`} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </>
        )}
        <span className="w-1.5" />
        {CHART_TYPES.map((t) => (
          <button key={t} className={`term-btn ${chartType === t ? "active" : ""}`} onClick={() => setChartType(t)}>
            {t.toUpperCase()}
          </button>
        ))}
        <span className="w-1.5" />
        {INDICATORS.map((ind) => (
          <button
            key={ind}
            className={`term-btn ${active.has(ind) ? "active" : ""}`}
            onClick={() => toggleIndicator(ind)}
          >
            {ind}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2 text-[10px] pr-1">
          {liveQuote?.price !== null && liveQuote?.price !== undefined && (
            <span className={pctClass(liveQuote.changePercent)}>
              {fmtCurrency(liveQuote.price, liveQuote.currency)}{" "}
              {liveQuote.changePercent !== null
                ? `(${liveQuote.changePercent >= 0 ? "+" : ""}${fmt(liveQuote.changePercent)}%)`
                : ""}
            </span>
          )}
          <span className={connected ? "up" : "dim"}>{connected ? "● LIVE" : "○ SYNC"}</span>
        </span>
      </div>
      {error && <div className="p-2 down">Error: {(error as Error).message}</div>}
      <div className="relative flex-1 min-h-0">
        {legend && (
          <div className="absolute top-1 left-2 z-10 flex flex-col gap-0.5 text-[11px] pointer-events-none bg-[rgba(10,10,10,0.75)] px-2 py-1 rounded max-w-[95%]">
            <div className="flex gap-3 flex-wrap">
              <span className="amber font-bold">{intervalKey}</span>
              <span className="dim">
                O <span className="text-[var(--text)]">{fmt(legend.open)}</span>
              </span>
              <span className="dim">
                H <span className="up">{fmt(legend.high)}</span>
              </span>
              <span className="dim">
                L <span className="down">{fmt(legend.low)}</span>
              </span>
              <span className="dim">
                C <span className={legend.close >= legend.open ? "up" : "down"}>{fmt(legend.close)}</span>
              </span>
              <span className="dim">
                Vol <span className="text-[var(--text)]">{fmtBig(legend.volume)}</span>
              </span>
            </div>
            {indicatorRows.length > 0 && (
              <div className="flex gap-3 flex-wrap">
                {indicatorRows.map((r) => (
                  <span key={r.label} className="dim">
                    {r.label} <span style={{ color: r.color }}>{r.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
