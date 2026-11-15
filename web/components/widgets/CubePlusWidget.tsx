"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiGet, apiPost, fmt, fmtCurrency, pctClass } from "../../lib/api";
import { useTerminal } from "../../store/terminal";

type TradejiniStatus = {
  configured: boolean;
  oauthReady: boolean;
  connected: boolean;
  redirectUri: string;
  profile: Record<string, any> | null;
  userId: string | null;
};

type TradejiniOverview = {
  profile: Record<string, any> | null;
  limits: Record<string, any> | null;
  holdings: any;
  positions: any;
  orders: any;
  trades: any;
};

function asArray(val: any, keys: string[]): any[] {
  if (Array.isArray(val)) return val;
  if (val && typeof val === "object") {
    for (const k of keys) {
      if (Array.isArray(val[k])) return val[k];
    }
  }
  return [];
}

function cleanSym(raw: unknown): string {
  const s = String(raw ?? "").toUpperCase();
  if (s.startsWith("EQT_")) {
    const parts = s.split("_");
    if (parts.length >= 4) {
      const exch = parts[parts.length - 1];
      const sym = parts[1];
      return exch === "BSE" ? `BSE:${sym}` : sym;
    }
  }
  return s;
}

export default function CubePlusWidget() {
  const qc = useQueryClient();
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [tab, setTab] = useState<"holdings" | "positions" | "orders" | "limits">("holdings");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [authMsg, setAuthMsg] = useState<string | null>(null);
  const [authErr, setAuthErr] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ["tradejini-status"],
    queryFn: () => apiGet<TradejiniStatus>("/api/tradejini/status"),
    refetchInterval: 30_000,
  });

  const overview = useQuery({
    queryKey: ["tradejini-overview"],
    queryFn: () => apiGet<TradejiniOverview>("/api/tradejini/overview"),
    enabled: Boolean(status.data?.connected),
    refetchInterval: 5_000,
  });

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        !event.origin.endsWith(".run.app") &&
        !event.origin.includes("localhost") &&
        !event.origin.includes("127.0.0.1")
      ) {
        return;
      }
      if (event.data?.type === "TRADEJINI_AUTH_SUCCESS") {
        setAuthErr(null);
        setAuthMsg("Tradejini CubePlus account linked securely.");
        qc.invalidateQueries({ queryKey: ["tradejini-status"] });
        qc.invalidateQueries({ queryKey: ["tradejini-overview"] });
      } else if (event.data?.type === "TRADEJINI_AUTH_ERROR") {
        setAuthErr(event.data.error ?? "CubePlus OAuth failed");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [qc]);

  const handleOAuthPopup = async () => {
    setAuthErr(null);
    setAuthMsg(null);
    try {
      const { url } = await apiGet<{ url: string }>("/api/tradejini/auth/url");
      const popup = window.open(url, "tradejini_cubeplus_oauth", "width=560,height=720");
      if (!popup) {
        setAuthErr("Popup blocked. Please allow popups for this site to sign into CubePlus.");
      }
    } catch (err) {
      setAuthErr(err instanceof Error ? err.message : "Could not initiate CubePlus OAuth");
    }
  };

  const sessionLogin = useMutation({
    mutationFn: () => apiPost("/api/tradejini/session", { password, totp }),
    onSuccess: () => {
      setPassword("");
      setTotp("");
      setAuthErr(null);
      setAuthMsg("CubePlus daily session activated.");
      qc.invalidateQueries({ queryKey: ["tradejini-status"] });
      qc.invalidateQueries({ queryKey: ["tradejini-overview"] });
    },
    onError: (err) => {
      setAuthErr(err instanceof Error ? err.message : "CubePlus login failed");
    },
  });

  const logout = useMutation({
    mutationFn: () => apiPost("/api/tradejini/logout", {}),
    onSuccess: () => {
      setAuthMsg(null);
      qc.invalidateQueries({ queryKey: ["tradejini-status"] });
      qc.removeQueries({ queryKey: ["tradejini-overview"] });
    },
  });

  const st = status.data;
  const holdings = asArray(overview.data?.holdings, ["holdings", "list", "data"]);
  const positions = asArray(overview.data?.positions, ["positions", "netPositions", "dayPositions", "list"]);
  const orders = asArray(overview.data?.orders, ["orders", "list", "data"]);
  const limits = overview.data?.limits;

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-2 p-1.5 items-center flex-wrap border-b border-[var(--border)] bg-[var(--panel-2)] shrink-0">
        <span className="amber font-bold text-[11px] tracking-wider">TRADEJINI CUBEPLUS</span>
        {st?.connected ? (
          <>
            <span className="up text-[10px] font-bold">● LINKED {st.userId ? `(${st.userId})` : ""}</span>
            <div className="flex gap-1 ml-2">
              {(["holdings", "positions", "orders", "limits"] as const).map((t) => (
                <button
                  key={t}
                  className={`term-btn ${tab === t ? "active" : ""}`}
                  onClick={() => setTab(t)}
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
            <button
              className="term-btn ml-auto hover:!text-[var(--down)]"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
            >
              DISCONNECT
            </button>
          </>
        ) : (
          <span className="dim text-[10px]">NOT LINKED · SERVER-SIDE ENCRYPTED COOKIE SESSION</span>
        )}
      </div>

      {authErr && <div className="px-2 py-1 down text-[11px] border-b border-[#221111]">{authErr}</div>}
      {authMsg && <div className="px-2 py-1 up text-[11px] border-b border-[#112211]">{authMsg}</div>}

      {!st?.connected ? (
        <div className="p-3 flex flex-col gap-3 overflow-auto text-[11px]">
          <div className="border border-[var(--border)] p-2.5 bg-[#0d0d0d]">
            <div className="amber font-bold mb-1">1. Connect CubePlus via OAuth 2.0 (cubeplus.tradejini.com)</div>
            <p className="dim mb-2">
              Opens Tradejini CubePlus authorization directly in a secure popup and stores your daily trading session in an HttpOnly server cookie—API keys and tokens never touch browser storage.
            </p>
            <div className="flex gap-2 items-center flex-wrap">
              <button
                className="term-btn active"
                onClick={handleOAuthPopup}
                disabled={!st?.oauthReady}
                title={!st?.oauthReady ? "Set TRADEJINI_API_KEY and TRADEJINI_API_SECRET on server" : undefined}
              >
                CONNECT CUBEPLUS OAUTH ↗
              </button>
              {!st?.oauthReady && (
                <span className="dim text-[10px]">
                  Server env requires <span className="text-[var(--text)]">TRADEJINI_API_KEY</span> &amp;{" "}
                  <span className="text-[var(--text)]">TRADEJINI_API_SECRET</span>
                </span>
              )}
            </div>
            {st?.redirectUri && (
              <div className="mt-2 text-[10px] dim break-all">
                OAuth Redirect URI: <span className="text-[var(--text)]">{st.redirectUri}</span>
              </div>
            )}
          </div>

          <form
            className="border border-[var(--border)] p-2.5 bg-[#0d0d0d] flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (password && totp) sessionLogin.mutate();
            }}
          >
            <div className="amber font-bold">2. Or Link Individual CubePlus Session (Password + 2FA TOTP)</div>
            <p className="dim text-[10px]">
              For Tradejini Individual Apps (<span className="text-[var(--text)]">TRADEJINI_API_KEY</span> configured in server env). Credentials are forwarded over HTTPS and never persisted.
            </p>
            <div className="flex gap-2 flex-wrap items-center">
              <input
                type="password"
                placeholder="CubePlus Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="w-44"
              />
              <input
                type="text"
                inputMode="numeric"
                maxLength={8}
                placeholder="6-digit TOTP"
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
                className="w-32"
              />
              <button
                type="submit"
                className="term-btn"
                disabled={!st?.configured || sessionLogin.isPending || !password || !totp}
              >
                {sessionLogin.isPending ? "LINKING…" : "ACTIVATE SESSION"}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="flex-1 overflow-auto min-h-0">
          {overview.isLoading && <div className="p-2 dim">Syncing CubePlus live account…</div>}
          {overview.error && <div className="p-2 down">{(overview.error as Error).message}</div>}

          {tab === "holdings" && !overview.isLoading && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Qty</th>
                  <th>Avg Price</th>
                  <th>LTP</th>
                  <th>Curr Val</th>
                  <th>P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h: any, i: number) => {
                  const sym = cleanSym(h.symId ?? h.symbol ?? h.tradingsymbol);
                  const qty = Number(h.qty ?? h.quantity ?? h.holdQty ?? 0);
                  const avg = Number(h.avgPrice ?? h.buyAvg ?? h.costPrice ?? 0);
                  const ltp = Number(h.ltp ?? h.lastPrice ?? avg);
                  const pnl = Number(h.pnl ?? (ltp - avg) * qty);
                  return (
                    <tr key={`${sym}-${i}`} onClick={() => sym && setActiveSymbol(sym)}>
                      <td className="font-bold amber">{sym || "—"}</td>
                      <td>{fmt(qty, 0)}</td>
                      <td>{fmtCurrency(avg, "INR")}</td>
                      <td>{fmtCurrency(ltp, "INR")}</td>
                      <td>{fmtCurrency(ltp * qty, "INR")}</td>
                      <td className={pctClass(pnl)}>{fmtCurrency(pnl, "INR")}</td>
                    </tr>
                  );
                })}
                {holdings.length === 0 && (
                  <tr>
                    <td colSpan={6} className="dim p-3 !text-center">
                      No Demat holdings returned by CubePlus.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {tab === "positions" && !overview.isLoading && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Product</th>
                  <th>Net Qty</th>
                  <th>Buy Avg</th>
                  <th>LTP</th>
                  <th>MTM P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p: any, i: number) => {
                  const sym = cleanSym(p.symId ?? p.symbol ?? p.tradingsymbol);
                  const qty = Number(p.netQty ?? p.qty ?? 0);
                  const avg = Number(p.buyAvg ?? p.avgPrice ?? 0);
                  const ltp = Number(p.ltp ?? p.lastPrice ?? avg);
                  const mtm = Number(p.mtm ?? p.unrealizedPnl ?? p.pnl ?? 0);
                  return (
                    <tr key={`${sym}-${i}`} onClick={() => sym && setActiveSymbol(sym)}>
                      <td className="font-bold amber">{sym || "—"}</td>
                      <td className="dim">{p.product ?? p.prd ?? "—"}</td>
                      <td>{fmt(qty, 0)}</td>
                      <td>{fmtCurrency(avg, "INR")}</td>
                      <td>{fmtCurrency(ltp, "INR")}</td>
                      <td className={pctClass(mtm)}>{fmtCurrency(mtm, "INR")}</td>
                    </tr>
                  );
                })}
                {positions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="dim p-3 !text-center">
                      No open CubePlus positions today.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {tab === "orders" && !overview.isLoading && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Type</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o: any, i: number) => {
                  const sym = cleanSym(o.symId ?? o.symbol);
                  const side = String(o.side ?? o.trantype ?? "").toUpperCase();
                  return (
                    <tr key={o.orderId ?? i} onClick={() => sym && setActiveSymbol(sym)}>
                      <td className="font-bold">{sym || "—"}</td>
                      <td className={side.includes("B") ? "up" : "down"}>{side}</td>
                      <td>{fmt(Number(o.qty ?? 0), 0)}</td>
                      <td>{fmtCurrency(Number(o.price ?? o.avgPrice ?? 0), "INR")}</td>
                      <td className="dim">{o.orderType ?? o.type ?? "—"}</td>
                      <td className="amber">{o.status ?? "—"}</td>
                    </tr>
                  );
                })}
                {orders.length === 0 && (
                  <tr>
                    <td colSpan={6} className="dim p-3 !text-center">
                      No orders placed in today&apos;s session.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {tab === "limits" && !overview.isLoading && (
            <div className="p-2 grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
              {limits && typeof limits === "object" ? (
                Object.entries(limits).map(([k, v]) => (
                  <div key={k} className="border border-[var(--border)] p-2 bg-[#0d0d0d]">
                    <div className="dim text-[10px] uppercase">{k}</div>
                    <div className="amber font-bold mt-0.5">
                      {typeof v === "number" ? fmtCurrency(v, "INR") : String(v ?? "—")}
                    </div>
                  </div>
                ))
              ) : (
                <div className="dim">No margin/limit data available.</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
