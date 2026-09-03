import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  FilterSpecification,
  ExpressionSpecification,
} from "maplibre-gl";
import MapView from "./components/MapView";
import InfoPanel from "./components/InfoPanel";
import ControlPanel, { type SearchHit } from "./components/ControlPanel";
import {
  EMPTY_FILTERS,
  FILTER_FIELDS,
  type Filters,
  type ParcelCollection,
  type ParcelFeature,
  type ParcelProperties,
} from "./types";
import { geometryBounds, type BBox } from "./geo";

const DATA_URL = `${import.meta.env.BASE_URL}demo-parcels.geojson`;
const MAX_RESULTS = 12;

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ParcelCollection };

function isParcelCollection(value: unknown): value is ParcelCollection {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.type === "FeatureCollection" && Array.isArray(v.features);
}

function passesFilters(props: ParcelProperties, filters: Filters): boolean {
  return FILTER_FIELDS.every(
    ({ key }) => !filters[key] || String(props[key] ?? "") === filters[key],
  );
}

export default function App() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [selected, setSelected] = useState<ParcelProperties | null>(null);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [focusBounds, setFocusBounds] = useState<BBox | null>(null);

  // --- data load -------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    fetch(DATA_URL, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${DATA_URL}`);
        const json: unknown = await res.json();
        if (!isParcelCollection(json)) {
          throw new Error("Response is not a GeoJSON FeatureCollection");
        }
        if (json.features.length === 0) {
          throw new Error("Parcel dataset contains no features");
        }
        return json;
      })
      .then((data) => {
        if (!cancelled) setLoad({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (cancelled || controller.signal.aborted) return;
        setLoad({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const features: ParcelFeature[] =
    load.status === "ready" ? (load.data.features as ParcelFeature[]) : [];

  const index = useMemo(() => {
    const m = new Map<string, ParcelFeature>();
    for (const f of features) m.set(f.properties.parcel_id, f);
    return m;
  }, [features]);

  const filterOptions = useMemo(() => {
    const opts: Record<keyof Filters, Set<string>> = {
      land_use: new Set(),
      zoning: new Set(),
      status: new Set(),
    };
    for (const f of features) {
      for (const { key } of FILTER_FIELDS) {
        const v = f.properties[key];
        if (v !== undefined && v !== null && v !== "") opts[key].add(String(v));
      }
    }
    return {
      land_use: [...opts.land_use].sort(),
      zoning: [...opts.zoning].sort(),
      status: [...opts.status].sort(),
    };
  }, [features]);

  const visibleCount = useMemo(
    () => features.filter((f) => passesFilters(f.properties, filters)).length,
    [features, filters],
  );

  const mapFilter = useMemo<FilterSpecification | null>(() => {
    const parts: ExpressionSpecification[] = [];
    for (const { key } of FILTER_FIELDS) {
      if (filters[key]) {
        parts.push(["==", ["get", key], filters[key]] as ExpressionSpecification);
      }
    }
    if (parts.length === 0) return null;
    return ["all", ...parts] as unknown as FilterSpecification;
  }, [filters]);

  const results = useMemo<SearchHit[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: SearchHit[] = [];
    for (const f of features) {
      const p = f.properties;
      if (!passesFilters(p, filters)) continue;
      const id = p.parcel_id.toLowerCase();
      const addr = (p.address ?? "").toLowerCase();
      if (id.includes(q) || addr.includes(q)) {
        hits.push({
          parcel_id: p.parcel_id,
          address: p.address,
          land_use: p.land_use,
        });
        if (hits.length >= MAX_RESULTS) break;
      }
    }
    return hits;
  }, [query, features, filters]);

  const activeFilterCount = FILTER_FIELDS.filter(({ key }) => filters[key]).length;

  // Drop the selection if a filter change hides it.
  useEffect(() => {
    if (selected && !passesFilters(selected, filters)) setSelected(null);
  }, [filters, selected]);

  const selectedId = selected?.parcel_id ?? null;

  const handleMapSelect = useCallback((props: ParcelProperties | null) => {
    setSelected(props);
  }, []);

  const handlePickResult = useCallback(
    (parcelId: string) => {
      const f = index.get(parcelId);
      if (!f) return;
      setSelected(f.properties);
      setFocusBounds(geometryBounds(f.geometry));
    },
    [index],
  );

  const handleFilterChange = useCallback((key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const resetFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);
  const closeInfo = useCallback(() => setSelected(null), []);

  const infoOpen = selected !== null;

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <span className="app__brand-mark" aria-hidden="true" />
          <span className="app__brand-name">Urban Parcel Mapping</span>
          <span className="app__brand-tag">SIS concept prototype</span>
        </div>
        <div className="app__header-right">
          <span className="app__badge" title="This map does not show real parcels.">
            SYNTHETIC DEMO DATA
          </span>
        </div>
      </header>

      <main
        className={"app__main" + (infoOpen ? " app__main--info" : "")}
      >
        <div className="app__sidebar">
          {load.status === "ready" ? (
            <ControlPanel
              query={query}
              onQueryChange={setQuery}
              results={results}
              hasQuery={query.trim().length > 0}
              onPickResult={handlePickResult}
              filters={filters}
              filterOptions={filterOptions}
              onFilterChange={handleFilterChange}
              onResetFilters={resetFilters}
              activeFilterCount={activeFilterCount}
              visibleCount={visibleCount}
              totalCount={features.length}
              selectedId={selectedId}
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
              Loading parcel data…
            </div>
          )}
          {load.status === "error" && (
            <div className="app__overlay app__overlay--error" role="alert">
              <strong>Could not load parcel data.</strong>
              <span>{load.message}</span>
            </div>
          )}
          {load.status === "ready" && (
            <MapView
              parcels={load.data}
              selectedId={selectedId}
              filter={mapFilter}
              focusBounds={focusBounds}
              rightPanelOpen={infoOpen}
              onSelect={handleMapSelect}
            />
          )}
        </div>

        {infoOpen && (
          <div className="app__info">
            <InfoPanel parcel={selected} onClose={closeInfo} />
          </div>
        )}
      </main>

      <footer className="app__footer">
        <span>
          Base map © OpenStreetMap contributors · Parcel geometry &amp; attributes
          are synthetic, for demonstration only.
        </span>
        {load.status === "ready" && (
          <span className="app__footer-count">{features.length} parcels loaded</span>
        )}
      </footer>
    </div>
  );
}
