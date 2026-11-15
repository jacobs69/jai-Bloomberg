import { Router, type Router as ExpressRouter } from "express";
import * as tradejini from "../providers/tradejini.js";
import { resolveScrip } from "../providers/indiaScrips.js";

export const tradejiniRouter: ExpressRouter = Router();

tradejiniRouter.get("/status", (req, res) => {
  const { hasKey, hasSecret } = tradejini.isConfigured();
  const session = tradejini.getSession(req);
  const redirectUri = tradejini.getRedirectUri(req);
  res.json({
    configured: hasKey,
    oauthReady: hasKey && hasSecret,
    connected: Boolean(session),
    redirectUri,
    profile: session?.profile ?? null,
    userId: session?.userId ?? null,
  });
});

// Step 1 of OAuth 2.0 popup flow: returns Tradejini authorize URL directly for window.open()
tradejiniRouter.get("/auth/url", (req, res) => {
  try {
    const data = tradejini.createOAuthAuthorizeUrl(req);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "OAuth unavailable" });
  }
});

// Step 2 of OAuth 2.0 popup flow: exchange code, set HttpOnly SameSite=None; Secure cookie, notify opener
tradejiniRouter.get(["/auth/callback", "/auth/callback/"], async (req, res) => {
  const code = String(req.query.code ?? "");
  const state = String(req.query.state ?? "");
  const oauthErr = req.query.error ? String(req.query.error) : null;

  if (oauthErr || !code || !state) {
    const msg = oauthErr ?? "Missing authorization code or state";
    res.status(400).send(`<!doctype html><html><body style="background:#0a0a0a;color:#ff3d3d;font-family:monospace;padding:24px">
      <h3>CubePlus authorization failed</h3>
      <p>${msg.replace(/</g, "&lt;")}</p>
      <script>if (window.opener) window.opener.postMessage({ type: "TRADEJINI_AUTH_ERROR", error: ${JSON.stringify(msg)} }, "*");</script>
    </body></html>`);
    return;
  }

  try {
    const session = await tradejini.exchangeOAuthCode(code, state, req);
    tradejini.setSessionCookie(req, res, session.sid);
    res.send(`<!doctype html><html><body style="background:#0a0a0a;color:#00c853;font-family:monospace;padding:24px">
      <h3>Tradejini CubePlus linked</h3>
      <p>Authentication successful. Returning to terminal...</p>
      <script>
        if (window.opener) {
          window.opener.postMessage({ type: "TRADEJINI_AUTH_SUCCESS" }, "*");
          window.close();
        } else {
          window.location.href = "/";
        }
      </script>
    </body></html>`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to complete OAuth login";
    res.status(502).send(`<!doctype html><html><body style="background:#0a0a0a;color:#ff3d3d;font-family:monospace;padding:24px">
      <h3>CubePlus linking error</h3>
      <p>${msg.replace(/</g, "&lt;")}</p>
      <script>if (window.opener) window.opener.postMessage({ type: "TRADEJINI_AUTH_ERROR", error: ${JSON.stringify(msg)} }, "*");</script>
    </body></html>`);
  }
});

// Individual App session login (Password + TOTP forwarded securely to Tradejini using server-side TRADEJINI_API_KEY)
tradejiniRouter.post("/session", async (req, res) => {
  const password = String(req.body?.password ?? "");
  const totp = String(req.body?.totp ?? "").trim();
  if (!password || !totp) {
    return res.status(400).json({ error: "Trading password and 6-digit TOTP are required" });
  }
  try {
    const session = await tradejini.loginIndividualSession(password, totp);
    tradejini.setSessionCookie(req, res, session.sid);
    res.json({ connected: true, userId: session.userId ?? null, profile: session.profile ?? null });
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : "Tradejini login failed" });
  }
});

tradejiniRouter.post("/logout", (req, res) => {
  tradejini.deleteSession(req);
  tradejini.clearSessionCookie(req, res);
  res.json({ connected: false });
});

tradejiniRouter.get("/overview", async (req, res) => {
  const session = tradejini.getSession(req);
  if (!session) return res.status(401).json({ error: "CubePlus account not linked" });
  try {
    const data = await tradejini.fetchOverview(session);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to fetch CubePlus data" });
  }
});

tradejiniRouter.get("/history/:symbol", async (req, res) => {
  const session = tradejini.getSession(req);
  if (!session) return res.status(401).json({ error: "CubePlus account not linked" });
  try {
    const scrip = await resolveScrip(req.params.symbol);
    if (!scrip) return res.status(404).json({ error: "Symbol not found in NSE/BSE scrip master" });
    const interval = String(req.query.interval ?? "5m");
    const to = Math.floor(Date.now() / 1000);
    const from = Number(req.query.from ?? to - 5 * 86_400);
    const bars = await tradejini.fetchIntervalChart(session, scrip.id, interval, from, to);
    res.json(bars);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to fetch CubePlus chart" });
  }
});
