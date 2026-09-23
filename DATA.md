# Data sources, provenance & limitations

**This build runs in MODE C — Demonstration.** It does **not** connect to any
official Indian land-record system, cadastral dataset, satellite
change-detection service, or weather feed. There is no lawful public API for
those configured here. The application is architected so such sources can be
added later (`frontend/src/data/providers.ts`), and the UI always states the current
mode and the state of every source.

Nothing in this prototype is an official record or a legal determination.

## Parcel data — DERIVED geometry + SYNTHETIC attributes

- **Files:** `backend/data/demo-parcels.geojson` (144), `backend/data/demo-buildings.geojson` (122), served at `/api/demo/*`.
- **Generator:** `backend/jobs/generate_demo_parcels.py` (`npm run gen:data`),
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

- `backend/app/osm_parcels.py` turns each OSM building way from the reference fetch
  into a Land-Twin record — **real polygon, real area (geodesic), real
  land-use** where an OSM `landuse`/`shop`/`amenity` tag applies, **real
  nearest-road distance + name**, and OSM `name` / `addr:*` / `building:levels`
  where present (~40 % land-use, ~5 % address, ~2 % storeys in T. Nagar — OSM
  tagging is sparse in Indian neighbourhoods, but the geometry is real).
- Served at `GET /api/parcels`; consumed by `osmLiveProvider` in
  `frontend/src/data/providers.ts`, which sits ahead of the synthetic provider.
  `resolveDataStack()` → **MODE B (Hybrid — partial live)**.
- **Left unset on purpose** (no public source, never fabricated):
  `survey_no`, `ownership_*`, `encroachment_*`, `reference_area_*`,
  `discrepancy_*`, `boundary_confidence`, `tenure_class`,
  `assessed_value_inr`, `previous` (time-series). The Land Twin panel shows
  these as *"Not available — OpenStreetMap has no cadastral/ownership
  record"*, and hides the encroachment/discrepancy analysis for OSM parcels.
- Fallback: if `/api/parcels` returns nothing (OSM reference not loaded), the
  backend still serves the synthetic dataset at `/api/demo/*` and the app
  shows **MODE C**. If the backend itself is down the app shows "data
  unavailable" — there is no in-browser copy of the data.

## Reference data & cross-check — REAL (OpenStreetMap)

There is **no public API for Indian cadastral parcel geometry**. State
land-record systems (Tamil Nadu: `eservices.tn.gov.in` — Patta / Chitta /
A-Register / FMB sketch; `tnreginet.gov.in` — guideline value) are
CAPTCHA-gated, per-record web forms with no bulk/API access. Automating them
would mean defeating access controls, which this project does not do.

The closest lawful, automatable reference is **OpenStreetMap**, pulled
server-side via the **Overpass API**:

- **`backend/app/reference.py`** fetches `building`, `landuse` and `highway` ways
  for the demo bbox (T. Nagar). Tries several Overpass mirrors; caches to
  `backend/.cache/` (24 h TTL, gitignored); ships a committed snapshot at
  **`backend/data/osm-reference.json`** (~206 buildings, ~15 land-use polygons,
  ~45 roads) so the feature works offline and is reviewable in git.
- The `highway` ways are also served on their own at **`GET
  /api/reference/roads`** and rendered as a toggleable **"Roads"** map layer
  (`frontend/src/components/MapView.tsx`) — real OpenStreetMap road geometry, not a
  synthesised grid. Off by default; enable it in the layer manager.
- **`backend/app/reconcile.py`** compares every synthetic parcel against that
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

## Elevation & terrain — REAL (Open Topo Data DEM)

The Terrain Mapping page's flood model now runs over **real elevation data**,
not a synthesised surface:

- **Source:** [Open Topo Data](https://www.opentopodata.org) (public, keyless
  REST API), dataset **`mapzen`** (Mapzen/Tilezen composite DEM), falling
  back to **`srtm30m`** (SRTM, void-filled) if `mapzen` is unreachable.
- **Fetched by:** `backend/app/elevation.py`, run manually via `npm run
  gen:elevation -- --site <site>` (`backend/jobs/fetch_elevation.py`) — a
  one-time data-prep step, not part of `dev`/`build`, since DEM data for a
  fixed site doesn't change run to run.
- **Committed snapshot:** `backend/data/elevation-<site>.json` — a coarse
  24×24 elevation grid over the site's bounding box plus a real elevation
  value at every parcel centroid, reviewable in git like
  `backend/data/osm-reference.json`.
