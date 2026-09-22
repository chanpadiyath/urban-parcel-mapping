import { memo, useEffect, useState, type ReactNode } from "react";
import type { AiInsight, ParcelProperties } from "../types";
import {
  deriveMetrics,
  fmtInr,
  fmtPct,
  fmtSigned,
  fmtSqft,
  fmtSqm,
} from "../metrics";
import type { AnalyzeResult } from "../ai/analyze";
import type { AiRuntimeState } from "../types";
import type { ParcelReconcile } from "../data/reconcile";
import { nearbyPlaces, type NearbyPlace } from "../data/google";

function rel(ts: number | null | undefined, now: number): string {
  if (!ts) return "—";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

interface Props {
  parcel: ParcelProperties | null;
  aiState: AiRuntimeState;
  aiBusy: boolean;
  aiResult: AnalyzeResult | null;
  aiLastRanAt: number | null;
  lastSyncTs: number;
  now: number;
  reconcile: ParcelReconcile | null | undefined;
  reconcileState: "loading" | "ready" | "unavailable";
  centroid: [number, number] | null;
  onClose: () => void;
}

function Section({ title, tag, children }: { title: string; tag?: string; children: ReactNode }) {
  return (
    <section className="tw__section">
      <h3 className="tw__section-title">
        {title}
        {tag ? <span className="tw__tag">{tag}</span> : null}
      </h3>
      <dl className="tw__list">{children}</dl>
    </section>
  );
}
function Row({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="tw__row">
      <dt className="tw__label">{label}</dt>
      <dd className="tw__value">
        {value}
        {sub ? <span className="tw__sub"> {sub}</span> : null}
      </dd>
    </div>
  );
}

const CAT_LABEL: Record<AiInsight["category"], string> = {
  boundary: "Boundary",
  area: "Area",
  change: "Change",
  landuse: "Land use",
  encroachment: "Encroachment",
  confidence: "Confidence",
  context: "Context",
};

function confPill(label: string | undefined) {
  if (label === "High") return "pill pill--green";
  if (label === "Low") return "pill pill--red";
  return "pill pill--amber";
}
function encPill(level: string) {
  if (level === "None") return "pill pill--green";
  if (level === "Minor" || level === "Moderate") return "pill pill--amber";
  return "pill pill--red";
}

function LandTwinPanel({
  parcel, aiState, aiBusy, aiResult, aiLastRanAt, lastSyncTs, now, reconcile, reconcileState, centroid, onClose,
}: Props) {
  const [places, setPlaces] = useState<{ status: "idle" | "loading" | "done"; list: NearbyPlace[] }>({
    status: "idle",
    list: [],
  });
  useEffect(() => {
    if (!parcel || !centroid) {
      setPlaces({ status: "idle", list: [] });
      return;
    }
    let cancelled = false;
    setPlaces({ status: "loading", list: [] });
    nearbyPlaces(centroid[1], centroid[0]).then((list) => {
      if (!cancelled) setPlaces({ status: "done", list });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcel?.parcel_id, centroid]);

  if (!parcel) return null;
  const m = deriveMetrics(parcel);
  const prev = parcel.previous;
  const isOsm = String(parcel.data_quality ?? "").startsWith("OSM");

  const changeCount = [m.builtUpChangeSqm, m.vegetationChangePct, m.encroachmentChangeSqm].filter(
    (d) => d != null && Math.abs(d) >= 1,
  ).length;
  const construction =
    m.builtUpChangeSqm != null && m.builtUpChangeSqm > 4
      ? "Likely (built-up area rising)"
      : m.builtUpChangeSqm != null && m.builtUpChangeSqm < -4
        ? "Possible demolition / correction"
        : "None observed";

  const insights = aiResult?.parcelId === parcel.parcel_id ? aiResult.insights : [];

  return (
    <aside className="tw" aria-label="Land Twin" aria-live="polite">
      <div className="tw__header">
        <div>
          <div className="tw__eyebrow">Land Twin</div>
          <h2 className="tw__title">{parcel.parcel_id}</h2>
          <div className="tw__subtitle">
            {parcel.survey_no ?? "Survey no. unavailable"} · {parcel.locality ?? ""}
          </div>
        </div>
        <button type="button" className="tw__close" onClick={onClose} aria-label="Close Land Twin">×</button>
      </div>

      <div className="tw__badges">
        {parcel.development_status && <span className="pill pill--blue">{String(parcel.development_status)}</span>}
        {isOsm ? (
          <>
            <span className="pill pill--green">Live · OpenStreetMap</span>
            {parcel.name && <span className="pill">{String(parcel.name)}</span>}
          </>
        ) : (
          <>
            <span className={encPill(m.encroachmentLevel)}>Encroachment: {m.encroachmentLevel}</span>
            <span className={confPill(parcel.boundary_confidence_label)}>
              Confidence: {parcel.boundary_confidence_label ?? "—"}
              {m.boundaryConfidence != null ? ` (${Math.round(m.boundaryConfidence * 100)}%)` : ""}
            </span>
            <span className="pill pill--demo">{String(parcel.data_quality ?? "DEMO")}</span>
          </>
        )}
      </div>

      {isOsm && (
        <p className="tw__muted" style={{ padding: "8px 14px 0" }}>
          Real OpenStreetMap building footprint. Ownership, survey number,
          encroachment, guideline value and tenure have <strong>no public data
          source</strong> and are not shown.
        </p>
      )}

      <Section title="Live status">
        <Row label="Last twin sync" value={rel(lastSyncTs, now)} />
        <Row
          label="Local AI"
          value={aiState === "running" ? "Local / running" : aiState === "fallback" ? "Local / fallback (inline)" : "Idle"}
          sub={aiBusy ? "· analysing…" : ""}
        />
        <Row label="Last analysis" value={rel(aiLastRanAt, now)} />
        <Row label="Detected changes" value={`${changeCount} vs ${prev?.observed_on ?? "prev."}`} />
        <Row label="Imagery" value="Basemap only — no change-detection feed" />
      </Section>

      <Section title="Land intelligence" tag="AI-derived / demo">
        <Row label="Observed use" value={parcel.observed_use ?? parcel.land_use ?? "—"} />
        <Row label="Built footprint change" value={fmtSigned(m.builtUpChangeSqm, "m²")} sub={`since ${prev?.observed_on ?? "—"}`} />
        <Row label="Vegetation change" value={fmtSigned(m.vegetationChangePct, "pts")} />
        <Row label="Potential encroachment" value={`${fmtSqm(m.encroachmentAreaSqm)} · ${fmtPct(m.encroachmentPct)}`} sub={m.encroachmentLevel} />
        <Row label="Construction activity" value={construction} />
        <Row label="Access / road change" value="Data unavailable" />
        <Row label="Flood / water risk" value="Data unavailable" />
      </Section>

      <Section title={isOsm ? "Footprint & geometry" : "Area & discrepancy"} tag={isOsm ? "real · OSM" : "derived geometry"}>
        <Row label={isOsm ? "Footprint area" : "Mapped area"} value={fmtSqft(m.parcelAreaSqft)} sub={fmtSqm(m.parcelAreaSqm)} />
        {isOsm ? (
          <>
            <Row label="Reference / cadastral area" value="Not available" sub="no public source" />
            <Row label="Nearest mapped road" value={parcel.nearest_road_m != null ? `${parcel.nearest_road_m} m` : "—"} sub={(parcel.nearest_road_name as string) ?? (parcel.nearest_road_class as string) ?? undefined} />
            <Row label="OSM way" value={parcel.osm_id != null ? `way/${parcel.osm_id}` : "—"} />
          </>
        ) : (
          <>
            <Row label="Reference area" value={fmtSqft(parcel.reference_area_sqft)} sub={fmtSqm(m.referenceAreaSqm)} />
            <Row
              label="Potential discrepancy"
              value={`${fmtSqm(m.discrepancyAreaSqm)} · ${fmtPct(m.discrepancyPct)}`}
              sub="mapped vs reference — indicative only"
            />
            <Row label="Boundary confidence" value={m.boundaryConfidence != null ? `${Math.round(m.boundaryConfidence * 100)}%` : "—"} sub={parcel.boundary_confidence_label} />
            <Row label="Perimeter" value={parcel.perimeter_m != null ? `${parcel.perimeter_m} m` : "—"} />
            <Row label="Boundary source" value={parcel.boundary_source ?? "—"} />
          </>
        )}
      </Section>

      <Section title="Built form" tag="estimated">
        <Row label="Built-up area" value={fmtSqft(m.builtUpAreaSqm * 10.76391)} sub={`${fmtSqm(m.builtUpAreaSqm)} · ${fmtPct(m.builtUpPct)}`} />
        <Row label="Open / vacant area" value={fmtSqm(m.openAreaSqm)} sub={fmtPct(m.openPct)} />
        <Row label="Floors" value={m.floors > 0 ? String(m.floors) : "—"} />
        <Row label="Building height" value={m.estBuildingHeightM != null ? `${m.estBuildingHeightM.toFixed(1)} m` : "—"} sub="floors × 3.2 m" />
        <Row label="Floor area ratio (FAR)" value={m.far != null ? m.far.toFixed(2) : "—"} sub="estimated" />
        <Row label="Ground coverage" value={fmtPct(m.groundCoveragePct)} />
      </Section>

      {prev && (
        <Section title="Time series" tag={`current vs ${prev.observed_on ?? "previous"}`}>
          <Row label="Built-up area" value={`${fmtSqm(prev.built_up_area_sqm)} → ${fmtSqm(m.builtUpAreaSqm)}`} />
          <Row label="Vegetation" value={`${prev.vegetation_pct ?? "—"}% → ${m.vegetationPct ?? "—"}%`} />
          <Row label="Potential encroachment" value={`${fmtSqm(prev.encroachment_area_sqm)} → ${fmtSqm(m.encroachmentAreaSqm)}`} />
        </Section>
      )}

      <Section title="Planning">
        <Row label="Zoning" value={`${parcel.zoning_code ?? "—"} — ${parcel.zoning_description ?? ""}`} />
        <Row label="Land use" value={parcel.land_use ?? "—"} />
        <Row label="Tenure" value={parcel.tenure_class ?? "—"} />
        <Row label="Agricultural status" value={parcel.agri_status ?? "—"} />
        <Row label="Assessed value" value={fmtInr(parcel.assessed_value_inr)} sub="(demo guideline estimate)" />
      </Section>

      <Section title="Identity">
        <Row label="Survey no." value={parcel.survey_no ?? "—"} sub={parcel.subdivision_no ? `sub-div ${parcel.subdivision_no}` : ""} />
        <Row label="Address" value={parcel.address ?? "—"} />
        <Row label="Ward / village" value={parcel.village_ward ?? "—"} />
        <Row label="Taluk / district" value={`${parcel.taluk ?? "—"}, ${parcel.district ?? "—"}`} />
        <Row label="Local body" value={parcel.local_body ?? "—"} />
        <Row label="PIN" value={parcel.pin_code ?? "—"} />
        <Row label="State" value={parcel.state ?? "—"} />
      </Section>

      <Section title="Ownership">
        <Row
          label="Ownership"
          value={parcel.owner_record_available ? (parcel.ownership_status ?? "—") : "Ownership data unavailable"}
        />
        <Row label="Ownership type" value={parcel.ownership_type ?? "—"} />
        <Row label="Last verified" value={parcel.last_verified ?? "—"} />
      </Section>

      <section className="tw__section">
        <h3 className="tw__section-title">
          Local AI insights
          <span className="tw__tag">{aiState === "running" ? "worker" : "inline"} · heuristic</span>
        </h3>
        {insights.length === 0 && <p className="tw__muted">No insights yet — analysis pending.</p>}
        <ul className="ins">
          {insights.map((i) => (
            <li key={i.id} className="ins__item">
              <div className="ins__head">
                <span className="ins__cat">{CAT_LABEL[i.category]}</span>
                <span className="ins__conf">{Math.round(i.confidence * 100)}%{i.requiresVerification ? " · needs verification" : ""}</span>
              </div>
              <p className="ins__text">{i.text}</p>
              <p className="ins__meta">Basis: {i.basis}</p>
              <p className="ins__meta">Source: {i.source} · {rel(i.ts, now)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="tw__section">
        <h3 className="tw__section-title">
          Nearby (Google Places)
          <span className="tw__tag">real data · optional</span>
        </h3>
        {!centroid && <p className="tw__muted">Unavailable — no location for this parcel.</p>}
        {centroid && places.status === "loading" && <p className="tw__muted">Loading nearby places…</p>}
        {centroid && places.status === "done" && places.list.length === 0 && (
          <p className="tw__muted">No nearby places found, or Google Places isn't configured (needs a server-side API key — see .env.example).</p>
        )}
        {places.list.length > 0 && (
          <>
            <ul className="ins">
              {places.list.map((pl, i) => (
                <li key={i} className="ins__item">
                  <div className="ins__head">
                    <span className="ins__cat">{pl.types[0] ? pl.types[0].replace(/_/g, " ") : "place"}</span>
                  </div>
                  <p className="ins__text">{pl.name}</p>
                  {pl.address && <p className="ins__meta">{pl.address}</p>}
                </li>
              ))}
            </ul>
            <p className="tw__muted">Fills the gap where OpenStreetMap name/address tagging is sparse in this area (~5% coverage).</p>
          </>
        )}
      </section>

      {!isOsm && (
      <section className="tw__section">
        <h3 className="tw__section-title">
          Cross-check — OpenStreetMap
          <span className="tw__tag">community data</span>
        </h3>
        {reconcileState === "unavailable" && (
          <p className="tw__muted">Needs the simulation backend (npm run server) with network access.</p>
        )}
        {reconcileState === "loading" && <p className="tw__muted">Loading reference comparison…</p>}
        {reconcileState === "ready" && !reconcile && (
          <p className="tw__muted">No OSM feature overlaps this parcel.</p>
        )}
        {reconcileState === "ready" && reconcile && (
          <dl className="tw__list">
            <Row
              label="OSM building here"
              value={reconcile.osm_building_present ? `Yes (${reconcile.osm_building_count})` : "No"}
            />
            {reconcile.osm_building_present && (
              <Row
                label="Footprint: OSM vs ours"
                value={`${fmtSqm(reconcile.osm_building_area_sqm)} vs ${fmtSqm(reconcile.our_built_up_area_sqm)}`}
                sub={reconcile.built_up_delta_sqm != null ? `Δ ${reconcile.built_up_delta_sqm} m²` : undefined}
              />
            )}
            <Row
              label="OSM land use"
              value={reconcile.osm_landuse ?? "—"}
              sub={
                reconcile.landuse_match === null
                  ? "not comparable"
                  : reconcile.landuse_match
                    ? "agrees with ours"
                    : `differs (ours: ${reconcile.our_land_use})`
              }
            />
            <Row
              label="Nearest mapped road"
              value={reconcile.nearest_road_m != null ? `${reconcile.nearest_road_m} m` : "—"}
              sub={reconcile.nearest_road_name ?? reconcile.nearest_road_class ?? undefined}
            />
          </dl>
        )}
        <p className="tw__muted" style={{ marginTop: 8 }}>
          OpenStreetMap, not an official land record. Our boundary is a derived grid, so
          overlap is indicative.
        </p>
      </section>
      )}

      <Section title="Data sources">
        <Row
          label="Parcel geometry"
          value={isOsm ? "Real — OpenStreetMap building footprint (live via Overpass)" : "Derived — regular grid at a real location (not cadastral)"}
        />
        <Row label="Attributes" value="Demonstration data (synthetic)" />
        <Row label="Imagery" value="Esri / OSM base tiles — no analysis feed" />
        <Row label="Intelligence" value="Local Land AI — deterministic heuristics, on device" />
      </Section>

      <p className="tw__foot">
        Demonstration Land Twin. Geometry is a derived grid, not a verified cadastral
        boundary. Encroachment, discrepancy, valuation and change figures are
        potential indicators for illustration — not official or legal determinations.
        No personal ownership data is included.
      </p>
    </aside>
  );
}

export default memo(LandTwinPanel);
