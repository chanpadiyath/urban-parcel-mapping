import { memo, type ReactNode } from "react";
import {
  ENCROACHMENT_COLORS,
  FILTER_FIELDS,
  LAND_USE_COLORS,
  MAP_LAYERS,
  type BasemapId,
  type FilterKey,
  type Filters,
  type StyleMode,
  type TwinEvent,
  type ViewMode,
  type AiRuntimeState,
} from "../types";
import type { OperationalMode, SourceStatus } from "../data/providers";
import type { ReconcileResult } from "../data/reconcile";
import { fmtPct } from "../metrics";

export interface SearchHit {
  parcel_id: string;
  survey_no?: string;
  address?: string;
  locality?: string;
  village_ward?: string;
  land_use?: string;
}

export interface DashboardStats {
  parcels: number;
  totalParcels: number;
  mappedAreaKm2: number;
  potentialDiscrepancies: number;
  recentChanges: number;
  highConfidence: number;
}

interface SidebarProps {
  mode: OperationalMode;
  modeLabel: string;
  sources: SourceStatus[];

  dash: DashboardStats;

  reconcile: ReconcileResult | null;
  reconcileState: "loading" | "ready" | "unavailable";
  onReconcileRefresh: () => void;

  aiState: AiRuntimeState;
  aiBusy: boolean;
  aiReason: string | null;
  aiConfidence: number | null;
  aiLastRel: string;

  cmd: string;
  onCmd: (v: string) => void;
  onRunCmd: () => void;
  cmdNote: string | null;

  layers: Record<string, boolean>;
  onToggleLayer: (id: string) => void;

  viewMode: ViewMode;
  onViewMode: (m: ViewMode) => void;
  basemap: BasemapId;
  onBasemap: (b: BasemapId) => void;
  styleMode: StyleMode;
  onStyleMode: (m: StyleMode) => void;

  query: string;
  onQuery: (v: string) => void;
  results: SearchHit[];
  hasQuery: boolean;
  onPick: (id: string) => void;
  selectedId: string | null;

  filters: Filters;
  filterOptions: Record<FilterKey, string[]>;
  onFilterChange: (k: FilterKey, v: string) => void;
  onMinConfidence: (v: number) => void;
  onResetFilters: () => void;
  activeFilterCount: number;

  events: TwinEvent[];
  now: number;
}

