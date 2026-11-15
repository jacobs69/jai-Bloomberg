const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const BASE = "https://tankermap.com";

export type TankerVessel = {
  vessel_id: number;
  name: string;
  imo: number | null;
  mmsi: number | null;
  vessel_type: string;
  fleet: "crude" | "product" | "lng" | "other";
  observed_at: string;
  latitude: number;
  longitude: number;
  speed_knots: number | null;
  flag: string | null;
  deadweight: number | null;
  cog_degrees: number | null;
  draught_meters: number | null;
  cargo_state: string | null;
  nav_status: string | null;
  destination: string | null;
};

export type TankerPort = {
  id: number;
  name: string;
  slug: string;
  country: string;
  lat: number;
  lon: number;
  port_type: string;
  commodity: string | null;
  direction: string | null;
  capacity_value: string | null;
  capacity_unit: string | null;
  in_port_count: number | null;
};

export type TankerTrackPoint = {
  observed_at: string;
  latitude: number;
  longitude: number;
  speed_knots: number | null;
  cog_degrees: number | null;
  draught_meters: number | null;
  nav_status: string | null;
  destination: string | null;
  position_source: string | null;
};

export type ChokepointStat = {
  id: string;
  label: string;
  lat: number;
  lon: number;
  zoom: number;
  bounds: [number, number, number, number]; // [latMin, latMax, lonMin, lonMax]
  count: number;
  crude: number;
  product: number;
  lng: number;
};

const CHOKEPOINTS: Array<Omit<ChokepointStat, "count" | "crude" | "product" | "lng">> = [
  { id: "india", label: "India Coast", lat: 18.5, lon: 73.0, zoom: 5, bounds: [5.5, 24.5, 65.5, 89.0] },
  { id: "hormuz", label: "Hormuz", lat: 26.2, lon: 56.3, zoom: 7, bounds: [24.2, 27.6, 53.5, 58.6] },
  { id: "redsea", label: "Red Sea", lat: 19.0, lon: 39.0, zoom: 5, bounds: [11.8, 29.8, 32.0, 45.0] },
  { id: "suez", label: "Suez Canal", lat: 30.5, lon: 32.35, zoom: 8, bounds: [29.7, 31.6, 32.0, 32.8] },
  { id: "malacca", label: "Malacca", lat: 2.8, lon: 101.5, zoom: 6, bounds: [0.4, 6.8, 97.5, 105.0] },
  { id: "blacksea", label: "Black Sea", lat: 43.5, lon: 30.6, zoom: 6, bounds: [40.8, 46.8, 27.2, 41.8] },
  { id: "northsea", label: "North Sea", lat: 53.8, lon: 3.2, zoom: 5, bounds: [49.5, 61.0, -3.5, 9.5] },
  { id: "usgulf", label: "US Gulf", lat: 27.8, lon: -90.5, zoom: 6, bounds: [23.5, 30.8, -98.0, -81.5] },
];

function classifyFleet(vesselType: string): TankerVessel["fleet"] {
  const t = vesselType.toLowerCase();
  if (t.includes("crude")) return "crude";
  if (t.includes("lng") || t.includes("lpg") || t.includes("gas")) return "lng";
  if (t.includes("product") || t.includes("oil") || t.includes("chemical") || t.includes("bitumen") || t.includes("asphalt")) {
    return "product";
  }
  return "other";
}

async function tmFetchJson<T>(path: string, timeoutMs = 15_000): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      Referer: `${BASE}/`,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`tankermap ${res.status} for ${path}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchAllLiveTankers(): Promise<{
  updatedAt: string;
  stats: {
    total: number;
    crude: number;
    product: number;
    lng: number;
    loaded: number;
    ballast: number;
    underway: number;
    anchored: number;
  };
  chokepoints: ChokepointStat[];
  vessels: TankerVessel[];
}> {
  const raw = await tmFetchJson<any[]>("/api/vessels/live?fields=map&limit=10000");
  const vessels: TankerVessel[] = [];
  let crude = 0;
  let product = 0;
  let lng = 0;
  let loaded = 0;
  let ballast = 0;
  let underway = 0;
  let anchored = 0;

  const cpCounts = CHOKEPOINTS.map((c) => ({ ...c, count: 0, crude: 0, product: 0, lng: 0 }));

  for (const r of raw) {
    if (typeof r.latitude !== "number" || typeof r.longitude !== "number") continue;
    const vtype = String(r.vessel_type ?? "Tanker");
    const fleet = classifyFleet(vtype);
    if (fleet === "crude") crude++;
    else if (fleet === "lng") lng++;
    else product++;

    const cs = String(r.cargo_state ?? "").toLowerCase();
    if (cs === "loaded") loaded++;
    else if (cs === "ballast") ballast++;

    const spd = typeof r.speed_knots === "number" ? r.speed_knots : null;
    const nav = String(r.nav_status ?? "").toLowerCase();
    if ((spd !== null && spd >= 0.8) || nav.includes("underway")) underway++;
    else anchored++;

    for (const cp of cpCounts) {
      const [latMin, latMax, lonMin, lonMax] = cp.bounds;
      if (r.latitude >= latMin && r.latitude <= latMax && r.longitude >= lonMin && r.longitude <= lonMax) {
        cp.count++;
        if (fleet === "crude") cp.crude++;
        else if (fleet === "lng") cp.lng++;
        else cp.product++;
      }
    }

    vessels.push({
      vessel_id: Number(r.vessel_id),
      name: String(r.name ?? `VESSEL ${r.vessel_id}`),
      imo: typeof r.imo === "number" ? r.imo : null,
      mmsi: typeof r.mmsi === "number" ? r.mmsi : null,
      vessel_type: vtype,
      fleet,
      observed_at: String(r.observed_at ?? ""),
      latitude: r.latitude,
      longitude: r.longitude,
      speed_knots: spd,
      flag: r.flag ? String(r.flag) : null,
      deadweight: typeof r.deadweight === "number" ? r.deadweight : null,
      cog_degrees: typeof r.cog_degrees === "number" ? r.cog_degrees : null,
      draught_meters: typeof r.draught_meters === "number" ? r.draught_meters : null,
      cargo_state: r.cargo_state ? String(r.cargo_state) : null,
      nav_status: r.nav_status ? String(r.nav_status) : null,
      destination: r.destination ? String(r.destination).trim() : null,
    });
  }

  return {
    updatedAt: new Date().toISOString(),
    stats: {
      total: vessels.length,
      crude,
      product,
      lng,
      loaded,
      ballast,
      underway,
      anchored,
    },
    chokepoints: cpCounts,
    vessels,
  };
}

export async function fetchTankerPorts(): Promise<TankerPort[]> {
  const raw = await tmFetchJson<any[]>("/api/ports");
  return (Array.isArray(raw) ? raw : []).filter((p) => typeof p.lat === "number" && typeof p.lon === "number");
}

export async function fetchVesselDetailAndTrack(vesselId: number): Promise<{
  detail: Record<string, any> | null;
  track: TankerTrackPoint[];
}> {
  const [detailRes, trackRes] = await Promise.allSettled([
    tmFetchJson<Record<string, any>>(`/api/vessels/${vesselId}`),
    tmFetchJson<TankerTrackPoint[]>(`/api/vessels/${vesselId}/track`),
  ]);

  return {
    detail: detailRes.status === "fulfilled" ? detailRes.value : null,
    track: trackRes.status === "fulfilled" && Array.isArray(trackRes.value) ? trackRes.value : [],
  };
}
