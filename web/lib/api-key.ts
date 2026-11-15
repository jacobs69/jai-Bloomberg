import { readFileSync } from "node:fs";
import { join } from "node:path";

let cached: string | null = null;

export function getApiKey(): string | null {
  if (process.env.API_KEY) return process.env.API_KEY;
  const inProcess = (globalThis as Record<string, unknown>).__openTerminalApiKey;
  if (typeof inProcess === "string" && inProcess) return inProcess;
  if (cached) return cached;

  const keyFile = process.env.API_KEY_FILE ?? join(process.cwd(), "..", "data", ".api-key");
  try {
    cached = readFileSync(keyFile, "utf8").trim();
  } catch {
    return null;
  }
  return cached;
}
