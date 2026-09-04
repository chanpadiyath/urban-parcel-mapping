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

## Primary parcels — REAL OpenStreetMap footprints (MODE B)

When the backend is running, the app's parcel dataset is **real OpenStreetMap
building footprints**, not the synthetic grid:

- `server/osm-parcels.mjs` turns each OSM building way from the reference fetch
  into a Land-Twin record — **real polygon, real area (geodesic), real
  land-use** where an OSM `landuse`/`shop`/`amenity` tag applies, **real
  nearest-road distance + name**, and OSM `name` / `addr:*` / `building:levels`
  where present (~40 % land-use, ~5 % address, ~2 % storeys in T. Nagar — OSM
  tagging is sparse in Indian neighbourhoods, but the geometry is real).
- Served at `GET /api/parcels`; consumed by `osmLiveProvider` in
  `src/data/providers.ts`, which sits ahead of the synthetic provider.
  `resolveDataStack()` → **MODE B (Hybrid — partial live)**.
- **Left unset on purpose** (no public source, never fabricated):
  `survey_no`, `ownership_*`, `encroachment_*`, `reference_area_*`,
  `discrepancy_*`, `boundary_confidence`, `tenure_class`,
  `assessed_value_inr`, `previous` (time-series). The Land Twin panel shows
  these as *"Not available — OpenStreetMap has no cadastral/ownership
  record"*, and hides the encroachment/discrepancy analysis for OSM parcels.
- Fallback: if `/api/parcels` is unreachable (no backend, offline), the app
  uses the synthetic dataset below and shows **MODE C**.

## Reference data & cross-check — REAL (OpenStreetMap)

There is **no public API for Indian cadastral parcel geometry**. State
land-record systems (Tamil Nadu: `eservices.tn.gov.in` — Patta / Chitta /
A-Register / FMB sketch; `tnreginet.gov.in` — guideline value) are
CAPTCHA-gated, per-record web forms with no bulk/API access. Automating them
would mean defeating access controls, which this project does not do.

The closest lawful, automatable reference is **OpenStreetMap**, pulled
server-side via the **Overpass API**:

- **`server/reference.mjs`** fetches `building`, `landuse` and `highway` ways
  for the demo bbox (T. Nagar). Tries several Overpass mirrors; caches to
  `server/.cache/` (24 h TTL, gitignored); ships a committed snapshot at
  **`server/data/osm-reference.json`** (~206 buildings, ~15 land-use polygons,
  ~45 roads) so the feature works offline and is reviewable in git.
- **`server/reconcile.mjs`** compares every synthetic parcel against that
  reference: is a real OSM building on it, OSM footprint area vs our built-up
  estimate, does OSM's `landuse` tag agree with ours, true distance to the
  nearest mapped road.
- Endpoints: `GET /api/reference/osm`, `GET /api/reference/status`,
  `POST /api/reference/refresh`, `GET /api/reconcile`.
- Shown in the UI: sidebar **"OSM cross-check"** card (building-presence rate,
  land-use agreement rate, median road distance) and a per-parcel
  **"Cross-check — OpenStreetMap"** section in the Land Twin panel.

**What the numbers mean.** In the current data the agreement is *low*
(~16 % of parcels sit on an OSM building, ~7 % land-use agreement). That is
expected and correct: our parcels are a **derived grid at the real location**,
not real plot boundaries, so they only line up with real OSM features by
coincidence. The reconciliation is doing its job — it is honestly measuring
how far the synthetic geometry is from reality.

**OSM caveats.** Community-contributed; completeness and tagging vary by area;
building polygons can lag the ground; no ownership or legal-boundary data.
It is a sanity reference, not an authoritative record.

## Getting real cadastral data (production paths)

None of these is a drop-in API; all need process, not just code.

1. **Formal data-sharing request** to the Tamil Nadu **Commissionerate of Land
   Administration / Survey & Settlement Department** (or **TNeGA**). They hold
   digitised FMB + Patta; a government/academic/partner MoU can obtain
   village-level cadastral shapefiles. This is the real source of parcel
   polygons + survey numbers.
2. **CMDA Second Master Plan** land-use zoning — published as maps; can be
   georeferenced and vectorised into a real `land_use` / `zoning` layer for
   Chennai. Legitimate, just manual.
3. **Bhuvan (ISRO/NRSC)** WMS/WFS — LULC (Land Use Land Cover) and
   administrative/ward boundaries. Reachable (`bhuvan-vec1.nrsc.gov.in`,
   registration for some layers), coarse (not parcel-level) but good for
   neighbourhood land-use validation. A natural second `LandDataProvider`.
4. **District e-Adangal / DIGITISE datasets** where a district has published
   them on its portal or on `data.gov.in`.
5. **Municipal property-tax GIS** (Greater Chennai Corporation) — parcel-ish
   property boundaries exist internally; obtainable via the corporation.
6. **Commercial cadastral vendors** operating under state Revenue-department
   arrangements, if budget allows.

To wire any of these in: implement `LandDataProvider` in
`src/data/providers.ts` (or a server-side fetch + `/api` endpoint for
CAPTCHA/rate-limited sources) returning geometry normalised to
`ParcelProperties`, and place it ahead of `demoDataProvider`. The mode
indicator then reports MODE A/B and the reconciliation compares against it
instead of (or as well as) OSM.

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
