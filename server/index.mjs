/**
 * Real-time simulation backend — zero runtime dependencies (node:http only).
 *
 *   GET  /api/health
 *   GET  /api/simulation/state             -> current snapshot (JSON)
 *   GET  /api/simulation/stream            -> Server-Sent Events, snapshot on every tick
 *   POST /api/simulation/start|pause|reset
 *   POST /api/simulation/flood             body: { speed?: 1|2|5, levelDeltaM?: number, cycleSpeed?: true }
 *
 * In production it also serves the built SPA from ../dist (and ../public).
 * If this server is not running, the frontend falls back to its client-side
 * simulation automatically.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { createEngine } from "./flood-engine.mjs";
import { ReferenceStore } from "./reference.mjs";
import { reconcile } from "./reconcile.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SIM_PORT ?? 8787);
const DIST = resolve(__dirname, "../dist");
const PUBLIC = resolve(__dirname, "../public");

const engine = createEngine();
const refStore = new ReferenceStore(engine.parcels);
let reconcileCache = null; // { at, refLoadedAt, result }

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function sendJson(res, code, obj) {
  cors(res);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { try { res(b ? JSON.parse(b) : {}); } catch { res({}); } });
    req.on("error", () => res({}));
  });
}

async function serveStatic(req, res, pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  for (const root of [DIST, PUBLIC]) {
    const file = join(root, rel === "/" || rel === "" ? "index.html" : rel);
    if (!file.startsWith(root)) continue;
    try {
      const s = await stat(file);
      if (s.isFile()) {
        const body = await readFile(file);
        res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
        res.end(body);
        return true;
      }
    } catch { /* try next root */ }
  }
  // SPA fallback
  try {
    const body = await readFile(join(DIST, "index.html"));
    res.writeHead(200, { "Content-Type": MIME[".html"] });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); res.end(); return; }

  if (p === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      listeners: engine.listenerCount,
      status: engine.status,
      reference: refStore.state,
    });
  }

  if (p === "/api/simulation/state") {
    return sendJson(res, 200, engine.snapshot());
  }

  // --- reference data (real OpenStreetMap) ---
  if (p === "/api/reference/status") {
    return sendJson(res, 200, refStore.status());
  }
  if (p === "/api/reference/osm") {
    if (!refStore.fc) return sendJson(res, 503, { error: "reference not loaded", status: refStore.status() });
    cors(res);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify(refStore.fc));
  }
  if (p === "/api/reference/refresh" && req.method === "POST") {
    try {
      await refStore.refresh();
      reconcileCache = null;
      return sendJson(res, 200, refStore.status());
    } catch (err) {
      return sendJson(res, 502, { error: String(err && err.message || err), status: refStore.status() });
    }
  }

  // --- reconciliation: our synthetic parcels vs OSM ---
  if (p === "/api/reconcile") {
    if (!refStore.fc) return sendJson(res, 503, { error: "reference not loaded", status: refStore.status() });
    const refAt = refStore.fc.meta?.fetched_at ?? refStore.loadedAt;
    if (!reconcileCache || reconcileCache.refLoadedAt !== refAt) {
      reconcileCache = { at: Date.now(), refLoadedAt: refAt, result: reconcile(engine.parcels, refStore.fc) };
    }
    return sendJson(res, 200, { ...reconcileCache.result, reference_state: refStore.state });
  }

  if (p === "/api/simulation/stream") {
    cors(res);
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 3000\n\n");
    const send = (snap) => {
      res.write(`event: state\ndata: ${JSON.stringify(snap)}\n\n`);
    };
    const off = engine.addListener(send);
    const ka = setInterval(() => res.write(": keep-alive\n\n"), 15000);
    ka.unref?.();
    req.on("close", () => { clearInterval(ka); off(); });
    return;
  }

  if (p.startsWith("/api/simulation/") && req.method === "POST") {
    const action = p.slice("/api/simulation/".length);
    const body = await readBody(req);
    switch (action) {
      case "start": engine.start(); break;
      case "pause": engine.pause(); break;
      case "reset": engine.reset(); break;
      case "flood":
        if (body.cycleSpeed) engine.cycleSpeed();
        if (body.speed != null) engine.setSpeed(body.speed);
        if (body.levelDeltaM != null) engine.bumpLevel(body.levelDeltaM);
        break;
      default:
        return sendJson(res, 404, { error: `unknown action '${action}'` });
    }
    return sendJson(res, 200, engine.snapshot());
  }

  if (p.startsWith("/api/")) return sendJson(res, 404, { error: "not found" });

  // static / SPA
  if (req.method === "GET") {
    if (await serveStatic(req, res, p)) return;
  }
  sendJson(res, 404, { error: "not found" });
});

refStore.init().then(() => {
  const c = refStore.fc?.meta?.counts;
  console.log(
    `[sim-backend] reference: ${refStore.state}` +
      (c ? ` (${c.building} buildings, ${c.landuse} land-use, ${c.highway} roads from OSM)` : ""),
  );
});

server.listen(PORT, () => {
  console.log(`[sim-backend] listening on http://localhost:${PORT}`);
  console.log(`[sim-backend] ${engine.rows.length} parcels · elevation ${engine.elevMin.toFixed(2)}–${engine.elevMax.toFixed(2)} m`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { engine.dispose(); server.close(() => process.exit(0)); });
}
