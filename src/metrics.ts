import {
  ENCROACHMENT_LEVELS,
  type EncroachmentLevel,
  type ParcelProperties,
} from "./types";

export const FLOOR_HEIGHT_M = 3.2;
export const SQFT_PER_SQM = 10.76391;

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
function pct(part: number, whole: number): number | null {
  if (!Number.isFinite(whole) || whole <= 0) return null;
  return clamp((part / whole) * 100, 0, 100);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function encroachmentLevelFromPct(p: number | null): EncroachmentLevel {
  if (p === null || p <= 0) return "None";
  if (p < 5) return "Minor";
  if (p < 15) return "Moderate";
  if (p < 30) return "Significant";
  return "Critical";
}

export interface ParcelMetrics {
  parcelAreaSqm: number;
  parcelAreaSqft: number;
  referenceAreaSqm: number;
  builtUpAreaSqm: number;
  openAreaSqm: number;
  encroachmentAreaSqm: number;
  builtUpPct: number | null;
  openPct: number | null;
  encroachmentPct: number | null;
  discrepancyAreaSqm: number;
  discrepancyPct: number | null;
  groundCoveragePct: number | null;
  far: number | null;
  estBuildingHeightM: number | null;
  floors: number;
  vegetationPct: number | null;
  boundaryConfidence: number | null;
  encroachmentLevel: EncroachmentLevel;
  /** deltas vs the parcel's `previous` snapshot (null if no history) */
  builtUpChangeSqm: number | null;
  vegetationChangePct: number | null;
  encroachmentChangeSqm: number | null;
}

export function deriveMetrics(props: ParcelProperties): ParcelMetrics {
  const parcelAreaSqm = num(props.area_sqm);
  const parcelAreaSqft = props.area_sqft != null ? num(props.area_sqft) : round2(parcelAreaSqm * SQFT_PER_SQM);
  const referenceAreaSqm = props.reference_area_sqm != null ? num(props.reference_area_sqm) : parcelAreaSqm;

  const encroachmentAreaSqm = clamp(num(props.encroachment_area_sqm), 0, parcelAreaSqm || Infinity);
  const builtUpAreaSqm = clamp(num(props.built_up_area_sqm), 0, parcelAreaSqm || Infinity);
  const openAreaSqm = parcelAreaSqm > 0 ? Math.max(0, parcelAreaSqm - builtUpAreaSqm - encroachmentAreaSqm) : 0;
  const floors = Math.max(0, num(props.floors));

  const discrepancyAreaSqm =
    props.discrepancy_area_sqm != null
      ? num(props.discrepancy_area_sqm)
      : Math.abs(parcelAreaSqm - referenceAreaSqm);
  const discrepancyPct =
    props.discrepancy_pct != null
      ? num(props.discrepancy_pct)
      : referenceAreaSqm > 0
        ? round2((discrepancyAreaSqm / referenceAreaSqm) * 100)
        : null;

  const encroachmentPct = pct(encroachmentAreaSqm, parcelAreaSqm);
  const stored = props.encroachment_status;
  const encroachmentLevel: EncroachmentLevel =
    typeof stored === "string" && (ENCROACHMENT_LEVELS as readonly string[]).includes(stored)
      ? (stored as EncroachmentLevel)
      : encroachmentLevelFromPct(encroachmentPct);

  const prev = props.previous;
  const builtUpChangeSqm =
    prev && typeof prev.built_up_area_sqm === "number"
      ? round2(builtUpAreaSqm - prev.built_up_area_sqm)
      : null;
  const vegetationChangePct =
    prev && typeof prev.vegetation_pct === "number" && typeof props.vegetation_pct === "number"
      ? props.vegetation_pct - prev.vegetation_pct
      : null;
  const encroachmentChangeSqm =
    prev && typeof prev.encroachment_area_sqm === "number"
      ? round2(encroachmentAreaSqm - prev.encroachment_area_sqm)
      : null;

  return {
    parcelAreaSqm,
    parcelAreaSqft,
    referenceAreaSqm,
    builtUpAreaSqm,
    openAreaSqm,
    encroachmentAreaSqm,
    builtUpPct: pct(builtUpAreaSqm, parcelAreaSqm),
    openPct: pct(openAreaSqm, parcelAreaSqm),
    encroachmentPct,
    discrepancyAreaSqm,
    discrepancyPct,
    groundCoveragePct: pct(builtUpAreaSqm, parcelAreaSqm),
    far: parcelAreaSqm > 0 && floors > 0 ? round2((builtUpAreaSqm * floors) / parcelAreaSqm) : null,
    estBuildingHeightM: floors > 0 ? round2(floors * FLOOR_HEIGHT_M) : null,
    floors,
    vegetationPct: typeof props.vegetation_pct === "number" ? props.vegetation_pct : null,
    boundaryConfidence: typeof props.boundary_confidence === "number" ? props.boundary_confidence : null,
    encroachmentLevel,
    builtUpChangeSqm,
    vegetationChangePct,
    encroachmentChangeSqm,
  };
}

// --- formatting -------------------------------------------------
export function fmtSqm(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toLocaleString(undefined, { maximumFractionDigits: v < 100 ? 1 : 0 })} m²`;
}
export function fmtSqft(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v).toLocaleString("en-IN")} sq ft`;
}
export function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}
export function fmtInr(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 1e7) return `₹${round2(v / 1e7).toLocaleString("en-IN")} Cr`;
  if (v >= 1e5) return `₹${round2(v / 1e5).toLocaleString("en-IN")} L`;
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
}
export function fmtSigned(v: number | null | undefined, unit: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = v > 0 ? "+" : "";
  return `${s}${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
}
