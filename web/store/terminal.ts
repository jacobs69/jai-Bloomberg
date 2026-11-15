"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { normalizeSymbol } from "../lib/symbol";

export type WidgetType =
  | "quote"
  | "chart"
  | "watchlist"
  | "news"
  | "heatmap"
  | "screener"
  | "crypto"
  | "macro"
  | "options"
  | "portfolio"
  | "ai"
  | "calendar"
  | "insider"
  | "tv"
  | "recap"
  | "ipo"
  | "cubeplus";

export type WidgetInstance = {
  id: string;
  type: WidgetType;
  symbol?: string;
  linked: boolean; // follows the globally active symbol
};

export type LayoutItem = { i: string; x: number; y: number; w: number; h: number };

export type TvChannel = {
  id: string;
  label: string;
  url: string;
  kind: "hls" | "youtube";
  youtubeId?: string;
  builtin?: boolean;
};

const DEFAULT_TV_CHANNELS: TvChannel[] = [
  {
    id: "ndtv",
    label: "NDTV Profit",
    url: "https://ndtvprofit.akamaized.net/hls/live/2107404/ndtvprofit/master_1.m3u8",
    kind: "hls",
    builtin: true,
  },
  {
    id: "cnbc",
    label: "CNBC Global",
    url: "https://gpuserver3.tier1streams.com/CNBC/index.m3u8",
    kind: "hls",
    builtin: true,
  },
  {
    id: "bloomberg",
    label: "Bloomberg TV",
    url: "https://liveprodusphoenixeast.global.ssl.fastly.net/USPhx-HD/Channel-TX-USPhx-AWS-virginia-1/Source-USPhx-16k-1-s6lk2-BP-07-02-81ykIWnsMsg_live.m3u8",
    kind: "hls",
    builtin: true,
  },
  {
    id: "yahoo",
    label: "Yahoo Finance",
    url: "https://d1ewctnvcwvvvu.cloudfront.net/playlist.m3u8",
    kind: "hls",
    builtin: true,
  },
];

type TerminalState = {
  activeSymbol: string;
  widgets: WidgetInstance[];
  layout: LayoutItem[];
  watchlist: string[];
  tvChannels: TvChannel[];
  activeTvId: string;
  commandOpen: boolean;
  setActiveSymbol: (s: string) => void;
  setCommandOpen: (open: boolean) => void;
  addWidget: (type: WidgetType, symbol?: string) => void;
  addOrFocusWidget: (type: WidgetType) => void;
  removeWidget: (id: string) => void;
  setWidgetSymbol: (id: string, symbol: string) => void;
  toggleLinked: (id: string) => void;
  setLayout: (layout: LayoutItem[]) => void;
  addToWatchlist: (s: string) => void;
  removeFromWatchlist: (s: string) => void;
  setTvChannels: (channels: TvChannel[]) => void;
  addTvChannel: (channel: TvChannel) => void;
  removeTvChannel: (id: string) => void;
  setActiveTvId: (id: string) => void;
  resetWorkspace: () => void;
};

const DEFAULT_WIDGETS: WidgetInstance[] = [
  { id: "w-chart", type: "chart", linked: true },
  { id: "w-quote", type: "quote", linked: true },
  { id: "w-watchlist", type: "watchlist", linked: false },
  { id: "w-news", type: "news", linked: true },
  { id: "w-macro", type: "macro", linked: false },
  { id: "w-ipo", type: "ipo", linked: false },
];

const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: "w-chart", x: 0, y: 0, w: 7, h: 12 },
  { i: "w-quote", x: 7, y: 0, w: 5, h: 6 },
  { i: "w-watchlist", x: 7, y: 6, w: 5, h: 8 },
  { i: "w-news", x: 0, y: 12, w: 7, h: 8 },
  { i: "w-macro", x: 7, y: 14, w: 5, h: 6 },
  { i: "w-ipo", x: 0, y: 20, w: 12, h: 8 },
];

