/**
 * Central runtime configuration. Nothing location-specific should be
 * hard-coded elsewhere — read from here. Client values come from Vite env
 * (`VITE_*`), with Chennai defaults. The data generator reads the matching
 * un-prefixed vars (`DEMO_LAT` …) in scripts/generate-demo-parcels.mjs.
 */

const env = import.meta.env as Record<string, string | undefined>;

function numEnv(key: string, fallback: number): number {
  const v = env[key];
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const DEMO = {
  location: env.VITE_DEMO_LOCATION ?? "T. Nagar, Chennai, Tamil Nadu, India",
  city: env.VITE_DEMO_CITY ?? "Chennai",
  state: env.VITE_DEMO_STATE ?? "Tamil Nadu",
  lat: numEnv("VITE_DEMO_LAT", 13.0418),
  lon: numEnv("VITE_DEMO_LON", 80.2341),
  /** Initial map zoom over the demo area. */
  zoom: numEnv("VITE_DEMO_ZOOM", 16.2),
} as const;

/** Real-time sync cadence (ms). Controlled cycle — never per-frame. */
export const SYNC_INTERVAL_MS = numEnv("VITE_SYNC_INTERVAL_MS", 8000);

/** Base map raster sources (both keyless). */
export const BASEMAPS = {
  map:
    env.VITE_BASEMAP_TILE_URL ??
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  satellite:
    env.VITE_SATELLITE_TILE_URL ??
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
} as const;

export const BASEMAP_ATTRIBUTION = {
  map: "© OpenStreetMap contributors",
  satellite: "Imagery © Esri, Maxar, Earthstar Geographics",
} as const;
