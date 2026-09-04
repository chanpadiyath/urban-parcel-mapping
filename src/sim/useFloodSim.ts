import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BuildingCollection, ParcelCollection } from "../types";
import {
  buildElevationModel,
  computeFloodImpact,
  type ElevationModel,
  type FloodImpact,
} from "./flood";

const TICK_MS = 250;
const RISE_RATE_M_PER_S = 0.05; // demo water-rise rate
const SPEEDS = [1, 2, 5] as const;
export type SimSpeed = (typeof SPEEDS)[number];
export type SimStatus = "idle" | "running" | "paused";

export interface FloodSim {
  status: SimStatus;
  tSeconds: number;
  speed: SimSpeed;
  waterLevelM: number;
  elevation: ElevationModel;
  impact: FloodImpact;
  start: () => void;
  pause: () => void;
  reset: () => void;
  cycleSpeed: () => void;
  bumpLevel: (delta: number) => void;
}

export function useFloodSim(parcels: ParcelCollection, buildings: BuildingCollection): FloodSim {
  const elevation = useMemo(() => buildElevationModel(parcels), [parcels]);
  const buildingParcelIds = useMemo(
    () => new Set(buildings.features.map((f) => String(f.properties.parcel_id))),
    [buildings],
  );

  const baseLevel = elevation.minM - 0.25;
  const maxLevel = elevation.maxM + 1;

  const [status, setStatus] = useState<SimStatus>("idle");
  const [tSeconds, setT] = useState(0);
  const [speed, setSpeed] = useState<SimSpeed>(1);
  const [offset, setOffset] = useState(0);

  const rawLevel = baseLevel + RISE_RATE_M_PER_S * tSeconds + offset;
  const waterLevelM = Math.max(0, Math.min(maxLevel, rawLevel));
  const quantised = Math.round(waterLevelM * 20) / 20;

  const impact = useMemo(
    () => computeFloodImpact(parcels, buildingParcelIds, elevation, quantised),
    [parcels, buildingParcelIds, elevation, quantised],
  );

  const tickRef = useRef<number | null>(null);
  useEffect(() => {
    if (status !== "running") return;
    tickRef.current = window.setInterval(() => {
      setT((t) => {
        const next = t + (TICK_MS / 1000) * speed;
        return next;
      });
    }, TICK_MS);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
  }, [status, speed]);

  // stop rising once the whole area is under water
  useEffect(() => {
    if (status === "running" && rawLevel >= maxLevel) setStatus("paused");
  }, [status, rawLevel, maxLevel]);

  const start = useCallback(() => setStatus("running"), []);
  const pause = useCallback(() => setStatus((s) => (s === "running" ? "paused" : s)), []);
  const reset = useCallback(() => {
    setStatus("idle");
    setT(0);
    setOffset(0);
  }, []);
  const cycleSpeed = useCallback(
    () => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length]),
    [],
  );
  const bumpLevel = useCallback(
    (delta: number) => setOffset((o) => Math.max(-baseLevel, Math.min(maxLevel, o + delta))),
    [baseLevel, maxLevel],
  );

  return { status, tSeconds, speed, waterLevelM, elevation, impact, start, pause, reset, cycleSpeed, bumpLevel };
}
