/**
 * Land data abstraction. The UI never talks to a specific API directly — it
 * asks `resolveDataStack()` which providers are available and uses the best
 * one, falling back all the way to bundled demonstration data.
 *
 * Reality in this build: no official Indian land-record API, satellite feed,
 * or weather API is wired up (there is no lawful public endpoint configured),
 * so those providers report `unavailable` and the app runs in MODE C (demo).
 * The interfaces exist so a real source can be dropped in without touching
 * the UI.
 */

import type { BuildingCollection, ParcelCollection } from "../types";

export type OperationalMode = "A" | "B" | "C";
export type SourceState = "live" | "cached" | "demo" | "unavailable";
export type ProviderKind = "official" | "geospatial" | "imagery" | "weather" | "cache" | "demo";

export interface SourceStatus {
  id: string;
  label: string;
  kind: ProviderKind;
  state: SourceState;
  detail: string;
}

export interface LandDataProvider {
  id: string;
  label: string;
  kind: ProviderKind;
  /** Cheap check — is this source reachable/configured right now? */
  isAvailable(): Promise<boolean>;
  getParcels?(): Promise<ParcelCollection>;
  getBuildings?(): Promise<BuildingCollection>;
  describe(): SourceStatus;
}

const BASE = import.meta.env.BASE_URL;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

/** Bundled synthetic Indian-urban dataset. Always available. */
export const demoDataProvider: LandDataProvider = {
  id: "demo",
  label: "Demonstration dataset (synthetic)",
  kind: "demo",
  isAvailable: async () => true,
  getParcels: () => fetchJson<ParcelCollection>(`${BASE}demo-parcels.geojson`),
  getBuildings: () => fetchJson<BuildingCollection>(`${BASE}demo-buildings.geojson`),
  describe: () => ({
    id: "demo",
    label: "Demonstration dataset",
    kind: "demo",
    state: "demo",
    detail: "144 synthetic parcels + estimated buildings, T. Nagar, Chennai.",
  }),
};

/** Configure with an endpoint + auth to make it real. */
function stubProvider(
  id: string,
  label: string,
  kind: ProviderKind,
  detail: string,
): LandDataProvider {
  return {
    id,
    label,
    kind,
    isAvailable: async () => false,
    describe: () => ({ id, label, kind, state: "unavailable", detail }),
  };
}

export const officialLandProvider = stubProvider(
  "official",
  "State land-record API",
  "official",
  "No authorised endpoint configured. Integrate a state cadastral / land-record API here.",
);
export const openMapProvider = stubProvider(
  "osm-features",
  "OpenStreetMap feature extraction",
  "geospatial",
  "Vector feature extraction (roads / water / buildings) not wired up in this build.",
);
export const satelliteProvider = stubProvider(
  "imagery",
  "Satellite imagery + change detection",
  "imagery",
  "Esri World Imagery is available as a base layer; automated change detection is not configured.",
);
export const weatherProvider = stubProvider(
  "weather",
  "Weather / flood-risk feed",
  "weather",
  "No weather API key configured.",
);

export const ALL_PROVIDERS: LandDataProvider[] = [
  officialLandProvider,
  openMapProvider,
  satelliteProvider,
  weatherProvider,
  demoDataProvider,
];

export interface DataStack {
  mode: OperationalMode;
  modeLabel: string;
  parcels: ParcelCollection;
  buildings: BuildingCollection;
  activeSourceId: string;
  sources: SourceStatus[];
}

const MODE_LABEL: Record<OperationalMode, string> = {
  A: "Full live",
  B: "Hybrid (partial live + cached)",
  C: "Demonstration",
};

/**
 * Try providers best-first, land on whichever can actually serve parcels.
 * With only the demo provider available this resolves to MODE C.
 */
export async function resolveDataStack(): Promise<DataStack> {
  const sources: SourceStatus[] = [];
  let served: { id: string; parcels: ParcelCollection; buildings: BuildingCollection } | null = null;

  for (const provider of ALL_PROVIDERS) {
    let available = false;
    try {
      available = await provider.isAvailable();
    } catch {
      available = false;
    }

    if (available && provider.getParcels && !served) {
      try {
        const parcels = await provider.getParcels();
        const buildings = provider.getBuildings
          ? await provider.getBuildings()
          : ({ type: "FeatureCollection", features: [] } as BuildingCollection);
        served = { id: provider.id, parcels, buildings };
        sources.push({ ...provider.describe(), state: provider.kind === "demo" ? "demo" : "live" });
        continue;
      } catch (err) {
        sources.push({
          ...provider.describe(),
          state: "unavailable",
          detail: `Reachable but failed to load: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }
    }
    sources.push(provider.describe());
  }

  if (!served) {
    // last-ditch: demo provider directly
    const parcels = await demoDataProvider.getParcels!();
    const buildings = await demoDataProvider.getBuildings!();
    served = { id: "demo", parcels, buildings };
  }

  const anyLive = sources.some((s) => s.state === "live" && s.kind !== "demo");
  const servedIsDemo = served.id === "demo";
  const mode: OperationalMode = servedIsDemo && !anyLive ? "C" : anyLive ? "B" : "C";

  return {
    mode,
    modeLabel: MODE_LABEL[mode],
    parcels: served.parcels,
    buildings: served.buildings,
    activeSourceId: served.id,
    sources,
  };
}
