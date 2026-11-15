"use client";

import { useCallback, useEffect, useState } from "react";
import { create } from "zustand";

export type LiveNewsItem = {
  title: string;
  link: string;
  publisher: string;
  publishedAt: string | null;
  symbol?: string | null;
};

export function newsKey(item: Pick<LiveNewsItem, "title" | "link">): string {
  const clean = item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 90);
  return `${clean}|${item.link.trim()}`;
}

type NewsAlertState = {
  unreadCount: number;
  latestTitle: string | null;
  bumpUnread: (count: number, latestTitle?: string | null) => void;
  clearUnread: () => void;
};

/** Global alert store so TopBar & panel titles can blink immediately on live news updates. */
export const useNewsAlert = create<NewsAlertState>((set) => ({
  unreadCount: 0,
  latestTitle: null,
  bumpUnread: (count, latestTitle) =>
    set((st) => ({
      unreadCount: st.unreadCount + count,
      latestTitle: latestTitle ?? st.latestTitle,
    })),
  clearUnread: () => set({ unreadCount: 0, latestTitle: null }),
}));

export type UseNewsStreamOptions = {
  mode: "india" | "symbol" | "sector" | "index" | "ipo";
  symbol: string;
  sector: string;
  index: string;
  initialItems?: LiveNewsItem[];
};

export function useNewsStream({ mode, symbol, sector, index, initialItems }: UseNewsStreamOptions) {
  const [items, setItems] = useState<LiveNewsItem[]>(initialItems ?? []);
  const [newKeys, setNewKeys] = useState<Set<string>>(() => new Set());
  const [connected, setConnected] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const bumpUnread = useNewsAlert((s) => s.bumpUnread);
  const clearGlobalUnread = useNewsAlert((s) => s.clearUnread);

  useEffect(() => {
    if (initialItems && initialItems.length > 0) {
      setItems((prev) => (prev.length === 0 ? initialItems : prev));
    }
  }, [initialItems]);

  useEffect(() => {
    setNewKeys(new Set());
    clearGlobalUnread();
    const params = new URLSearchParams({ mode, symbol, sector, index });
    const es = new EventSource(`/api/india/news/stream?${params.toString()}`);

    const onSnapshot = (evt: MessageEvent) => {
      try {
        const parsed = JSON.parse(evt.data) as { ts?: number; items?: LiveNewsItem[] };
        if (Array.isArray(parsed.items)) {
          setItems(parsed.items);
          setLastUpdatedAt(parsed.ts ?? Date.now());
          setConnected(true);
        }
      } catch {
        // ignore malformed frame
      }
    };

    const onNewsUpdate = (evt: MessageEvent) => {
      try {
        const parsed = JSON.parse(evt.data) as {
          ts?: number;
          items?: LiveNewsItem[];
          newItems?: LiveNewsItem[];
        };
        if (Array.isArray(parsed.items)) {
          setItems(parsed.items);
        }
        if (Array.isArray(parsed.newItems) && parsed.newItems.length > 0) {
          setNewKeys((prev) => {
            const next = new Set(prev);
            for (const item of parsed.newItems!) next.add(newsKey(item));
            return next;
          });
          bumpUnread(parsed.newItems.length, parsed.newItems[0]?.title ?? null);
        }
        setLastUpdatedAt(parsed.ts ?? Date.now());
        setConnected(true);
      } catch {
        // ignore malformed frame
      }
    };

    const onHeartbeat = (evt: MessageEvent) => {
      try {
        const parsed = JSON.parse(evt.data) as { ts?: number };
        setLastUpdatedAt(parsed.ts ?? Date.now());
        setConnected(true);
      } catch {
        // ignore
      }
    };

    es.onopen = () => setConnected(true);
    es.addEventListener("snapshot", onSnapshot);
    es.addEventListener("news_update", onNewsUpdate);
    es.addEventListener("heartbeat", onHeartbeat);
    es.onerror = () => setConnected(false);

    return () => {
      es.close();
      setConnected(false);
    };
  }, [mode, symbol, sector, index, bumpUnread, clearGlobalUnread]);

  const acknowledgeAll = useCallback(() => {
    setNewKeys(new Set());
    clearGlobalUnread();
  }, [clearGlobalUnread]);

  const acknowledgeOne = useCallback(
    (key: string) => {
      setNewKeys((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        if (next.size === 0) clearGlobalUnread();
        return next;
      });
    },
    [clearGlobalUnread]
  );

  return {
    items,
    newKeys,
    unreadCount: newKeys.size,
    connected,
    lastUpdatedAt,
    acknowledgeAll,
    acknowledgeOne,
  };
}
