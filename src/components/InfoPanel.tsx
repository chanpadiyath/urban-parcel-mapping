import {
  ENCROACHMENT_COLORS,
  INFO_SECTIONS,
  type ParcelProperties,
} from "../types";
import { deriveMetrics, fmtArea, fmtCurrency, fmtPct } from "../metrics";

interface InfoPanelProps {
  parcel: ParcelProperties | null;
  onClose: () => void;
}

function devStatusClass(status: string | undefined): string {
  switch (status) {
    case "Developed":
      return "pill pill--green";
    case "Partially Developed":
    case "Under Development":
      return "pill pill--blue";
    case "Vacant":
      return "pill pill--gray";
    case "Encroached":
      return "pill pill--red";
    case "Requires Review":
      return "pill pill--amber";
    default:
      return "pill";
  }
}

function formatRow(key: keyof ParcelProperties, raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  if (key === "assessed_value_usd" && typeof raw === "number") {
    return `${fmtCurrency(raw)}  (demo)`;
  }
  if (key === "floors") {
    return typeof raw === "number" && raw > 0 ? String(raw) : "—";
  }
  return String(raw);
}

export default function InfoPanel({ parcel, onClose }: InfoPanelProps) {
  if (!parcel) return null;
  const m = deriveMetrics(parcel);
  const encColor = ENCROACHMENT_COLORS[m.encroachmentLevel];

  const bar = [
    { label: "Built-up", value: m.builtUpArea, color: "#4b6b96" },
    { label: "Open", value: m.openArea, color: "#cdd8e4" },
    { label: "Encroach.", value: m.encroachmentArea, color: encColor },
  ].filter((s) => s.value > 0);
  const barTotal = bar.reduce((s, x) => s + x.value, 0) || 1;

  return (
    <aside className="info" aria-label="Parcel details" aria-live="polite">
      <div className="info__header">
        <div>
          <div className="info__eyebrow">Parcel</div>
          <h2 className="info__title">{parcel.parcel_id}</h2>
        </div>
        <button type="button" className="info__close" onClick={onClose} aria-label="Close parcel details">
          ×
        </button>
      </div>

      <div className="info__badges">
        {parcel.development_status && (
          <span className={devStatusClass(parcel.development_status)}>
            {String(parcel.development_status)}
          </span>
        )}
        <span
          className="pill"
          style={{ background: encColor + "33", borderColor: encColor, color: "#3f3325" }}
        >
          Encroachment: {m.encroachmentLevel}
        </span>
        {parcel.data_quality && <span className="pill pill--demo">{String(parcel.data_quality)}</span>}
      </div>

      <section className="info__section">
        <h3 className="info__section-title">Area analysis</h3>

        <div className="areabar" role="img" aria-label="Parcel area composition">
          {bar.map((s) => (
            <span
              key={s.label}
              className="areabar__seg"
              style={{ width: `${(s.value / barTotal) * 100}%`, background: s.color }}
              title={`${s.label}: ${fmtArea(s.value)}`}
            />
          ))}
        </div>
        <div className="areabar__legend">
          {bar.map((s) => (
            <span key={s.label} className="areabar__key">
              <i style={{ background: s.color }} /> {s.label}
            </span>
          ))}
        </div>

        <dl className="info__list">
          <Row label="Parcel area" value={fmtArea(m.parcelArea)} sub={fmtArea(parcel.area_acres, "ac")} />
          <Row label="Built-up area" value={fmtArea(m.builtUpArea)} sub={fmtPct(m.builtUpPct)} />
          <Row label="Open / vacant area" value={fmtArea(m.openArea)} sub={fmtPct(m.openPct)} />
          <Row
            label="Encroachment area"
            value={fmtArea(m.encroachmentArea)}
            sub={`${fmtPct(m.encroachmentPct)} · ${m.encroachmentLevel}`}
          />
          <Row label="Road / RoW area" value={fmtArea(m.rowArea)} />
        </dl>
      </section>

      <section className="info__section">
        <h3 className="info__section-title">
          Development intelligence <span className="info__tag">Demo analysis</span>
        </h3>
        <dl className="info__list">
          <Row label="Ground coverage" value={fmtPct(m.groundCoveragePct)} />
          <Row label="Floor area ratio (FAR)" value={m.far === null ? "—" : m.far.toFixed(2)} sub="estimated" />
          <Row label="Built-up ratio" value={fmtPct(m.builtUpPct)} />
        </dl>
      </section>

      {INFO_SECTIONS.map((sec) => (
        <section className="info__section" key={sec.title}>
          <h3 className="info__section-title">{sec.title}</h3>
          <dl className="info__list">
            {sec.rows.map(({ key, label }) => (
              <Row key={String(key)} label={label} value={formatRow(key, parcel[key])} />
            ))}
          </dl>
        </section>
      ))}

      <p className="info__foot">
        Demonstration dataset. Encroachment and planning figures are fabricated for
        this prototype and are not official determinations.
      </p>
    </aside>
  );
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="info__row">
      <dt className="info__label">{label}</dt>
      <dd className="info__value">
        {value}
        {sub ? <span className="info__value-sub"> {sub}</span> : null}
      </dd>
    </div>
  );
}
