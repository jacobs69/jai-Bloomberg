import { Router, type Router as ExpressRouter } from "express";
import { cached } from "../cache.js";
import * as tankermap from "../providers/tankermap.js";
import * as judgment from "../providers/tankerJudgment.js";

export const tankersRouter: ExpressRouter = Router();

const FALLBACK_CHOKEPOINTS: tankermap.ChokepointStat[] = [
  { id: "india", label: "India Coast", lat: 18.5, lon: 73.0, zoom: 5, bounds: [5.5, 24.5, 65.5, 89.0], count: 0, crude: 0, product: 0, lng: 0 },
  { id: "hormuz", label: "Hormuz", lat: 26.2, lon: 56.3, zoom: 7, bounds: [24.2, 27.6, 53.5, 58.6], count: 0, crude: 0, product: 0, lng: 0 },
  { id: "redsea", label: "Red Sea", lat: 19.0, lon: 39.0, zoom: 5, bounds: [11.8, 29.8, 32.0, 45.0], count: 0, crude: 0, product: 0, lng: 0 },
  { id: "suez", label: "Suez Canal", lat: 30.5, lon: 32.35, zoom: 8, bounds: [29.7, 31.6, 32.0, 32.8], count: 0, crude: 0, product: 0, lng: 0 },
  { id: "malacca", label: "Malacca", lat: 2.8, lon: 101.5, zoom: 6, bounds: [0.4, 6.8, 97.5, 105.0], count: 0, crude: 0, product: 0, lng: 0 },
  { id: "blacksea", label: "Black Sea", lat: 43.5, lon: 30.6, zoom: 6, bounds: [40.8, 46.8, 27.2, 41.8], count: 0, crude: 0, product: 0, lng: 0 },
  { id: "northsea", label: "North Sea", lat: 53.8, lon: 3.2, zoom: 5, bounds: [49.5, 61.0, -3.5, 9.5], count: 0, crude: 0, product: 0, lng: 0 },
  { id: "usgulf", label: "US Gulf", lat: 27.8, lon: -90.5, zoom: 6, bounds: [23.5, 30.8, -98.0, -81.5], count: 0, crude: 0, product: 0, lng: 0 },
];

function fail(req: any, res: any, err: unknown) {
  const detail = err instanceof Error ? err.message : String(err);
  console.error("[tankers]", req.path, detail);
  res.status(502).json({ error: detail || "TankerMap live AIS feed unavailable." });
}

tankersRouter.get("/live", async (req, res) => {
  try {
    const data = await cached("tankermap:live", 30_000, () => tankermap.fetchAllLiveTankers());
    const fleet = String(req.query.fleet ?? "all").toLowerCase();
    const cargo = String(req.query.cargo ?? "all").toLowerCase();
    const status = String(req.query.status ?? "all").toLowerCase();
    const q = String(req.query.q ?? "").trim().toLowerCase();

    const filtered = data.vessels.filter((v) => {
      if (fleet !== "all" && v.fleet !== fleet) return false;
      if (cargo !== "all" && (v.cargo_state ?? "").toLowerCase() !== cargo) return false;
      if (status === "underway") {
        const moving = (v.speed_knots !== null && v.speed_knots >= 0.8) || (v.nav_status ?? "").toLowerCase().includes("underway");
        if (!moving) return false;
      } else if (status === "anchored") {
        const moving = (v.speed_knots !== null && v.speed_knots >= 0.8) || (v.nav_status ?? "").toLowerCase().includes("underway");
        if (moving) return false;
      }
      if (q) {
        const hay = `${v.name} ${v.imo ?? ""} ${v.mmsi ?? ""} ${v.flag ?? ""} ${v.destination ?? ""} ${v.vessel_type}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    res.json({
      aisAvailable: true,
      aisError: null,
      updatedAt: data.updatedAt,
      stats: data.stats,
      chokepoints: data.chokepoints,
      matched: filtered.length,
      vessels: filtered,
    });
  } catch (err) {
    // Graceful fallback: return 200 with aisAvailable=false so World Map Judgment mode works seamlessly
    const detail = err instanceof Error ? err.message : String(err);
    console.warn("[tankers] AIS live feed unavailable, switching to Map Judgment mode:", detail);
    res.json({
      aisAvailable: false,
      aisError: detail,
      updatedAt: new Date().toISOString(),
      stats: { total: 0, crude: 0, product: 0, lng: 0, loaded: 0, ballast: 0, underway: 0, anchored: 0 },
      chokepoints: FALLBACK_CHOKEPOINTS,
      matched: 0,
      vessels: [],
    });
  }
});

tankersRouter.get("/judgment", async (req, res) => {
  try {
    const data = await cached("tankermap:judgment", 45_000, () => judgment.buildTankerJudgment());
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

tankersRouter.get("/ports", async (_req, res) => {
  try {
    const data = await cached("tankermap:ports", 300_000, () => tankermap.fetchTankerPorts());
    res.json(data);
  } catch {
    res.json(judgment.getStrategicPortsFallback());
  }
});

tankersRouter.get("/vessel/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid vessel_id" });
  }
  try {
    const data = await cached(`tankermap:vessel:${id}`, 60_000, () => tankermap.fetchVesselDetailAndTrack(id));
    if (!data.detail && data.track.length === 0) {
      return res.status(404).json({ error: "Vessel not found" });
    }
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});
