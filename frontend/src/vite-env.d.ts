/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BASEMAP_TILE_URL?: string;
  readonly VITE_SATELLITE_TILE_URL?: string;
  readonly VITE_DEMO_LOCATION?: string;
  readonly VITE_DEMO_CITY?: string;
  readonly VITE_DEMO_STATE?: string;
  readonly VITE_DEMO_LAT?: string;
  readonly VITE_DEMO_LON?: string;
  readonly VITE_DEMO_ZOOM?: string;
  readonly VITE_SYNC_INTERVAL_MS?: string;
  readonly VITE_SIM_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
