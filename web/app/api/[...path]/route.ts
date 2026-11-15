import { NextRequest, NextResponse } from "next/server";
import { getApiKey } from "@/lib/api-key";

function getApiBaseUrl(): string {
  // Vercel injects API_URL from the private server-service binding at runtime.
  // Keep a localhost fallback for the regular two-process npm run dev workflow.
  const apiUrl =
    process.env.API_URL ??
    (process.env.NODE_ENV !== "production" ? "http://127.0.0.1:4000" : undefined);

  if (!apiUrl) {
    throw new Error("API_URL service binding is missing");
  }

  return apiUrl.replace(/\/+$/, "");
}

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  const apiUrl = getApiBaseUrl();
  const url = `${apiUrl}/api/${path.join("/")}${req.nextUrl.search}`;
  const apiKey = getApiKey();

  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  if (apiKey) headers.set("x-api-key", apiKey);
  const cookie = req.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  if (proto) headers.set("x-forwarded-proto", proto);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) headers.set("x-forwarded-host", host);

  const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.method !== "DELETE";

  const upstream = await fetch(url, {
    method: req.method,
    headers,
    body: hasBody ? await req.text() : undefined,
    cache: "no-store",
  });

  const respHeaders = new Headers();
  const upstreamType = upstream.headers.get("content-type") ?? "application/json";
  respHeaders.set("content-type", upstreamType);

  const setCookies =
    typeof (upstream.headers as any).getSetCookie === "function"
      ? (upstream.headers as any).getSetCookie()
      : upstream.headers.get("set-cookie")
      ? [upstream.headers.get("set-cookie")!]
      : [];
  for (const sc of setCookies) respHeaders.append("set-cookie", sc);

  if (upstreamType.includes("text/event-stream") && upstream.body) {
    respHeaders.set("cache-control", "no-cache, no-transform");
    respHeaders.set("x-accel-buffering", "no");
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  }

  const body = upstream.status === 204 ? null : await upstream.arrayBuffer();
  return new NextResponse(body, {
    status: upstream.status,
    headers: respHeaders,
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
