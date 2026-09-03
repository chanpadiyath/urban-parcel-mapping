/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BASEMAP_TILE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
