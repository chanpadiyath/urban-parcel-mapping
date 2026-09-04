/**
 * generate-demo-parcels.mjs
 * -------------------------------------------------------------------------
 * Generates the SYNTHETIC Indian-urban demonstration dataset for the
 * "Urban Parcel Intelligence / Land Twin" prototype.
 *
 * There is NO official cadastral / land-record source behind this file.
 * Every attribute — survey numbers, ownership status, encroachment,
 * confidence, valuations, timestamps — is fabricated for demonstration.
 * See DATA.md.
 *
 * Location is configurable via env (Chennai / T. Nagar defaults):
 *   DEMO_LAT DEMO_LON DEMO_CITY DEMO_STATE DEMO_LOCALITY
 *
 * Outputs (GeoJSON FeatureCollection, EPSG:4326 / CRS84):
 *   public/demo-parcels.geojson    — 144 derived parcels on a road grid
 *   public/demo-buildings.geojson  — estimated building footprints/heights
 *
 * Geodesic areas (spherical excess), never raw degrees. All non-geometric
 * values are deterministic (stable across regenerations).
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "../public/demo-parcels.geojson");
const BUILDINGS_OUT_PATH = resolve(__dirname, "../public/demo-buildings.geojson");

// --- Location (env-configurable) -----------------------------------
const CENTER_LAT = Number(process.env.DEMO_LAT ?? 13.0418);
const CENTER_LNG = Number(process.env.DEMO_LON ?? 80.2341);
const CITY = process.env.DEMO_CITY ?? "Chennai";
const STATE = process.env.DEMO_STATE ?? "Tamil Nadu";
const LOCALITY = process.env.DEMO_LOCALITY ?? "T. Nagar";
const DISTRICT = "Chennai";
const TALUK = "Mambalam";
const LOCAL_BODY = "Greater Chennai Corporation";
const PIN = "600017";
const ID_PREFIX = "IND-TN-CHN-DEMO";

// --- Grid shape (Indian urban plot scale) ------------------------
const COLS = 12;
const ROWS = 12;
const PLOT_W_M = 11; // ~36 ft frontage
const PLOT_H_M = 17; // ~56 ft depth
const ROAD_GAP_M = 7;
const FLOOR_HEIGHT_M = 3.2;

const SQFT_PER_SQM = 10.76391;
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

const DATA_SOURCE = "Demonstration data — synthetic, not an official land record";
const DATA_QUALITY = "DEMO";
const BOUNDARY_SOURCE = "Derived — regular grid aligned to a real basemap location";
const LAST_UPDATED = "2026-09-01";
const PREV_OBSERVED = "2026-03-05";

// land use -> planning + massing profile (illustrative CMDA-style codes)
const LAND_USE_PROFILE = {
  Residential: {
    weight: 34, zoning_code: "R1", zoning_description: "Primary Residential Use Zone",
    coverage: [0.45, 0.68], floors: [1, 3], veg: [8, 30],
  },
  "Mixed Residential": {
    weight: 14, zoning_code: "R2", zoning_description: "Mixed Residential Use Zone",
    coverage: [0.5, 0.75], floors: [2, 4], veg: [4, 18],
  },
  Commercial: {
    weight: 16, zoning_code: "C2", zoning_description: "General Commercial Use Zone",
    coverage: [0.6, 0.9], floors: [2, 6], veg: [0, 8],
  },
  Institutional: {
    weight: 8, zoning_code: "I1", zoning_description: "Institutional Use Zone",
    coverage: [0.3, 0.55], floors: [1, 4], veg: [15, 40],
  },
  Industrial: {
    weight: 5, zoning_code: "IND", zoning_description: "Primary Industrial Use Zone",
    coverage: [0.4, 0.7], floors: [1, 2], veg: [2, 12],
  },
  "Public/Semi-Public": {
    weight: 6, zoning_code: "PSP", zoning_description: "Public & Semi-Public Use Zone",
    coverage: [0.1, 0.35], floors: [1, 2], veg: [20, 55],
  },
  "Open Space": {
    weight: 8, zoning_code: "OSR", zoning_description: "Open Space & Recreation Zone",
    coverage: [0.0, 0.06], floors: [0, 0], veg: [55, 90],
  },
  Vacant: {
    weight: 9, zoning_code: "R1", zoning_description: "Primary Residential Use Zone (undeveloped)",
    coverage: [0.0, 0.04], floors: [0, 0], veg: [20, 65],
  },
};
const LAND_USES = Object.keys(LAND_USE_PROFILE);

const TENURE = ["Private", "Private", "Private", "Government", "Public", "Institutional"];
const STREETS = [
  "1st Main Rd", "2nd Main Rd", "Habibullah Rd", "Thanikachalam Rd", "Bazullah Rd",
  "Burkit Rd", "North Boag Rd", "South Boag Rd", "Venkatnarayana Rd", "G.N. Chetty Rd",
  "Duraiswamy Rd", "Madley Rd",
];

// --- Geo helpers -------------------------------------------------
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
function unit(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
const lerp = (a, b, t) => a + (b - a) * t;

function pickLandUse(seq) {
  const total = LAND_USES.reduce((s, k) => s + LAND_USE_PROFILE[k].weight, 0);
  let r = unit(seq * 3.17) * total;
  for (const k of LAND_USES) {
    r -= LAND_USE_PROFILE[k].weight;
    if (r <= 0) return k;
  }
  return "Residential";
}
function encroachmentBand(seq) {
  const roll = unit(seq * 5.53);
  if (roll < 0.66) return { status: "None", lo: 0, hi: 0 };
  if (roll < 0.82) return { status: "Minor", lo: 0.5, hi: 4.5 };
  if (roll < 0.93) return { status: "Moderate", lo: 5, hi: 14 };
  if (roll < 0.985) return { status: "Significant", lo: 15, hi: 29 };
  return { status: "Critical", lo: 30, hi: 45 };
}
function confidenceLabel(c) {
  if (c >= 0.8) return "High";
  if (c >= 0.55) return "Medium";
  return "Low";
}

// --- Build ----------------------------------------------------
const dLat = (m) => m / mPerDegLat();
const dLng = (m, lat) => m / mPerDegLng(lat);

const stepXm = PLOT_W_M + ROAD_GAP_M;
const stepYm = PLOT_H_M + ROAD_GAP_M;
const originLng = CENTER_LNG - dLng((COLS * stepXm - ROAD_GAP_M) / 2, CENTER_LAT);
const originLat = CENTER_LAT - dLat((ROWS * stepYm - ROAD_GAP_M) / 2);

const features = [];
const buildings = [];
let seq = 0;

for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    seq += 1;
    const parcelId = `${ID_PREFIX}-${String(seq).padStart(4, "0")}`;

    const west = originLng + dLng(col * stepXm, CENTER_LAT);
    const east = west + dLng(PLOT_W_M, CENTER_LAT);
    const south = originLat + dLat(row * stepYm);
    const north = south + dLat(PLOT_H_M);
    const ring = [
      [west, south], [east, south], [east, north], [west, north], [west, south],
    ];

    const areaSqM = ringAreaSqM(ring);
    const areaSqFt = areaSqM * SQFT_PER_SQM;
    const perimeterM = 2 * (PLOT_W_M + PLOT_H_M);

    const landUse = pickLandUse(seq);
    const p = LAND_USE_PROFILE[landUse];

    const coverage = lerp(p.coverage[0], p.coverage[1], unit(seq * 7.7));
    let builtUp = coverage * areaSqM;

    const band = encroachmentBand(seq);
    const encPct = band.status === "None" ? 0 : lerp(band.lo, band.hi, unit(seq * 9.13));
    let encArea = (encPct / 100) * areaSqM;
    if (builtUp + encArea > 0.95 * areaSqM) builtUp = Math.max(0, 0.95 * areaSqM - encArea);
    const builtPct = (builtUp / areaSqM) * 100;

    const floors =
      p.floors[1] === 0 ? 0 : Math.round(lerp(p.floors[0], p.floors[1], unit(seq * 6.1)));
    const vegPct = Math.round(lerp(p.veg[0], p.veg[1], unit(seq * 4.2)));

    const refOffset = (unit(seq * 2.3) - 0.5) * 0.14; // +-7%
    const referenceAreaSqM = areaSqM * (1 + refOffset);
    const discrepancyAreaSqM = Math.abs(areaSqM - referenceAreaSqM);
    const discrepancyPct = (discrepancyAreaSqM / referenceAreaSqM) * 100;

    let confidence = 0.4 + unit(seq * 11.7) * 0.5;
    if (band.status === "Significant" || band.status === "Critical") confidence -= 0.1;
    confidence = Math.max(0.3, Math.min(0.92, confidence));

    const devStatus =
      landUse === "Vacant" || builtPct < 3
        ? "Vacant / Undeveloped"
        : band.status === "Significant" || band.status === "Critical"
          ? "Developed — discrepancy flagged"
          : builtPct < 30
            ? "Partly developed"
            : unit(seq * 12.7) < 0.08
              ? "Under review"
              : "Developed";

    const tenure =
      landUse === "Open Space" || landUse === "Public/Semi-Public"
        ? "Public"
        : landUse === "Institutional"
          ? "Institutional"
          : TENURE[Math.floor(unit(seq * 8.9) * TENURE.length)];

    const ratePerSqFt = ({
      Residential: 21000, "Mixed Residential": 23500, Commercial: 34000,
      Institutional: 15000, Industrial: 12000, "Public/Semi-Public": 6000,
      "Open Space": 3000, Vacant: 18000,
    })[landUse];
    const assessedValueInr =
      Math.round(
        ((ratePerSqFt * areaSqFt +
          builtUp * SQFT_PER_SQM * 1800 * Math.max(1, floors) * 0.12) *
          (0.9 + unit(seq * 8.2) * 0.3)) / 100000,
      ) * 100000;

    const prevBuilt = Math.max(0, builtUp * (0.78 + unit(seq * 13.3) * 0.18));
    const prevVeg = Math.min(95, vegPct + Math.round(unit(seq * 14.1) * 10));
    const prevEnc = band.status === "None" ? 0 : encArea * (unit(seq * 15.7) < 0.5 ? 0 : 0.6);

    features.push({
      type: "Feature",
      id: parcelId,
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {
        parcel_id: parcelId,
        survey_no: `T.S. No. ${1000 + Math.floor(seq * 2.7)}`,
        subdivision_no: `${1 + (seq % 9)}`,
        state: STATE,
        district: DISTRICT,
        taluk: TALUK,
        village_ward: `Ward ${120 + (row % 8)}, ${LOCALITY}`,
        local_body: LOCAL_BODY,
        pin_code: PIN,
        city: CITY,
        locality: LOCALITY,
        address: `Plot ${col + 1}, ${STREETS[row % STREETS.length]}, ${LOCALITY}`,

        land_use: landUse,
        observed_use: landUse === "Vacant" ? "No active use observed" : landUse,
        zoning_code: p.zoning_code,
        zoning_description: p.zoning_description,
        development_status: devStatus,
        tenure_class: tenure,
        agri_status: "Non-agricultural",

        ownership_status: "On record (details not public in this dataset)",
        owner_record_available: false,
        ownership_type: tenure === "Private" ? "Individual / private" : tenure,
        last_verified: LAST_UPDATED,

        area_sqm: round1(areaSqM),
        area_sqft: Math.round(areaSqFt),
        perimeter_m: round1(perimeterM),
        reference_area_sqm: round1(referenceAreaSqM),
        reference_area_sqft: Math.round(referenceAreaSqM * SQFT_PER_SQM),
        discrepancy_area_sqm: round1(discrepancyAreaSqM),
        discrepancy_pct: round2(discrepancyPct),
        boundary_confidence: round2(confidence),
        boundary_confidence_label: confidenceLabel(confidence),
        boundary_source: BOUNDARY_SOURCE,

        built_up_area_sqm: round1(builtUp),
        built_up_pct: round1(builtPct),
        floors,
        vegetation_pct: vegPct,
        encroachment_area_sqm: round1(encArea),
        encroachment_status: band.status,

        previous: {
          observed_on: PREV_OBSERVED,
          built_up_area_sqm: round1(prevBuilt),
          vegetation_pct: prevVeg,
          encroachment_area_sqm: round1(prevEnc),
        },

        assessed_value_inr: assessedValueInr,
        last_updated: LAST_UPDATED,
        data_source: DATA_SOURCE,
        data_quality: DATA_QUALITY,
      },
    });

    if (floors > 0 && builtUp > 20) {
      const footprintArea = Math.min(builtUp, 0.88 * areaSqM);
      const s = Math.sqrt(footprintArea / areaSqM);
      const cx = (west + east) / 2;
      const cy = (south + north) / 2;
      const hw = ((east - west) / 2) * s;
      const hh = ((north - south) / 2) * s;
      buildings.push({
        type: "Feature",
        id: parcelId,
        geometry: {
          type: "Polygon",
          coordinates: [[
            [cx - hw, cy - hh], [cx + hw, cy - hh],
            [cx + hw, cy + hh], [cx - hw, cy + hh], [cx - hw, cy - hh],
          ]],
        },
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

const crs = { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } };
const parcelCollection = {
  type: "FeatureCollection",
  name: "demo-parcels",
  crs,
  metadata: {
    generated_by: "scripts/generate-demo-parcels.mjs",
    location: `${LOCALITY}, ${CITY}, ${STATE}, India`,
    center: [round2(CENTER_LNG), round2(CENTER_LAT)],
    note: DATA_SOURCE,
    disclaimer:
      "DEMONSTRATION DATA. Not an official land record. Survey numbers, ownership status, " +
      "encroachment, boundary confidence, valuations and timestamps are all fabricated. " +
      "Parcel geometry is a derived regular grid, NOT verified cadastral boundary. " +
      "Discrepancy / encroachment figures are potential indicators only, not legal determinations.",
    feature_count: features.length,
  },
  features,
};
const buildingCollection = {
  type: "FeatureCollection",
  name: "demo-buildings",
  crs,
  metadata: {
    generated_by: "scripts/generate-demo-parcels.mjs",
    note: DATA_SOURCE,
    disclaimer:
      "ESTIMATED demo massing: centred rectangle sized to the built-up area; " +
      "height = floors x 3.2 m. Not surveyed structures.",
    feature_count: buildings.length,
  },
  features: buildings,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(parcelCollection, null, 2) + "\n", "utf8");
writeFileSync(BUILDINGS_OUT_PATH, JSON.stringify(buildingCollection, null, 2) + "\n", "utf8");
console.log(
  `Wrote ${features.length} demo parcels + ${buildings.length} buildings for ` +
    `${LOCALITY}, ${CITY} (${CENTER_LAT}, ${CENTER_LNG})`,
);
