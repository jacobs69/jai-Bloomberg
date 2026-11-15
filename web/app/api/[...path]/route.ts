import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { NextRequest, NextResponse } from "next/server";
import { getApiKey } from "@/lib/api-key";
import { createApp } from "server";

const g = globalThis as typeof globalThis & {
  __openTerminalApiUrlPromise?: Promise<string>;
};

async function getApiBaseUrl(): Promise<string> {
  if (process.env.API_URL) return process.env.API_URL;
  if (!g.__openTerminalApiUrlPromise) {
    g.__openTerminalApiUrlPromise = (async () => {
      const app = createApp();
      const server = createServer(app);
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
      });
      const addr = server.address() as AddressInfo;
      return `http://127.0.0.1:${addr.port}`;
    })();
  }
  return g.__openTerminalApiUrlPromise;
}

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  const apiUrl = await getApiBaseUrl();
  const url = `${apiUrl}/api/${path.join("/")}${req.nextUrl.search}`;
  const apiKey = getApiKey();

  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  if (apiKey) headers.set("x-api-key", apiKey);
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);

  const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.method !== "DELETE";

  const upstream = await fetch(url, {
    method: req.method,
    headers,
    body: hasBody ? await req.text() : undefined,
    cache: "no-store",
  });

  const body = upstream.status === 204 ? null : await upstream.arrayBuffer();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
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
