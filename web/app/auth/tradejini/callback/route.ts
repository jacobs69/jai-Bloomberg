import { NextRequest, NextResponse } from "next/server";
import { getApiKey } from "@/lib/api-key";
import { buildUpstreamUrl, getApiBaseUrl } from "@/lib/api-proxy";

export async function GET(req: NextRequest) {
  const apiUrl = await getApiBaseUrl();
  const target = buildUpstreamUrl(apiUrl, "api/tradejini/auth/callback", req.nextUrl.search);
  const apiKey = getApiKey();
  const headers = new Headers();
  if (apiKey) headers.set("x-api-key", apiKey);
  const cookie = req.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  if (proto) headers.set("x-forwarded-proto", proto);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) headers.set("x-forwarded-host", host);

  const upstream = await fetch(target, { headers, cache: "no-store" });
  const respHeaders = new Headers();
  respHeaders.set("content-type", upstream.headers.get("content-type") ?? "text/html; charset=utf-8");

  const setCookies =
    typeof (upstream.headers as any).getSetCookie === "function"
      ? (upstream.headers as any).getSetCookie()
      : upstream.headers.get("set-cookie")
      ? [upstream.headers.get("set-cookie")!]
      : [];
  for (const sc of setCookies) respHeaders.append("set-cookie", sc);

  return new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: respHeaders,
  });
}
