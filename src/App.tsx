import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapView, { type LayerVisibility, type ViewState } from "./components/MapView";
import LandTwinPanel from "./components/LandTwinPanel";
import Sidebar, { type DashboardStats, type SearchHit } from "./components/Sidebar";
import {
  EMPTY_FILTERS,
  FILTER_FIELDS,
  MAP_LAYERS,
  type BasemapId,
  type FilterKey,
  type Filters,
  type ParcelFeature,
  type ParcelProperties,
  type StyleMode,
  type ViewMode,
} from "./types";
import { deriveMetrics } from "./metrics";
import { geometryBounds, type BBox } from "./geo";
import { DEMO } from "./config";
import { resolveDataStack, type DataStack } from "./data/providers";
import { useReconciliation } from "./data/reconcile";
import { useLocalLandAI } from "./ai/useLocalLandAI";
import { parseQuery } from "./ai/analyze";
import { useLandTwinSync } from "./realtime/useLandTwinSync";
import SimulationPage from "./pages/SimulationPage";

const MAX_RESULTS = 12;

type Page = "map" | "sim";
function pageFromHash(): Page {
  return typeof window !== "undefined" && window.location.hash.replace(/^#/, "").startsWith("/simulation")
    ? "sim"
    : "map";
}

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; stack: DataStack };

const DEFAULT_LAYERS: Record<string, boolean> = Object.fromEntries(
  MAP_LAYERS.map((l) => [l.id, l.available && l.defaultOn]),
);

function centroid(f: ParcelFeature): [number, number] {
  const b = geometryBounds(f.geometry);
  return b ? [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2] : [0, 0];
}

function passesFilters(p: ParcelProperties, f: Filters): boolean {
  for (const { key } of FILTER_FIELDS) {
    if (f[key] && String(p[key] ?? "") !== f[key]) return false;
  }
  if (f.minConfidence > 0 && !(typeof p.boundary_confidence === "number" && p.boundary_confidence >= f.minConfidence)) {
    return false;
  }
  return true;
}

