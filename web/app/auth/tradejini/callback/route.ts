import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const target = new URL(`/api/tradejini/auth/callback${req.nextUrl.search}`, req.url);
  const headers = new Headers();
  const cookie = req.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  if (proto) headers.set("x-forwarded-proto", proto);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) headers.set("x-forwarded-host", host);

  const upstream = await fetch(target.toString(), { headers, cache: "no-store" });
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
