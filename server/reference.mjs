/**
 * Reference-data provider: real OpenStreetMap features for the demo area,
 * fetched from the Overpass API and cached. This is the closest lawful,
 * automatable "ground truth" available — India has no public cadastral
 * parcel API (state land-record portals are CAPTCHA-gated, per-record web
 * forms). OSM is community data: good for building footprints / roads /
 * land-use, NOT for ownership or legal boundaries.
 */

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = resolve(__dirname, "data/osm-reference.json"); // committed
const CACHE = resolve(__dirname, ".cache/osm-reference.json"); // runtime, gitignored
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const OVERPASS_ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
];
const UA = "UrbanParcelIntelligence/0.1 (land-twin cross-check)";

function bboxOf(parcels) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (c) => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      minX = Math.min(minX, c[0]); minY = Math.min(minY, c[1]);
      maxX = Math.max(maxX, c[0]); maxY = Math.max(maxY, c[1]);
    } else if (Array.isArray(c)) c.forEach(visit);
  };
  for (const f of parcels.features) visit(f.geometry.coordinates);
  const mx = (maxX - minX) * 0.15 + 0.0006;
  const my = (maxY - minY) * 0.15 + 0.0006;
  return [minY - my, minX - mx, maxY + my, maxX + mx]; // S,W,N,E for Overpass
}

function overpassToGeoJSON(raw) {
  const feats = [];
  for (const el of raw.elements ?? []) {
    if (el.type !== "way" || !el.geometry?.length) continue;
    const coords = el.geometry.map((p) => [p.lon, p.lat]);
    const t = el.tags ?? {};
    let kind = null;
    if (t.building) kind = "building";
    else if (t.landuse) kind = "landuse";
    else if (t.highway) kind = "highway";
    if (!kind) continue;
    if (kind === "highway") {
      feats.push({
        type: "Feature",
        id: `osm-way-${el.id}`,
        geometry: { type: "LineString", coordinates: coords },
        properties: { osm_kind: "highway", osm_id: el.id, highway: t.highway, name: t.name ?? null },
      });
    } else {
      const ring = coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1]
        ? coords
        : [...coords, coords[0]];
      feats.push({
        type: "Feature",
        id: `osm-way-${el.id}`,
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: {
          osm_kind: kind,
          osm_id: el.id,
          building: kind === "building" ? (t.building ?? "yes") : undefined,
          landuse: kind === "landuse" ? t.landuse : undefined,
          name: t.name ?? null,
          levels: t["building:levels"] ? Number(t["building:levels"]) : undefined,
        },
      });
    }
  }
  return { type: "FeatureCollection", features: feats };
}

async function fetchOverpass(bbox) {
  const [s, w, n, e] = bbox;
  const ql =
    `[out:json][timeout:90];(` +
    `way["building"](${s},${w},${n},${e});` +
    `way["landuse"](${s},${w},${n},${e});` +
    `way["highway"](${s},${w},${n},${e});` +
    `);out geom;`;
  let lastErr = "no endpoints tried";
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(`${ep}?data=${encodeURIComponent(ql)}`, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) { lastErr = `${ep}: HTTP ${res.status}`; continue; }
      const raw = await res.json();
      if (!raw.elements?.length) { lastErr = `${ep}: empty`; continue; }
      const fc = overpassToGeoJSON(raw);
      fc.meta = {
        source: "OpenStreetMap via Overpass",
        endpoint: ep,
        fetched_at: new Date().toISOString(),
        bbox: { south: s, west: w, north: n, east: e },
        counts: {
          building: fc.features.filter((f) => f.properties.osm_kind === "building").length,
          landuse: fc.features.filter((f) => f.properties.osm_kind === "landuse").length,
          highway: fc.features.filter((f) => f.properties.osm_kind === "highway").length,
        },
        disclaimer:
          "OpenStreetMap community data. Not an official cadastral / land-record source. " +
          "Coverage and accuracy vary; no ownership or legal-boundary information.",
      };
      return fc;
    } catch (err) {
      lastErr = `${ep}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  throw new Error(`Overpass unreachable — ${lastErr}`);
}

export class ReferenceStore {
  constructor(parcels) {
    this.bbox = bboxOf(parcels);
    this.fc = null;
    this.state = "empty"; // empty | snapshot | cache | live | error
    this.error = null;
    this.loadedAt = null;
  }

  async init() {
    // 1. runtime cache (fresh?)  2. committed snapshot  3. background refresh
    try {
      const st = await stat(CACHE);
      if (Date.now() - st.mtimeMs < CACHE_TTL_MS) {
        this.fc = JSON.parse(await readFile(CACHE, "utf8"));
        this.state = "cache";
        this.loadedAt = st.mtime.toISOString();
      }
    } catch { /* no cache */ }
    if (!this.fc) {
      try {
        this.fc = JSON.parse(await readFile(SNAPSHOT, "utf8"));
        this.state = "snapshot";
        this.loadedAt = this.fc.meta?.fetched_at ?? null;
      } catch { /* no snapshot */ }
    }
    // try to get something live, but never block startup on it
    this.refresh().catch(() => {});
    return this;
  }

  async refresh() {
    try {
      const fc = await fetchOverpass(this.bbox);
      this.fc = fc;
      this.state = "live";
      this.error = null;
      this.loadedAt = fc.meta.fetched_at;
      await mkdir(dirname(CACHE), { recursive: true });
      await writeFile(CACHE, JSON.stringify(fc));
      return fc;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      if (!this.fc) this.state = "error";
      throw err;
    }
  }

  status() {
    return {
      state: this.state,
      source: this.fc?.meta?.source ?? null,
      endpoint: this.fc?.meta?.endpoint ?? null,
      loaded_at: this.loadedAt,
      counts: this.fc?.meta?.counts ?? null,
      error: this.error,
      note: "OpenStreetMap community data — not official cadastral. India has no public parcel API.",
    };
  }
}