export default function App() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<ParcelProperties | null>(null);
  const [query, setQuery] = useState("");
  const [cmd, setCmd] = useState("");
  const [cmdNote, setCmdNote] = useState<string | null>(null);
  const [cmdPredicate, setCmdPredicate] = useState<null | ((p: ParcelProperties) => boolean)>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [styleMode, setStyleMode] = useState<StyleMode>("land_use");
  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  const [basemap, setBasemap] = useState<BasemapId>("map");
  const [layerState, setLayerState] = useState<Record<string, boolean>>(DEFAULT_LAYERS);
  const [focusBounds, setFocusBounds] = useState<BBox | null>(null);
  const [view, setView] = useState<ViewState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [page, setPage] = useState<Page>(pageFromHash);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const go = useCallback((p: Page) => {
    window.location.hash = p === "sim" ? "/simulation" : "/";
    setPage(p);
  }, []);

  const ai = useLocalLandAI();
  const ready = load.status === "ready";
  const sync = useLandTwinSync(ready);
  const recon = useReconciliation();
  const reconResult = recon.state.status === "ready" ? recon.state.data : null;
  const reconStatus: "loading" | "ready" | "unavailable" =
    recon.state.status === "ready" ? "ready" : recon.state.status === "loading" ? "loading" : "unavailable";

  // clock for relative timestamps
  useEffect(() => {
    const iv = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(iv);
  }, []);

  // load data stack
  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    resolveDataStack()
      .then((stack) => {
        if (!cancelled) {
          if (stack.parcels.features.length === 0) throw new Error("No parcels available from any provider");
          setLoad({ status: "ready", stack });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const stack = ready ? load.stack : null;
  const features: ParcelFeature[] = stack ? (stack.parcels.features as ParcelFeature[]) : [];

  const index = useMemo(() => {
    const m = new Map<string, ParcelFeature>();
    for (const f of features) m.set(f.properties.parcel_id, f);
    return m;
  }, [features]);

  const filterOptions = useMemo(() => {
    const sets = Object.fromEntries(FILTER_FIELDS.map(({ key }) => [key, new Set<string>()])) as Record<FilterKey, Set<string>>;
    for (const f of features) {
      for (const { key } of FILTER_FIELDS) {
        const v = f.properties[key];
        if (v != null && v !== "") sets[key].add(String(v));
      }
    }
    return Object.fromEntries(FILTER_FIELDS.map(({ key }) => [key, [...sets[key]].sort()])) as Record<FilterKey, string[]>;
  }, [features]);

  const visible = useMemo(
    () => features.filter((f) => passesFilters(f.properties, filters) && (!cmdPredicate || cmdPredicate(f.properties))),
    [features, filters, cmdPredicate],
  );

  const activeFilterCount =
    FILTER_FIELDS.filter(({ key }) => filters[key]).length +
    (filters.minConfidence > 0 ? 1 : 0) +
    (cmdPredicate ? 1 : 0);

  const visibleIds = useMemo(
    () => (activeFilterCount > 0 ? visible.map((f) => f.properties.parcel_id) : null),
    [visible, activeFilterCount],
  );

  const dash: DashboardStats = useMemo(() => {
    let area = 0, disc = 0, changed = 0, highConf = 0;
    for (const f of visible) {
      const p = f.properties;
      const m = deriveMetrics(p);
      area += m.parcelAreaSqm;
      if (m.encroachmentLevel !== "None" || (m.discrepancyPct ?? 0) >= 5) disc += 1;
      if ((m.builtUpChangeSqm != null && Math.abs(m.builtUpChangeSqm) >= 4) ||
          (m.vegetationChangePct != null && Math.abs(m.vegetationChangePct) >= 5)) changed += 1;
      if ((m.boundaryConfidence ?? 0) >= 0.8) highConf += 1;
    }
    return {
      parcels: visible.length,
      totalParcels: features.length,
      mappedAreaKm2: area / 1e6,
      potentialDiscrepancies: disc,
      recentChanges: changed,
      highConfidence: highConf,
    };
  }, [visible, features.length]);

  const results = useMemo<SearchHit[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const coordM = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (coordM) {
      const lat = Number(coordM[1]);
      const lng = Number(coordM[2]);
      const scored = features
        .map((f) => {
          const [cx, cy] = centroid(f);
          return { f, d: (cx - lng) ** 2 + (cy - lat) ** 2 };
        })
        .sort((a, b) => a.d - b.d)
        .slice(0, 5);
      return scored.map(({ f }) => hit(f.properties));
    }
    const out: SearchHit[] = [];
    for (const f of visible) {
      const p = f.properties;
      const hay = `${p.parcel_id} ${p.survey_no ?? ""} ${p.address ?? ""} ${p.locality ?? ""} ${p.village_ward ?? ""}`.toLowerCase();
      if (hay.includes(q)) {
        out.push(hit(p));
        if (out.length >= MAX_RESULTS) break;
      }
    }
    return out;
  }, [query, visible, features]);

  const selectedId = selected?.parcel_id ?? null;
  const infoOpen = selected !== null;

  const neighborsOf = useCallback(
    (p: ParcelProperties): ParcelProperties[] => {
      const self = index.get(p.parcel_id);
      if (!self) return [];
      const [sx, sy] = centroid(self);
      return features
        .filter((f) => f.properties.parcel_id !== p.parcel_id)
        .map((f) => {
          const [cx, cy] = centroid(f);
          return { f, d: Math.hypot(cx - sx, cy - sy) };
        })
        .filter((x) => x.d < 0.0004)
        .sort((a, b) => a.d - b.d)
        .slice(0, 8)
        .map((x) => x.f.properties);
    },
    [features, index],
  );

  // analyse on selection
  useEffect(() => {
    if (!selected) { ai.clear(); return; }
    ai.analyze(selected, neighborsOf(selected));
    sync.pushEvent("analysis", `Analysing ${selected.parcel_id}`);
    const m = deriveMetrics(selected);
    if (m.encroachmentLevel !== "None") {
      sync.pushEvent("detection", `${selected.parcel_id}: potential encroachment (${m.encroachmentLevel})`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // continuous re-analysis on the sync cadence
  useEffect(() => {
    if (sync.tick === 0 || !selected) return;
    ai.analyze(selected, neighborsOf(selected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.tick]);

  // log AI results into the event stream (deduped by ranAt)
  const lastLoggedRun = useRef<number>(0);
  useEffect(() => {
    const r = ai.result;
    if (!r || r.ranAt === lastLoggedRun.current) return;
    lastLoggedRun.current = r.ranAt;
    sync.pushEvent("ai", `${r.parcelId}: ${r.insights.length} insight${r.insights.length === 1 ? "" : "s"} · confidence ${Math.round(r.overallConfidence * 100)}%`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.result]);

  // drop selection if filtered out
  useEffect(() => {
    if (selected && !visible.some((f) => f.properties.parcel_id === selected.parcel_id)) setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleMapSelect = useCallback((p: ParcelProperties | null) => setSelected(p), []);
  const handlePick = useCallback((id: string) => {
    const f = index.get(id);
    if (!f) return;
    setSelected(f.properties);
    setFocusBounds(geometryBounds(f.geometry));
  }, [index]);
  const onFilterChange = useCallback((k: FilterKey, v: string) => setFilters((p) => ({ ...p, [k]: v })), []);
  const onMinConfidence = useCallback((v: number) => setFilters((p) => ({ ...p, minConfidence: v })), []);
  const onResetFilters = useCallback(() => { setFilters(EMPTY_FILTERS); setCmdPredicate(null); setCmdNote(null); }, []);
  const onToggleLayer = useCallback((id: string) => setLayerState((p) => ({ ...p, [id]: !(p[id] ?? false) })), []);

  const runCmd = useCallback(() => {
    const intent = parseQuery(cmd);
    let pred: ((p: ParcelProperties) => boolean) | null = null;
    if (intent.kind === "encroachment") pred = (p) => !!p.encroachment_status && p.encroachment_status !== "None";
    else if (intent.kind === "recent-change") pred = (p) => {
      const m = deriveMetrics(p);
      return (m.builtUpChangeSqm != null && Math.abs(m.builtUpChangeSqm) >= 4) ||
        (m.vegetationChangePct != null && Math.abs(m.vegetationChangePct) >= 5);
    };
    else if (intent.kind === "high-confidence") pred = (p) => (p.boundary_confidence ?? 0) >= 0.7;
    else if (intent.kind === "low-confidence") pred = (p) => (p.boundary_confidence ?? 1) < 0.55;
    else if (intent.kind === "large") pred = (p) => (p.area_sqft ?? 0) >= (intent.minSqft ?? 2000);

    if (pred) {
      const fn = pred;
      setCmdPredicate(() => fn);
      const n = features.filter((f) => fn(f.properties)).length;
      setCmdNote(`${intent.note} — ${n} parcel${n === 1 ? "" : "s"}.`);
      sync.pushEvent("ai", `Command: ${intent.note}`);
    } else if (intent.kind === "land-use" && intent.landUse) {
      setCmdPredicate(null);
      setFilters((p) => ({ ...p, land_use: intent.landUse! }));
      setCmdNote(intent.note);
    } else if (intent.kind === "analyze") {
      setCmdNote(selected ? `Re-analysing ${selected.parcel_id}…` : "Select a parcel first, then ask to analyse it.");
      if (selected) ai.analyze(selected, neighborsOf(selected));
    } else {
      setCmdPredicate(null);
      setCmdNote(intent.note);
    }
  }, [cmd, features, selected, ai, neighborsOf, sync]);

  const layers: LayerVisibility = {
    parcels: layerState.parcels ?? true,
    landuse: layerState.landuse ?? true,
    buildings: layerState.buildings ?? true,
    ai: layerState.ai ?? true,
  };

  const aiLastRel = ai.lastRanAt ? `${Math.max(0, Math.round((now - ai.lastRanAt) / 1000))}s ago` : "—";

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <span className="app__brand-mark" aria-hidden="true" />
          <span className="app__brand-text">
            <span className="app__brand-name">Urban Parcel Intelligence</span>
            <span className="app__brand-sub">Land Twin · {DEMO.city}, {DEMO.state}</span>
          </span>
        </div>
        <nav className="app__nav">
          <button type="button" className={"app__nav-btn" + (page === "map" ? " is-active" : "")} onClick={() => go("map")}>Parcel Mapping</button>
          <button type="button" className={"app__nav-btn" + (page === "sim" ? " is-active" : "")} onClick={() => go("sim")}>Land Simulation</button>
        </nav>
        <div className="app__status-pills">
          <span className="spill"><i className="dot" /> LAND DATA <b>{ready ? "DEMO" : "…"}</b></span>
          <span className="spill"><i className="dot dot--ok" /> IMAGERY <b>{basemap === "satellite" ? "SATELLITE" : "MAP"}</b></span>
          <span className="spill">
            <i className={"dot " + (ai.state === "running" ? "dot--ok" : ai.state === "fallback" ? "dot--warn" : "")} />
            AI <b>{ai.state === "running" ? "LOCAL / RUNNING" : ai.state === "fallback" ? "LOCAL / FALLBACK" : "IDLE"}</b>
          </span>
        </div>
      </header>

      {page === "sim" && ready && stack ? (
        <SimulationPage
          parcels={stack.parcels}
          buildings={stack.buildings}
          center={[DEMO.lon, DEMO.lat]}
          zoom={DEMO.zoom}
        />
      ) : page === "sim" ? (
        <div className="app__overlay" role="status">
          <span className="app__spinner" /> Loading simulation data…
        </div>
      ) : (
      <main className={"app__main" + (infoOpen ? " app__main--info" : "")}>
        <div className="app__sidebar">
          {ready && stack ? (
            <Sidebar
              mode={stack.mode}
              modeLabel={stack.modeLabel}
              sources={stack.sources}
              dash={dash}
              reconcile={reconResult}
              reconcileState={reconStatus}
              onReconcileRefresh={recon.refresh}
              aiState={ai.state}
              aiBusy={ai.busy}
              aiReason={ai.reason}
              aiConfidence={ai.result?.overallConfidence ?? null}
              aiLastRel={aiLastRel}
              cmd={cmd}
              onCmd={setCmd}
              onRunCmd={runCmd}
              cmdNote={cmdNote}
              layers={layerState}
              onToggleLayer={onToggleLayer}
              viewMode={viewMode}
              onViewMode={setViewMode}
              basemap={basemap}
              onBasemap={setBasemap}
              styleMode={styleMode}
              onStyleMode={setStyleMode}
              query={query}
              onQuery={setQuery}
              results={results}
              hasQuery={query.trim().length > 0}
              onPick={handlePick}
              selectedId={selectedId}
              filters={filters}
              filterOptions={filterOptions}
              onFilterChange={onFilterChange}
              onMinConfidence={onMinConfidence}
              onResetFilters={onResetFilters}
              activeFilterCount={activeFilterCount}
              events={sync.events}
              now={now}
            />
          ) : (
            <div className="sb__loading">{load.status === "loading" ? "Resolving data providers…" : "Data unavailable"}</div>
          )}
        </div>

        <div className="app__map">
          {load.status === "loading" && (
            <div className="app__overlay" role="status"><span className="app__spinner" /> Loading Land Twin — {DEMO.location}…</div>
          )}
          {load.status === "error" && (
            <div className="app__overlay app__overlay--error" role="alert">
              <strong>Land data could not be loaded.</strong>
              <span>{load.message}</span>
              <button type="button" className="app__retry" onClick={() => setReloadKey((k) => k + 1)}>Retry</button>
            </div>
          )}
          {ready && stack && (
            <MapView
              parcels={stack.parcels}
              buildings={stack.buildings}
              center={[DEMO.lon, DEMO.lat]}
              zoom={DEMO.zoom}
              selectedId={selectedId}
              styleMode={styleMode}
              viewMode={viewMode}
              basemap={basemap}
              layers={layers}
              visibleIds={visibleIds}
              focusBounds={focusBounds}
              rightPanelOpen={infoOpen}
              onSelect={handleMapSelect}
              onViewState={setView}
            />
          )}
        </div>

        {infoOpen && (
          <div className="app__info">
            <LandTwinPanel
              parcel={selected}
              aiState={ai.state}
              aiBusy={ai.busy}
              aiResult={ai.result}
              aiLastRanAt={ai.lastRanAt}
              lastSyncTs={sync.lastSyncTs}
              now={now}
              reconcile={selectedId ? reconResult?.perParcel[selectedId] ?? null : null}
              reconcileState={reconStatus}
              onClose={() => setSelected(null)}
            />
          </div>
        )}
      </main>
      )}

      <footer className="app__statusbar">
        {page === "sim" ? (
          <>
            <span>LAND SIMULATION</span>
            <span className="sep">·</span>
            <span>Client-side deterministic flood model · SIMULATION / DEMO MODE</span>
            <span className="push">© OpenStreetMap contributors</span>
          </>
        ) : (
          <>
            <span>{view ? `${view.lat.toFixed(5)}, ${view.lng.toFixed(5)}` : `${DEMO.lat}, ${DEMO.lon}`}</span>
            <span>z {view ? view.zoom.toFixed(1) : DEMO.zoom.toFixed(1)}</span>
            <span>tilt {view ? `${Math.round(view.pitch)}°` : "—"} · {viewMode.toUpperCase()}</span>
            <span>{ready ? `${visible.length}/${features.length} parcels` : "—"}</span>
            <span className="sep">·</span>
            <span>MODE {ready && stack ? stack.mode : "—"} — synthetic demonstration data, not an official land record</span>
            <span className="push">Esri / © OpenStreetMap contributors</span>
          </>
        )}
      </footer>
    </div>
  );
}

function hit(p: ParcelProperties): SearchHit {
  return {
    parcel_id: p.parcel_id,
    survey_no: p.survey_no,
    address: p.address,
    locality: p.locality,
    village_ward: p.village_ward,
    land_use: p.land_use,
  };
}
