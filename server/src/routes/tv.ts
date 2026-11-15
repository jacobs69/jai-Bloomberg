import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Router, type Router as ExpressRouter } from "express";
import { dataDir } from "../db.js";

export type SavedTvChannel = {
  id: string;
  label: string;
  url: string;
  kind: "hls" | "youtube";
  youtubeId?: string;
  builtin?: boolean;
};

const DEFAULT_CHANNELS: SavedTvChannel[] = [
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

const STORE_PATH = join(dataDir, "tv-channels.json");

function loadChannels(): SavedTvChannel[] {
  try {
    if (existsSync(STORE_PATH)) {
      const parsed = JSON.parse(readFileSync(STORE_PATH, "utf8"));
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // ignore corrupt/missing file
  }
  return [...DEFAULT_CHANNELS];
}

function saveChannels(list: SavedTvChannel[]): void {
  try {
    writeFileSync(STORE_PATH, JSON.stringify(list, null, 2), "utf8");
  } catch {
    // ignore read-only fs errors
  }
}

let channels: SavedTvChannel[] = loadChannels();

export function extractYouTubeId(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl.trim());
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host.endsWith("youtube.com") || host === "youtube-nocookie.com") {
      const v = u.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const parts = u.pathname.split("/").filter(Boolean);
      if ((parts[0] === "live" || parts[0] === "embed" || parts[0] === "shorts") && /^[a-zA-Z0-9_-]{11}$/.test(parts[1] ?? "")) {
        return parts[1];
      }
    }
  } catch {
    if (/^[a-zA-Z0-9_-]{11}$/.test(rawUrl.trim())) return rawUrl.trim();
  }
  return null;
}

async function resolveYouTubeLiveUrl(rawUrl: string): Promise<{ youtubeId: string; title?: string } | null> {
  const direct = extractYouTubeId(rawUrl);
  if (direct) return { youtubeId: direct };

  // Support channel live URLs like https://www.youtube.com/@CNBCTV18/live or /channel/UC.../live
  try {
    const u = new URL(rawUrl.trim());
    if (!u.hostname.toLowerCase().includes("youtube.com")) return null;
    const res = await fetch(u.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const canonical =
      html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})"/)?.[1] ??
      html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/)?.[1];
    if (!canonical) return null;
    const title = html.match(/<title>(.*?)<\/title>/)?.[1]?.replace(/\s*-\s*YouTube\s*$/i, "").trim();
    return { youtubeId: canonical, title };
  } catch {
    return null;
  }
}

export const tvRouter: ExpressRouter = Router();

tvRouter.get("/channels", (_req, res) => {
  res.json(channels);
});

tvRouter.post("/channels", async (req, res) => {
  const rawUrl = String(req.body?.url ?? "").trim();
  const customLabel = String(req.body?.label ?? "").trim();
  if (!rawUrl) return res.status(400).json({ error: "URL is required" });

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("invalid protocol");
  } catch {
    return res.status(400).json({ error: "Please paste a valid https:// YouTube Live or .m3u8 URL" });
  }

  const host = parsedUrl.hostname.toLowerCase();
  const isYt = host.includes("youtube.com") || host === "youtu.be" || host === "youtube-nocookie.com";

  if (isYt) {
    const resolved = await resolveYouTubeLiveUrl(rawUrl);
    if (!resolved) {
      return res.status(400).json({
        error: "Could not detect a YouTube video/live ID from that URL. Try pasting a youtube.com/watch?v=..., youtu.be/..., or youtube.com/live/... link.",
      });
    }
    const label = customLabel || resolved.title || `YouTube Live (${resolved.youtubeId.slice(0, 6)})`;
    const item: SavedTvChannel = {
      id: `yt-${Date.now()}`,
      label,
      url: rawUrl,
      kind: "youtube",
      youtubeId: resolved.youtubeId,
    };
    channels = [...channels, item];
    saveChannels(channels);
    return res.status(201).json(item);
  }

  const label = customLabel || parsedUrl.hostname.replace(/^www\./, "");
  const item: SavedTvChannel = {
    id: `hls-${Date.now()}`,
    label,
    url: rawUrl,
    kind: "hls",
  };
  channels = [...channels, item];
  saveChannels(channels);
  return res.status(201).json(item);
});

tvRouter.delete("/channels/:id", (req, res) => {
  const id = req.params.id;
  const target = channels.find((c) => c.id === id);
  if (!target) return res.status(404).json({ error: "Channel not found" });
  channels = channels.filter((c) => c.id !== id);
  saveChannels(channels);
  res.status(204).end();
});
