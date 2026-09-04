/**
 * Client-side deterministic FLOOD simulation for the Land Twin.
 *
 * SIMULATION / DEMO MODE — this is NOT a hydrological or disaster-prediction
 * model. There is no real terrain / DEM available, so a smooth demo elevation
 * surface is synthesised deterministically from each parcel's location
 * (gradient rising from a low "river/coast" corner + gentle noise). A parcel
 * is "affected" when the rising water level exceeds its demo elevation; depth
 * = water level − elevation. Impact metrics are computed from the real parcel
 * geometry and attributes.
 */

import type { ParcelCollection, ParcelFeature } from "../types";
import { geometryBounds } from "../geo";

const GRID_COLS = 12; // matches scripts/generate-demo-parcels.mjs

export interface ElevationModel {
  minM: number;
  maxM: number;
  at: (parcelId: string) => number;
}

function centroid(f: ParcelFeature): [number, number] {
  const b = geometryBounds(f.geometry);
  return b ? [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2] : [0, 0];
}
function seqOf(parcelId: string): number {
  const m = parcelId.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}

/** Build a demo elevation surface (metres) over the dataset extent. */
export function buildElevationModel(parcels: ParcelCollection): ElevationModel {
  const feats = parcels.features as ParcelFeature[];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of feats) {
    const [x, y] = centroid(f);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const cache = new Map<string, number>();

  const compute = (f: ParcelFeature): number => {
    const [x, y] = centroid(f);
    const u = (x - minX) / spanX; // 0 = west
    const v = (y - minY) / spanY; // 0 = south
    // low ground toward the south-west ("towards the Cooum / coast"), rising NE
    const slope = 0.55 * u + 0.55 * (1 - v);
    const noise = 0.12 * Math.sin(u * 9.1) * Math.cos(v * 7.3) + 0.06 * Math.sin(seqOf(f.properties.parcel_id) * 1.7);
    return clamp(0.3 + 6.2 * (slope + noise), 0.2, 6.5);
  };

  for (const f of feats) cache.set(f.properties.parcel_id, compute(f));
  const vals = [...cache.values()];
  return {
    minM: Math.min(...vals),
    maxM: Math.max(...vals),
    at: (id) => cache.get(id) ?? 3,
  };
}

export type ImpactLevel = "Low" | "Moderate" | "High" | "Severe";
export function impactFromDepth(depth: number): ImpactLevel {
  if (depth < 0.3) return "Low";
  if (depth < 1) return "Moderate";
  if (depth < 2) return "High";
  return "Severe";
}

export interface ParcelFloodState {
  parcelId: string;
  elevationM: number;
  depthM: number;
  impact: ImpactLevel;
}

export interface FloodImpact {
  waterLevelM: number;
  affectedParcelIds: Set<string>;
  perParcel: Map<string, ParcelFloodState>;
  affectedParcels: number;
  affectedBuildings: number;
  affectedRoadsApprox: number;
  affectedAreaSqm: number;
  affectedAreaPct: number;
  criticalInfrastructure: number;
  maxDepthM: number;
}

const CRITICAL_USES = new Set(["Institutional", "Public/Semi-Public"]);

export function computeFloodImpact(
  parcels: ParcelCollection,
  buildingParcelIds: Set<string>,
  elev: ElevationModel,
  waterLevelM: number,
): FloodImpact {
  const feats = parcels.features as ParcelFeature[];
  const perParcel = new Map<string, ParcelFloodState>();
  const affected = new Set<string>();
  const rows = new Set<number>();
  const cols = new Set<number>();
  let area = 0, totalArea = 0, critical = 0, maxDepth = 0, buildings = 0;

  for (const f of feats) {
    const id = f.properties.parcel_id;
    const e = elev.at(id);
    const a = typeof f.properties.area_sqm === "number" ? f.properties.area_sqm : 0;
    totalArea += a;
    const depth = waterLevelM - e;
    if (depth > 0) {
      affected.add(id);
      perParcel.set(id, { parcelId: id, elevationM: e, depthM: depth, impact: impactFromDepth(depth) });
      area += a;
      if (depth > maxDepth) maxDepth = depth;
      if (CRITICAL_USES.has(String(f.properties.land_use))) critical += 1;
      if (buildingParcelIds.has(id)) buildings += 1;
      const s = seqOf(id) - 1;
      if (s >= 0) {
        rows.add(Math.floor(s / GRID_COLS));
        cols.add(s % GRID_COLS);
      }
    }
  }

  return {
    waterLevelM,
    affectedParcelIds: affected,
    perParcel,
    affectedParcels: affected.size,
    affectedBuildings: buildings,
    // grid roads bordering the wetted area (approximate, geometry-derived)
    affectedRoadsApprox: rows.size + cols.size,
    affectedAreaSqm: area,
    affectedAreaPct: totalArea > 0 ? (area / totalArea) * 100 : 0,
    criticalInfrastructure: critical,
    maxDepthM: maxDepth,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}
