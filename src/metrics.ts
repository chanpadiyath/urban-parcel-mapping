import { ENCROACHMENT_LEVELS, type EncroachmentLevel, type ParcelProperties } from "./types";

/** Assumed storey height for estimated building extrusion (metres). */
export const FLOOR_HEIGHT_M = 3.2;

/** Everything the UI derives from a parcel's raw areas. All guarded against
 *  zero / missing / non-finite inputs so a bad record never crashes a render. */
export interface ParcelMetrics {
  parcelArea: number;
  builtUpArea: number;
  openArea: number;
  encroachmentArea: number;
  rowArea: number;
  builtUpPct: number | null;
  openPct: number | null;
  encroachmentPct: number | null;
  groundCoveragePct: number | null;
  far: number | null;
  estBuildingHeightM: number | null;
  floors: number;
  encroachmentLevel: EncroachmentLevel;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function pct(part: number, whole: number): number | null {
  if (!Number.isFinite(whole) || whole <= 0) return null;
  return clamp((part / whole) * 100, 0, 100);
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Classify an encroachment percentage into a severity band. */
export function encroachmentLevelFromPct(p: number | null): EncroachmentLevel {
  if (p === null || p <= 0) return "None";
  if (p < 5) return "Minor";
  if (p < 15) return "Moderate";
  if (p < 30) return "Significant";
  return "Critical";
}

export function deriveMetrics(props: ParcelProperties): ParcelMetrics {
  const parcelArea = num(props.area_sqm);
  const encroachmentArea = clamp(num(props.encroachment_area_sqm), 0, parcelArea || Infinity);
  const rowArea = clamp(num(props.row_area_sqm), 0, parcelArea || Infinity);
  const builtUpArea = clamp(num(props.built_up_area_sqm), 0, parcelArea || Infinity);
  const openArea = parcelArea > 0 ? Math.max(0, parcelArea - builtUpArea - encroachmentArea) : 0;
  const floors = Math.max(0, num(props.floors));

  const encroachmentPct = pct(encroachmentArea, parcelArea);
  // Prefer the stored categorical label when present and valid; else derive.
  const stored = props.encroachment_status;
  const encroachmentLevel: EncroachmentLevel =
    typeof stored === "string" && (ENCROACHMENT_LEVELS as readonly string[]).includes(stored)
      ? (stored as EncroachmentLevel)
      : encroachmentLevelFromPct(encroachmentPct);

  const groundCoveragePct = pct(builtUpArea, parcelArea);
  const far =
    parcelArea > 0 && floors > 0 ? round2((builtUpArea * floors) / parcelArea) : null;
  const estBuildingHeightM = floors > 0 ? round2(floors * FLOOR_HEIGHT_M) : null;

  return {
    parcelArea,
    builtUpArea,
    openArea,
    encroachmentArea,
    rowArea,
    builtUpPct: pct(builtUpArea, parcelArea),
    openPct: pct(openArea, parcelArea),
    encroachmentPct,
    groundCoveragePct,
    far,
    estBuildingHeightM,
    floors,
    encroachmentLevel,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// --- formatting helpers -------------------------------------------
export function fmtArea(v: number | null | undefined, unit = "m²"): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toLocaleString(undefined, { maximumFractionDigits: v < 100 ? 1 : 0 })} ${unit}`;
}

export function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

export function fmtCurrency(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
