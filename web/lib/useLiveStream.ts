"use client";

import { useEffect, useMemo, useState } from "react";
import type { Quote } from "./api";
import { symbolsParam } from "./symbol";

export type LiveStreamResult = {
  ticks: Record<string, Quote>;
  connected: boolean;
  lastTickAt: number | null;
};

/**
 * Subscribes to the real-time NSE/BSE server-sent event stream (`/api/india/stream`)
 * for instant quote ticks without client polling jitter.
 */
export function useLiveStream(symbols: string[], enabled = true): LiveStreamResult {
  const key = useMemo(
    () =>
      [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))]
        .slice(0, 80)
        .join(","),
    [symbols]
  );

  const [ticks, setTicks] = useState<Record<string, Quote>>({});
  const [connected, setConnected] = useState(false);
  const [lastTickAt, setLastTickAt] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || !key) {
      setConnected(false);
      return;
    }

    const list = key.split(",");
    const url = `/api/india/stream?symbols=${symbolsParam(list)}`;
    const es = new EventSource(url);

    const handlePayload = (evt: MessageEvent) => {
      try {
        const parsed = JSON.parse(evt.data) as { ts?: number; quotes?: Quote[] };
        if (!Array.isArray(parsed.quotes)) return;
        setTicks((prev) => {
          const next = { ...prev };
          for (const q of parsed.quotes!) {
            next[q.symbol] = q;
          }
          return next;
        });
        setLastTickAt(parsed.ts ?? Date.now());
        setConnected(true);
      } catch {
        // ignore malformed frames
      }
    };

    es.onopen = () => setConnected(true);
    es.addEventListener("snapshot", handlePayload);
    es.addEventListener("tick", handlePayload);
    es.onerror = () => setConnected(false);

    return () => {
      es.close();
      setConnected(false);
    };
  }, [key, enabled]);

  return { ticks, connected, lastTickAt };
}