const SIZE_BY_TYPE: Record<WidgetType, { w: number; h: number }> = {
  quote: { w: 5, h: 6 },
  chart: { w: 7, h: 12 },
  watchlist: { w: 5, h: 8 },
  news: { w: 7, h: 8 },
  heatmap: { w: 7, h: 10 },
  screener: { w: 12, h: 9 },
  crypto: { w: 6, h: 9 },
  macro: { w: 5, h: 8 },
  options: { w: 12, h: 9 },
  portfolio: { w: 7, h: 8 },
  ai: { w: 5, h: 10 },
  calendar: { w: 12, h: 11 },
  insider: { w: 7, h: 9 },
  tv: { w: 6, h: 11 },
  recap: { w: 5, h: 12 },
  ipo: { w: 12, h: 8 },
  cubeplus: { w: 7, h: 10 },
};

export const useTerminal = create<TerminalState>()(
  persist(
    (set) => ({
      activeSymbol: "RELIANCE",
      widgets: DEFAULT_WIDGETS,
      layout: DEFAULT_LAYOUT,
      watchlist: ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "SBIN", "BHARTIARTL", "ITC"],
      tvChannels: DEFAULT_TV_CHANNELS,
      activeTvId: "ndtv",
      commandOpen: false,
      setActiveSymbol: (s) => {
        const sym = normalizeSymbol(s);
        if (sym) set({ activeSymbol: sym });
      },
      setCommandOpen: (open) => set({ commandOpen: open }),
      addWidget: (type, symbol) =>
        set((st) => {
          const id = `w-${type}-${Date.now()}`;
          const size = SIZE_BY_TYPE[type];
          const maxY = st.layout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
          return {
            widgets: [...st.widgets, { id, type, symbol, linked: !symbol }],
            layout: [...st.layout, { i: id, x: 0, y: maxY, ...size }],
          };
        }),
      addOrFocusWidget: (type) =>
        set((st) => {
          if (st.widgets.some((w) => w.type === type)) return st;
          const id = `w-${type}-${Date.now()}`;
          const size = SIZE_BY_TYPE[type];
          const maxY = st.layout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
          return {
            widgets: [...st.widgets, { id, type, linked: true }],
            layout: [...st.layout, { i: id, x: 0, y: maxY, ...size }],
          };
        }),
      removeWidget: (id) =>
        set((st) => ({
          widgets: st.widgets.filter((w) => w.id !== id),
          layout: st.layout.filter((l) => l.i !== id),
        })),
      setWidgetSymbol: (id, symbol) => {
        const sym = normalizeSymbol(symbol);
        if (!sym) return;
        set((st) => ({
          widgets: st.widgets.map((w) => (w.id === id ? { ...w, symbol: sym, linked: false } : w)),
        }));
      },
      toggleLinked: (id) =>
        set((st) => ({
          widgets: st.widgets.map((w) => (w.id === id ? { ...w, linked: !w.linked } : w)),
        })),
      setLayout: (layout) => set({ layout }),
      addToWatchlist: (s) => {
        const sym = normalizeSymbol(s);
        if (!sym) return;
        set((st) => ({
          watchlist: st.watchlist.includes(sym) ? st.watchlist : [...st.watchlist, sym],
        }));
      },
      removeFromWatchlist: (s) => set((st) => ({ watchlist: st.watchlist.filter((x) => x !== s) })),
      setTvChannels: (channels) => set({ tvChannels: channels }),
      addTvChannel: (channel) =>
        set((st) => ({
          tvChannels: st.tvChannels.some((c) => c.id === channel.id) ? st.tvChannels : [...st.tvChannels, channel],
          activeTvId: channel.id,
        })),
      removeTvChannel: (id) =>
        set((st) => {
          const next = st.tvChannels.filter((c) => c.id !== id);
          return {
            tvChannels: next,
            activeTvId: st.activeTvId === id ? next[0]?.id ?? "" : st.activeTvId,
          };
        }),
      setActiveTvId: (id) => set({ activeTvId: id }),
      resetWorkspace: () => set({ widgets: DEFAULT_WIDGETS, layout: DEFAULT_LAYOUT }),
    }),
    { name: "openterminal-india-workspace" }
  )
);

/** Symbol a widget should display: its own, or the active one when linked. */
export function useWidgetSymbol(widget: WidgetInstance): string {
  const active = useTerminal((s) => s.activeSymbol);
  return widget.linked ? active : widget.symbol ?? active;
}
