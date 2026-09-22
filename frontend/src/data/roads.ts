import type { Feature, FeatureCollection, LineString } from "geojson";

export interface RoadProperties {
  osm_kind: "highway";
  osm_id: number;
  highway?: string;
  name?: string | null;
}
export type RoadFeature = Feature<LineString, RoadProperties>;
export type RoadCollection = FeatureCollection<LineString, RoadProperties>;

const SIM_API = (import.meta.env.VITE_SIM_API as string | undefined) ?? "/api";

export const EMPTY_ROADS: RoadCollection = { type: "FeatureCollection", features: [] };

/** Real OpenStreetMap road geometry (server/reference.mjs). Empty if the backend isn't reachable. */
export async function fetchRoads(): Promise<RoadCollection> {
  const res = await fetch(`${SIM_API}/reference/roads`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as RoadCollection;
}