- **Consumed by:** `backend/app/flood.py` — the only place the flood model
  runs. Parcels without a snapshot entry (e.g. the live OSM footprints, whose
  ids differ from the demo grid) are bilinear-sampled from the snapshot's
  24×24 grid at their centroid. The old synthesised gradient+noise surface
  is gone.
- **Resolution & accuracy:** ~30 m-class horizontal resolution, SRTM's
  published vertical accuracy is approx. ±10 m. A parcel's "elevation" is a
  spatial average over roughly a 30 m cell, **not a surveyed spot height** —
  shown as such in the UI (`meta.vertical_accuracy_note` in the snapshot).
- **What's still a demo:** the flood **event** — the rising water level
  itself — remains a deterministic timer-driven simulation, not a
  rainfall/hydrology model. Real terrain, simulated flood.
- **T. Nagar, Chennai is real-world nearly flat** (coastal plain, roughly
  11–17 m across the demo area per this DEM) — so flood/landslide variation
  there is genuinely small. That is the correct, honest result, not a bug.
- **Future path:** this is the exact seam a drone-derived DEM (photogrammetry
  from real drone imagery) would replace — same snapshot shape
  (`grid` + `parcelElevations`), different `source` label. See the project
  goal in `CLAUDE.md` / commit history: drone topography → real elevation →
  landscape/disaster prediction is the intended end state; Open Topo Data is
  the interim stand-in while no drone data exists yet.
- **Real topographic (hillshade) view, today.** The Terrain Mapping page's
  "Terrain shading" toggle (`frontend/src/components/SimMap.tsx`) renders
  real relief shading from AWS's public, keyless `elevation-tiles-prod`
  Terrarium tiles (`s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`)
  — the same Mapzen/Tilezen DEM family as the elevation numbers above, so the
  visual and the math agree. This is a genuine topographical view, not a
  drone substitute dressed up to look like one — on T. Nagar's flat terrain
  it correctly shows almost no relief (see above); it will show real
  structure once pointed at a site with real hills.
- **Drone-image slot.** The same page also has a plain image-upload control
  (`SimulationPage.tsx`). Uploading a photo places it over the demo site's
  bounding box using MapLibre's `image` source — client-side only (an object
  URL, never uploaded anywhere), and explicitly labeled a rough placement,
  **not** orthorectified or georeferenced (no ground-control points, no
  photogrammetry). This is the concrete, working version of the seam above:
  once real drone captures exist, this is where they'd go, with real
  georeferencing replacing the rough bounding-box placement.

## Weather — REAL (Open-Meteo)

The Terrain Mapping page shows a **"Real weather"** card: current
temperature/precipitation plus a 3-day precipitation forecast for the demo
location, from [Open-Meteo](https://open-meteo.com) (public, keyless, open
CORS — called directly from the browser, `frontend/src/data/weather.ts`). A simple,
explicitly-labeled heuristic (`deriveRainOutlook`) buckets the forecast into
a Low/Elevated/High "today's rain outlook" from precipitation probability
and sum thresholds.

**This does not drive the simulated flood event.** The water level on that
same page is still a fixed-rate timer (`RISE_RATE_M_PER_S` in `backend/app/flood.py`) — real terrain (see
above), simulated rise, real weather shown alongside as context, not as an
input. Conflating the two would overclaim a rainfall-runoff/hydrology model
this app doesn't have. `frontend/src/data/providers.ts`'s `weatherProvider` now
reports genuine live/unavailable state in the "Data sources" panel (a real
Open-Meteo reachability check), rather than a permanent stub — but a live
weather source does **not** upgrade the parcel-data MODE indicator (A/B/C),
since that's specifically about parcel-geometry provenance, not weather.

## Flood-risk guidance — illustrative, not official

The Terrain Mapping page's **"How this works"** card maps each impact level
(Low/Moderate/High/Severe, from `impact_from_depth` in `backend/app/flood.py`) to
general guidance text (`IMPACT_GUIDANCE`). This is **illustrative only** — a
depth-threshold heuristic over a simulated water level, not an official
hazard assessment, evacuation order, or emergency-management product. It
explicitly directs the reader to their local municipal/disaster-management
authority for real decisions, and never uses "confirmed" or directive
legal/safety language.

