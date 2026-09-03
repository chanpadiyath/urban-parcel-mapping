import { memo } from "react";
import {
  AREA_THRESHOLDS,
  ENCROACHMENT_COLORS,
  FILTER_FIELDS,
  LAND_USE_COLORS,
  type FilterKey,
  type Filters,
  type StyleMode,
  type ViewMode,
} from "../types";
import { fmtArea, fmtPct } from "../metrics";

export interface SearchHit {
  parcel_id: string;
  address?: string;
  locality?: string;
  land_use?: string;
}

export interface OverviewStats {
  visible: number;
  total: number;
  totalAreaSqm: number;
  builtUpAreaSqm: number;
  avgBuiltUpPct: number | null;
  encroachedShare: number | null;
  vacantShare: number | null;
}

interface ControlPanelProps {
  stats: OverviewStats;

  query: string;
  onQueryChange: (v: string) => void;
  results: SearchHit[];
  hasQuery: boolean;
  onPickResult: (parcelId: string) => void;
  selectedId: string | null;

  styleMode: StyleMode;
  onStyleModeChange: (m: StyleMode) => void;
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;

  filters: Filters;
  filterOptions: Record<FilterKey, string[]>;
  onFilterChange: (key: FilterKey, value: string) => void;
  onAreaChange: (value: number) => void;
  onResetFilters: () => void;
  activeFilterCount: number;
}

function ControlPanel({
  stats,
  query,
  onQueryChange,
  results,
  hasQuery,
  onPickResult,
  selectedId,
  styleMode,
  onStyleModeChange,
  viewMode,
  onViewModeChange,
  filters,
  filterOptions,
  onFilterChange,
  onAreaChange,
  onResetFilters,
  activeFilterCount,
}: ControlPanelProps) {
  const legend =
    styleMode === "encroachment"
      ? Object.entries(ENCROACHMENT_COLORS)
      : Object.entries(LAND_USE_COLORS);

  return (
    <div className="panel">
      <section className="panel__section">
        <h2 className="panel__heading">Overview</h2>
        <div className="stats">
          <Stat label="Parcels shown" value={`${stats.visible}`} sub={`of ${stats.total}`} />
          <Stat label="Total area" value={fmtArea(stats.totalAreaSqm)} />
          <Stat label="Built-up area" value={fmtArea(stats.builtUpAreaSqm)} />
          <Stat label="Avg built-up" value={fmtPct(stats.avgBuiltUpPct)} />
          <Stat label="Encroached" value={fmtPct(stats.encroachedShare)} sub="mod.+ severity" />
          <Stat label="Vacant" value={fmtPct(stats.vacantShare)} />
        </div>
      </section>

      <section className="panel__section">
        <h2 className="panel__heading">View</h2>
        <div className="segmented" role="group" aria-label="Map view mode">
          <button
            type="button"
            className={"segmented__btn" + (viewMode === "2d" ? " is-active" : "")}
            onClick={() => onViewModeChange("2d")}
          >
            2D
          </button>
          <button
            type="button"
            className={"segmented__btn" + (viewMode === "3d" ? " is-active" : "")}
            onClick={() => onViewModeChange("3d")}
          >
            3D
          </button>
        </div>
        {viewMode === "3d" && (
          <p className="legend__note">
            Right-drag or Ctrl-drag to rotate &amp; tilt. Buildings are estimated
            (floors × 3.2 m).
          </p>
        )}
      </section>

      <section className="panel__section">
        <h2 className="panel__heading">Search</h2>
        <div className="panel__search">
          <input
            type="search"
            className="panel__input"
            placeholder="Parcel ID, address or locality…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            aria-label="Search parcels"
            autoComplete="off"
          />
          {query && (
            <button type="button" className="panel__clear" onClick={() => onQueryChange("")} aria-label="Clear search">
              ×
            </button>
          )}
        </div>
        {hasQuery && (
          <div className="panel__results" role="listbox" aria-label="Search results">
            <div className="panel__results-head">{results.length} match{results.length === 1 ? "" : "es"}</div>
            {results.length === 0 && <p className="panel__empty">No parcels match “{query.trim()}”.</p>}
            {results.map((r) => (
              <button
                key={r.parcel_id}
                type="button"
                role="option"
                aria-selected={r.parcel_id === selectedId}
                className={"panel__result" + (r.parcel_id === selectedId ? " panel__result--active" : "")}
                onClick={() => onPickResult(r.parcel_id)}
              >
                <span className="panel__result-id">{r.parcel_id}</span>
                <span className="panel__result-sub">
                  {[r.address, r.locality, r.land_use].filter(Boolean).join(" · ") || "—"}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="panel__section">
        <h2 className="panel__heading">Map colouring</h2>
        <div className="segmented" role="group" aria-label="Map colouring mode">
          <button
            type="button"
            className={"segmented__btn" + (styleMode === "land_use" ? " is-active" : "")}
            onClick={() => onStyleModeChange("land_use")}
          >
            Land use
          </button>
          <button
            type="button"
            className={"segmented__btn" + (styleMode === "encroachment" ? " is-active" : "")}
            onClick={() => onStyleModeChange("encroachment")}
          >
            Encroachment
          </button>
        </div>
      </section>

      <section className="panel__section">
        <div className="panel__heading-row">
          <h2 className="panel__heading">Filters</h2>
          {activeFilterCount > 0 && (
            <button type="button" className="panel__link" onClick={onResetFilters}>
              Clear ({activeFilterCount})
            </button>
          )}
        </div>
        {FILTER_FIELDS.map(({ key, label }) => (
          <label key={key} className="panel__field">
            <span className="panel__field-label">{label}</span>
            <select className="panel__select" value={filters[key]} onChange={(e) => onFilterChange(key, e.target.value)}>
              <option value="">All</option>
              {filterOptions[key].map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="panel__field">
          <span className="panel__field-label">Minimum area</span>
          <select
            className="panel__select"
            value={String(filters.minArea)}
            onChange={(e) => onAreaChange(Number(e.target.value))}
          >
            {AREA_THRESHOLDS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <p className="panel__count">
          <strong>{stats.visible}</strong> of {stats.total} parcels
          {activeFilterCount > 0 ? " match filters" : ""}
        </p>
      </section>

      <section className="panel__section">
        <h2 className="panel__heading">
          Legend — {styleMode === "encroachment" ? "encroachment severity" : "land use"}
        </h2>
        <ul className="legend">
          {legend.map(([name, color]) => (
            <li key={name} className="legend__item">
              <span className="legend__swatch" style={{ background: color }} aria-hidden="true" />
              {name}
            </li>
          ))}
          {viewMode === "3d" && (
            <li className="legend__item">
              <span className="legend__swatch" style={{ background: "#cfd4da" }} aria-hidden="true" />
              Building (estimated extrusion)
            </li>
          )}
        </ul>
        <p className="legend__note">Selected: dark outline · Hover: mid outline</p>
      </section>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat__value">{value}</div>
      <div className="stat__label">
        {label}
        {sub ? <span className="stat__sub"> · {sub}</span> : null}
      </div>
    </div>
  );
}

export default memo(ControlPanel);
