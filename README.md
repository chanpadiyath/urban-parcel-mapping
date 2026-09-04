# Urban Parcel Intelligence — Indian Land Twin (prototype)

A geospatial-intelligence prototype: an interactive 2D/3D map of an Indian
urban area (**T. Nagar, Chennai** by default) where every parcel has a **Land
Twin** — a live digital record combining geometry, Indian administrative
identity, land classification, area & potential-encroachment analysis,
time-series change, and a continuously running **on-device AI** intelligence
layer, all behind a pluggable data-provider architecture with an explicit
live / cached / demo mode indicator.

> **This build runs in MODE C (Demonstration).** No official Indian
> land-record API, satellite change-detection feed, or weather feed is
> connected (there is no lawful public endpoint configured). Parcel geometry
> is a **derived regular grid at a real location**, not verified cadastral
> boundary. Survey numbers, ownership status, encroachment, valuations,
> confidence and timestamps are **synthetic**. Every such value is labelled in
> the UI. See [`DATA.md`](./DATA.md).

## Quick start

Requires Node 20.19+.

```bash
npm install
npm run dev        # http://localhost:5173
```

`npm run gen:data` regenerates the demo GeoJSON (runs automatically before
`dev` / `build`). Location is configurable — see `.env.example`
(`VITE_DEMO_LAT/LON/CITY/STATE`, and `DEMO_LAT/…` for the generator).

## Production build

```bash
npm run build      # tsc --noEmit + vite build -> dist/
npm run preview
```

Static bundle, no backend. `dist/` also emits a small Web Worker chunk
(`localLandAI.worker-*.js`).

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
- **Layer manager** — parcels, land-use fill, buildings, AI detections
  toggle independently; roads / water / vegetation / admin boundaries are
  listed **disabled** ("needs external data source").

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
names) · **Local AI insights** (list) · **Data sources** · disclaimer.

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
- Rising water level vs a **synthesised demo elevation surface** (gradient from
  a low SW "river/coast" corner + gentle noise — *not* a real DEM). A parcel
  floods when the level exceeds its demo elevation; depth = level − elevation.
  Water visibly spreads outward from the low ground as the level rises.
- **Impact analytics** (from real geometry/attributes): affected parcels,
  buildings, roads (grid rows/cols touched, approx), area (ha + %), critical
  infrastructure (Institutional / Public), max depth, sim clock.
- **Click a flooded parcel** → depth, impact level, land use, building present,
  encroachment, sim time — showing Parcel Mapping → Land Twin → Simulation.
- Labelled **SIMULATION / DEMO MODE** throughout. No backend (none exists) —
  runs deterministically in the browser (fallback Level 3).

Files: `src/sim/flood.ts` (elevation model + impact maths, pure),
`src/sim/useFloodSim.ts` (timer/state), `src/components/SimMap.tsx` (2D map,
depth-ramp fill via `feature-state`), `src/pages/SimulationPage.tsx`.

## Architecture

```
public/demo-parcels.geojson     144 derived Indian parcels (Chennai), synthetic attributes + time-series
public/demo-buildings.geojson   122 estimated building footprints / heights
src/config.ts                   DEMO location + basemap URLs + sync cadence (env-driven, Chennai defaults)
src/data/providers.ts           LandDataProvider interface, demo provider, API stubs, resolveDataStack()
src/realtime/useLandTwinSync.ts controlled real-time loop + event feed
src/ai/analyze.ts               deterministic Land-AI engine + NL query parser
src/ai/localLandAI.worker.ts    Web Worker wrapper
src/ai/useLocalLandAI.ts        worker orchestration + inline fallback + status
src/metrics.ts                  runtime-derived metrics (area, discrepancy, deltas, FAR…) + ₹/sq-ft formatters, all guarded
src/components/MapView.tsx      MapLibre map: parcel fill/line, AI-detection line, 3D buildings, basemap swap, layers, camera
src/components/Sidebar.tsx      mode banner, data sources, dashboard, Local AI + command bar, view, layers, search, filters, legend, event stream
src/components/LandTwinPanel.tsx  the Land Twin record
src/App.tsx                     data-stack load, all state, wiring, dashboard/stats, neighbours, command handling
scripts/generate-demo-parcels.mjs  re-runnable generator (env-configurable location)
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

- **Live APIs unavailable →** provider stack falls through to bundled demo data; MODE C shown.
- **Web Worker unavailable →** Local AI runs inline; status shows `FALLBACK`.
- **AI error →** app keeps working; deterministic filters still serve the command bar.
- **3D unstable →** the 2D toggle is a pure MapLibre 2D view, no reload.
- **Missing env vars →** Chennai defaults in `src/config.ts`.

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
  `src/data/providers.ts` (`isAvailable`, `getParcels`, `getBuildings`) and
  add it to `ALL_PROVIDERS` before the demo provider — the UI and mode
  indicator adapt automatically.
- No automated `lint` / `test` npm scripts.
