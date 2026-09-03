/**
 * generate-demo-parcels.mjs
 * -------------------------------------------------------------------------
 * Produces SYNTHETIC demo parcel data for the Urban Parcel Mapping prototype.
 * There is no real cadastral source behind this file. See DATA.md.
 *
 * Output: public/demo-parcels.geojson  (GeoJSON FeatureCollection, EPSG:4326)
 * Re-runnable: `npm run gen:data` (also runs automatically before dev/build).
 *
 * Geometry: a regular grid of rectangular parcels separated by road gaps,
 * placed around a fictional town centre ("City of Demoville"). Parcel
 * dimensions are defined in metres and converted to degrees with a local
 * metres-per-degree approximation.
 *
 * Areas are computed geodesically (spherical excess), never from raw degrees.
 * All non-geometric attribute values are deterministic so the file is stable
 * across regenerations (only the metadata timestamp changes).
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "../public/demo-parcels.geojson");

// --- Configuration -----------------------------------------------------

// Fictional town centre. Arbitrary land near Portland, OR — corresponds to no
// real property boundaries.
const CENTER_LNG = -122.676;
const CENTER_LAT = 45.523;

const COLS = 10;
const ROWS = 10;
const PARCEL_W_M = 40;
const PARCEL_H_M = 60;
const ROAD_GAP_M = 12;

const DATA_SOURCE = "SYNTHETIC DEMO DATA — not real parcels";
const JURISDICTION = "City of Demoville (fictional)";
const LAST_UPDATED = "2026-09-01";

// zoning code -> land-use class + indicative assessed rate (demo $/m²)
const ZONING = [
  { code: "R-1", landUse: "Residential", rate: 185 },
  { code: "R-2", landUse: "Residential", rate: 205 },
  { code: "C-1", landUse: "Commercial", rate: 320 },
  { code: "C-2", landUse: "Commercial", rate: 360 },
  { code: "MU", landUse: "Mixed Use", rate: 270 },
  { code: "M-1", landUse: "Industrial", rate: 135 },
  { code: "OS", landUse: "Parks / Open Space", rate: 12 },
  { code: "CF", landUse: "Civic / Institutional", rate: 95 },
];

const STATUSES = [
  "Active",
  "Active",
  "Active",
  "Active",
  "Pending Review",
  "Exempt",
  "Subdivision Proposed",
];

const STREET_NAMES = [
  "Alder St",
  "Birch Ave",
  "Cedar Way",
  "Douglas Blvd",
  "Elm Ct",
  "Fir Loop",
  "Grove Pl",
  "Hazel Row",
  "Ironwood Dr",
  "Juniper Ln",
];

// --- Geo helpers -----------------------------------------------------

const EARTH_RADIUS_M = 6371008.8;
const DEG2RAD = Math.PI / 180;
const metresPerDegLat = () => 111320;
const metresPerDegLng = (atLat) => 111320 * Math.cos(atLat * DEG2RAD);

/** Geodesic area (m²) of a closed [lng,lat] ring via spherical excess. */
function ringAreaSqM(ring) {
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    total +=
      (lng2 * DEG2RAD - lng1 * DEG2RAD) *
      (2 + Math.sin(lat1 * DEG2RAD) + Math.sin(lat2 * DEG2RAD));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

// Deterministic 0..1 hash so demo values are stable between runs.
function unit(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// --- Build features -------------------------------------------------

const dLat = (m) => m / metresPerDegLat();
const dLng = (m, atLat) => m / metresPerDegLng(atLat);

const stepXm = PARCEL_W_M + ROAD_GAP_M;
const stepYm = PARCEL_H_M + ROAD_GAP_M;
const gridWm = COLS * stepXm - ROAD_GAP_M;
const gridHm = ROWS * stepYm - ROAD_GAP_M;

const originLng = CENTER_LNG - dLng(gridWm / 2, CENTER_LAT);
const originLat = CENTER_LAT - dLat(gridHm / 2);

const features = [];
let seq = 0;

for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    seq += 1;
    const parcelId = `DEM-${String(seq).padStart(4, "0")}`;

    const west = originLng + dLng(col * stepXm, CENTER_LAT);
    const east = west + dLng(PARCEL_W_M, CENTER_LAT);
    const south = originLat + dLat(row * stepYm);
    const north = south + dLat(PARCEL_H_M);

    // Exterior ring: counter-clockwise (RFC 7946 right-hand rule), closed.
    const ring = [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ];

    const zoning = ZONING[(row * 3 + col * 5 + Math.floor(row / 2)) % ZONING.length];
    const areaSqM = ringAreaSqM(ring);
    const status =
      zoning.code === "CF"
        ? "Exempt"
        : STATUSES[Math.floor(unit(seq) * STATUSES.length)];

    const assessedValue =
      status === "Exempt"
        ? 0
        : Math.round((zoning.rate * areaSqM * (0.85 + unit(seq * 7) * 0.4)) / 1000) *
          1000;

    const houseNumber = 100 + row * 100 + col * 2;

    features.push({
      type: "Feature",
      id: parcelId,
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {
        parcel_id: parcelId,
        address: `${houseNumber} ${STREET_NAMES[row % STREET_NAMES.length]}`,
        land_use: zoning.landUse,
        zoning: zoning.code,
        status,
        area_sqm: Math.round(areaSqM * 10) / 10,
        area_acres: Math.round((areaSqM / 4046.8564224) * 1000) / 1000,
        assessed_value_usd: assessedValue,
        owner: "City of Demoville (synthetic — no personal data)",
        jurisdiction: JURISDICTION,
        last_updated: LAST_UPDATED,
        data_source: DATA_SOURCE,
      },
    });
  }
}

const collection = {
  type: "FeatureCollection",
  name: "demo-parcels",
  crs: {
    type: "name",
    properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" }, // EPSG:4326, lng/lat
  },
  metadata: {
    generated_by: "scripts/generate-demo-parcels.mjs",
    generated_at: new Date().toISOString(),
    note: DATA_SOURCE,
    assessed_value_note: "assessed_value_usd is a fabricated demo figure, not a real assessment",
    feature_count: features.length,
  },
  features,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(collection, null, 2) + "\n", "utf8");

const kb = (JSON.stringify(collection).length / 1024).toFixed(1);
console.log(`Wrote ${features.length} synthetic parcels -> ${OUT_PATH} (${kb} KB)`);
