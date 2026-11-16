import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import type { Candle } from "./yahoo.js";

const TJ_BASE = "https://api.tradejini.com/v2";

export type TradejiniSession = {
  sid: string;
  accessToken: string;
  createdAt: number;
  userId?: string;
  profile?: Record<string, any>;
};

const g = globalThis as typeof globalThis & {
  __tradejiniSessions?: Map<string, TradejiniSession>;
  __tradejiniOauthStates?: Map<string, { createdAt: number; redirectUri: string }>;
};

const sessions = (g.__tradejiniSessions ??= new Map<string, TradejiniSession>());
const oauthStates = (g.__tradejiniOauthStates ??= new Map<string, { createdAt: number; redirectUri: string }>());

const SESSION_TTL_MS = 18 * 3_600_000;
const COOKIE_NAME = "tj_sid";

export function isConfigured(): { hasKey: boolean; hasSecret: boolean } {
  return {
    hasKey: Boolean(process.env.TRADEJINI_API_KEY?.trim()),
    hasSecret: Boolean(process.env.TRADEJINI_API_SECRET?.trim()),
  };
}

function apiKey(): string {
  return process.env.TRADEJINI_API_KEY?.trim() ?? "";
}

function apiSecret(): string {
  return process.env.TRADEJINI_API_SECRET?.trim() ?? "";
}

export function getAppBaseUrl(req?: Request): string {
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl) return envUrl.replace(/\/+$/, "");
  if (req) {
    const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0]?.trim() || req.protocol || "http";
    const host = (req.headers["x-forwarded-host"] as string)?.split(",")[0]?.trim() || req.get("host");
    if (host) return `${proto}://${host}`;
  }
  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl.replace(/^https?:\/\//, "")}`;
  return "http://localhost:3000";
}

export function getRedirectUri(req?: Request): string {
  return `${getAppBaseUrl(req)}/auth/tradejini/callback`;
}

export function parseCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function isSecureContext(req: Request): boolean {
  const proto = (req.headers["x-forwarded-proto"] as string) || "";
  const appUrl = process.env.APP_URL || "";
  return req.secure || proto.includes("https") || appUrl.startsWith("https://");
}

export function setSessionCookie(req: Request, res: Response, sid: string): void {
  const secure = isSecureContext(req);
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(sid)}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    secure ? "SameSite=None" : "SameSite=Lax",
  ];
  if (secure) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

export function clearSessionCookie(req: Request, res: Response): void {
  const secure = isSecureContext(req);
  const attrs = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "Max-Age=0",
    secure ? "SameSite=None" : "SameSite=Lax",
  ];
  if (secure) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

export function getSession(req: Request): TradejiniSession | null {
  const sid = parseCookie(req, COOKIE_NAME);
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) {
    sessions.delete(sid);
    return null;
  }
  return s;
}

export function deleteSession(req: Request): void {
  const sid = parseCookie(req, COOKIE_NAME);
  if (sid) sessions.delete(sid);
}

export function createOAuthAuthorizeUrl(req: Request): { url: string; redirectUri: string; state: string } {
  const key = apiKey();
  if (!key) throw new Error("TRADEJINI_API_KEY is not configured on the server");

  const redirectUri = getRedirectUri(req);
  const state = randomBytes(24).toString("hex");
  oauthStates.set(state, { createdAt: Date.now(), redirectUri });

  // Prune old states > 15m
  for (const [k, v] of oauthStates) {
    if (Date.now() - v.createdAt > 15 * 60_000) oauthStates.delete(k);
  }

  const params = new URLSearchParams({
    client_id: key,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "general",
    state,
  });

  return {
    url: `${TJ_BASE}/api-gw/oauth/authorize?${params.toString()}`,
    redirectUri,
    state,
  };
}

