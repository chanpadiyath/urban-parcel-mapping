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

const SIM_API = (import.meta.env.VITE_SIM_API as string | undefined) ?? "/api";

async function fetchJson<T>(url: string, timeoutMs?: number): Promise<T> {
  const res = await fetch(url, timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : undefined);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

/** Synthetic Indian-urban demonstration dataset, served by the backend (/api/demo/*). */
export const demoDataProvider: LandDataProvider = {
  id: "demo",
  label: "Demonstration dataset (synthetic)",
  kind: "demo",
  isAvailable: async () => true,
  getParcels: () => fetchJson<ParcelCollection>(`${SIM_API}/demo/parcels`),
  getBuildings: () => fetchJson<BuildingCollection>(`${SIM_API}/demo/buildings`),
  describe: () => ({
    id: "demo",
    label: "Demonstration dataset",
    kind: "demo",
    state: "demo",
    detail: "144 synthetic parcels + estimated buildings, T. Nagar, Chennai.",
  }),
};

/**
 * LIVE parcels derived from real OpenStreetMap building footprints, served by
 * the simulation backend (`/api/parcels`). Real geometry / area / land-use /
 * roads; fields with no public source (ownership, survey no, encroachment)
 * are absent, not faked. Available only when the backend is reachable.
 */
interface OsmParcelsResponse {
  parcels: ParcelCollection;
  buildings: BuildingCollection;
  meta: { parcel_count: number; attribute_coverage: Record<string, number>; fetched_at: string | null };
}
let osmCache: OsmParcelsResponse | null = null;
let osmFromSnapshot = false;

async function loadOsm(): Promise<OsmParcelsResponse> {
  try {
    osmFromSnapshot = false;
    return await fetchJson<OsmParcelsResponse>(`${SIM_API}/parcels`, 6000);
  } catch {
    osmFromSnapshot = true;
    return await fetchJson<OsmParcelsResponse>("/data/osm-parcels.json", 6000);
  }
}

export const osmLiveProvider: LandDataProvider = {
  id: "osm-live",
  label: "OpenStreetMap — live building footprints",
  kind: "geospatial",
  isAvailable: async () => {
    try {
      osmCache = await loadOsm();
      return (osmCache?.parcels?.features?.length ?? 0) > 0;
    } catch {
      osmCache = null;
      return false;
    }
  },
  getParcels: async () => {
    if (osmCache) return osmCache.parcels;
    osmCache = await loadOsm();
    return osmCache.parcels;
  },
  getBuildings: async () => {
    if (osmCache) return osmCache.buildings;
    osmCache = await loadOsm();
    return osmCache.buildings;
  },
  describe: () => ({
    id: "osm-live",
    label: "OpenStreetMap — live footprints",
    kind: "geospatial",
    state: osmCache ? "live" : "unavailable",
    detail: osmCache
      ? `${osmCache.meta.parcel_count} real building footprints · land-use tagged on ${osmCache.meta.attribute_coverage.land_use_pct ?? 0}% · via Overpass${osmFromSnapshot ? " · bundled snapshot (backend waking up)" : ""}`
      : "Backend /api/parcels not reachable — falls back to the synthetic dataset.",
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
/**
 * Real current + forecast precipitation (Open-Meteo, keyless). Only reports
 * availability here — the actual data is fetched where it's used
 * (`src/sim/useWeather.ts`, Terrain Mapping page), since this provider's
 * `LandDataProvider` shape is parcels/buildings-oriented and weather isn't.
 */
let weatherLastOk: string | null = null;
export const weatherProvider: LandDataProvider = {
  id: "weather",
  label: "Weather / flood-risk feed",
  kind: "weather",
  isAvailable: async () => {
    try {
      const res = await fetch("https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0&current=precipitation", {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) weatherLastOk = new Date().toISOString();
      return res.ok;
    } catch {
      return false;
    }
  },
  describe: () => ({
    id: "weather",
    label: "Weather / flood-risk feed",
    kind: "weather",
    state: weatherLastOk ? "live" : "unavailable",
    detail: weatherLastOk
      ? `Real current + 3-day precipitation forecast (Open-Meteo, keyless) — shown on the Terrain Mapping page.`
      : "Open-Meteo (keyless) not reachable right now.",
  }),
};

export const ALL_PROVIDERS: LandDataProvider[] = [
  officialLandProvider,
  osmLiveProvider,
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

  // MODE is about PARCEL data provenance — only count a source toward "live"
  // here if it can actually serve parcels. A live weather/imagery source is
  // real and shown as such in the sources list, but doesn't by itself make
  // the parcel data any less synthetic, so it must not upgrade the mode.
  const anyLive = sources.some((s) => {
    if (s.state !== "live" || s.kind === "demo") return false;
    return !!ALL_PROVIDERS.find((p) => p.id === s.id)?.getParcels;
  });
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
