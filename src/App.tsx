import { useCallback, useEffect, useMemo, useState } from "react";
import MapView, { type ViewState } from "./components/MapView";
import InfoPanel from "./components/InfoPanel";
import ControlPanel, {
  type OverviewStats,
  type SearchHit,
} from "./components/ControlPanel";
import {
  EMPTY_FILTERS,
  FILTER_FIELDS,
  type BuildingCollection,
  type FilterKey,
  type Filters,
  type ParcelCollection,
  type ParcelFeature,
  type ParcelProperties,
  type StyleMode,
  type ViewMode,
} from "./types";
import { deriveMetrics } from "./metrics";
import { geometryBounds, type BBox } from "./geo";

const PARCELS_URL = `${import.meta.env.BASE_URL}demo-parcels.geojson`;
const BUILDINGS_URL = `${import.meta.env.BASE_URL}demo-buildings.geojson`;
const MAX_RESULTS = 12;
const SEVERE = new Set(["Moderate", "Significant", "Critical"]);

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ParcelCollection; buildings: BuildingCollection };

function isFeatureCollection(value: unknown): value is { features: unknown[] } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.type === "FeatureCollection" && Array.isArray(v.features);
}

function passesFilters(p: ParcelProperties, f: Filters): boolean {
  for (const { key } of FILTER_FIELDS) {
    if (f[key] && String(p[key] ?? "") !== f[key]) return false;
  }
  if (f.minArea > 0 && !(typeof p.area_sqm === "number" && p.area_sqm >= f.minArea)) {
    return false;
  }
  return true;
}

