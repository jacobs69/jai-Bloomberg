import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

// API requests are proxied by web/app/api/[...path]/route.ts instead of a
// rewrite here, so the shared API key can be attached server-side. See
// web/lib/api-key.ts.
export default function createNextConfig(phase: string): NextConfig {
  return {
    output: "standalone",
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
    serverExternalPackages: ["server", "express", "cors", "fast-xml-parser", "@anthropic-ai/sdk", "zod"],
  };
}
