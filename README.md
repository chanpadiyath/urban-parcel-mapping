# Urban Parcel Intelligence — Indian Land Twin (prototype)

A geospatial-intelligence prototype: an interactive 2D/3D map of an Indian
urban area (**T. Nagar, Chennai** by default) where every parcel has a **Land
Twin** — a live digital record combining geometry, Indian administrative
identity, land classification, area & potential-encroachment analysis,
time-series change, and a continuously running **on-device AI** intelligence
layer, all behind a pluggable data-provider architecture with an explicit
live / cached / demo mode indicator.

> **Data modes.** With the backend running (`npm run dev`) the app loads **real, live OpenStreetMap building footprints** for
> the area (via the Overpass API) as the parcel dataset — **MODE B**. Real
> geometry, area, land-use tags, road distances, names/storeys where OSM has
> them. Fields with **no public data source** — ownership, survey number,
> encroachment, guideline value, tenure — are shown as *not available*, never
> fabricated. If OpenStreetMap can't be loaded, the backend serves the **synthetic MODE C**
> dataset (a derived grid; clearly labelled).
>
> **What has no real source, anywhere:** India has **no public API for
> cadastral parcel geometry** — state land-record portals are CAPTCHA-gated,
> per-record web forms. So "real parcels" here means real *OSM building
> footprints*, not official plot boundaries. See [`DATA.md`](./DATA.md) for
> the six production paths to authoritative cadastral data.

## Project layout

Two independent apps in one repo:

```
frontend/   TypeScript · React · Vite · MapLibre GL — the browser app (static build)
backend/    Python 3.12+ · FastAPI — the API: simulation engine, OSM + elevation data, Google proxy
scripts/    tiny Node helpers so one command runs both (no dependencies)
DATA.md     data sources, provenance, limits        CLAUDE.md   project rules
```

The frontend only talks to the backend over `/api/*` (REST + Server-Sent
Events). All models and data logic live in the backend; the frontend renders
and controls them.

## Quick start

Requires **Node 20.19+** (frontend) and **Python 3.12+** (backend).

```bash
npm run setup      # one time: frontend npm install + backend venv + pip install
npm run dev        # frontend http://localhost:5173  +  backend http://localhost:8787
```

Other commands (all from the repo root):

