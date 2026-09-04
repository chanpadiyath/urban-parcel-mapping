# Data sources, provenance & limitations

**This build runs in MODE C — Demonstration.** It does **not** connect to any
official Indian land-record system, cadastral dataset, satellite
change-detection service, or weather feed. There is no lawful public API for
those configured here. The application is architected so such sources can be
added later (`src/data/providers.ts`), and the UI always states the current
mode and the state of every source.

Nothing in this prototype is an official record or a legal determination.

## Parcel data — DERIVED geometry + SYNTHETIC attributes

- **Files:** `public/demo-parcels.geojson` (144), `public/demo-buildings.geojson` (122).
- **Generator:** `scripts/generate-demo-parcels.mjs` (`npm run gen:data`),
  deterministic. Location via env: `DEMO_LAT DEMO_LON DEMO_CITY DEMO_STATE
  DEMO_LOCALITY` (default: **13.0418, 80.2341 — T. Nagar, Chennai, Tamil Nadu**).
- **Geometry:** a regular grid of ~2,000 sq ft plots on a road grid, placed at
  the real Chennai coordinate. It is **derived**, *not* a verified cadastral
  boundary. `boundary_source` and the `boundary_confidence` field
  (mostly Medium/Low) say so on every parcel.
- **CRS:** EPSG:4326 / CRS84. **Areas:** geodesic (spherical excess), reported
  in sq ft and m².
- **Identity fields** (`survey_no`, `subdivision_no`, `state`, `district`,
  `taluk`, `village_ward`, `local_body`, `pin_code`, `address`): **synthetic**,
  formatted to resemble Tamil Nadu / Greater Chennai Corporation records
  (e.g. `T.S. No. 1234`, `Ward 121, T. Nagar`, PIN `600017`). They do not
  correspond to real survey records.
- **Classification** (`land_use`, `observed_use`, `zoning_code`,
  `zoning_description`, `permitted use`, `development_status`, `tenure_class`,
  `agri_status`): **illustrative**. Zoning codes (R1/R2/C2/I1/OSR/PSP…) mimic
  CMDA-style categories but are not drawn from an official Master Plan.
- **Area & encroachment intelligence** (`reference_area_sqm`,
  `discrepancy_area_sqm`, `discrepancy_pct`, `built_up_area_sqm`,
  `vegetation_pct`, `encroachment_area_sqm`, `encroachment_status`):
  **fabricated, deterministic**. "Potential discrepancy" = |mapped area −
  reference area|. Encroachment is a **metric only** — no encroachment polygon
  is generated, and nothing is claimed to be officially detected. Terms used
  throughout: "Potential", "Detected boundary/usage discrepancy",
  "Requires verification".
- **Time series** (`previous` object): a single fabricated prior snapshot
  (built-up area, vegetation %, encroachment) dated ~6 months back, so
  current-vs-previous change can be shown. Not real observations.
- **Ownership:** `owner_record_available: false`. The UI shows **"Ownership
  data unavailable"**. No names, contact details, or any personal data are
  present anywhere in the dataset.
- **Valuation** (`assessed_value_inr`): a fabricated guideline-style estimate
  (indicative ₹/sq ft by land use × area + a built-up premium). Labelled
  "(demo guideline estimate)".
- **Buildings:** centred rectangle sized to the built-up area; `height_m =
  floors × 3.2 m`; `height_basis` states this. Estimated massing, not
  surveyed structures.
- Every feature carries `data_source = "Demonstration data — synthetic, not an
  official land record"` and `data_quality = "DEMO"`; both files carry a
  `metadata.disclaimer`.

## Base map — REAL, keyless

| Layer | Source | Attribution |
|---|---|---|
| Map | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | © OpenStreetMap contributors (ODbL) |
| Satellite | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | Imagery © Esri, Maxar, Earthstar Geographics |

Override with `VITE_BASEMAP_TILE_URL` / `VITE_SATELLITE_TILE_URL`. The public
OSM tile server is for low-volume prototype use only
(<https://operations.osmfoundation.org/policies/tiles/>). No API key. The
satellite layer is imagery only — there is **no automated change detection**
over it; "satellite-derived" change values in the UI are demonstration data.

## Local Land AI

- `src/ai/analyze.ts` is a **deterministic rule/heuristic engine**, not a
  machine-learning model — there are no model weights, and it does not call
  any external service. It runs on-device (Web Worker, or inline fallback).
- Output is shaped like a model-backed analyser would be (insight text +
  confidence + basis + source + `requiresVerification` + timestamp) so a real
  model can replace it behind `LocalLandAI` without UI changes.
- All statements are hedged ("potential", "estimated", "appears", "likely").
  It never emits "confirmed", "illegal", or a legal conclusion. Confidence is
  derived from the parcel's (synthetic) boundary confidence and rule
  strength — it is **not** a calibrated probability.
- Personal ownership data is never sent anywhere (there is none in the
  dataset, and the AI runs locally regardless).

## Real-time behaviour

The "real-time" loop (`useLandTwinSync`) is a fixed-cadence heartbeat plus a
feed of **actual** application events (session start, sync tick, parcel
analysis, detections surfaced, AI runs). It does **not** synthesise land-data
updates. Data freshness shown in the UI is the time since the last loop tick,
not a claim of new authoritative data.

## For production integration

1. Implement `LandDataProvider` for a real source in `src/data/providers.ts`
   (`isAvailable`, `getParcels`, `getBuildings`), returning geometry
   normalised to `ParcelProperties` (`src/types.ts`). Add it to
   `ALL_PROVIDERS` ahead of `demoDataProvider`.
2. Reproject to EPSG:4326, validate geometry, drop/repair invalid polygons.
3. Redact any personal ownership data before it reaches the client.
4. Replace the heuristic AI with a real model behind the same `LocalLandAI`
   interface if desired.
5. `resolveDataStack()` will then report MODE A / B and mark sources `live`.
