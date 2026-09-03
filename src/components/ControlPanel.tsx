import { FILTER_FIELDS, LAND_USE_COLORS, type Filters } from "../types";

export interface SearchHit {
  parcel_id: string;
  address?: string;
  land_use?: string;
}

interface ControlPanelProps {
  query: string;
  onQueryChange: (value: string) => void;
  results: SearchHit[];
  hasQuery: boolean;
  onPickResult: (parcelId: string) => void;

  filters: Filters;
  filterOptions: Record<keyof Filters, string[]>;
  onFilterChange: (key: keyof Filters, value: string) => void;
  onResetFilters: () => void;
  activeFilterCount: number;

  visibleCount: number;
  totalCount: number;

  selectedId: string | null;
}

export default function ControlPanel({
  query,
  onQueryChange,
  results,
  hasQuery,
  onPickResult,
  filters,
  filterOptions,
  onFilterChange,
  onResetFilters,
  activeFilterCount,
  visibleCount,
  totalCount,
  selectedId,
}: ControlPanelProps) {
  return (
    <div className="panel">
      <section className="panel__section">
        <h2 className="panel__heading">Search</h2>
        <input
          type="search"
          className="panel__input"
          placeholder="Parcel ID or address…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label="Search by parcel ID or address"
          autoComplete="off"
        />
        {hasQuery && (
          <div className="panel__results" role="listbox" aria-label="Search results">
            {results.length === 0 && (
              <p className="panel__empty">No parcels match “{query.trim()}”.</p>
            )}
            {results.map((r) => (
              <button
                key={r.parcel_id}
                type="button"
                role="option"
                aria-selected={r.parcel_id === selectedId}
                className={
                  "panel__result" +
                  (r.parcel_id === selectedId ? " panel__result--active" : "")
                }
                onClick={() => onPickResult(r.parcel_id)}
              >
                <span className="panel__result-id">{r.parcel_id}</span>
                <span className="panel__result-sub">
                  {(r.address ?? "—") + " · " + (r.land_use ?? "—")}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="panel__section">
        <div className="panel__heading-row">
          <h2 className="panel__heading">Filters</h2>
          {activeFilterCount > 0 && (
            <button
              type="button"
              className="panel__link"
              onClick={onResetFilters}
            >
              Reset ({activeFilterCount})
            </button>
          )}
        </div>
        {FILTER_FIELDS.map(({ key, label }) => (
          <label key={key} className="panel__field">
            <span className="panel__field-label">{label}</span>
            <select
              className="panel__select"
              value={filters[key]}
              onChange={(e) => onFilterChange(key, e.target.value)}
            >
              <option value="">All</option>
              {filterOptions[key].map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
        ))}
        <p className="panel__count">
          Showing <strong>{visibleCount}</strong> of {totalCount} parcels
        </p>
      </section>

      <section className="panel__section">
        <h2 className="panel__heading">Legend</h2>
        <ul className="legend">
          {Object.entries(LAND_USE_COLORS).map(([name, color]) => (
            <li key={name} className="legend__item">
              <span
                className="legend__swatch"
                style={{ background: color }}
                aria-hidden="true"
              />
              {name}
            </li>
          ))}
        </ul>
        <p className="legend__note">
          Selected parcel: bold dark outline. Hover: lighter outline.
        </p>
      </section>
    </div>
  );
}
