import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend-only SPA. The backend (../backend, FastAPI) is a separate service;
// in dev, `/api` is proxied to it on its default port 8787 (edit below if you
// run it elsewhere locally). In production, host this as static files and set
// VITE_SIM_API to the backend's public URL (and add the frontend origin to
// the backend's CORS_ORIGINS). `base: "./"` keeps the static build sub-path
// safe.
const API_TARGET = "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    port: 5173,
    strictPort: false,
    proxy: { "/api": { target: API_TARGET, changeOrigin: true } },
  },
  preview: {
    port: 4173,
    strictPort: false,
    proxy: { "/api": { target: API_TARGET, changeOrigin: true } },
  },
});
