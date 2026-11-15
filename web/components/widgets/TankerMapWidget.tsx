"use client";

import "leaflet/dist/leaflet.css";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "../../lib/api";
import { isSafeHttpUrl } from "../../lib/links";
import { useTerminal } from "../../store/terminal";

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

type ChokepointStat = {
  id: string;
  label: string;
  lat: number;
  lon: number;
  zoom: number;
  bounds: [number, number, number, number];
  count: number;
  crude: number;
  product: number;
  lng: number;
};

type TankerLiveResponse = {
  aisAvailable?: boolean;
  aisError?: string | null;
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
  matched: number;
  vessels: TankerVessel[];
};

type TankerPort = {
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

type TankerTrackPoint = {
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

type VesselDetailResponse = {
  detail: Record<string, any> | null;
  track: TankerTrackPoint[];
};

type ChokepointAssessment = {
  id: string;
  label: string;
  lat: number;
  lon: number;
  zoom: number;
  bounds: [number, number, number, number];
  indiaRelevance: string;
  exposedTickers: string[];
  aisCount: number | null;
  crudeCount: number | null;
  productCount: number | null;
  lngCount: number | null;
  loadedPct: number | null;
  anchoredPct: number | null;
  avgSpeedKnots: number | null;
  newsHits: number;
  disruptionHits: number;
  riskScore: number;
  status: "NORMAL" | "ELEVATED" | "CRITICAL";
  summary: string;
};

type SeaCorridor = {
  id: string;
  name: string;
  shortName: string;
  commodity: "Crude & LNG" | "Crude & Products" | "Diversion Route";
  riskScore: number;
  status: "NORMAL" | "ELEVATED" | "CRITICAL";
  waypoints: Array<[number, number]>;
  transitNote: string;
  impactedTickers: string[];
};

type MaritimeHeadline = {
  title: string;
  link: string;
  publisher: string;
  publishedAt: string | null;
  regions: string[];
  disruption: boolean;
};

type BenchmarkQuote = {
  symbol: string;
  label: string;
  price: number | null;
  changePercent: number | null;
  currency: string | null;
};

type TankerJudgmentResponse = {
  updatedAt: string;
  aisAvailable: boolean;
  aisError: string | null;
  aisTotalVessels: number | null;
  verdict: {
    overallScore: number;
    regime: string;
    indiaImpact: string;
    drivers: string[];
  };
  benchmarks: {
    brent: BenchmarkQuote;
    wti: BenchmarkQuote;
    natgas: BenchmarkQuote;
    usdinr: BenchmarkQuote;
    brentWtiSpread: number | null;
    brentInrPerBbl: number | null;
    omcAvgChangePct: number | null;
    upstreamAvgChangePct: number | null;
    tankerAvgChangePct: number | null;
    tankerStocks: BenchmarkQuote[];
    indiaEnergyStocks: BenchmarkQuote[];
  };
  chokepoints: ChokepointAssessment[];
  corridors: SeaCorridor[];
  headlines: MaritimeHeadline[];
};

type FleetFilter = "all" | "crude" | "product" | "lng";
type CargoFilter = "all" | "loaded" | "ballast";
type StatusFilter = "all" | "underway" | "anchored";
type ViewMode = "split" | "map" | "table";
type PanelTab = "judgment" | "fleet";
type SortField = "deadweight" | "speed_knots" | "name" | "destination";
type MoverSpeed = 0 | 1 | 15 | 60;

// MarineTraffic default coordinates from user: centerx:30.6 / centery:43.5 / zoom:2
const DEFAULT_VIEW: { lat: number; lon: number; zoom: number } = { lat: 43.5, lon: 30.6, zoom: 2 };

const FLEET_COLOR: Record<TankerVessel["fleet"], string> = {
  crude: "#ff9900",
  product: "#38bdf8",
  lng: "#00c853",
  other: "#a3a3a3",
};

const RISK_COLOR: Record<"NORMAL" | "ELEVATED" | "CRITICAL", string> = {
  NORMAL: "#00c853",
  ELEVATED: "#ff9900",
  CRITICAL: "#ff3d3d",
};

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").slice(0, 16) + "Z";
}

function escHtml(val: string): string {
  return val
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Dead-reckon a vessel forward along its true course (COG°) and speed (knots) */
function deadReckon(v: TankerVessel, elapsedSec: number): [number, number] {
  if (
    elapsedSec <= 0 ||
    v.speed_knots === null ||
    v.speed_knots < 0.5 ||
    v.cog_degrees === null ||
    !Number.isFinite(v.cog_degrees)
  ) {
    return [v.latitude, v.longitude];
  }
  const distNm = (v.speed_knots * elapsedSec) / 3600;
  const cogRad = (v.cog_degrees * Math.PI) / 180;
  const dLat = (distNm * Math.cos(cogRad)) / 60;
  const cosLat = Math.max(0.15, Math.cos((v.latitude * Math.PI) / 180));
  const dLon = (distNm * Math.sin(cogRad)) / (60 * cosLat);
  const lat = Math.max(-84, Math.min(84, v.latitude + dLat));
  let lon = v.longitude + dLon;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return [lat, lon];
}

export default function TankerMapWidget() {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);

  const [fleet, setFleet] = useState<FleetFilter>("all");
  const [cargo, setCargo] = useState<CargoFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [activeChokepoint, setActiveChokepoint] = useState<string>("global");
  const [activeCorridorId, setActiveCorridorId] = useState<string | null>(null);
  const [showPorts, setShowPorts] = useState(true);
  const [showCorridors, setShowCorridors] = useState(true);
  const [showZones, setShowZones] = useState(true);
  const [showSeamarks, setShowSeamarks] = useState(false);
  const [moverSpeed, setMoverSpeed] = useState<MoverSpeed>(15);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [panelTab, setPanelTab] = useState<PanelTab>("judgment");
  const [sortField, setSortField] = useState<SortField>("deadweight");
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mapViewport, setMapViewport] = useState(DEFAULT_VIEW);
  const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number; vessel: TankerVessel } | null>(null);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const moverCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<any>(null);
  const leafletRef = useRef<any>(null);
  const rendererRef = useRef<any>(null);
  const zonesLayerRef = useRef<any>(null);
  const corridorsLayerRef = useRef<any>(null);
  const portsLayerRef = useRef<any>(null);
  const trackLayerRef = useRef<any>(null);
  const seamarksLayerRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  // Refs shared with fast canvas animation loop
  const vesselsRef = useRef<TankerVessel[]>([]);
  const selectedIdRef = useRef<number | null>(null);
  const moverSpeedRef = useRef<MoverSpeed>(15);
  const dataSyncMsRef = useRef<number>(Date.now());
  const screenPointsRef = useRef<Array<{ x: number; y: number; vessel: TankerVessel }>>([]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    moverSpeedRef.current = moverSpeed;
  }, [moverSpeed]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const liveUrl = useMemo(() => {
    const p = new URLSearchParams();
    p.set("fleet", fleet);
    p.set("cargo", cargo);
    p.set("status", status);
    if (debouncedQ) p.set("q", debouncedQ);
    return `/api/tankers/live?${p.toString()}`;
  }, [fleet, cargo, status, debouncedQ]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["tankers-live", fleet, cargo, status, debouncedQ],
    queryFn: () => apiGet<TankerLiveResponse>(liveUrl),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const { data: judgment, isFetching: judgmentFetching, refetch: refetchJudgment } = useQuery({
    queryKey: ["tankers-judgment"],
    queryFn: () => apiGet<TankerJudgmentResponse>("/api/tankers/judgment"),
    refetchInterval: 45_000,
    staleTime: 25_000,
  });

  const { data: ports } = useQuery({
    queryKey: ["tankers-ports"],
    queryFn: () => apiGet<TankerPort[]>("/api/tankers/ports"),
    enabled: showPorts,
    staleTime: 300_000,
  });

  const { data: vesselDetail, isFetching: detailLoading } = useQuery({
    queryKey: ["tankers-vessel", selectedId],
    queryFn: () => apiGet<VesselDetailResponse>(`/api/tankers/vessel/${selectedId}`),
    enabled: selectedId !== null,
    staleTime: 60_000,
  });

  useEffect(() => {
    vesselsRef.current = data?.vessels ?? [];
    dataSyncMsRef.current = Date.now();
  }, [data?.vessels]);

  // Dynamically initialize Leaflet in browser only centered at MarineTraffic coordinates (43.5, 30.6, z=2)
  useEffect(() => {
    let destroyed = false;
    async function initMap() {
      if (!mapContainerRef.current || mapRef.current) return;
      const L = (await import("leaflet")).default;
      if (destroyed || !mapContainerRef.current) return;
      leafletRef.current = L;

      const map = L.map(mapContainerRef.current, {
        center: [DEFAULT_VIEW.lat, DEFAULT_VIEW.lon],
        zoom: DEFAULT_VIEW.zoom,
        minZoom: 2,
        maxZoom: 13,
        worldCopyJump: true,
        preferCanvas: true,
        zoomControl: true,
      });

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap &copy; CARTO | MarineTraffic Mover & MarketForge",
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);

      rendererRef.current = L.canvas({ padding: 0.5 });
      zonesLayerRef.current = L.layerGroup().addTo(map);
      corridorsLayerRef.current = L.layerGroup().addTo(map);
      portsLayerRef.current = L.layerGroup().addTo(map);
      trackLayerRef.current = L.layerGroup().addTo(map);

      map.on("moveend zoomend", () => {
        const c = map.getCenter();
        setMapViewport({
          lat: Number(c.lat.toFixed(2)),
          lon: Number(c.lng.toFixed(2)),
          zoom: map.getZoom(),
        });
      });

      mapRef.current = map;
      setMapReady(true);
    }
    initMap();
    return () => {
      destroyed = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        leafletRef.current = null;
        zonesLayerRef.current = null;
        corridorsLayerRef.current = null;
        portsLayerRef.current = null;
        trackLayerRef.current = null;
        seamarksLayerRef.current = null;
      }
    };
  }, []);

  // MarineTraffic-style Directional Mover Canvas Renderer (rotated ship arrows + speed wake + dead-reckoning)
  useEffect(() => {
    if (!mapReady || !mapRef.current || !moverCanvasRef.current) return;
    const map = mapRef.current;
    const canvas = moverCanvasRef.current;

    const drawVessels = () => {
      const container = map.getContainer();
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const mult = moverSpeedRef.current;
      const elapsedSec = mult > 0 ? ((Date.now() - dataSyncMsRef.current) / 1000) * mult : 0;
      const zoom = map.getZoom();
      const arrowScale = zoom >= 7 ? 1.55 : zoom >= 5 ? 1.25 : zoom >= 3 ? 1.0 : 0.85;
      const activeId = selectedIdRef.current;
      const pts: Array<{ x: number; y: number; vessel: TankerVessel }> = [];

      for (const v of vesselsRef.current) {
        const [lat, lon] = deadReckon(v, elapsedSec);
        const pt = map.latLngToContainerPoint([lat, lon]);
        if (pt.x < -12 || pt.y < -12 || pt.x > w + 12 || pt.y > h + 12) continue;

        pts.push({ x: pt.x, y: pt.y, vessel: v });
        const color = FLEET_COLOR[v.fleet] ?? FLEET_COLOR.other;
        const isSelected = v.vessel_id === activeId;
        const moving = v.speed_knots !== null && v.speed_knots >= 0.5 && v.cog_degrees !== null;

        ctx.save();
        ctx.translate(pt.x, pt.y);

        if (moving) {
          const rad = ((v.cog_degrees ?? 0) * Math.PI) / 180;
          ctx.rotate(rad);

          // Speed wake / heading vector line (MarineTraffic mover feel)
          const wakeLen = Math.min(20, (v.speed_knots ?? 0) * 0.85 * arrowScale);
          if (wakeLen > 2) {
            ctx.beginPath();
            ctx.moveTo(0, -4 * arrowScale);
            ctx.lineTo(0, -(4 * arrowScale + wakeLen));
            ctx.strokeStyle = isSelected ? "#ffffff" : color;
            ctx.globalAlpha = isSelected ? 0.95 : 0.55;
            ctx.lineWidth = isSelected ? 1.8 : 1;
            ctx.stroke();
          }

          // Directional Ship Chevron / Triangle pointing along COG (up = 0 deg before rotate)
          const sz = (isSelected ? 7.5 : 4.6) * arrowScale;
          ctx.beginPath();
          ctx.moveTo(0, -sz * 1.35);
          ctx.lineTo(sz * 0.78, sz * 0.95);
          ctx.lineTo(0, sz * 0.45);
          ctx.lineTo(-sz * 0.78, sz * 0.95);
          ctx.closePath();

          ctx.globalAlpha = isSelected ? 1 : 0.9;
          ctx.fillStyle = color;
          ctx.fill();
          ctx.lineWidth = isSelected ? 1.8 : 0.6;
          ctx.strokeStyle = isSelected ? "#ffffff" : "#000000";
          ctx.stroke();
        } else {
          // Anchored / moored tanker marker
          const r = (isSelected ? 5.2 : 2.3) * arrowScale;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.globalAlpha = isSelected ? 1 : 0.72;
          ctx.fillStyle = color;
          ctx.fill();
          if (isSelected) {
            ctx.lineWidth = 2;
            ctx.strokeStyle = "#ffffff";
            ctx.stroke();
          }
        }
        ctx.restore();
      }
      screenPointsRef.current = pts;
    };

    drawVessels();
    map.on("move zoom viewreset resize", drawVessels);
    const interval = setInterval(drawVessels, 350);

    return () => {
      map.off("move zoom viewreset resize", drawVessels);
      clearInterval(interval);
    };
  }, [mapReady]);

  // Re-draw immediately when selectedId or vessel list updates
  useEffect(() => {
    if (mapReady && mapRef.current) {
      mapRef.current.fire("viewreset");
    }
  }, [mapReady, data?.vessels, selectedId, moverSpeed]);

  // Optional OpenSeaMap nautical seamarks layer
  useEffect(() => {
    if (!mapReady || !mapRef.current || !leafletRef.current) return;
    const L = leafletRef.current;
    const map = mapRef.current;
    if (showSeamarks) {
      if (!seamarksLayerRef.current) {
        seamarksLayerRef.current = L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", {
          attribution: "&copy; OpenSeaMap",
          maxZoom: 18,
          opacity: 0.85,
        });
      }
      seamarksLayerRef.current.addTo(map);
    } else if (seamarksLayerRef.current) {
      map.removeLayer(seamarksLayerRef.current);
    }
  }, [mapReady, showSeamarks]);

  // Keep map dimensions synced when layout or viewMode toggles
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const t = setTimeout(() => {
      mapRef.current?.invalidateSize();
      mapRef.current?.fire("viewreset");
    }, 80);
    return () => clearTimeout(t);
  }, [mapReady, viewMode, selectedId, panelTab]);

  // Hit-testing on Leaflet container for clicking & hovering moving canvas vessels
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const findNearest = (x: number, y: number): TankerVessel | null => {
      let best: TankerVessel | null = null;
      let bestD2 = 12 * 12;
      for (const p of screenPointsRef.current) {
        const dx = p.x - x;
        const dy = p.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= bestD2) {
          bestD2 = d2;
          best = p.vessel;
        }
      }
      return best;
    };

    const onMouseMove = (e: any) => {
      const hit = findNearest(e.containerPoint.x, e.containerPoint.y);
      if (hit) {
        setHoverInfo({ x: e.containerPoint.x, y: e.containerPoint.y, vessel: hit });
      } else {
        setHoverInfo((prev) => (prev ? null : prev));
      }
    };
    const onMouseOut = () => setHoverInfo(null);
    const onClick = (e: any) => {
      const hit = findNearest(e.containerPoint.x, e.containerPoint.y);
      if (hit) {
        setSelectedId(hit.vessel_id);
        setPanelTab("fleet");
      }
    };

    map.on("mousemove", onMouseMove);
    map.on("mouseout", onMouseOut);
    map.on("click", onClick);
    return () => {
      map.off("mousemove", onMouseMove);
      map.off("mouseout", onMouseOut);
      map.off("click", onClick);
    };
  }, [mapReady]);

  const aisAvailable = data?.aisAvailable ?? judgment?.aisAvailable ?? true;

  const activeBounds = useMemo(() => {
    if (activeChokepoint === "global" || !data?.chokepoints) return null;
    return data.chokepoints.find((c) => c.id === activeChokepoint)?.bounds ?? null;
  }, [activeChokepoint, data?.chokepoints]);

  const displayedVessels = useMemo(() => {
    const list = data?.vessels ?? [];
    if (!activeBounds) return list;
    const [latMin, latMax, lonMin, lonMax] = activeBounds;
    return list.filter(
      (v) => v.latitude >= latMin && v.latitude <= latMax && v.longitude >= lonMin && v.longitude <= lonMax
    );
  }, [data?.vessels, activeBounds]);

  const sortedTableRows = useMemo(() => {
    const copy = [...displayedVessels];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortField === "deadweight") cmp = (a.deadweight ?? 0) - (b.deadweight ?? 0);
      else if (sortField === "speed_knots") cmp = (a.speed_knots ?? -1) - (b.speed_knots ?? -1);
      else if (sortField === "name") cmp = a.name.localeCompare(b.name);
      else cmp = (a.destination ?? "").localeCompare(b.destination ?? "");
      return sortAsc ? cmp : -cmp;
    });
    return copy.slice(0, 250);
  }, [displayedVessels, sortField, sortAsc]);

  const selectedVessel = useMemo(() => {
    if (selectedId === null || !data?.vessels) return null;
    return data.vessels.find((v) => v.vessel_id === selectedId) ?? null;
  }, [selectedId, data?.vessels]);

  // Draw Chokepoint Risk Bounding Zones on World Map
  useEffect(() => {
    if (!mapReady || !leafletRef.current || !zonesLayerRef.current) return;
    const L = leafletRef.current;
    const layer = zonesLayerRef.current;
    layer.clearLayers();
    if (!showZones || !judgment?.chokepoints) return;

    for (const cp of judgment.chokepoints) {
      const [latMin, latMax, lonMin, lonMax] = cp.bounds;
      const color = RISK_COLOR[cp.status];
      const isActive = activeChokepoint === cp.id;
      const rect = L.rectangle(
        [
          [latMin, lonMin],
          [latMax, lonMax],
        ],
        {
          color,
          weight: isActive ? 2.2 : 1.1,
          dashArray: isActive ? undefined : "4 3",
          fillColor: color,
          fillOpacity: isActive ? 0.16 : 0.07,
        }
      );
      rect.bindTooltip(
        `<div style="line-height:1.35">
          <div style="color:${color};font-weight:700">${escHtml(cp.label.toUpperCase())} · ${cp.riskScore}/100 (${cp.status})</div>
          <div>${escHtml(cp.summary)}</div>
          <div style="color:#ff9900">${escHtml(cp.indiaRelevance)}</div>
        </div>`,
        { sticky: true, className: "tanker-tooltip" }
      );
      rect.on("click", () => {
        setActiveChokepoint(cp.id);
        setPanelTab("judgment");
        mapRef.current?.setView([cp.lat, cp.lon], cp.zoom, { animate: true });
      });
      rect.addTo(layer);
    }
  }, [mapReady, showZones, judgment?.chokepoints, activeChokepoint]);

  // Draw Global Crude & LNG Shipping Corridors on World Map
  useEffect(() => {
    if (!mapReady || !leafletRef.current || !corridorsLayerRef.current) return;
    const L = leafletRef.current;
    const layer = corridorsLayerRef.current;
    layer.clearLayers();
    if (!showCorridors || !judgment?.corridors) return;

    for (const cor of judgment.corridors) {
      const color = RISK_COLOR[cor.status];
      const isSelected = activeCorridorId === cor.id;
      const line = L.polyline(cor.waypoints, {
        color,
        weight: isSelected ? 4 : 2.1,
        opacity: isSelected ? 0.95 : 0.58,
        dashArray: cor.commodity === "Diversion Route" ? "6 5" : undefined,
      });
      line.bindTooltip(
        `<div style="line-height:1.35">
          <div style="color:${color};font-weight:700">${escHtml(cor.name)}</div>
          <div>Risk: ${cor.riskScore}/100 (${cor.status}) · ${escHtml(cor.commodity)}</div>
          <div>${escHtml(cor.transitNote)}</div>
        </div>`,
        { sticky: true, className: "tanker-tooltip" }
      );
      line.on("click", () => {
        setActiveCorridorId(cor.id);
        setPanelTab("judgment");
        mapRef.current?.fitBounds(line.getBounds(), { padding: [30, 30] });
      });
      line.addTo(layer);
    }
  }, [mapReady, showCorridors, judgment?.corridors, activeCorridorId]);

  // Draw oil / LNG ports layer
  useEffect(() => {
    if (!mapReady || !leafletRef.current || !portsLayerRef.current || !rendererRef.current) return;
    const L = leafletRef.current;
    const layer = portsLayerRef.current;
    const renderer = rendererRef.current;
    layer.clearLayers();

    if (!showPorts || !ports) return;
    for (const p of ports) {
      const marker = L.circleMarker([p.lat, p.lon], {
        renderer,
        radius: 3.4,
        color: "#fde047",
        weight: 1,
        fillColor: "#854d0e",
        fillOpacity: 0.78,
      });
      marker.bindTooltip(
        `<div><b>${escHtml(p.name)}</b> (${escHtml(p.country)})<br/>${escHtml(p.port_type)} · ${escHtml(p.commodity ?? "Oil/LNG")}${p.in_port_count != null ? ` · ${p.in_port_count} in port` : p.capacity_value ? ` · Cap: ${escHtml(p.capacity_value)}` : ""}</div>`,
        { direction: "top", sticky: true, className: "tanker-tooltip" }
      );
      marker.addTo(layer);
    }
  }, [mapReady, showPorts, ports]);

  // Draw 24h AIS track for selected vessel
  useEffect(() => {
    if (!mapReady || !leafletRef.current || !trackLayerRef.current) return;
    const L = leafletRef.current;
    const layer = trackLayerRef.current;
    layer.clearLayers();

    const pts = vesselDetail?.track ?? [];
    if (pts.length > 1) {
      const latlngs = pts.map((p) => [p.latitude, p.longitude] as [number, number]);
      L.polyline(latlngs, {
        color: "#ffffff",
        weight: 2,
        opacity: 0.9,
        dashArray: "4 4",
      }).addTo(layer);
    }
  }, [mapReady, vesselDetail]);

  function handleChokepointClick(id: string) {
    setActiveChokepoint(id);
    setActiveCorridorId(null);
    if (!mapRef.current) return;
    if (id === "global") {
      mapRef.current.setView([DEFAULT_VIEW.lat, DEFAULT_VIEW.lon], DEFAULT_VIEW.zoom, { animate: true });
      return;
    }
    const cp = judgment?.chokepoints.find((c) => c.id === id) ?? data?.chokepoints.find((c) => c.id === id);
    if (cp) {
      mapRef.current.setView([cp.lat, cp.lon], cp.zoom, { animate: true });
    }
  }

  function handleCorridorClick(cor: SeaCorridor) {
    setActiveCorridorId(cor.id);
    if (mapRef.current && leafletRef.current && cor.waypoints.length > 1) {
      const bounds = leafletRef.current.latLngBounds(cor.waypoints);
      mapRef.current.fitBounds(bounds, { padding: [30, 30] });
    }
  }

  function handleSelectVesselFromTable(v: TankerVessel) {
    setSelectedId(v.vessel_id);
    if (mapRef.current) {
      mapRef.current.setView([v.latitude, v.longitude], Math.max(mapRef.current.getZoom(), 6), { animate: true });
    }
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(field === "name" || field === "destination");
    }
  }

  const marineTrafficViewportUrl = `https://www.marinetraffic.com/en/ais/home/centerx:${mapViewport.lon}/centery:${mapViewport.lat}/zoom:${mapViewport.zoom}`;

  const marineTrafficVesselUrl = selectedVessel?.mmsi
    ? `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${selectedVessel.mmsi}`
    : selectedVessel?.imo
      ? `https://www.marinetraffic.com/en/ais/details/ships/imo:${selectedVessel.imo}`
      : marineTrafficViewportUrl;

  const tankermapVesselUrl =
    vesselDetail?.detail?.url && isSafeHttpUrl(String(vesselDetail.detail.url))
      ? String(vesselDetail.detail.url)
      : selectedId
        ? `https://tankermap.com/?vessel=${selectedId}`
        : "https://tankermap.com/";

  const brent = judgment?.benchmarks.brent;
  const wti = judgment?.benchmarks.wti;
  const spread = judgment?.benchmarks.brentWtiSpread;
  const brentInr = judgment?.benchmarks.brentInrPerBbl;
  const omcAvg = judgment?.benchmarks.omcAvgChangePct;
  const tankerAvg = judgment?.benchmarks.tankerAvgChangePct;
  const verdict = judgment?.verdict;

  const regimeColor =
    (verdict?.overallScore ?? 0) >= 68
      ? "text-[var(--down)] border-[var(--down)] bg-[#1f0a0a]"
      : (verdict?.overallScore ?? 0) >= 48
        ? "text-[var(--amber)] border-[var(--amber)] bg-[#1f1606]"
        : "text-[var(--up)] border-[var(--up)] bg-[#061c0f]";

  return (
    <div className="flex flex-col h-full text-[11px] bg-[var(--panel)]">
      {/* Top Macro Oil & Maritime Judgment Strip */}
      <div className="flex flex-wrap items-center gap-3 px-2 py-1 bg-[#0b0d10] border-b border-[var(--border)] shrink-0">
        {verdict ? (
          <span className={`px-1.5 py-0.5 border font-bold text-[10px] tracking-wider ${regimeColor}`}>
            {verdict.regime} ({verdict.overallScore}/100)
          </span>
        ) : (
          <span className="font-bold text-[var(--amber)] tracking-wider">WORLD OIL MAP JUDGMENT</span>
        )}
        <span>
          BRENT{" "}
          <b className="text-[var(--text)]">{brent?.price != null ? `$${brent.price.toFixed(2)}` : "—"}</b>{" "}
          <span className={brent?.changePercent != null && brent.changePercent >= 0 ? "up" : "down"}>
            {fmtPct(brent?.changePercent)}
          </span>
        </span>
        <span>
          WTI <b className="text-[var(--text)]">{wti?.price != null ? `$${wti.price.toFixed(2)}` : "—"}</b>{" "}
          <span className={wti?.changePercent != null && wti.changePercent >= 0 ? "up" : "down"}>
            {fmtPct(wti?.changePercent)}
          </span>
        </span>
        <span>
          B-W SPREAD <b className="amber">{spread != null ? `$${spread.toFixed(2)}` : "—"}</b>
        </span>
        <span>
          INDIA LANDED <b className="amber">{brentInr != null ? `₹${brentInr.toLocaleString("en-IN")}/bbl` : "—"}</b>
        </span>
        <span>
          INDIA OMCs{" "}
          <b className={omcAvg != null && omcAvg >= 0 ? "up" : "down"}>{fmtPct(omcAvg)}</b>
        </span>
        <span>
          VLCC STOCKS{" "}
          <b className={tankerAvg != null && tankerAvg >= 0 ? "up" : "down"}>{fmtPct(tankerAvg)}</b>
        </span>
        <span className="ml-auto flex items-center gap-2 dim">
          {!aisAvailable && (
            <span className="px-1.5 py-0.5 border border-[var(--amber-dim)] text-[var(--amber)] text-[9px]">
              AIS RESTRICTED — WORLD MAP JUDGMENT ACTIVE
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              refetch();
              refetchJudgment();
            }}
            className="term-btn !py-0"
          >
            {isFetching || judgmentFetching ? "SYNCING…" : "↻ REFRESH"}
          </button>
          <a
            href={marineTrafficViewportUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sky-400 hover:text-[var(--amber)] underline"
            title="Open exact lat/lon/zoom viewport on MarineTraffic"
          >
            MarineTraffic ↗
          </a>
          <a
            href="https://tankermap.com/"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--amber-dim)] hover:text-[var(--amber)] underline"
          >
            TankerMap ↗
          </a>
        </span>
      </div>

      {/* AIS KPI, Mover Speed & World Map Layer Bar */}
      <div className="flex flex-wrap items-center gap-3 px-2 py-1 bg-[var(--panel-2)] border-b border-[var(--border)] shrink-0">
        <span className="font-bold text-[var(--amber)] tracking-wider">TANKER MOVER</span>
        <span>
          TOTAL <b className="text-[var(--text)]">{aisAvailable ? fmtNum(data?.stats.total) : "—"}</b>
        </span>
        <span>
          MOVING <b className="up">{aisAvailable ? fmtNum(data?.stats.underway) : "—"}</b>
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-full bg-[#ff9900] mr-1" />
          CRUDE <b className="amber">{aisAvailable ? fmtNum(data?.stats.crude) : "—"}</b>
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-full bg-[#38bdf8] mr-1" />
          PRODUCTS <b className="text-sky-400">{aisAvailable ? fmtNum(data?.stats.product) : "—"}</b>
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-full bg-[#00c853] mr-1" />
          LNG <b className="up">{aisAvailable ? fmtNum(data?.stats.lng) : "—"}</b>
        </span>
        <span className="flex items-center gap-1">
          <span className="dim text-[10px]">MOVER:</span>
          {([0, 1, 15, 60] as MoverSpeed[]).map((spd) => (
            <button
              key={spd}
              type="button"
              onClick={() => setMoverSpeed(spd)}
              className={`term-btn text-[10px] ${moverSpeed === spd ? "active" : ""}`}
              title={spd === 0 ? "Pause vessel dead-reckoning motion" : `Animate vessels along COG at ${spd}x speed`}
            >
              {spd === 0 ? "PAUSE" : `${spd}x`}
            </button>
          ))}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <span className="dim text-[10px] mr-1">LAYERS:</span>
          <button type="button" onClick={() => setShowCorridors((s) => !s)} className={`term-btn text-[10px] ${showCorridors ? "active" : ""}`}>
            SEA LANES {showCorridors ? "●" : "○"}
          </button>
          <button type="button" onClick={() => setShowZones((s) => !s)} className={`term-btn text-[10px] ${showZones ? "active" : ""}`}>
            RISK ZONES {showZones ? "●" : "○"}
          </button>
          <button type="button" onClick={() => setShowPorts((s) => !s)} className={`term-btn text-[10px] ${showPorts ? "active" : ""}`}>
            PORTS {showPorts ? "●" : "○"}
          </button>
          <button type="button" onClick={() => setShowSeamarks((s) => !s)} className={`term-btn text-[10px] ${showSeamarks ? "active" : ""}`}>
            SEAMARKS {showSeamarks ? "●" : "○"}
          </button>
        </span>
      </div>

      {/* Chokepoint Jump Bar (includes Black Sea 43.5, 30.6 + Live Risk + AIS count) */}
      <div className="flex flex-wrap items-center gap-1 px-2 py-1 border-b border-[var(--border)] bg-[#070707] shrink-0">
        <span className="dim text-[10px] mr-1 uppercase">Chokepoints:</span>
        <button
          type="button"
          onClick={() => handleChokepointClick("global")}
          className={`term-btn text-[10px] ${activeChokepoint === "global" ? "active" : ""}`}
        >
          GLOBAL {aisAvailable ? `(${fmtNum(data?.stats.total)})` : ""}
        </button>
        {(judgment?.chokepoints ?? data?.chokepoints ?? []).map((cp: any) => {
          const score: number | undefined = cp.riskScore;
          const count: number | null = cp.aisCount ?? cp.count ?? null;
          const dotColor =
            cp.status === "CRITICAL" ? "bg-[#ff3d3d]" : cp.status === "ELEVATED" ? "bg-[#ff9900]" : "bg-[#00c853]";
          return (
            <button
              key={cp.id}
              type="button"
              onClick={() => handleChokepointClick(cp.id)}
              className={`term-btn text-[10px] flex items-center gap-1 ${activeChokepoint === cp.id ? "active" : ""}`}
              title={cp.summary ?? ""}
            >
              {cp.status && <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor}`} />}
              <span>{cp.label}</span>
              <span className="dim">
                {count != null ? `(${count})` : score != null ? `[${score}]` : ""}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filter & View Bar */}
      <div className="flex flex-wrap items-center gap-2 px-2 py-1 border-b border-[var(--border)] bg-[var(--panel-2)] shrink-0">
        <div className="flex items-center gap-1">
          {(["all", "crude", "product", "lng"] as FleetFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFleet(f)}
              className={`term-btn text-[10px] uppercase ${fleet === f ? "active" : ""}`}
            >
              {f}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setStatus((s) => (s === "underway" ? "all" : "underway"))}
          className={`term-btn text-[10px] ${status === "underway" ? "active" : ""}`}
          title="Filter to vessels actively underway (>= 0.8 knots)"
        >
          MOVERS ONLY {status === "underway" ? "●" : "○"}
        </button>

        <select value={cargo} onChange={(e) => setCargo(e.target.value as CargoFilter)} className="text-[10px]" aria-label="Filter by cargo state">
          <option value="all">CARGO: ALL</option>
          <option value="loaded">LOADED</option>
          <option value="ballast">BALLAST</option>
        </select>

        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="text-[10px]" aria-label="Filter by navigation status">
          <option value="all">STATUS: ALL</option>
          <option value="underway">UNDERWAY</option>
          <option value="anchored">ANCHORED / MOORED</option>
        </select>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search vessel, IMO, MMSI, flag, dest…"
          className="flex-1 min-w-[140px] max-w-xs text-[10px]"
        />

        <div className="ml-auto flex items-center gap-1">
          <span className="dim text-[10px]">PANEL:</span>
          <button
            type="button"
            onClick={() => setPanelTab("judgment")}
            className={`term-btn text-[10px] ${panelTab === "judgment" ? "active" : ""}`}
          >
            WORLD JUDGMENT
          </button>
          <button
            type="button"
            onClick={() => setPanelTab("fleet")}
            className={`term-btn text-[10px] ${panelTab === "fleet" ? "active" : ""}`}
          >
            FLEET ({fmtNum(displayedVessels.length)})
          </button>
          <span className="dim text-[10px] ml-2">VIEW:</span>
          {(["split", "map", "table"] as ViewMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setViewMode(m)}
              className={`term-btn text-[10px] uppercase ${viewMode === m ? "active" : ""}`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Main Split Body */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Map Canvas Container + Directional Mover Canvas Overlay */}
        <div
          className={`relative min-h-0 bg-[#06090e] ${
            viewMode === "table"
              ? "hidden"
              : viewMode === "map"
                ? "flex-1"
                : "flex-1 min-w-[320px] border-r border-[var(--border)]"
          }`}
        >
          <div ref={mapContainerRef} className="w-full h-full" />
          <canvas
            ref={moverCanvasRef}
            className="absolute inset-0 pointer-events-none z-[420]"
            aria-label="Live tanker heading and movement overlay"
          />

          {/* Dynamic Hover Tooltip for Moving Canvas Tankers */}
          {hoverInfo && (
            <div
              className="absolute z-[520] pointer-events-none bg-[#0c0c0c]/95 border border-[var(--amber-dim)] px-2 py-1 text-[10px] leading-snug shadow-lg"
              style={{
                left: Math.min(hoverInfo.x + 12, (mapContainerRef.current?.clientWidth ?? 600) - 210),
                top: Math.max(8, hoverInfo.y - 68),
              }}
            >
              <div className="font-bold" style={{ color: FLEET_COLOR[hoverInfo.vessel.fleet] ?? "#ff9900" }}>
                {hoverInfo.vessel.name}
              </div>
              <div>
                {hoverInfo.vessel.vessel_type} · {hoverInfo.vessel.flag ?? "—"}
              </div>
              <div>
                {hoverInfo.vessel.speed_knots != null ? `${hoverInfo.vessel.speed_knots.toFixed(1)} kt` : "—"} · HDG{" "}
                {hoverInfo.vessel.cog_degrees != null ? `${Math.round(hoverInfo.vessel.cog_degrees)}°` : "—"} ·{" "}
                {(hoverInfo.vessel.cargo_state ?? "—").toUpperCase()}
              </div>
              <div className="dim">DEST: {hoverInfo.vessel.destination || "—"}</div>
            </div>
          )}

          {isLoading && (
            <div className="absolute top-2 left-12 z-[500] bg-black/80 border border-[var(--amber-dim)] px-2 py-1 amber">
              Loading World Oil Map, corridors &amp; AIS fleet…
            </div>
          )}
          {/* Map Legend */}
          <div className="absolute bottom-2 left-2 z-[450] bg-black/80 border border-[var(--border)] px-2 py-1 text-[9px] flex flex-wrap gap-2 pointer-events-none">
            <span>▲ Moving (COG)</span>
            <span>● Anchored</span>
            <span><span className="inline-block w-2 h-2 rounded-full bg-[#ff9900] mr-1" />Crude</span>
            <span><span className="inline-block w-2 h-2 rounded-full bg-[#38bdf8] mr-1" />Product</span>
            <span><span className="inline-block w-2 h-2 rounded-full bg-[#00c853] mr-1" />LNG</span>
            <span className="dim">| Lanes:</span>
            <span className="down">■ Critical</span>
            <span className="amber">■ Elevated</span>
            <span className="up">■ Normal</span>
          </div>
        </div>

        {/* Right Side: Judgment Intelligence OR Live AIS Fleet Table */}
        {viewMode !== "map" && (
          <div
            className={`flex flex-col min-h-0 overflow-hidden bg-[var(--panel)] ${
              viewMode === "table" ? "flex-1" : "w-[46%] min-w-[360px]"
            }`}
          >
            {panelTab === "judgment" ? (
              <div className="flex-1 overflow-auto p-2 space-y-2.5">
                {/* 1. Overall Maritime & India Judgment */}
                <div className="border border-[var(--border)] bg-[var(--panel-2)] p-2">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-bold amber uppercase tracking-wider">World Map Oil &amp; India Judgment</span>
                    {verdict && (
                      <span className={`px-1.5 py-0 border text-[9px] font-bold ${regimeColor}`}>
                        SCORE {verdict.overallScore}/100
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-semibold text-[var(--text)] mb-1">
                    {verdict?.indiaImpact ?? "Computing live maritime crude & OMC exposure…"}
                  </div>
                  <ul className="space-y-0.5 text-[10px] dim list-disc pl-4">
                    {(verdict?.drivers ?? []).map((d, i) => (
                      <li key={i} className="text-[var(--text)]">{d}</li>
                    ))}
                  </ul>
                </div>

                {/* 2. Clickable India Energy & Global VLCC Equity Reaction */}
                <div className="border border-[var(--border)] bg-[var(--panel-2)] p-2">
                  <div className="font-bold dim uppercase text-[10px] mb-1.5">
                    Live Equity Reaction (Click ticker to inspect in Terminal)
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {[
                      ...(judgment?.benchmarks.indiaEnergyStocks ?? []),
                      ...(judgment?.benchmarks.tankerStocks ?? []),
                    ].map((s) => (
                      <button
                        key={s.symbol}
                        type="button"
                        onClick={() => setActiveSymbol(s.symbol)}
                        className="text-left px-1.5 py-1 border border-[var(--border)] bg-[#0b0b0b] hover:border-[var(--amber)] flex items-center justify-between gap-1"
                        title={`${s.label} — click to load in Chart & Quote`}
                      >
                        <span className="font-bold text-[10px] text-[var(--text)] truncate">{s.symbol}</span>
                        <span className={`text-[10px] ${s.changePercent != null && s.changePercent >= 0 ? "up" : "down"}`}>
                          {fmtPct(s.changePercent)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 3. Chokepoint Risk Matrix */}
                <div className="border border-[var(--border)] bg-[var(--panel-2)] p-2">
                  <div className="font-bold dim uppercase text-[10px] mb-1">
                    Maritime Chokepoints (Click row to zoom map)
                  </div>
                  <div className="space-y-1">
                    {(judgment?.chokepoints ?? []).map((cp) => {
                      const badge =
                        cp.status === "CRITICAL"
                          ? "text-[var(--down)] border-[var(--down)]"
                          : cp.status === "ELEVATED"
                            ? "text-[var(--amber)] border-[var(--amber)]"
                            : "text-[var(--up)] border-[var(--up)]";
                      return (
                        <div
                          key={cp.id}
                          onClick={() => handleChokepointClick(cp.id)}
                          className={`p-1.5 border cursor-pointer hover:border-[var(--amber)] ${
                            activeChokepoint === cp.id ? "border-[var(--amber)] bg-[#191306]" : "border-[var(--border)] bg-[#090909]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-[var(--text)]">{cp.label}</span>
                            <div className="flex items-center gap-1.5">
                              {cp.disruptionHits > 0 && (
                                <span className="text-[9px] px-1 bg-[#2a0c0c] text-[var(--down)]">
                                  {cp.disruptionHits} ALERTS
                                </span>
                              )}
                              <span className={`text-[9px] px-1 border ${badge}`}>
                                {cp.status} · {cp.riskScore}
                              </span>
                            </div>
                          </div>
                          <div className="text-[10px] dim mt-0.5">{cp.summary}</div>
                          <div className="text-[9px] text-sky-400/90 mt-0.5">{cp.indiaRelevance}</div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {cp.exposedTickers.map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveSymbol(t);
                                }}
                                className="px-1 py-0 text-[9px] border border-[var(--border)] text-[var(--amber)] hover:border-[var(--amber)]"
                              >
                                {t}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 4. Global Shipping Corridors */}
                <div className="border border-[var(--border)] bg-[var(--panel-2)] p-2">
                  <div className="font-bold dim uppercase text-[10px] mb-1">
                    Global Crude Sea Corridors (Click to highlight route)
                  </div>
                  <div className="space-y-1">
                    {(judgment?.corridors ?? []).map((cor) => {
                      const col =
                        cor.status === "CRITICAL" ? "down" : cor.status === "ELEVATED" ? "amber" : "up";
                      return (
                        <div
                          key={cor.id}
                          onClick={() => handleCorridorClick(cor)}
                          className={`p-1.5 border cursor-pointer hover:border-[var(--amber)] ${
                            activeCorridorId === cor.id ? "border-[var(--amber)] bg-[#191306]" : "border-[var(--border)] bg-[#090909]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-[var(--text)]">{cor.name}</span>
                            <span className={`text-[9px] font-bold ${col}`}>
                              {cor.status} ({cor.riskScore})
                            </span>
                          </div>
                          <div className="text-[10px] dim mt-0.5">{cor.transitNote}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 5. Live Maritime Disruption Headlines */}
                <div className="border border-[var(--border)] bg-[var(--panel-2)] p-2">
                  <div className="font-bold dim uppercase text-[10px] mb-1">
                    Live Shipping &amp; Crude Route Intelligence
                  </div>
                  <div className="space-y-1">
                    {(judgment?.headlines ?? []).slice(0, 12).map((h, idx) => (
                      <div key={idx} className="border-b border-[#181818] pb-1 last:border-0">
                        <div className="flex items-start gap-1.5">
                          {h.disruption && (
                            <span className="px-1 py-0 text-[8px] bg-[#2c0d0d] text-[var(--down)] border border-[var(--down)] shrink-0 mt-0.5">
                              ALERT
                            </span>
                          )}
                          {isSafeHttpUrl(h.link) ? (
                            <a
                              href={h.link}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] text-[var(--text)] hover:text-[var(--amber)] leading-snug"
                            >
                              {h.title}
                            </a>
                          ) : (
                            <span className="text-[10px] text-[var(--text)]">{h.title}</span>
                          )}
                        </div>
                        <div className="text-[9px] dim mt-0.5 flex gap-2">
                          <span>{h.publisher}</span>
                          <span>{fmtTime(h.publishedAt)}</span>
                          {h.regions.length > 0 && (
                            <span className="amber uppercase">{h.regions.join(", ")}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Selected Vessel Telemetry Drawer */}
                {selectedId !== null && (
                  <div className="border-b border-[var(--amber-dim)] bg-[#0f0d08] p-2 shrink-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="font-bold amber truncate">
                        {selectedVessel?.name ?? vesselDetail?.detail?.name ?? `Vessel #${selectedId}`}
                        {selectedVessel?.flag ? <span className="ml-2 dim font-normal">[{selectedVessel.flag}]</span> : null}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {isSafeHttpUrl(marineTrafficVesselUrl) && (
                          <a href={marineTrafficVesselUrl} target="_blank" rel="noreferrer" className="text-[10px] text-sky-400 underline">
                            MarineTraffic ↗
                          </a>
                        )}
                        {isSafeHttpUrl(tankermapVesselUrl) && (
                          <a href={tankermapVesselUrl} target="_blank" rel="noreferrer" className="text-[10px] text-[var(--amber)] underline">
                            TankerMap ↗
                          </a>
                        )}
                        {selectedVessel?.mmsi && (
                          <a
                            href={`https://www.vesselfinder.com/vessels/details/${selectedVessel.imo ?? selectedVessel.mmsi}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] dim hover:text-[var(--text)] underline"
                          >
                            VesselFinder ↗
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedId(null)}
                          className="dim hover:text-[var(--down)] px-1"
                          title="Close vessel detail"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {detailLoading && !vesselDetail ? (
                      <div className="dim text-[10px]">Fetching IMO specs &amp; 24h AIS track…</div>
                    ) : (
                      <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 text-[10px]">
                        <div><span className="dim">IMO:</span> {vesselDetail?.detail?.imo ?? selectedVessel?.imo ?? "—"}</div>
                        <div><span className="dim">MMSI:</span> {vesselDetail?.detail?.mmsi ?? selectedVessel?.mmsi ?? "—"}</div>
                        <div><span className="dim">BUILT:</span> {vesselDetail?.detail?.built_year ?? "—"}</div>
                        <div><span className="dim">TYPE:</span> {selectedVessel?.vessel_type ?? vesselDetail?.detail?.vessel_type ?? "—"}</div>
                        <div><span className="dim">DWT:</span> {fmtNum(vesselDetail?.detail?.deadweight ?? selectedVessel?.deadweight)} t</div>
                        <div><span className="dim">SIZE:</span> {vesselDetail?.detail?.size_meters ? `${vesselDetail.detail.size_meters} m` : "—"}</div>
                        <div>
                          <span className="dim">SPD / COG:</span>{" "}
                          {selectedVessel?.speed_knots != null ? `${selectedVessel.speed_knots.toFixed(1)} kt` : "—"} /{" "}
                          {selectedVessel?.cog_degrees != null ? `${Math.round(selectedVessel.cog_degrees)}°` : "—"}
                        </div>
                        <div><span className="dim">DRAUGHT:</span> {selectedVessel?.draught_meters != null ? `${selectedVessel.draught_meters} m` : "—"}</div>
                        <div>
                          <span className="dim">CARGO:</span>{" "}
                          <span className={selectedVessel?.cargo_state === "loaded" ? "amber font-bold" : ""}>
                            {(selectedVessel?.cargo_state ?? "—").toUpperCase()}
                          </span>
                        </div>
                        <div className="col-span-2 truncate">
                          <span className="dim">DEST:</span> {selectedVessel?.destination || "—"} ({selectedVessel?.nav_status || "—"})
                        </div>
                        <div><span className="dim">TRACK PTS:</span> {vesselDetail?.track?.length ?? 0}</div>
                        <div className="col-span-3 dim">
                          OBS: {fmtTime(selectedVessel?.observed_at)} · LAT {selectedVessel ? selectedVessel.latitude.toFixed(3) : "—"} · LON {selectedVessel ? selectedVessel.longitude.toFixed(3) : "—"}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Live Fleet Table */}
                <div className="flex-1 overflow-auto min-h-0">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th onClick={() => toggleSort("name")}>Vessel {sortField === "name" ? (sortAsc ? "▲" : "▼") : ""}</th>
                        <th>Type</th>
                        <th>Flag</th>
                        <th onClick={() => toggleSort("deadweight")}>DWT {sortField === "deadweight" ? (sortAsc ? "▲" : "▼") : ""}</th>
                        <th onClick={() => toggleSort("speed_knots")}>Spd {sortField === "speed_knots" ? (sortAsc ? "▲" : "▼") : ""}</th>
                        <th>Cargo</th>
                        <th onClick={() => toggleSort("destination")}>Destination {sortField === "destination" ? (sortAsc ? "▲" : "▼") : ""}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedTableRows.map((v) => {
                        const active = v.vessel_id === selectedId;
                        const color = FLEET_COLOR[v.fleet] ?? FLEET_COLOR.other;
                        return (
                          <tr
                            key={v.vessel_id}
                            onClick={() => handleSelectVesselFromTable(v)}
                            className={active ? "bg-[#221a09]" : ""}
                          >
                            <td className="font-semibold max-w-[140px] truncate" title={v.name}>
                              <span className="inline-block w-1.5 h-1.5 rounded-full mr-1" style={{ backgroundColor: color }} />
                              {v.name}
                            </td>
                            <td className="dim text-left max-w-[90px] truncate">{v.vessel_type}</td>
                            <td className="dim">{v.flag ?? "—"}</td>
                            <td>{v.deadweight ? fmtNum(v.deadweight) : "—"}</td>
                            <td className={v.speed_knots && v.speed_knots >= 0.8 ? "up" : "dim"}>
                              {v.speed_knots != null ? v.speed_knots.toFixed(1) : "—"}
                            </td>
                            <td className={v.cargo_state === "loaded" ? "amber" : "dim"}>
                              {(v.cargo_state ?? "—").slice(0, 4).toUpperCase()}
                            </td>
                            <td className="dim max-w-[110px] truncate" title={v.destination ?? ""}>
                              {v.destination || "—"}
                            </td>
                          </tr>
                        );
                      })}
                      {sortedTableRows.length === 0 && !isLoading && (
                        <tr>
                          <td colSpan={7} className="!text-center dim py-4">
                            {aisAvailable
                              ? "No tankers match the active filters."
                              : "Live AIS vessel positions unavailable — switch to WORLD JUDGMENT tab to assess sea corridors, chokepoints, Brent/WTI & India OMCs."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