| Command | What it does |
|---|---|
| `npm run dev:web` / `npm run dev:api` | run just one side |
| `npm test` | backend tests (pytest) |
| `npm run build` | type-check + production build of the frontend → `frontend/dist/` |
| `npm run gen:data` | regenerate the synthetic demo GeoJSON (`backend/data/`) |
| `npm run gen:elevation -- --site chennai` | fetch real DEM elevation from Open Topo Data → `backend/data/elevation-<site>.json` (manual, one-time — DEM data doesn't change) |

Configuration is by environment: frontend `VITE_*` in `frontend/.env.local`
(see `frontend/.env.example`), backend in `backend/.env` (see
`backend/.env.example` — port, CORS, optional `GOOGLE_MAPS_API_KEY`). The
backend also reads a repo-root `.env`.

The frontend needs the backend running — without it the app shows a
"data unavailable" state with Retry (there is no in-browser fallback engine).

## Deploying (two pieces)

See **[`DEPLOY.md`](./DEPLOY.md)** for step-by-step free hosting (Netlify +
Render, config already committed as [`netlify.toml`](./netlify.toml) /
[`render.yaml`](./render.yaml)). The short version, for any static host +
Python host:

```bash
npm run build                      # frontend/dist/ — host as static files anywhere
cd backend && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8787   # or a container / Python host
```

Set `VITE_SIM_API` to the backend's public URL (+ `/api`) at frontend build
time, and add the frontend's origin to the backend's `CORS_ORIGINS`.

## What works

### Map & 3D
- MapLibre GL, opens over Chennai. **2D / 3D toggle** (pitch 45° + rotate via
  right-drag / Ctrl-drag), **Map / Satellite** basemap switch (OSM / Esri
  World Imagery — both keyless), navigation w/ tilt-compass, fullscreen,
  scale, **Reset view**.
- **Parcels** — 144 derived plots; fill colour by **land use / potential
  encroachment / boundary confidence** (toggle). Hover + click (parcel or
  building) → select + highlight.
- **Buildings (3D)** — `fill-extrusion` from 122 estimated footprints
  (height = floors × 3.2 m), labelled estimated.
- **AI detections layer** — dashed red outline on parcels carrying a potential
  encroachment / discrepancy flag. Metric-only — no fabricated encroachment
  geometry.
- **Layer manager** — parcels, land-use fill, buildings, AI detections,
  **roads** (real OpenStreetMap geometry, off by default) toggle
  independently; water / vegetation / admin boundaries remain **disabled**
  ("needs external data source").

### Land Twin panel (on select)
Badges (development status, encroachment level, boundary confidence, DEMO),
then sections: **Live status** (last sync, local-AI state, last analysis,
detected-change count) · **Land intelligence** (observed use, built-footprint
change, vegetation change, potential encroachment, construction-activity
inference; road/flood = "Data unavailable") · **Area & discrepancy** (mapped
vs reference area, potential discrepancy m²/%, boundary confidence, perimeter)
· **Built form** (built-up sq ft/m²/%, open area, floors, est. height, FAR,
ground coverage) · **Time series** (current → previous for built-up,
vegetation, encroachment) · **Planning** (zoning, tenure, agri status,
assessed value in ₹) · **Identity** (survey no, sub-division, ward, taluk,
local body, PIN, state) · **Ownership** ("Ownership data unavailable" — no
names) · **Local AI insights** (list) · **Nearby (Google Places)** — real
business/POI names near the parcel, opt-in, needs `GOOGLE_MAPS_API_KEY` (see
below) · **Data sources** · disclaimer.

### Land Simulation page
Real elevation (DEM) feeding a simulated flood event — see
[`DATA.md`](./DATA.md#elevation--terrain--real-open-topo-data-dem) for the
full picture. Also shows: a **"Real weather"** card (live current + 3-day
precipitation forecast, Open-Meteo, keyless) and a **"How this works"** card
explaining the model and giving illustrative per-impact-level guidance.

### Search
Local parcel-ID/address/ward/lat,lng match first; if nothing matches, a
**"Search address instead (Google)"** fallback geocodes a real-world address
and pans the map there — opt-in, needs `GOOGLE_MAPS_API_KEY`.

### Google Maps Platform (optional)
Two features — address search fallback and nearby-places parcel enrichment —
use Google's Geocoding + Places APIs, proxied server-side
(`backend/app/google.py`) so the key never reaches the browser. Everything else
in this app works without it. To enable: create a Google Cloud project with
billing, enable "Geocoding API" and "Places API (New)", generate a
restricted API key, and set `GOOGLE_MAPS_API_KEY` in `backend/.env` (copy
from `backend/.env.example`). Without a key, both features degrade cleanly to
"unavailable" — see [`DATA.md`](./DATA.md#places--geocoding--real-google-maps-platform-optional).

### Local Land AI
- `src/ai/analyze.ts` — a **deterministic heuristic engine** (not an ML
  model). Runs in a **Web Worker** when available (`state: running`), else
  inline (`state: fallback`); never blocks the map, never breaks the app.
- Produces hedged insights ("potential", "estimated", "appears") — each with
  category, **confidence 0–1**, **basis**, **source**, `requiresVerification`,
  timestamp. Never emits "confirmed" / "illegal".
- Re-analyses the selected parcel on selection and on the sync cadence
  (controlled interval, default 8 s — not per-frame).
- **AI command bar** — natural-ish queries → deterministic filters:
  "potential encroachment", "recent changes", "larger than 2000 sq ft",
  "low confidence", "residential parcels", "analyse this parcel". Unknown
  queries return a hint; nothing depends on an external LLM.

### Real-time & data architecture
- `src/data/providers.ts` — `LandDataProvider` interface + `demoDataProvider`
  (active) and `official / openMap / satellite / weather` **stubs**
  (`isAvailable → false`). `resolveDataStack()` tries best-first and lands on
  demo → **MODE C**. Sidebar shows every source's state (demo / unavailable)
  and "Live land-record API unavailable — demonstration dataset active".
- `src/realtime/useLandTwinSync.ts` — controlled heartbeat + real event feed
  (session start, sync, analysis, detection, AI). It is a *cadence*, not a
  data faker — it never invents land data.
- **Dashboard** — parcels shown, km² mapped, potential discrepancies, recent
  changes, high-confidence parcels, AI status — all computed from the
  (filtered) dataset.
- **Search** — parcel ID / survey no / ward / locality / `lat,lng` → fly +
  select + Land Twin + AI analysis.
- **Filters** — land use, zoning, development status, encroachment, tenure,
  min. boundary confidence; drives parcels + buildings + AI layer + stats.
- **States** — loading spinner, error + **Retry**, empty results.
- Status bar — cursor lat/lng, zoom, tilt°, 2D/3D, visible/total, MODE.

## Land Simulation page (`#/simulation`)

A separate view (header nav: **Parcel Mapping** / **Land Simulation**) — the
parcel map is untouched. A **client-side deterministic flood simulation** over
the real parcel geometry:

- **Controls:** Start / Pause / Reset, Speed ×1/×2/×5, ± Water level, timeline bar.
- Rising water level over **real elevation data** (Open Topo Data DEM — see
  [`DATA.md`](./DATA.md#elevation--terrain--real-open-topo-data-dem)). A parcel
  floods when the level exceeds its ground elevation; depth = level − elevation.
  The rise itself is a fixed-rate timer, *not* a rainfall/hydrology model.
- **Impact analytics** (from real geometry/attributes): affected parcels,
  buildings, roads (distinct named roads beside flooded parcels), area (ha + %),
  critical infrastructure (Institutional / Public), max depth, sim clock.
- **Click a flooded parcel** → depth, impact level, elevation, land use,
  building present, encroachment, sim time.
- Labelled **SIMULATION / DEMO MODE** throughout.

### Backend (`backend/`, FastAPI)

- **`app/main.py`** — routes. Owns the authoritative simulation state, advances
  it on a 500 ms timer, and **streams every update over SSE** to all clients.
- **`app/flood.py`** — the flood engine (real elevation + impact maths). It runs
  over the *same parcels the API serves* (real OSM footprints), so the map and
  the simulation always agree.
- **`app/elevation.py`** · **`reference.py`** · **`osm_parcels.py`** ·
  **`reconcile.py`** · **`google.py`** — DEM snapshot, OSM reference (Overpass),
  OSM→parcels, demo-vs-OSM cross-check, optional Google proxy.
- **`jobs/`** — re-runnable data prep: `generate_demo_parcels.py`,
  `fetch_elevation.py`. **`data/`** — small committed snapshots.
- **API:** `GET /api/health` · `/api/parcels` · `/api/demo/{parcels,buildings}` ·
  `/api/elevation/{site}` · `/api/reference/{status,osm,roads}` ·
  `POST /api/reference/refresh` · `/api/reconcile` ·
  `/api/simulation/{state,elevations,stream}` ·
  `POST /api/simulation/{start,pause,reset,flood}` ·
  `/api/geocode` · `/api/places/nearby`. Interactive docs at
  `http://localhost:8787/docs` while it runs.
- **Frontend side:** `frontend/src/sim/useServerSim.ts` (`EventSource` client),
  `useParcelElevations.ts`, `flood.ts` (types + guidance text only),
  `components/SimMap.tsx`, `pages/SimulationPage.tsx`.

## Architecture

```
backend/app/main.py                FastAPI routes + SSE
backend/app/flood.py               flood engine (real DEM + impact maths)
backend/app/elevation.py           real DEM snapshot loader / Open Topo Data fetcher
backend/app/reference.py           OSM reference store (Overpass, cache, committed snapshot)
backend/data/                      demo-parcels/buildings.geojson, osm-reference.json, elevation-<site>.json
backend/jobs/                      generate_demo_parcels.py, fetch_elevation.py
frontend/src/config.ts             DEMO location + basemap URLs + sync cadence (env-driven, Chennai defaults)
frontend/src/data/providers.ts     LandDataProvider interface, providers, resolveDataStack()
frontend/src/realtime/useLandTwinSync.ts  controlled real-time loop + event feed
frontend/src/ai/analyze.ts         deterministic Land-AI engine + NL query parser
frontend/src/ai/localLandAI.worker.ts     Web Worker wrapper
frontend/src/ai/useLocalLandAI.ts  worker orchestration + inline fallback + status
frontend/src/metrics.ts            runtime-derived metrics (area, discrepancy, deltas, FAR…) + ₹/sq-ft formatters
frontend/src/components/MapView.tsx       MapLibre map: parcels, AI detections, roads, 3D buildings, basemap swap, layers, camera
frontend/src/components/Sidebar.tsx       mode banner, data sources, dashboard, Local AI, view, layers, search, filters, legend, events
frontend/src/components/LandTwinPanel.tsx the Land Twin record
frontend/src/App.tsx               data-stack load, all state, wiring, dashboard/stats, neighbours, command handling
```

## Data provenance (what is what)

| Element | Provenance |
|---|---|
| Basemap tiles (Map / Satellite) | **Real** — OpenStreetMap / Esri World Imagery, keyless |
| Map location (Chennai coords) | **Real** — configurable |
| Parcel polygons | **Derived** — regular grid at the real location; *not* cadastral |
| Survey no / ward / taluk / PIN / zoning / land use / ownership status | **Demonstration** — synthetic, plausible Indian formatting |
| Areas, perimeter | **Computed** — geodesic, from the derived geometry |
| Built-up / vegetation / encroachment / discrepancy / confidence / valuation / time-series | **Demonstration** — fabricated, deterministic |
| Building footprints & heights | **Estimated** — sized to built-up area, floors × 3.2 m |
| AI insights | **AI-derived (heuristic)** — deterministic rules over the above; hedged, needs verification |
| Event stream | **Real** — reflects actual app activity (no fake data events) |

## Fallbacks (all automatic)

- **Live OSM unavailable →** the backend serves the bundled demo dataset; MODE C shown.
- **Web Worker unavailable →** Local AI runs inline; status shows `FALLBACK`.
- **AI error →** app keeps working; deterministic filters still serve the command bar.
- **3D unstable →** the 2D toggle is a pure MapLibre 2D view, no reload.
- **Missing env vars →** Chennai defaults in `frontend/src/config.ts`.
- **Backend unreachable →** the frontend shows "data unavailable" / "OFFLINE" with Retry; there is no in-browser engine.

## Checkpoints / rollback

| Tag / branch | State |
|---|---|
| `stable-2d` | pre-3D Urban Parcel Intelligence (2D) |
| `stable-3d` | 3D buildings + camera, pre-India |
| `main` | current — India Land Twin |
| branch `india-land-twin` | this work |

`git reset --hard stable-3d` restores the pre-India app.

## Notes / limitations

- Verified via `npm run build` (tsc + vite) and a headless SSR smoke test
  (58 checks: render paths, metric maths, analyser output & hedging, query
  parser, provider shapes). **Live browser rendering / 3D / worker execution
  were not verified here** — no browser tooling in the build environment.
- JS bundle ~996 KB (~280 KB gzip), mostly MapLibre. Worker chunk ~5 KB.
- To integrate a real land-record source: implement `LandDataProvider` in
  `frontend/src/data/providers.ts` (`isAvailable`, `getParcels`, `getBuildings`) and
  add it to `ALL_PROVIDERS` before the demo provider — the UI and mode
  indicator adapt automatically.
- Backend has a pytest suite (`npm test`); the frontend has no automated tests yet.

## Tech decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-09-20 | Split into `frontend/` (TypeScript) + `backend/` (Python/FastAPI); Node backend removed | Drone photogrammetry and terrain analysis tooling (OpenDroneMap, rasterio, GDAL, numpy) is Python-first; one owner for all models removes duplicated frontend/backend flood logic. Supersedes CLAUDE.md's "Backend: none for MVP". |
