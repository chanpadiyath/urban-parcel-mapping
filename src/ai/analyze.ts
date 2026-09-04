/**
 * Local Land AI — deterministic analyser.
 *
 * This is a rule / heuristic engine, not a machine-learning model. It runs
 * on-device (in a Web Worker when available, else inline) and produces the
 * same shape of output a model-backed analyser would, so `LocalLandAI` can
 * swap in a real model later without touching the UI.
 *
 * Every statement it emits is hedged ("potential", "estimated", "appears")
 * and carries confidence + basis + source + requiresVerification. Nothing
 * here is a legal or official determination.
 */

import type { AiInsight, ParcelProperties } from "../types";
import { deriveMetrics } from "../metrics";

export interface AnalyzeOptions {
  neighbors?: ParcelProperties[];
  now?: number;
}

export interface AnalyzeResult {
  parcelId: string;
  insights: AiInsight[];
  overallConfidence: number;
  ranAt: number;
}

const AI_SOURCE = "Local Land AI (heuristic) · parcel geometry + demo attributes";

function mk(
  parcelId: string,
  category: AiInsight["category"],
  text: string,
  confidence: number,
  basis: string,
  ts: number,
  requiresVerification = true,
): AiInsight {
  return {
    id: `${parcelId}:${category}`,
    parcelId,
    category,
    text,
    confidence: Math.max(0.05, Math.min(0.97, confidence)),
    basis,
    source: AI_SOURCE,
    requiresVerification,
    ts,
  };
}

export function analyzeParcel(props: ParcelProperties, opts: AnalyzeOptions = {}): AnalyzeResult {
  const ts = opts.now ?? Date.now();
  const m = deriveMetrics(props);
  const conf = m.boundaryConfidence ?? 0.5;
  const insights: AiInsight[] = [];

  // area / boundary discrepancy
  if (m.discrepancyPct != null && m.discrepancyPct >= 3) {
    insights.push(
      mk(
        props.parcel_id,
        "area",
        `Mapped area differs from the reference figure by approximately ${m.discrepancyPct.toFixed(1)}% ` +
          `(${m.discrepancyAreaSqm.toFixed(1)} m²).`,
        0.5 + Math.min(0.3, m.discrepancyPct / 60) * conf,
        "Compared the mapped polygon area against the parcel's reference area value.",
        ts,
      ),
    );
  }

  // potential encroachment
  if (m.encroachmentLevel !== "None") {
    const sevWeight = { Minor: 0.35, Moderate: 0.55, Significant: 0.75, Critical: 0.88 }[m.encroachmentLevel] ?? 0.4;
    insights.push(
      mk(
        props.parcel_id,
        "encroachment",
        `Potential encroachment / boundary–usage discrepancy on this parcel: about ` +
          `${m.encroachmentAreaSqm.toFixed(1)} m² (${(m.encroachmentPct ?? 0).toFixed(1)}%). ` +
          `Indicative severity: ${m.encroachmentLevel}. Requires field verification.`,
        0.4 + sevWeight * 0.5 * (0.6 + conf * 0.4),
        "Estimated overlap between the mapped parcel polygon and the observed built footprint (demo).",
        ts,
      ),
    );
  }

  // built-up change vs previous snapshot
  if (m.builtUpChangeSqm != null && Math.abs(m.builtUpChangeSqm) >= 4) {
    const dir = m.builtUpChangeSqm > 0 ? "increased" : "decreased";
    insights.push(
      mk(
        props.parcel_id,
        "change",
        `Built-up area appears to have ${dir} by ~${Math.abs(m.builtUpChangeSqm).toFixed(1)} m² since ` +
          `${props.previous?.observed_on ?? "the previous observation"} — ` +
          `${m.builtUpChangeSqm > 0 ? "possible new construction" : "possible demolition / correction"}.`,
        0.45 + conf * 0.25,
        "Difference between current and previous built-up-area snapshots (demo time-series).",
        ts,
      ),
    );
  }

  // vegetation change
  if (m.vegetationChangePct != null && m.vegetationChangePct <= -5) {
    insights.push(
      mk(
        props.parcel_id,
        "change",
        `Vegetation cover down about ${Math.abs(m.vegetationChangePct)} percentage points since ` +
          `${props.previous?.observed_on ?? "the previous observation"}.`,
        0.4 + conf * 0.2,
        "Difference between current and previous vegetation-fraction snapshots (demo time-series).",
        ts,
        false,
      ),
    );
  }

  // land-use inference
  if (props.land_use) {
    insights.push(
      mk(
        props.parcel_id,
        "landuse",
        `Parcel appears predominantly ${String(props.land_use).toLowerCase()} based on built-up coverage ` +
          `(${(m.builtUpPct ?? 0).toFixed(0)}%)${m.floors ? ` and ~${m.floors} floors` : ""}.`,
        0.55 + conf * 0.25,
        "Coverage ratio and storey count compared with typical land-use profiles.",
        ts,
        false,
      ),
    );
  }

  // confidence caveat
  if (conf < 0.55) {
    insights.push(
      mk(
        props.parcel_id,
        "confidence",
        `Confidence is limited: authoritative cadastral geometry is unavailable, so the boundary is a ` +
          `derived grid. Treat area and discrepancy figures as indicative only.`,
        0.9,
        `Boundary confidence for this parcel is ${(conf * 100).toFixed(0)}% (source: ${props.boundary_source ?? "derived"}).`,
        ts,
      ),
    );
  }

  // neighbourhood context
  if (opts.neighbors && opts.neighbors.length) {
    const flagged = opts.neighbors.filter(
      (n) => n.encroachment_status && n.encroachment_status !== "None",
    ).length;
    if (flagged > 0) {
      insights.push(
        mk(
          props.parcel_id,
          "context",
          `${flagged} of ${opts.neighbors.length} adjoining parcels also carry a potential-encroachment flag ` +
            `— possible cluster; worth reviewing the block together.`,
          0.5,
          "Scanned encroachment flags on parcels sharing a boundary with this one.",
          ts,
          false,
        ),
      );
    }
  }

  const overallConfidence = insights.length
    ? insights.reduce((s, i) => s + i.confidence, 0) / insights.length
    : conf;

  return { parcelId: props.parcel_id, insights, overallConfidence, ranAt: ts };
}

