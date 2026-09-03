/**
 * generate-demo-parcels.mjs
 * -------------------------------------------------------------------------
 * Produces the SYNTHETIC demo dataset for the Urban Parcel Intelligence
 * prototype. There is no real cadastral source behind this file — every
 * attribute is fabricated for demonstration. See DATA.md.
 *
 * Output: public/demo-parcels.geojson  (GeoJSON FeatureCollection, EPSG:4326)
 * Re-runnable: `npm run gen:data` (also runs before dev / build).
 *
 * Geometry: a regular 10x10 grid of rectangular parcels around a fictional
 * town centre ("City of Demoville"). Parcel dimensions are metres, converted
 * to degrees with a local metres-per-degree approximation.
 *
 * Areas are geodesic (spherical excess), never from raw degrees. All
 * non-geometric values are deterministic, so regenerating yields the same
 * data (only the metadata timestamp changes). Percentages that the UI can
 * derive (built-up %, open %, encroachment %) are NOT stored here — the app
 * computes them from the raw areas at runtime.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "../public/demo-parcels.geojson");
const BUILDINGS_OUT_PATH = resolve(__dirname, "../public/demo-buildings.geojson");

// Assumed storey height for the ESTIMATED building extrusion (metres).
const FLOOR_HEIGHT_M = 3.2;

// --- Configuration ---------------------------------------------------
const CENTER_LNG = -122.676;
const CENTER_LAT = 45.523;
const COLS = 10;
const ROWS = 10;
const PARCEL_W_M = 40;
const PARCEL_H_M = 60;
const ROAD_GAP_M = 12;

const DATA_SOURCE = "SYNTHETIC DEMO DATA — not real parcels";
const DATA_QUALITY = "DEMO DATA";
const JURISDICTION = "City of Demoville (fictional)";
const LAST_UPDATED = "2026-09-01";

const LOCALITIES = [
  "Riverside",
  "Old Town",
  "Harbourgate",
  "Meadowbrook",
  "Kingsford",
];
const ZONES = ["North Zone", "Central Zone", "South Zone", "East Zone", "West Zone"];
const STREET_NAMES = [
  "Alder St", "Birch Ave", "Cedar Way", "Douglas Blvd", "Elm Ct",
  "Fir Loop", "Grove Pl", "Hazel Row", "Ironwood Dr", "Juniper Ln",
];

// land use -> planning profile (all fabricated demo values)
const LAND_USE_PROFILE = {
  Residential: {
    weight: 30,
    zoning_code: "R-2",
    zoning_description: "Medium Density Residential",
    permitted_use: "Dwellings, community facilities, home occupations",
    coverage: [0.35, 0.62],
    floors: [1, 3],
  },
  Commercial: {
    weight: 16,
    zoning_code: "C-2",
    zoning_description: "General Commercial",
    permitted_use: "Retail, offices, personal services, hospitality",
    coverage: [0.45, 0.8],
    floors: [2, 6],
  },
  "Mixed Use": {
    weight: 12,
    zoning_code: "MU",
    zoning_description: "Mixed Use Corridor",
    permitted_use: "Residential above ground-floor commercial",
    coverage: [0.45, 0.75],
    floors: [2, 5],
  },
  Industrial: {
    weight: 10,
    zoning_code: "I-1",
    zoning_description: "Light Industrial",
    permitted_use: "Manufacturing, warehousing, logistics",
    coverage: [0.4, 0.7],
    floors: [1, 2],
  },
  Institutional: {
    weight: 9,
    zoning_code: "PS-1",
    zoning_description: "Public & Semi-Public",
    permitted_use: "Schools, health facilities, civic buildings",
    coverage: [0.28, 0.5],
    floors: [1, 4],
  },
  "Public/Semi-Public": {
    weight: 6,
    zoning_code: "PS-2",
    zoning_description: "Public Utility & Infrastructure",
    permitted_use: "Utilities, transit, municipal works",
    coverage: [0.1, 0.35],
    floors: [1, 2],
  },
  Recreational: {
    weight: 8,
    zoning_code: "OS",
    zoning_description: "Open Space & Recreation",
    permitted_use: "Parks, playgrounds, greenways",
    coverage: [0.02, 0.12],
    floors: [1, 1],
  },
  Vacant: {
    weight: 9,
    zoning_code: "R-2",
    zoning_description: "Medium Density Residential (undeveloped)",
    permitted_use: "As per underlying zone",
    coverage: [0, 0.03],
    floors: [0, 0],
  },
};
const LAND_USES = Object.keys(LAND_USE_PROFILE);

// --- Geo helpers ---------------------------------------------------
const EARTH_RADIUS_M = 6371008.8;
const DEG2RAD = Math.PI / 180;
const mPerDegLat = () => 111320;
const mPerDegLng = (lat) => 111320 * Math.cos(lat * DEG2RAD);

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

// deterministic pseudo-random in [0,1)
function unit(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
const lerp = (a, b, t) => a + (b - a) * t;
const round1 = (n) => Math.round(n * 10) / 10;

function pickLandUse(seq) {
  const totalWeight = LAND_USES.reduce(
    (s, k) => s + LAND_USE_PROFILE[k].weight,
    0,
  );
  let r = unit(seq * 3.17) * totalWeight;
  for (const k of LAND_USES) {
    r -= LAND_USE_PROFILE[k].weight;
    if (r <= 0) return k;
  }
  return "Residential";
}

function encroachmentFor(seq, parcelArea) {
  const roll = unit(seq * 5.53);
  // ~62% of parcels have no encroachment
  let band;
  if (roll < 0.62) return { area: 0, status: "None" };
  else if (roll < 0.78) band = ["Minor", 0.5, 4.5];
  else if (roll < 0.9) band = ["Moderate", 5, 14];
  else if (roll < 0.97) band = ["Significant", 15, 29];
  else band = ["Critical", 30, 46];
  const pct = lerp(band[1], band[2], unit(seq * 9.13));
  return { area: (pct / 100) * parcelArea, status: band[0] };
}

function developmentStatus(builtPct, encStatus, seq) {
  if (encStatus === "Critical" || encStatus === "Significant") return "Encroached";
  if (builtPct < 3) return "Vacant";
  if (unit(seq * 12.7) < 0.08) return "Requires Review";
  if (builtPct < 22) return unit(seq * 4.4) < 0.5 ? "Under Development" : "Partially Developed";
  if (builtPct < 55) return "Partially Developed";
  return "Developed";
}

// --- Build features ---------------------------------------------
const dLat = (m) => m / mPerDegLat();
const dLng = (m, lat) => m / mPerDegLng(lat);

const stepXm = PARCEL_W_M + ROAD_GAP_M;
const stepYm = PARCEL_H_M + ROAD_GAP_M;
const originLng = CENTER_LNG - dLng((COLS * stepXm - ROAD_GAP_M) / 2, CENTER_LAT);
const originLat = CENTER_LAT - dLat((ROWS * stepYm - ROAD_GAP_M) / 2);

const features = [];
const buildings = [];
let seq = 0;

for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    seq += 1;
    const parcelId = `UPI-${String(seq).padStart(4, "0")}`;

    const west = originLng + dLng(col * stepXm, CENTER_LAT);
    const east = west + dLng(PARCEL_W_M, CENTER_LAT);
    const south = originLat + dLat(row * stepYm);
    const north = south + dLat(PARCEL_H_M);
    const ring = [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ];

    const areaSqM = ringAreaSqM(ring);
    const landUse = pickLandUse(seq);
    const profile = LAND_USE_PROFILE[landUse];

    let coverage = lerp(profile.coverage[0], profile.coverage[1], unit(seq * 7.7));
    let builtUp = coverage * areaSqM;

    const enc = encroachmentFor(seq, areaSqM);
    let encArea = enc.area;

    // keep built-up + encroachment within the parcel
    if (builtUp + encArea > 0.95 * areaSqM) {
      builtUp = Math.max(0, 0.95 * areaSqM - encArea);
    }
    const builtPct = (builtUp / areaSqM) * 100;

    const floors =
      profile.floors[1] === 0
        ? 0
        : Math.round(lerp(profile.floors[0], profile.floors[1], unit(seq * 6.1)));

    const rowArea = lerp(0.03, 0.09, unit(seq * 2.9)) * areaSqM; // notional RoW

    const devStatus =
      landUse === "Vacant"
        ? "Vacant"
        : developmentStatus(builtPct, enc.status, seq);

    const baseRate = { Residential: 190, Commercial: 340, "Mixed Use": 275, Industrial: 140, Institutional: 90, "Public/Semi-Public": 40, Recreational: 20, Vacant: 110 }[landUse];
    const assessedValue =
      devStatus === "Vacant"
        ? Math.round((baseRate * 0.4 * areaSqM) / 1000) * 1000
        : Math.round(((baseRate * areaSqM + builtUp * 260 * Math.max(1, floors) * 0.15) * (0.9 + unit(seq * 8.2) * 0.3)) / 1000) * 1000;

    const houseNumber = 100 + row * 100 + col * 2;

    features.push({
      type: "Feature",
      id: parcelId,
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {
        parcel_id: parcelId,
        address: `${houseNumber} ${STREET_NAMES[row % STREET_NAMES.length]}`,
        locality: LOCALITIES[(row + Math.floor(col / 3)) % LOCALITIES.length],
        ward: `Ward ${((row + col) % 6) + 1}`,
        zone: ZONES[Math.floor(col / 2) % ZONES.length],

        land_use: landUse,
        zoning_code: profile.zoning_code,
        zoning_description: profile.zoning_description,
        permitted_use: profile.permitted_use,
        development_status: devStatus,

        area_sqm: round1(areaSqM),
        area_acres: Math.round((areaSqM / 4046.8564224) * 1000) / 1000,
        built_up_area_sqm: round1(builtUp),
        floors,
        row_area_sqm: round1(rowArea),
        encroachment_area_sqm: round1(encArea),
        encroachment_status: enc.status,

        assessed_value_usd: assessedValue,
        owner: "City of Demoville (synthetic — no personal data)",
        jurisdiction: JURISDICTION,
        last_updated: LAST_UPDATED,
        data_source: DATA_SOURCE,
        data_quality: DATA_QUALITY,
      },
    });

    // --- ESTIMATED building footprint (developed parcels only) ---------
    // A centred rectangle whose plan area ~= built-up area, extruded to
    // floors x assumed storey height. This is a demo estimate, not a survey.
    if (floors > 0 && builtUp > 50) {
      const footprintArea = Math.min(builtUp, 0.85 * areaSqM);
      const s = Math.sqrt(footprintArea / areaSqM); // linear scale factor
      const cx = (west + east) / 2;
      const cy = (south + north) / 2;
      const hw = ((east - west) / 2) * s;
      const hh = ((north - south) / 2) * s;
      const fp = [
        [cx - hw, cy - hh],
        [cx + hw, cy - hh],
        [cx + hw, cy + hh],
        [cx - hw, cy + hh],
        [cx - hw, cy - hh],
      ];
      buildings.push({
        type: "Feature",
        id: parcelId,
        geometry: { type: "Polygon", coordinates: [fp] },
        properties: {
          parcel_id: parcelId,
          floors,
          height_m: round1(floors * FLOOR_HEIGHT_M),
          height_basis: `Estimated: ${floors} floors x ${FLOOR_HEIGHT_M} m`,
          footprint_area_sqm: round1(footprintArea),
          land_use: landUse,
          data_source: DATA_SOURCE,
          data_quality: DATA_QUALITY,
        },
      });
    }
  }
}

const collection = {
  type: "FeatureCollection",
  name: "demo-parcels",
  crs: {
    type: "name",
    properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" },
  },
  metadata: {
    generated_by: "scripts/generate-demo-parcels.mjs",
    note: DATA_SOURCE,
    disclaimer:
      "All attributes are fabricated for demonstration. Encroachment values do NOT represent officially detected encroachment. Planning metrics (FAR, ground coverage, built-up %) are demo analysis, not official determinations.",
    feature_count: features.length,
  },
  features,
};

const buildingCollection = {
  type: "FeatureCollection",
  name: "demo-buildings",
  crs: {
    type: "name",
    properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" },
  },
  metadata: {
    generated_by: "scripts/generate-demo-parcels.mjs",
    note: DATA_SOURCE,
    disclaimer:
      "Building footprints and heights are ESTIMATED demo geometry (centred rectangle sized to the built-up area; height = floors x 3.2 m). They are not surveyed structures.",
    feature_count: buildings.length,
  },
  features: buildings,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(collection, null, 2) + "\n", "utf8");
writeFileSync(BUILDINGS_OUT_PATH, JSON.stringify(buildingCollection, null, 2) + "\n", "utf8");
const kb = (JSON.stringify(collection).length / 1024).toFixed(1);
const bkb = (JSON.stringify(buildingCollection).length / 1024).toFixed(1);
console.log(`Wrote ${features.length} synthetic parcels -> ${OUT_PATH} (${kb} KB)`);
console.log(`Wrote ${buildings.length} estimated buildings -> ${BUILDINGS_OUT_PATH} (${bkb} KB)`);
