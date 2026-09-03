import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static SPA. No backend. `base: "./"` keeps the production build hostable
// from any sub-path (plain static hosting).
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    port: 5173,
    strictPort: false,
  },
  preview: {
    port: 4173,
    strictPort: false,
  },
});
