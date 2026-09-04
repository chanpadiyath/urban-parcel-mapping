import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// SPA + an optional real-time simulation backend (server/, default port 8787).
// `/api` is proxied to that backend in dev; if it isn't running, the app falls
// back to its client-side simulation. `base: "./"` keeps the static build
// sub-path safe. Override the port with SIM_PORT for `npm run server` only.
const SIM_TARGET = "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    port: 5173,
    strictPort: false,
    proxy: { "/api": { target: SIM_TARGET, changeOrigin: true } },
  },
  preview: {
    port: 4173,
    strictPort: false,
    proxy: { "/api": { target: SIM_TARGET, changeOrigin: true } },
  },
});
