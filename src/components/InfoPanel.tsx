import { PARCEL_FIELD_ORDER, type ParcelProperties } from "../types";

interface InfoPanelProps {
  parcel: ParcelProperties | null;
  onClose: () => void;
}

function formatValue(key: keyof ParcelProperties, raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  if (key === "area_sqm" && typeof raw === "number") {
    return `${raw.toLocaleString(undefined, { maximumFractionDigits: 1 })} m²`;
  }
  if (key === "area_acres" && typeof raw === "number") {
    return `${raw.toLocaleString(undefined, { maximumFractionDigits: 3 })} ac`;
  }
  if (key === "assessed_value_usd" && typeof raw === "number") {
    return `${raw.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    })}  (demo)`;
  }
  return String(raw);
}

function statusClass(status: string | undefined): string {
  switch (status) {
    case "Active":
      return "pill pill--green";
    case "Exempt":
      return "pill pill--gray";
    case "Pending Review":
      return "pill pill--amber";
    case "Subdivision Proposed":
      return "pill pill--blue";
    default:
      return "pill";
  }
}

export default function InfoPanel({ parcel, onClose }: InfoPanelProps) {
  if (!parcel) return null;

  return (
    <aside className="info" aria-label="Parcel details" aria-live="polite">
      <div className="info__header">
        <div>
          <div className="info__eyebrow">Parcel</div>
          <h2 className="info__title">{formatValue("parcel_id", parcel.parcel_id)}</h2>
        </div>
        <button
          type="button"
          className="info__close"
          onClick={onClose}
          aria-label="Close parcel details"
        >
          ×
        </button>
      </div>

      {parcel.status !== undefined && parcel.status !== "" && (
        <div className="info__status">
          <span className={statusClass(parcel.status)}>{String(parcel.status)}</span>
        </div>
      )}

      <dl className="info__list">
        {PARCEL_FIELD_ORDER.map(({ key, label }) => (
          <div className="info__row" key={String(key)}>
            <dt className="info__label">{label}</dt>
            <dd className="info__value">{formatValue(key, parcel[key])}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
