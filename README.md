# Urban Parcel Intelligence — Prototype

Interactive **Urban Parcel Intelligence / Spatial Information System** concept
prototype. It demonstrates the core municipal-planning workflow: navigate a
**3D city view** → select a parcel → inspect its planning intelligence (area
breakdown, built-up ratio, encroachment, zoning, FAR, estimated building
height, development status), plus search, multi-facet filtering, a dataset
overview, an encroachment map view, and a 2D/3D toggle.

The map shows **synthetic demo parcels** and **estimated building footprints /
heights**, not real cadastral or surveyed data. Encroachment and planning
figures are fabricated for demonstration — not official determinations. See
[`DATA.md`](./DATA.md).

## Quick start

Requires Node 20.19+ (see `.nvmrc`).

```bash
npm install
npm run dev
```

Open the URL Vite prints (default http://localhost:5173). The demo GeoJSON is
regenerated automatically before `dev` and `build`; run it manually with
`npm run gen:data`.

## Production build

```bash
npm run build     # tsc --noEmit + vite build -> dist/
npm run preview   # serve dist/ locally to verify
```

`dist/` is a static bundle (`vite.config.ts` sets `base: "./"`), hostable from
any static file server or sub-path. No backend.

## What works

| Capability | Status |
|---|---|
| Application shell — SIS header (brand + live dataset indicator + PROTOTYPE DATASET badge), control sidebar, map, docked info panel, status bar | ✅ |
| **3D map** — pitched (42°) & rotatable (right-drag / Ctrl-drag), navigation w/ tilt+compass, fullscreen, scale, "Reset view" (restores the mode's camera) | ✅ MapLibre native |
| **Estimated building extrusion** — `fill-extrusion` from `demo-buildings.geojson` (95 footprints, height = floors × 3.2 m), vertical gradient, selection/hover highlight | ✅ demo geometry, labelled estimated |
| **2D ⇄ 3D toggle** — eases pitch/bearing to 0 and hides buildings; preserves selection, filters, colour mode, location | ✅ |
| Parcel layer from local GeoJSON — 100 synthetic parcels | ✅ |
| Two parcel colouring modes — by **land use** or by **encroachment severity** (toggle) | ✅ |
| Hover feedback (mid outline) + click parcel *or building* → select + highlight (dark outline + amber building) | ✅ MapLibre `feature-state` |
| Parcel info panel — sectioned: badges (status + encroachment + DEMO DATA), **Area analysis** (composition bar + parcel/built-up/open/encroachment/RoW areas with %), **Development intelligence** (ground coverage, FAR est., built-up ratio, **building height est.**), Parcel overview, Planning, Assessment | ✅ derived at runtime, missing → `—`, disclaimer shown |
| Dataset **Overview** strip — parcels shown, total area, built-up area, avg built-up %, encroached share, vacant share, from the (filtered) dataset | ✅ 6 tiles |
| Search by parcel ID / address / locality → result list with count → pick → map flies + selects | ✅ |
| Filters — land use, zoning, development status, encroachment, minimum area; "N of 100 match filters"; also filters the building layer; selection cleared if filtered out | ✅ |
| Encroachment visualisation — metric-only (colour by severity), no fabricated encroachment geometry | ✅ |
| Legend — switches between land-use / encroachment keys; adds a building entry in 3D | ✅ |
| Status bar — cursor lat/lng, zoom, **tilt° + 2D/3D**, visible/total parcels, "Prototype dataset", attribution | ✅ |
| Loading (spinner) / error (with **Retry**) / empty-result states | ✅ |

Fallback hierarchy (per the brief): shipped at **Level 1 — full 3D**. The 2D
toggle is the built-in Level 4 path (pure MapLibre 2D) with no reload. Git
tag `stable-2d` marks the pre-3D version.

Not built (deferred): terrain, GLTF/3D models, time-series charts,
measurement/drawing/export, real-data ingest pipeline, automated test runner,
auth, backend, deploy pipeline.

## Architecture

Single-page React app, no backend.

```
public/demo-parcels.geojson         generated synthetic parcels, fetched at runtime
public/demo-buildings.geojson       generated estimated building footprints + heights
src/App.tsx                          data load (both files); selection / search / filter / style-mode / view-mode state; layout; overview stats
src/components/MapView.tsx           MapLibre GL map; parcel fill+line + building fill-extrusion; hover/click; id-list filter; colour mode; 2D/3D camera; fly-to; reset view
src/components/ControlPanel.tsx      overview strip, 2D/3D + colour-mode toggles, search + results, filter selects, legend
src/components/InfoPanel.tsx         sectioned parcel intelligence panel (uses metrics.ts)
src/metrics.ts                       derived metrics (built-up %, open area, encroachment %, FAR, ground coverage, est. building height) + formatters, all zero/missing-guarded
src/types.ts                         parcel + building schemas, colour maps, filter fields, info-panel sections
src/geo.ts                           bounding-box helpers
scripts/generate-demo-parcels.mjs   re-runnable synthetic parcel + building generator
```

Data flow is one-directional: map / search / filter interactions update React
state in `App`; `App` derives an overview-stats object and a list of visible
parcel IDs, and passes `selectedId`, `styleMode`, `visibleIds`, and a
`focusBounds` box to `MapView`, which reflects them into the map. Filtering
uses an `["in", parcel_id, [...]]` expression so any derived predicate works
without changing the data.

## Tech decisions log

| Date | Decision | Reason |
|---|---|---|
| 2026-09-04 | React 18 + TypeScript + Vite 7 | Matches `CLAUDE.md` §4; smallest standard SPA path. Vite 7 (not 5) so `npm audit` is clean — the Vite 5 line has unpatched dev-server advisories. |
| 2026-09-04 | MapLibre GL JS for the map | Matches §4; keyless, `feature-state` hover/selection built in, native vector styling for filters and categorical colour. |
| 2026-09-04 | No backend | Dataset is ~65 KB static GeoJSON; an API would add cost with no benefit. |
| 2026-09-04 | Demo data in `public/`, generated by `scripts/` | Single source, fetched at runtime, works offline. `data/` reserved for future real-data samples. |
| 2026-09-04 | OpenStreetMap raster tiles as base map | Keyless. Low-volume prototype use; usage policy noted in `DATA.md`. Override with `VITE_BASEMAP_TILE_URL`. |
| 2026-09-04 | Parcels coloured by `land_use` / `encroachment` (categorical, toggle) | Reads as a real GIS product; selection shown via outline not colour, so the category stays visible when selected. |
| 2026-09-04 | Derived metrics computed at runtime in `metrics.ts`, not stored | Keeps the dataset to raw measured quantities; percentages/FAR/coverage are computed with zero/missing guards so a bad record can't crash a render. |
| 2026-09-04 | Filtering via `["in", parcel_id, [...]]` id-list expression | One mechanism handles equality filters, the area threshold, and any future derived predicate; drives the parcel fill/line and the building layer alike. |
| 2026-09-04 | 3D via MapLibre's native pitch/bearing + `fill-extrusion` | No engine migration, no new dependencies. Level 1 of the brief's fallback hierarchy; the 2D toggle is the built-in fallback. |
| 2026-09-04 | Buildings as a separate generated GeoJSON, not runtime-derived | One re-runnable source of truth; real footprints can replace the file without touching the app. Footprint sized to the built-up area, height = floors × 3.2 m, all labelled **estimated**. |

## Demo flow (~50 s)

1. App loads in **3D** (pitch 42°) → SIS header, left panel (Overview / View / Map colouring / Search / Filters / Legend), city view with extruded buildings over the parcel grid.
2. Right-drag / Ctrl-drag to **rotate & tilt**; scroll to zoom. **Reset view** restores the 3D camera.
3. Overview strip: parcels shown, total area, built-up area, avg built-up %, encroached share, vacant share.
4. Hover a parcel or building → outline; click → dark parcel outline + amber building + info panel opens.
5. Info panel: status + encroachment + DEMO DATA badges; **Area analysis** composition bar + area rows with %; **Development intelligence** (ground coverage, FAR est., **building height est.**); Planning; Assessment; disclaimer.
6. **Map colouring → Encroachment** → parcels recolour by severity, legend switches.
7. Search `riverside` or `UPI-004` → results with count → pick one → map flies + selects.
8. **Filters → Development status = Encroached** + **Encroachment = Significant** → parcels *and buildings* narrow; Overview + "N of 100 match filters" update; a filtered-out selection closes. **Clear** resets.
9. **View → 2D** → camera flattens, buildings hide, selection/filters preserved. Status bar tracks lat/lng, zoom, tilt°, 2D/3D, visible count.

## Notes

- The production JS bundle is ~974 KB (~273 KB gzip); almost all of it is
  MapLibre GL. Acceptable for a prototype; code-splitting is a later concern.
- No automated test runner is wired up. A headless SSR smoke test
  (`renderToString` of the real modules via Vite SSR + `metrics.ts` unit
  assertions, 32 checks) verifies render paths and the derived-metric maths.
- 3D rendering, camera interaction, and building extrusion could not be
  verified in a real browser in the build environment (no browser tooling);
  the code compiles, type-checks, loads, and uses only stock MapLibre APIs.