/** Deterministic natural-language-ish query → filter intent. */
export interface QueryIntent {
  kind:
    | "encroachment"
    | "recent-change"
    | "large"
    | "high-confidence"
    | "low-confidence"
    | "analyze"
    | "land-use"
    | "unknown";
  landUse?: string;
  minSqft?: number;
  note: string;
}

export function parseQuery(raw: string): QueryIntent {
  const q = raw.toLowerCase().trim();
  if (!q) return { kind: "unknown", note: "Empty query." };
  if (/(high[- ]?confidence|reliable|verified)/.test(q))
    return { kind: "high-confidence", note: "Parcels with boundary confidence ≥ 70%." };
  if (/(low[- ]?confidence|uncertain|unreliable)/.test(q))
    return { kind: "low-confidence", note: "Parcels with boundary confidence < 55%." };
  if (/(encroach|discrepan|overlap)/.test(q))
    return { kind: "encroachment", note: "Parcels with a potential encroachment / discrepancy flag." };
  if (/(recent|change|changed|new construction|new build)/.test(q))
    return { kind: "recent-change", note: "Parcels whose built-up area changed vs the previous snapshot." };
  const sqftM = q.match(/(\d[\d,]{2,})\s*(sq\s?ft|sqft|square feet|sft)/);
  if (/larger than|bigger than|greater than|more than|>\s*\d/.test(q) || sqftM) {
    const n = sqftM ? Number(sqftM[1].replace(/,/g, "")) : 2000;
    return { kind: "large", minSqft: n, note: `Parcels larger than ${n.toLocaleString("en-IN")} sq ft.` };
  }
  const useM = q.match(/\b(residential|commercial|industrial|institutional|vacant|open space|mixed residential|public)\b/);
  if (useM) {
    const map: Record<string, string> = {
      residential: "Residential",
      commercial: "Commercial",
      industrial: "Industrial",
      institutional: "Institutional",
      vacant: "Vacant",
      "open space": "Open Space",
      "mixed residential": "Mixed Residential",
      public: "Public/Semi-Public",
    };
    return { kind: "land-use", landUse: map[useM[1]], note: `${map[useM[1]]} parcels.` };
  }
  if (/(analy[sz]e|assess|inspect|explain)/.test(q))
    return { kind: "analyze", note: "Run analysis on the selected parcel." };
  return { kind: "unknown", note: "Could not interpret — try: “potential encroachment”, “recent changes”, “larger than 2000 sq ft”, “low confidence”." };
}
