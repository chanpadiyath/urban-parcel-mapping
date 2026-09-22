/**
 * Flood-simulation types + presentation helpers.
 *
 * The simulation itself runs in the backend (backend/app/flood.py): a rising
 * water level over REAL elevation data (Open Topo Data DEM), streamed to this
 * app over SSE (see useServerSim.ts). The water-level RISE is a fixed-rate
 * timer, not a hydrological/rainfall model — this is NOT a disaster-prediction
 * model. Nothing here computes flood impact; it only describes and formats it.
 */

export type ImpactLevel = "Low" | "Moderate" | "High" | "Severe";

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

export const EMPTY_IMPACT: FloodImpact = {
  waterLevelM: 0,
  affectedParcelIds: new Set(),
  perParcel: new Map(),
  affectedParcels: 0,
  affectedBuildings: 0,
  affectedRoadsApprox: 0,
  affectedAreaSqm: 0,
  affectedAreaPct: 0,
  criticalInfrastructure: 0,
  maxDepthM: 0,
};

/**
 * General, non-prescriptive guidance text per impact level, for the "how
 * this works" explainer. Illustrative only — this is a depth-threshold
 * heuristic over a simulated water level, not an official hazard assessment.
 * For real flood risk and emergency guidance, consult your local
 * municipal/disaster-management authority. Thresholds mirror
 * `impact_from_depth` in backend/app/flood.py.
 */
export const IMPACT_GUIDANCE: Record<ImpactLevel, { depthRange: string; guidance: string }> = {
  Low: { depthRange: "< 0.3 m", guidance: "Minor nuisance flooding. Monitor local conditions; no action typically needed." },
  Moderate: { depthRange: "0.3–1 m", guidance: "May affect ground-floor access and parked vehicles. Avoid low-lying routes; watch for updates." },
  High: { depthRange: "1–2 m", guidance: "Likely to affect ground-floor structures. Move valuables/vehicles to higher ground; follow official advisories." },
  Severe: { depthRange: "≥ 2 m", guidance: "Significant depth. Avoid the area; follow local/disaster-management authority guidance and evacuation orders." },
};

export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}
