import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";

const g = globalThis as typeof globalThis & {
  __openTerminalApiUrlPromise?: Promise<string>;
};

export async function getApiBaseUrl(): Promise<string> {
  const boundUrl = process.env.API_URL?.trim();
  if (boundUrl) return boundUrl;

  if (!g.__openTerminalApiUrlPromise) {
    g.__openTerminalApiUrlPromise = (async () => {
      // Dynamic import avoids requiring server/dist during independent Next.js service builds when API_URL is bound at runtime.
      const serverPkg = "server";
      const { createApp } = (await import(/* webpackIgnore: true */ serverPkg)) as {
        createApp: () => RequestListener;
      };
      const app = createApp();
      const server = createServer(app);
      server.on("error", (err) => {
        console.error("[api-proxy] internal api server error:", err);
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
      });
      const addr = server.address() as AddressInfo;
      return `http://127.0.0.1:${addr.port}`;
    })().catch((err) => {
      g.__openTerminalApiUrlPromise = undefined;
      throw err;
    });
  }
  return g.__openTerminalApiUrlPromise;
}

export function buildUpstreamUrl(baseUrl: string, pathname: string, search = ""): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const relativePath = pathname.replace(/^\/+/, "");
  return new URL(`${relativePath}${search}`, normalizedBase).toString();
}