export async function exchangeOAuthCode(code: string, state: string, req: Request): Promise<TradejiniSession> {
  const saved = oauthStates.get(state);
  if (!saved || Date.now() - saved.createdAt > 15 * 60_000) {
    throw new Error("Invalid or expired OAuth state");
  }
  oauthStates.delete(state);

  const key = apiKey();
  const secret = apiSecret();
  if (!key || !secret) throw new Error("TRADEJINI_API_KEY and TRADEJINI_API_SECRET are required for OAuth exchange");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: key,
    client_secret: secret,
    redirect_uri: saved.redirectUri || getRedirectUri(req),
  });

  const res = await fetch(`${TJ_BASE}/api-gw/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  const json: any = await res.json().catch(() => ({}));
  const accessToken = json?.access_token ?? json?.d?.accessToken ?? json?.d?.access_token;
  if (!res.ok || !accessToken) {
    throw new Error(json?.msg ?? json?.error_description ?? `Tradejini OAuth exchange failed (${res.status})`);
  }

  return createAndHydrateSession(accessToken);
}

export async function loginIndividualSession(password: string, twoFa: string): Promise<TradejiniSession> {
  const key = apiKey();
  if (!key) throw new Error("TRADEJINI_API_KEY is not configured in server environment variables");

  const body = new URLSearchParams({
    password,
    twoFa,
    twoFaTyp: "totp",
  });

  const res = await fetch(`${TJ_BASE}/api-gw/oauth/individual-token-v2`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  const json: any = await res.json().catch(() => ({}));
  const accessToken = json?.access_token ?? json?.d?.accessToken ?? json?.accessToken;
  if (!res.ok || !accessToken) {
    throw new Error(json?.msg ?? json?.error ?? `Tradejini CubePlus login failed (${res.status})`);
  }

  return createAndHydrateSession(accessToken);
}

async function createAndHydrateSession(accessToken: string): Promise<TradejiniSession> {
  const sid = randomBytes(32).toString("hex");
  const session: TradejiniSession = {
    sid,
    accessToken,
    createdAt: Date.now(),
  };

  try {
    const profile = await tjFetch(session, "/api/oms/profile");
    session.profile = profile?.d ?? profile;
    session.userId = session.profile?.uid ?? session.profile?.userId ?? session.profile?.clientId;
  } catch {
    // Non-fatal if profile fails temporarily
  }

  sessions.set(sid, session);
  return session;
}

export async function tjFetch<T = any>(session: TradejiniSession, path: string): Promise<T> {
  const key = apiKey();
  const res = await fetch(`${TJ_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${key}:${session.accessToken}`,
      Accept: "application/json",
    },
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.s === "error") {
    throw new Error(json?.msg ?? `Tradejini API HTTP ${res.status}`);
  }
  return json as T;
}

export async function fetchOverview(session: TradejiniSession) {
  const [profile, limits, holdings, positions, orders, trades] = await Promise.allSettled([
    tjFetch(session, "/api/oms/profile"),
    tjFetch(session, "/api/oms/limits"),
    tjFetch(session, "/api/oms/holdings"),
    tjFetch(session, "/api/oms/positions"),
    tjFetch(session, "/api/oms/orders"),
    tjFetch(session, "/api/oms/trades"),
  ]);

  const unwrap = (r: PromiseSettledResult<any>) => (r.status === "fulfilled" ? r.value?.d ?? r.value : null);
  return {
    profile: unwrap(profile) ?? session.profile ?? null,
    limits: unwrap(limits),
    holdings: unwrap(holdings),
    positions: unwrap(positions),
    orders: unwrap(orders),
    trades: unwrap(trades),
  };
}

const TJ_INTERVAL_MAP: Record<string, string> = {
  "1m": "1",
  "3m": "3",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "1D": "1D",
};

export async function fetchIntervalChart(
  session: TradejiniSession,
  symId: string,
  intervalKey: string,
  fromSec: number,
  toSec: number
): Promise<Candle[]> {
  const iv = TJ_INTERVAL_MAP[intervalKey] ?? "1D";
  const qs = new URLSearchParams({
    id: symId,
    interval: iv,
    from: String(fromSec),
    to: String(toSec),
  });
  const json = await tjFetch(session, `/api/mkt-data/chart/interval-data?${qs.toString()}`);
  const rows: any[] = json?.d?.bars ?? json?.d ?? json?.bars ?? [];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((b) => {
      if (Array.isArray(b)) {
        const [t, o, h, l, c, v] = b;
        return { time: Number(t), open: Number(o), high: Number(h), low: Number(l), close: Number(c), volume: Number(v ?? 0) };
      }
      return {
        time: Number(b.time ?? b.t),
        open: Number(b.open ?? b.o),
        high: Number(b.high ?? b.h),
        low: Number(b.low ?? b.l),
        close: Number(b.close ?? b.c),
        volume: Number(b.volume ?? b.v ?? 0),
      };
    })
    .filter((c) => isFinite(c.time) && isFinite(c.close));
}
