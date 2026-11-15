"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { apiDelete, apiGet, apiPost } from "../../lib/api";
import { useTerminal, type TvChannel } from "../../store/terminal";

export default function TvWidget() {
  const qc = useQueryClient();
  const tvChannels = useTerminal((s) => s.tvChannels);
  const activeTvId = useTerminal((s) => s.activeTvId);
  const setTvChannels = useTerminal((s) => s.setTvChannels);
  const addTvChannel = useTerminal((s) => s.addTvChannel);
  const removeTvChannel = useTerminal((s) => s.removeTvChannel);
  const setActiveTvId = useTerminal((s) => s.setActiveTvId);

  const [urlInput, setUrlInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const { data: serverChannels } = useQuery({
    queryKey: ["tv-channels"],
    queryFn: () => apiGet<TvChannel[]>("/api/tv/channels"),
    staleTime: 60_000,
  });

  // Merge persisted server channels with client store so saved streams survive restarts and reloads
  useEffect(() => {
    if (!serverChannels || serverChannels.length === 0) return;
    const byId = new Map<string, TvChannel>();
    for (const c of serverChannels) byId.set(c.id, c);
    for (const c of tvChannels) {
      if (!byId.has(c.id)) byId.set(c.id, c);
    }
    const merged = [...byId.values()];
    if (merged.length !== tvChannels.length) {
      setTvChannels(merged);
    }
  }, [serverChannels]); // eslint-disable-line react-hooks/exhaustive-deps

  const channel = tvChannels.find((c) => c.id === activeTvId) ?? tvChannels[0];

  const saveChannel = useMutation({
    mutationFn: ({ url, label }: { url: string; label?: string }) =>
      apiPost<TvChannel>("/api/tv/channels", { url, label }),
    onSuccess: (saved) => {
      setError(null);
      addTvChannel(saved);
      setUrlInput("");
      setLabelInput("");
      qc.invalidateQueries({ queryKey: ["tv-channels"] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Could not save live stream URL");
    },
  });

  const deleteChannel = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/tv/channels/${encodeURIComponent(id)}`).catch(() => {}),
    onSuccess: (_res, id) => {
      removeTvChannel(id);
      qc.invalidateQueries({ queryKey: ["tv-channels"] });
    },
  });

  useEffect(() => {
    if (!channel || channel.kind !== "hls") return;
    const video = videoRef.current;
    if (!video) return;
    setError(null);

    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(channel.url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) setError(`Stream unavailable right now (${data.details}). Try another channel or paste a YouTube Live URL.`);
      });
      return () => hls.destroy();
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = channel.url;
      video.play().catch(() => {});
    } else {
      setError("Your browser doesn't support HLS playback.");
    }
  }, [channel]);

  return (
    <div className="flex flex-col h-full">
      {/* Paste & Persist YouTube Live / HLS URL bar */}
      <form
        className="flex gap-1 p-1 border-b border-[var(--border)] bg-[var(--panel-2)] flex-wrap shrink-0"
        onSubmit={(e) => {
          e.preventDefault();
          const url = urlInput.trim();
          if (!url) return;
          setError(null);
          saveChannel.mutate({ url, label: labelInput.trim() || undefined });
        }}
      >
        <input
          value={labelInput}
          onChange={(e) => setLabelInput(e.target.value)}
          placeholder="Channel name (optional)"
          className="w-32 text-[11px]"
        />
        <input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="Paste YouTube Live URL (youtube.com/live/... or watch?v=...) or .m3u8…"
          className="flex-1 min-w-[180px] text-[11px]"
        />
        <button className="term-btn active" type="submit" disabled={saveChannel.isPending || !urlInput.trim()}>
          {saveChannel.isPending ? "SAVING…" : "SAVE & WATCH"}
        </button>
      </form>

      {/* Channel selector */}
      <div className="flex gap-1 p-1 flex-wrap shrink-0 border-b border-[#1a1a1a]">
        {tvChannels.map((c) => (
          <div key={c.id} className="flex items-center">
            <button
              className={`term-btn flex items-center gap-1 ${channel?.id === c.id ? "active" : ""}`}
              onClick={() => {
                setError(null);
                setActiveTvId(c.id);
              }}
            >
              {c.kind === "youtube" && <span className="down text-[9px]">▶</span>}
              <span>{c.label}</span>
            </button>
            {!c.builtin && (
              <button
                type="button"
                onClick={() => deleteChannel.mutate(c.id)}
                className="dim hover:text-[var(--down)] px-1 text-[10px]"
                title={`Remove ${c.label}`}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Video / YouTube Live Viewport */}
      <div className="relative flex-1 min-h-0 bg-black">
        {channel?.kind === "youtube" && channel.youtubeId ? (
          <iframe
            key={channel.youtubeId}
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(channel.youtubeId)}?autoplay=1&mute=1&playsinline=1&rel=0`}
            title={channel.label}
            className="w-full h-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        ) : (
          <video ref={videoRef} className="w-full h-full" autoPlay muted controls playsInline />
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center down bg-black/90 text-[11px]">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