export default function App() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<ParcelProperties | null>(null);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [styleMode, setStyleMode] = useState<StyleMode>("land_use");
  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  const [focusBounds, setFocusBounds] = useState<BBox | null>(null);
  const [view, setView] = useState<ViewState | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoad({ status: "loading" });

    const grab = (url: string) =>
      fetch(url, { signal: controller.signal }).then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
        const json: unknown = await res.json();
        if (!isFeatureCollection(json)) throw new Error(`${url} is not a GeoJSON FeatureCollection`);
        return json;
      });

    Promise.all([grab(PARCELS_URL), grab(BUILDINGS_URL)])
      .then(([parcels, buildings]) => {
        if ((parcels as { features: unknown[] }).features.length === 0) {
          throw new Error("Parcel dataset contains no features");
        }
        if (!cancelled) {
          setLoad({
            status: "ready",
            data: parcels as ParcelCollection,
            buildings: buildings as BuildingCollection,
          });
        }
      })
      .catch((err: unknown) => {
        if (cancelled || controller.signal.aborted) return;
        setLoad({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [reloadKey]);

  const features: ParcelFeature[] =
    load.status === "ready" ? (load.data.features as ParcelFeature[]) : [];

  const index = useMemo(() => {
    const m = new Map<string, ParcelFeature>();
    for (const f of features) m.set(f.properties.parcel_id, f);
    return m;
  }, [features]);

  const filterOptions = useMemo(() => {
    const sets: Record<FilterKey, Set<string>> = {
      land_use: new Set(),
      zoning_code: new Set(),
      development_status: new Set(),
      encroachment_status: new Set(),
    };
    for (const f of features) {
      for (const { key } of FILTER_FIELDS) {
        const v = f.properties[key];
        if (v !== undefined && v !== null && v !== "") sets[key].add(String(v));
      }
    }
    return {
      land_use: [...sets.land_use].sort(),
      zoning_code: [...sets.zoning_code].sort(),
      development_status: [...sets.development_status].sort(),
      encroachment_status: [...sets.encroachment_status].sort(),
    } as Record<FilterKey, string[]>;
  }, [features]);

  const visible = useMemo(
    () => features.filter((f) => passesFilters(f.properties, filters)),
    [features, filters],
  );

  const activeFilterCount =
    FILTER_FIELDS.filter(({ key }) => filters[key]).length + (filters.minArea > 0 ? 1 : 0);

  const visibleIds = useMemo(
    () => (activeFilterCount > 0 ? visible.map((f) => f.properties.parcel_id) : null),
    [visible, activeFilterCount],
  );

  const stats: OverviewStats = useMemo(() => {
    const base: OverviewStats = {
      visible: visible.length,
      total: features.length,
      totalAreaSqm: 0,
      builtUpAreaSqm: 0,
      avgBuiltUpPct: null,
      encroachedShare: null,
      vacantShare: null,
    };
    if (visible.length === 0) return base;
    let builtSum = 0;
    let builtCount = 0;
    let encroached = 0;
    let vacant = 0;
    for (const f of visible) {
      const m = deriveMetrics(f.properties);
      base.totalAreaSqm += m.parcelArea;
      base.builtUpAreaSqm += m.builtUpArea;
      if (m.builtUpPct !== null) {
        builtSum += m.builtUpPct;
        builtCount += 1;
      }
      if (SEVERE.has(m.encroachmentLevel)) encroached += 1;
      if (f.properties.development_status === "Vacant") vacant += 1;
    }
    base.avgBuiltUpPct = builtCount ? builtSum / builtCount : null;
    base.encroachedShare = (encroached / visible.length) * 100;
    base.vacantShare = (vacant / visible.length) * 100;
    return base;
  }, [visible, features.length]);

  const results = useMemo<SearchHit[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: SearchHit[] = [];
    for (const f of visible) {
      const p = f.properties;
      const hay = `${p.parcel_id} ${p.address ?? ""} ${p.locality ?? ""}`.toLowerCase();
      if (hay.includes(q)) {
        hits.push({ parcel_id: p.parcel_id, address: p.address, locality: p.locality, land_use: p.land_use });
        if (hits.length >= MAX_RESULTS) break;
      }
    }
    return hits;
  }, [query, visible]);

  useEffect(() => {
    if (selected && !passesFilters(selected, filters)) setSelected(null);
  }, [filters, selected]);

  const selectedId = selected?.parcel_id ?? null;
  const infoOpen = selected !== null;

  const handleMapSelect = useCallback((p: ParcelProperties | null) => setSelected(p), []);
  const handlePickResult = useCallback(
    (parcelId: string) => {
      const f = index.get(parcelId);
      if (!f) return;
      setSelected(f.properties);
      setFocusBounds(geometryBounds(f.geometry));
    },
    [index],
  );
  const handleFilterChange = useCallback((key: FilterKey, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);
  const handleAreaChange = useCallback((value: number) => {
    setFilters((prev) => ({ ...prev, minArea: value }));
  }, []);
  const resetFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);
  const closeInfo = useCallback(() => setSelected(null), []);

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <span className="app__brand-mark" aria-hidden="true" />
          <span className="app__brand-text">
            <span className="app__brand-name">Urban Parcel Intelligence</span>
            <span className="app__brand-sub">Spatial Information System</span>
          </span>
        </div>
        <div className="app__header-right">
          <span className="app__dataset">
            <span className="app__dataset-dot" data-state={load.status} />
            {load.status === "ready"
              ? `Demoville dataset · ${features.length} parcels`
              : load.status === "loading"
                ? "Loading dataset…"
                : "Dataset error"}
          </span>
          <span className="app__badge" title="Synthetic data; building heights estimated.">
            PROTOTYPE DATASET
          </span>
        </div>
      </header>

      <main className={"app__main" + (infoOpen ? " app__main--info" : "")}>
        <div className="app__sidebar">
          {load.status === "ready" ? (
            <ControlPanel
              stats={stats}
              query={query}
              onQueryChange={setQuery}
              results={results}
              hasQuery={query.trim().length > 0}
              onPickResult={handlePickResult}
              selectedId={selectedId}
              styleMode={styleMode}
              onStyleModeChange={setStyleMode}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              filters={filters}
              filterOptions={filterOptions}
              onFilterChange={handleFilterChange}
              onAreaChange={handleAreaChange}
              onResetFilters={resetFilters}
              activeFilterCount={activeFilterCount}
            />
          ) : (
            <div className="panel panel--muted">
              {load.status === "loading" ? "Loading…" : "Data unavailable"}
            </div>
          )}
        </div>

        <div className="app__map">
          {load.status === "loading" && (
            <div className="app__overlay" role="status">
              <span className="app__spinner" aria-hidden="true" />
              Loading Urban Parcel Intelligence…
            </div>
          )}
          {load.status === "error" && (
            <div className="app__overlay app__overlay--error" role="alert">
              <strong>Parcel data could not be loaded.</strong>
              <span>{load.message}</span>
              <button type="button" className="app__retry" onClick={() => setReloadKey((k) => k + 1)}>
                Retry
              </button>
            </div>
          )}
          {load.status === "ready" && (
            <MapView
              parcels={load.data}
              buildings={load.buildings}
              selectedId={selectedId}
              styleMode={styleMode}
              viewMode={viewMode}
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
            <InfoPanel parcel={selected} onClose={closeInfo} />
          </div>
        )}
      </main>

      <footer className="app__statusbar">
        <span className="app__status-item">
          {view ? `${view.lat.toFixed(5)}, ${view.lng.toFixed(5)}` : "—, —"}
        </span>
        <span className="app__status-item">z {view ? view.zoom.toFixed(1) : "—"}</span>
        <span className="app__status-item">
          tilt {view ? `${Math.round(view.pitch)}°` : "—"} · {viewMode.toUpperCase()}
        </span>
        <span className="app__status-item">
          {load.status === "ready" ? `${visible.length}/${features.length} parcels` : "—"}
        </span>
        <span className="app__status-sep">·</span>
        <span className="app__status-item">Prototype dataset — synthetic; buildings estimated</span>
        <span className="app__status-item app__status-item--push">© OpenStreetMap contributors</span>
      </footer>
    </div>
  );
}