function Card({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="sb__card">
      <div className="sb__card-head">
        <h2 className="sb__card-title">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<[T, string]> }) {
  return (
    <div className="seg" role="group">
      {options.map(([v, label]) => (
        <button key={v} type="button" className={"seg__btn" + (v === value ? " is-active" : "")} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function rel(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}

function Sidebar(p: SidebarProps) {
  const legend =
    p.styleMode === "encroachment"
      ? Object.entries(ENCROACHMENT_COLORS)
      : p.styleMode === "confidence"
        ? ([["High (≥80%)", "#3f7d52"], ["Medium", "#d9902f"], ["Low (<55%)", "#c0392b"]] as Array<[string, string]>)
        : Object.entries(LAND_USE_COLORS);

  const dotClass =
    p.aiState === "running" ? "dot dot--ok" : p.aiState === "fallback" ? "dot dot--warn" : "dot";

  return (
    <div className="sb">
      <div className={"sb__mode sb__mode--" + p.mode.toLowerCase()}>
        <span className="sb__mode-tag">MODE {p.mode}</span>
        <span className="sb__mode-label">{p.modeLabel}</span>
      </div>

      <Card title="Data sources">
        <ul className="src">
          {p.sources.map((s) => (
            <li key={s.id} className="src__item">
              <span className={"src__state src__state--" + s.state}>{s.state}</span>
              <div>
                <div className="src__label">{s.label}</div>
                <div className="src__detail">{s.detail}</div>
              </div>
            </li>
          ))}
        </ul>
        <p className="sb__note">
          Live land-record API unavailable — demonstration dataset active.
        </p>
      </Card>

      <Card title="Dashboard">
        <div className="kpis">
          <div className="kpi"><b>{p.dash.parcels}</b><span>Parcels{p.dash.parcels !== p.dash.totalParcels ? ` / ${p.dash.totalParcels}` : ""}</span></div>
          <div className="kpi"><b>{p.dash.mappedAreaKm2.toFixed(3)}</b><span>km² mapped</span></div>
          <div className="kpi"><b>{p.dash.potentialDiscrepancies}</b><span>Potential discrepancies</span></div>
          <div className="kpi"><b>{p.dash.recentChanges}</b><span>Recent changes</span></div>
          <div className="kpi"><b>{p.dash.highConfidence}</b><span>High-confidence parcels</span></div>
          <div className="kpi"><b>{p.aiState === "running" ? "LOCAL" : p.aiState === "fallback" ? "LOCAL*" : "—"}</b><span>AI: {p.aiState}</span></div>
        </div>
      </Card>

      <Card
        title="OSM cross-check"
        right={
          p.reconcileState === "ready"
            ? <button type="button" className="link" onClick={p.onReconcileRefresh}>Refresh</button>
            : undefined
        }
      >
        {p.reconcileState === "unavailable" && (
          <p className="sb__note">
            Reference comparison needs the backend (`npm run server`) + network. India has
            no public cadastral API — this compares against OpenStreetMap.
          </p>
        )}
        {p.reconcileState === "loading" && <p className="sb__note">Comparing parcels against OpenStreetMap…</p>}
        {p.reconcileState === "ready" && p.reconcile && (
          <>
            <div className="kpis">
              <div className="kpi"><b>{p.reconcile.summary.building_presence_rate}%</b><span>parcels w/ OSM building</span></div>
              <div className="kpi"><b>{p.reconcile.summary.landuse_agreement_rate ?? "—"}%</b><span>land-use agreement</span></div>
              <div className="kpi"><b>{p.reconcile.summary.median_nearest_road_m ?? "—"} m</b><span>median road distance</span></div>
              <div className="kpi"><b>{p.reconcile.summary.osm_buildings_in_area}</b><span>OSM buildings in area</span></div>
            </div>
            <p className="sb__note">
              Reference: {p.reconcile.reference_source} · {p.reconcile.reference_state}
              {p.reconcile.reference_loaded_at ? ` · ${new Date(p.reconcile.reference_loaded_at).toLocaleString()}` : ""}.
              Low agreement is expected — our parcels are a derived grid, not real plots.
            </p>
          </>
        )}
      </Card>

      <Card
        title="Local Land AI"
        right={<span className="sb__ai-status"><span className={dotClass} /> {p.aiState === "running" ? "RUNNING" : p.aiState === "fallback" ? "FALLBACK" : "IDLE"}</span>}
      >
        <dl className="mini">
          <div><dt>Inference</dt><dd>{p.aiState === "running" ? "Local · Web Worker" : "Local · inline"}</dd></div>
          <div><dt>Model</dt><dd>Deterministic heuristics (no ML weights)</dd></div>
          <div><dt>Last analysis</dt><dd>{p.aiLastRel}{p.aiBusy ? " · running" : ""}</dd></div>
          <div><dt>Confidence</dt><dd>{p.aiConfidence != null ? fmtPct(p.aiConfidence * 100) : "—"}</dd></div>
        </dl>
        {p.aiReason && <p className="sb__note">{p.aiReason}</p>}
        <div className="cmd">
          <input
            className="sb__input"
            placeholder='Ask: "potential encroachment", "recent changes", "larger than 2000 sq ft"…'
            value={p.cmd}
            onChange={(e) => p.onCmd(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") p.onRunCmd(); }}
            aria-label="AI command"
          />
          <button type="button" className="btn" onClick={p.onRunCmd}>Run</button>
        </div>
        {p.cmdNote && <p className="sb__note sb__note--cmd">{p.cmdNote}</p>}
      </Card>

      <Card title="View">
        <div className="sb__field"><span>Camera</span><Seg value={p.viewMode} onChange={p.onViewMode} options={[["2d", "2D"], ["3d", "3D"]]} /></div>
        <div className="sb__field"><span>Basemap</span><Seg value={p.basemap} onChange={p.onBasemap} options={[["map", "Map"], ["satellite", "Satellite"]]} /></div>
        <div className="sb__field"><span>Parcel colour</span>
          <Seg value={p.styleMode} onChange={p.onStyleMode} options={[["land_use", "Land use"], ["encroachment", "Encroach."], ["confidence", "Confidence"]]} />
        </div>
      </Card>

      <Card title="Layers">
        <ul className="lyr">
          {MAP_LAYERS.map((l) => (
            <li key={l.id} className={"lyr__item" + (l.available ? "" : " is-disabled")}>
              <label>
                <input
                  type="checkbox"
                  disabled={!l.available}
                  checked={l.available ? (p.layers[l.id] ?? l.defaultOn) : false}
                  onChange={() => p.onToggleLayer(l.id)}
                />
                {l.label}
              </label>
              {l.note && <span className="lyr__note">{l.available ? l.note : `unavailable — ${l.note}`}</span>}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Search">
        <input
          className="sb__input"
          type="search"
          placeholder="Parcel ID, survey no, ward, locality, or lat,lng"
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
          aria-label="Search parcels"
        />
        {p.hasQuery && (
          <div className="res">
            <div className="res__head">{p.results.length} match{p.results.length === 1 ? "" : "es"}</div>
            {p.results.length === 0 && <p className="sb__note">No parcels match “{p.query.trim()}”.</p>}
            {p.results.map((r) => (
              <button
                key={r.parcel_id}
                type="button"
                className={"res__row" + (r.parcel_id === p.selectedId ? " is-active" : "")}
                onClick={() => p.onPick(r.parcel_id)}
              >
                <span className="res__id">{r.parcel_id}</span>
                <span className="res__sub">{[r.survey_no, r.village_ward, r.land_use].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card
        title="Filters"
        right={p.activeFilterCount > 0 ? <button type="button" className="link" onClick={p.onResetFilters}>Clear ({p.activeFilterCount})</button> : undefined}
      >
        {FILTER_FIELDS.map(({ key, label }) => (
          <label key={key} className="sb__select-field">
            <span>{label}</span>
            <select value={p.filters[key]} onChange={(e) => p.onFilterChange(key, e.target.value)}>
              <option value="">All</option>
              {p.filterOptions[key].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        ))}
        <label className="sb__select-field">
          <span>Min. boundary confidence</span>
          <select value={String(p.filters.minConfidence)} onChange={(e) => p.onMinConfidence(Number(e.target.value))}>
            <option value="0">Any</option>
            <option value="0.55">≥ 55% (Medium+)</option>
            <option value="0.8">≥ 80% (High)</option>
          </select>
        </label>
        <p className="sb__count"><b>{p.dash.parcels}</b> of {p.dash.totalParcels} parcels{p.activeFilterCount > 0 ? " match filters" : ""}</p>
      </Card>

      <Card title={`Legend — ${p.styleMode === "encroachment" ? "encroachment" : p.styleMode === "confidence" ? "boundary confidence" : "land use"}`}>
        <ul className="leg">
          {legend.map(([name, color]) => (
            <li key={name} className="leg__item"><span className="leg__sw" style={{ background: color }} />{name}</li>
          ))}
          {p.layers.ai !== false && (
            <li className="leg__item"><span className="leg__sw leg__sw--dash" />AI detection (potential discrepancy)</li>
          )}
        </ul>
      </Card>

      <Card title="Event stream">
        <ul className="evt">
          {p.events.slice(0, 10).map((e) => (
            <li key={e.id} className="evt__item">
              <span className="evt__t">{rel(e.ts, p.now)}</span>
              <span className={"evt__k evt__k--" + e.kind}>{e.kind}</span>
              <span className="evt__x">{e.text}</span>
            </li>
          ))}
          {p.events.length === 0 && <li className="sb__note">No events yet.</li>}
        </ul>
      </Card>
    </div>
  );
}

export default memo(Sidebar);
