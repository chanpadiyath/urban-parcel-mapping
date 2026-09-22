# CLAUDE.md — Urban Parcel Mapping

Persistent instructions for Claude Code working on this project. Read this before every task. If a request conflicts with these rules, flag the conflict before proceeding.

---

## 1. Project Objectives

- Build a web application that displays urban land parcels on an interactive map.
- Let a user find a parcel (by click, search, or address) and view its attributes: parcel ID, address, area, zoning, land use, owner/jurisdiction, and last-updated date.
- Support basic spatial context: parcel boundaries, adjacent parcels, and a base map for orientation.
- Produce something a stakeholder can open in a browser and use in a live demo without a walkthrough.

Non-objectives (explicitly out of scope for now): cadastral-grade legal accuracy, multi-user editing, authentication/accounts, payment, offline support, mobile-native apps.

---

## 2. MVP Requirements

The MVP is done when all of the following work end-to-end in a browser:

1. **Map loads** with a base map centered on the target city/area at a sensible zoom.
2. **Parcels render** as polygons from a GeoJSON dataset (bundled or served locally).
3. **Click a parcel** → it highlights and an info panel shows its attributes.
4. **Search** by parcel ID or address string → map pans/zooms to the match and selects it.
5. **Attribute panel** shows a clean, readable list of fields with graceful handling of missing values.
6. **Basic filter** — at least one: filter/highlight parcels by zoning or land-use category.
7. **Runs with one command** (`npm run dev` or documented equivalent) and has a short README section on how to start it.
8. **Deployable as static build** or trivially hostable, so the demo does not depend on a laptop dev server if avoidable.

Anything beyond this list is a stretch goal and must not delay items 1–8.

---

## 3. Development Priorities

In strict order. Do not start a lower item while a higher item is broken.

1. **Working demo path** — the click-to-attributes flow on real-ish data.
2. **Data pipeline** — get parcel GeoJSON loading reliably, with a documented source and a small committed sample.
3. **Search + filter** — the two interactions that make a demo feel real.
4. **Polish the UI** — layout, legibility, loading/empty/error states.
5. **Tests** — cover data loading, geometry parsing, and attribute lookup.
6. **Deploy target** — static hosting or container.
7. **Stretch goals** — measurement tools, multi-layer overlays, export, drawing, clustering, print/report view.

When in doubt, cut scope toward a smaller dataset and fewer features, not toward more time.

---

## 4. Technology Decisions

Locked for the MVP unless the user approves a change:

| Area | Choice | Rationale |
|---|---|---|
| Language | TypeScript | Type safety on geometry/attribute shapes; catches data bugs early. |
| Build tool | Vite | Fast start, simple static build. |
| UI framework | React | Ubiquitous, easy to hand off. |
| Map library | MapLibre GL JS | Free vector rendering, good performance on parcel polygons, no API key. Leaflet is an acceptable fallback if MapLibre causes trouble. |
| Base map | Free raster/vector tiles that need no key for dev (e.g. OSM raster). Document the tile source and its usage terms. |
| Styling | Plain CSS or a single lightweight utility layer. No heavy component library. |
| State | React state / context. No Redux. |
| Backend | **Python + FastAPI** (`backend/`), added 2026-09-20 with user approval — see the README tech decisions log. Owns all data logic and models (flood engine, OSM reference, elevation, Google proxy); the frontend is a separate static build that only calls `/api/*`. Python 3.12+, venv in `backend/.venv`, pytest for tests. |
| Data store | Flat GeoJSON files in the repo for the sample; larger data via a documented download script. Introduce PostGIS only if a backend becomes necessary. |
| Package manager | npm for the frontend (committed `frontend/package-lock.json`); pip + `backend/requirements*.txt` for the backend. |
| Node | Frontend only. LTS release; pinned in `frontend/.nvmrc` and `engines`. |

Record any deviation from this table in a short "Tech decisions log" section of the README with the date and reason.

---

## 5. Geospatial Data Handling

- **Interchange format:** GeoJSON (RFC 7946). Coordinate order is `[longitude, latitude]`.
- **CRS:** Store and serve data in EPSG:4326 (WGS84). Reproject at ingest time, not at render time. If source data is in a local projection (e.g. a state plane or UTM zone), convert it in the data prep script and note the original CRS.
- **Area/measurements:** Compute areas using an equal-area projection or a geodesic method — never from raw degrees. Label units explicitly (m² / hectares / acres).
- **Data prep:** All transforms (clip to study area, reproject, simplify, trim attributes) live in a committed, re-runnable job under `backend/jobs/`. Raw source data is not committed; the script downloads or points to it. Commit a small clipped sample (a few hundred parcels) so the app runs offline.
- **Geometry hygiene:** Expect invalid/self-intersecting polygons and multipolygons in real parcel data. Validate on ingest, fix or drop broken geometries, and log what was dropped. Simplify geometry for rendering (tolerance documented) but keep an unsimplified copy if precise area matters.
- **Attribute schema:** Define a TypeScript type for parcel properties (`frontend/src/types.ts`; the backend emits the matching JSON). Normalize field names to a documented internal schema; keep a mapping from source field names. Every parcel needs a stable unique ID.
- **Size limits:** Keep the bundled GeoJSON small enough to load fast (target < 5 MB, ideally < 2 MB). If the real dataset is larger, tile it (vector tiles / PMTiles) or paginate by viewport — do not ship a giant blob.
- **Licensing:** Record the data source, license, and attribution requirements in `DATA.md`. Display required attribution in the UI.
- **Privacy:** Treat owner names and any personal information as sensitive — see Security.

---

## 6. UI Requirements