## Per-parcel what-if mitigation — mixed real physics + illustrative assumption

Selecting a parcel — on **either** the Terrain Mapping page's "Parcel
impact" card, or the main Parcel Mapping page's Land Twin panel ("Flood
vulnerability & what-if" section, sharing the same `useWhatIf` hook) — shows
why it's vulnerable and lets you test two kinds of intervention. The two are
computed differently and must stay visually distinguished — this is the
core "so what" of the whole flood feature, so the honesty boundary here
matters more than almost anywhere else in the app:

- **Real elevation, real road distance, real current depth.** `GET
  /api/simulation/whatif` (`backend/app/flood.py`'s `FloodEngine.what_if`)
  recomputes depth from the parcel's actual elevation (see "Elevation &
  terrain" above) and the live simulated water level — this is the same real
  arithmetic `compute_impact()` uses, just for one parcel on demand. Nearest
  road name/distance is real OpenStreetMap road geometry (see "Reference
  data" above); for the synthetic demo dataset this is computed at server
  startup against the same real Overpass road data used for the Roads layer
  (`backend/app/roads.py` + `main.py`'s `_with_nearest_road`), not
  fabricated — OSM-derived parcels already carry it natively.
- **"Raise plinth" is real, defensible physics.** `depth = water_level −
  (elevation + raise)`. No assumption beyond "the structure's base is now
  physically higher," which is exactly what the arithmetic computes.
- **"Drainage / retention" is a user-chosen assumption, not a simulation.**
  This app has no drainage-network, soil, or rainfall-runoff data, so it
  cannot honestly simulate what a real drainage upgrade or retention basin
  would do. The preset values (−0.15 m "minor drainage", −0.30 m "retention
  basin") are illustrative local water-level reductions the user selects —
  labeled as such in the UI, never presented as a hydraulic result.
- Elevation percentile ("lower than X% of parcels here") is computed
  client-side from the same real `elevMin`/`elevMax` already in the live
  simulation snapshot.

## Places & geocoding — REAL (Google Maps Platform, optional)

Two things OpenStreetMap genuinely can't cover well for this area — search
for a real-world address, and business/POI names near a parcel (OSM
name/address tagging is sparse here, ~5% coverage) — can optionally be
backed by **Google Maps Platform**, proxied server-side so the API key never
reaches the browser:

- **`backend/app/google.py`** — `geocode(query)` (Geocoding API) and
  `nearbyPlaces(lat, lon)` (Places API — Nearby Search, New), each with a
  1h in-memory cache to avoid duplicate billed calls for the same
  query/parcel. Routes: `GET /api/geocode?q=`, `GET /api/places/nearby?lat=&lon=`.
- **Opt-in, needs your own key.** Set `GOOGLE_MAPS_API_KEY` in
  `backend/.env` (see `backend/.env.example`) — a billing-enabled Google Cloud project with
  the "Geocoding API" and "Places API (New)" turned on. Without it, both
  routes return a clean `503` and the UI simply omits the affected
  features (a "Search address instead" link in the Search card when no
  local parcel matches; a "Nearby (Google Places)" section in the Land Twin
  panel) — every other feature in this app is unaffected.
- **Why not Roads API too:** real OSM road geometry is already fetched
  server-side (see above) and rendered as a free layer — paying Google for
  the same thing would be redundant, so only Places + Geocoding are wired
  up.
- **Config:** `backend/app/config.py` loads `backend/.env` (then a repo-root
  `.env`) via python-dotenv; real environment variables win. Set
  `GOOGLE_MAPS_API_KEY` there — see `backend/.env.example`.

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
`frontend/src/data/providers.ts` (or a server-side fetch + `/api` endpoint for
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

- `frontend/src/ai/analyze.ts` is a **deterministic rule/heuristic engine**, not a
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

1. Implement `LandDataProvider` for a real source in `frontend/src/data/providers.ts`
   (`isAvailable`, `getParcels`, `getBuildings`), returning geometry
   normalised to `ParcelProperties` (`frontend/src/types.ts`). Add it to
   `ALL_PROVIDERS` ahead of `demoDataProvider`.
2. Reproject to EPSG:4326, validate geometry, drop/repair invalid polygons.
3. Redact any personal ownership data before it reaches the client.
4. Replace the heuristic AI with a real model behind the same `LocalLandAI`
   interface if desired.
5. `resolveDataStack()` will then report MODE A / B and mark sources `live`.
