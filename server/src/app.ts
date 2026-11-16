import express, { type Express } from "express";
import cors from "cors";
import { marketRouter } from "./routes/market.js";
import { indiaRouter } from "./routes/india.js";
import { portfolioRouter } from "./routes/portfolio.js";
import { aiRouter } from "./routes/ai.js";
import { tradejiniRouter } from "./routes/tradejini.js";
import { tvRouter } from "./routes/tv.js";
import { tankersRouter } from "./routes/tankers.js";
import { allStats } from "./providers/registry.js";
import { requireApiKey } from "./auth.js";
import { rateLimit } from "./rateLimit.js";

export function createApp(): Express {
  const app = express();

  if (process.env.TRUST_PROXY === "1" || process.env.VERCEL) {
    app.set("trust proxy", 1);
  }

  const webOrigin =
    process.env.WEB_ORIGIN ??
    process.env.APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  app.use(cors({ origin: webOrigin, credentials: true }));
  app.use(express.json());

  app.use("/api/india", rateLimit({ windowMs: 60_000, max: 240 }), indiaRouter);
  app.use("/api/tradejini", rateLimit({ windowMs: 60_000, max: 120 }), tradejiniRouter);
  app.use("/api/tv", tvRouter);
  app.use("/api/tankers", rateLimit({ windowMs: 60_000, max: 120 }), tankersRouter);
  app.use("/api", rateLimit({ windowMs: 60_000, max: 240 }), marketRouter);
  app.use("/api/portfolios", requireApiKey, portfolioRouter);
  app.use(
    "/api/ai",
    requireApiKey,
    rateLimit({ windowMs: 60_000, max: 10 }),
    aiRouter
  );

  app.get("/api/status", (_req, res) => {
    res.json({
      ok: true,
      time: new Date().toISOString(),
      providers: allStats(),
      ai: Boolean(process.env.ANTHROPIC_API_KEY),
    });
  });

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    const status = typeof err?.status === "number" ? err.status : 500;
    res.status(status).json({ error: err?.message ?? "Internal server error" });
  });

  return app;
}