- **Layout:** Map fills the viewport. Collapsible side panel for parcel attributes. Search box top-anchored. Legend/filter control in a corner.
- **Selection:** Clicking a parcel highlights it with an obvious style change and opens the panel. Clicking empty space or a close button clears selection.
- **Feedback states:** Every async action has a visible loading state. Handle and show: data-load failure, no search results, parcel with missing attributes, empty filter result.
- **Legibility:** High-contrast parcel outlines over the base map. Don't rely on color alone for filter categories — use labels in the legend.
- **Responsiveness:** Must be usable on a laptop and a projector (the demo). Basic tablet width should not break layout. Mobile is best-effort.
- **Performance:** Map interaction stays smooth with the full sample dataset loaded. Avoid re-rendering all features on every hover.
- **Accessibility (baseline):** Keyboard-focusable search and panel controls, sensible alt/aria labels, visible focus outlines. Full a11y is a stretch goal; don't ship obvious blockers.
- **No dead UI:** Do not add buttons or controls that aren't wired up. A smaller working UI beats a large fake one.

---

## 7. Testing

- **Framework:** Vitest + React Testing Library. Keep setup minimal.
- **Must-have coverage (MVP):**
  - GeoJSON loads and parses; feature count and required fields are present.
  - CRS/coordinate sanity: coordinates fall within expected bounds for the study area.
  - Attribute lookup by parcel ID returns the right feature.
  - Search resolves a known ID and a known address to the correct parcel.
  - Filter reduces the visible set as expected.
  - Missing-attribute rendering does not throw.
- **Nice-to-have:** area calculation correctness against a known parcel, geometry validation on a fixture with a broken polygon.
- **Practices:** Use a small committed fixture, not the full dataset, in tests. Every bug fix gets a regression test. Tests must pass before any commit. Keep the suite fast (seconds).
- **Not required for MVP:** E2E/browser automation, visual regression, coverage thresholds.

---

## 8. Security

- **Secrets:** No API keys or tokens committed. Use `.env` (gitignored) and provide `.env.example`. Prefer keyless tile/data sources for the MVP.
- **PII:** Parcel owner names, mailing addresses, and similar fields are sensitive. For a public demo, prefer a dataset without owner PII, or redact/aggregate those fields in the data prep script. If PII must be shown, confirm with the user first and document it in `DATA.md`.
- **Input handling:** Treat search input as untrusted. No HTML injection into the panel — render attribute values as text. Validate/parse any uploaded or fetched GeoJSON before use; guard against oversized payloads.
- **Dependencies:** Keep the dependency list small. Run `npm audit` before milestones; fix high/critical. Pin versions via lockfile.
- **If a backend is added:** CORS locked to known origins, rate-limit public endpoints, no raw error/stack traces in responses, no SQL string interpolation (parameterized queries only).
- **Hosting:** Serve over HTTPS. Set basic security headers on the deployed static site.
- **Client storage:** Don't persist sensitive data in localStorage. Local storage is fine only for non-sensitive UI preferences.

---

## 9. Deadline Mode

**This project is in deadline mode by default.** Until the user says otherwise:

- Ship the smallest thing that satisfies the MVP list in section 2. A working narrow demo beats an unfinished broad one.
- Prefer boring, well-known solutions over clever or novel ones.
- Hardcode reasonable defaults (city center, zoom, dataset path) instead of building configuration systems.
- If a task is blocked or ballooning, stop and surface the blocker with 2–3 concrete options rather than grinding.
- Defer: refactors, abstraction layers, performance tuning beyond "smooth in the demo", exhaustive tests, multi-environment config, custom design systems.
- Time-box exploration. If an approach isn't working after a reasonable attempt, fall back to the documented alternative (e.g. Leaflet instead of MapLibre).
- Keep `main` demoable at all times. Don't leave the app broken between sessions — commit working increments.
- Call out scope creep explicitly: if a request goes beyond the MVP, say so and ask whether it's a stretch goal.

Exit deadline mode only on an explicit instruction from the user.

---

## 10. Claude Code Behavior

- **Do not build the application until asked.** This file is setup only. Wait for an explicit go-ahead before scaffolding code.
- **Plan before large changes.** For anything touching multiple files or the data pipeline, outline the approach and get agreement first.
- **Respect the priority order** in section 3. Don't polish UI while the demo path is broken; don't add stretch goals while MVP items are open.
- **Keep changes small and reviewable.** Prefer several focused commits over one large one. Match the style of existing code.
- **Verify before claiming done.** Run the app and the tests. Report actual results, including failures and skipped steps — never assume.
- **Surface trade-offs concisely.** Give a recommendation, not an exhaustive survey. Ask a question only when the answer changes what you'd do.
- **Don't add dependencies casually.** Justify each new package against the "small dependency list" rule. Get approval for anything not implied by section 4.
- **Never commit secrets or PII.** Check diffs for keys, tokens, and owner data before committing.
- **Update docs alongside code.** When tech decisions, data sources, or run steps change, update this file, the README, and `DATA.md` in the same change.
- **Confirm irreversible or outward-facing actions** (deploys, force pushes, deleting data, publishing) before doing them.
- **Attribution:** follow the commit and PR attribution rules configured for this session.

---

## Repository Conventions

- `frontend/` — TypeScript/React/Vite app (`src/`, `index.html`, its own `package.json`)
- `backend/` — Python/FastAPI (`app/` API + models, `jobs/` data prep, `data/` small committed snapshots, `tests/` pytest)
- `scripts/` — Node helpers so `npm run dev|setup|test|gen:*` at the repo root drive both sides
- `frontend/src/**` co-located tests when added (Vitest); backend tests in `backend/tests/`
- `DATA.md` — data sources, licenses, attribution, PII notes
- `README.md` — quick start, run commands, tech decisions log
- Secrets: `backend/.env` (gitignored); never `VITE_*` — those ship to the browser
