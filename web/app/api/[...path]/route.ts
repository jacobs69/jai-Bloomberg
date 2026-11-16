import { NextRequest, NextResponse } from "next/server";
import { getApiKey } from "@/lib/api-key";
import { buildUpstreamUrl, getApiBaseUrl } from "@/lib/api-proxy";

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  try {
    const apiUrl = await getApiBaseUrl();
    const url = buildUpstreamUrl(apiUrl, `api/${path.join("/")}`, req.nextUrl.search);
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
      signal: req.signal,
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
      const reader = upstream.body.getReader();
      const stream = new ReadableStream({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
            } else if (value) {
              controller.enqueue(value);
            }
          } catch {
            try {
              controller.close();
            } catch {
              // ignore already closed stream
            }
          }
        },
        async cancel() {
          try {
            await reader.cancel();
          } catch {
            // ignore cancel error
          }
        },
      });
      return new NextResponse(stream, {
        status: upstream.status,
        headers: respHeaders,
      });
    }

    const body = upstream.status === 204 ? null : await upstream.arrayBuffer();
    return new NextResponse(body, {
      status: upstream.status,
      headers: respHeaders,
    });
  } catch (err: any) {
    if (req.signal.aborted || err?.name === "AbortError") {
      return new NextResponse(null, { status: 499 });
    }
    console.error("[api-proxy] upstream request failed:", err?.message ?? err);
    return NextResponse.json({ error: "API proxy request failed" }, { status: 502 });
  }
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
