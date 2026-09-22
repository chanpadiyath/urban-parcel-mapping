import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FloodImpact, ImpactLevel } from "./flood";

const API = (import.meta.env.VITE_SIM_API as string | undefined) ?? "/api";
const CONNECT_GRACE_MS = 3500;

export interface ServerSnapshot {
  source: "server";
  status: "idle" | "running" | "paused";
  simTimeSec: number;
  speed: 1 | 2 | 5;
  waterLevelM: number;
  levelOffsetM: number;
  elevMin: number;
  elevMax: number;
  elevSource: string;
  maxLevelM: number;
  totalParcels: number;
  totalAreaSqm: number;
  updatedAt: number;
  impact: {
    parcelIds: string[];
    perParcel: Record<string, { depthM: number; elevationM: number; impact: ImpactLevel }>;
    affectedParcels: number;
    affectedBuildings: number;
    affectedRoadsApprox: number;
    affectedAreaSqm: number;
    affectedAreaPct: number;
    criticalInfrastructure: number;
    maxDepthM: number;
  };
}

export interface ServerSim {
  connected: boolean;
  snapshot: ServerSnapshot | null;
  impact: FloodImpact | null;
  start: () => void;
  pause: () => void;
  reset: () => void;
  cycleSpeed: () => void;
  bumpLevel: (deltaM: number) => void;
}

function toImpact(s: ServerSnapshot): FloodImpact {
  const perParcel = new Map(
    Object.entries(s.impact.perParcel).map(([id, v]) => [
      id,
      { parcelId: id, elevationM: v.elevationM, depthM: v.depthM, impact: v.impact },
    ]),
  );
  return {
    waterLevelM: s.waterLevelM,
    affectedParcelIds: new Set(s.impact.parcelIds),
    perParcel,
    affectedParcels: s.impact.affectedParcels,
    affectedBuildings: s.impact.affectedBuildings,
    affectedRoadsApprox: s.impact.affectedRoadsApprox,
    affectedAreaSqm: s.impact.affectedAreaSqm,
    affectedAreaPct: s.impact.affectedAreaPct,
    criticalInfrastructure: s.impact.criticalInfrastructure,
    maxDepthM: s.impact.maxDepthM,
  };
}

export function useServerSim(): ServerSim {
  const [snapshot, setSnapshot] = useState<ServerSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    let closed = false;
    let es: EventSource;
    try {
      es = new EventSource(`${API}/simulation/stream`);
    } catch {
      return;
    }
    esRef.current = es;
    const onState = (ev: MessageEvent) => {
      if (closed) return;
      try {
        setSnapshot(JSON.parse(ev.data) as ServerSnapshot);
        setConnected(true);
      } catch {
        /* ignore malformed frame */
      }
    };
    es.addEventListener("state", onState as EventListener);
    es.onerror = () => {
      // EventSource retries on its own; only flip to "disconnected" so the
      // page can fall back. If it reconnects, onState will flip us back.
      setConnected(false);
    };
    const grace = window.setTimeout(() => {
      if (!closed && esRef.current && es.readyState !== EventSource.OPEN) setConnected(false);
    }, CONNECT_GRACE_MS);

    return () => {
      closed = true;
      window.clearTimeout(grace);
      es.removeEventListener("state", onState as EventListener);
      es.close();
      esRef.current = null;
    };
  }, []);

  const post = useCallback((action: string, body?: unknown) => {
    fetch(`${API}/simulation/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
      .then((r) => r.json())
      .then((snap) => setSnapshot(snap as ServerSnapshot))
      .catch(() => {
        /* control failed — page will show fallback state */
      });
  }, []);

  const impact = useMemo(() => (snapshot ? toImpact(snapshot) : null), [snapshot]);

  return {
    connected: connected && snapshot != null,
    snapshot,
    impact,
    start: useCallback(() => post("start"), [post]),
    pause: useCallback(() => post("pause"), [post]),
    reset: useCallback(() => post("reset"), [post]),
    cycleSpeed: useCallback(() => post("flood", { cycleSpeed: true }), [post]),
    bumpLevel: useCallback((deltaM: number) => post("flood", { levelDeltaM: deltaM }), [post]),
  };
}
