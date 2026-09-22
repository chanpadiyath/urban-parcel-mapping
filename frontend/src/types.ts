import type { FeatureCollection, Feature, Polygon, MultiPolygon } from "geojson";

/** Time-series snapshot carried on each parcel (demo history). */
export interface ParcelSnapshot {
  observed_on?: string;
  built_up_area_sqm?: number;
  vegetation_pct?: number;
  encroachment_area_sqm?: number;
}

/**
 * Land Twin attribute schema. Real datasets are normalised to these names.
 * Every parcel has a stable unique `parcel_id`. Derived metrics live in
 * `metrics.ts` and are computed at runtime.
 */
export interface ParcelProperties {
  parcel_id: string;

  // identity
  survey_no?: string;
  subdivision_no?: string;
  state?: string;
  district?: string;
  taluk?: string;
  village_ward?: string;
  local_body?: string;
  pin_code?: string;
  city?: string;
  locality?: string;
  address?: string;

  // classification
  land_use?: string;
  observed_use?: string;
  zoning_code?: string;
  zoning_description?: string;
  development_status?: string;
  tenure_class?: string;
  agri_status?: string;

  // ownership (no personal data in this dataset)
  ownership_status?: string;
  owner_record_available?: boolean;
  ownership_type?: string;
  last_verified?: string;

  // geometry / area
  area_sqm?: number;
  area_sqft?: number;
  perimeter_m?: number;
  reference_area_sqm?: number;
  reference_area_sqft?: number;
  discrepancy_area_sqm?: number;
  discrepancy_pct?: number;
  boundary_confidence?: number;
  boundary_confidence_label?: string;
  boundary_source?: string;

  // built form / land intelligence
  built_up_area_sqm?: number;
  built_up_pct?: number;
  floors?: number;
  vegetation_pct?: number;
  encroachment_area_sqm?: number;
  encroachment_status?: string;

  previous?: ParcelSnapshot;

  assessed_value_inr?: number;
  last_updated?: string;
  data_source?: string;
  data_quality?: string;

  [key: string]: unknown;
}

export type ParcelGeometry = Polygon | MultiPolygon;
export type ParcelFeature = Feature<ParcelGeometry, ParcelProperties>;
export type ParcelCollection = FeatureCollection<ParcelGeometry, ParcelProperties>;

export interface BuildingProperties {
  parcel_id: string;
  floors?: number;
  height_m?: number;
  height_basis?: string;
  footprint_area_sqm?: number;
  land_use?: string;
  [key: string]: unknown;
}
export type BuildingCollection = FeatureCollection<Polygon, BuildingProperties>;

export type ViewMode = "2d" | "3d";
export type BasemapId = "map" | "satellite";

/** Toggleable map layers. `available: false` => shown disabled (needs data). */
export interface LayerDef {
  id: string;
  label: string;
  available: boolean;
  defaultOn: boolean;
  note?: string;
}
export const MAP_LAYERS: LayerDef[] = [
  { id: "parcels", label: "Parcels", available: true, defaultOn: true },
  { id: "buildings", label: "Buildings (3D)", available: true, defaultOn: true, note: "Estimated massing" },
  { id: "ai", label: "AI detections", available: true, defaultOn: true, note: "Potential discrepancies" },
  { id: "landuse", label: "Land-use fill", available: true, defaultOn: true },
  { id: "roads", label: "Roads", available: true, defaultOn: false, note: "Real OpenStreetMap road geometry" },
  { id: "water", label: "Water bodies", available: false, defaultOn: false, note: "Needs hydrology layer" },
  { id: "vegetation", label: "Vegetation", available: false, defaultOn: false, note: "Needs NDVI / imagery" },
  { id: "admin", label: "Administrative boundaries", available: false, defaultOn: false, note: "Needs ward boundary data" },
];

/** Land-use categories → map / legend colours (muted). */
export const LAND_USE_COLORS: Record<string, string> = {
  Residential: "#5b8dc9",
  "Mixed Residential": "#7d9bd1",
  Commercial: "#d99a4e",
  Institutional: "#5aa79a",
  Industrial: "#8a8f98",
  "Public/Semi-Public": "#b7a75f",
  "Open Space": "#6faf6a",
  Vacant: "#9aa3ad",
};
export const LAND_USE_FALLBACK_COLOR = "#8b93a0";

export const ENCROACHMENT_LEVELS = ["None", "Minor", "Moderate", "Significant", "Critical"] as const;
export type EncroachmentLevel = (typeof ENCROACHMENT_LEVELS)[number];
export const ENCROACHMENT_COLORS: Record<EncroachmentLevel, string> = {
  None: "#3f7d52",
  Minor: "#c9b458",
  Moderate: "#d9902f",
  Significant: "#d1642e",
  Critical: "#c0392b",
};

export type StyleMode = "land_use" | "encroachment" | "confidence";

export type FilterKey =
  | "land_use"
  | "zoning_code"
  | "development_status"
  | "encroachment_status"
  | "tenure_class";

export const FILTER_FIELDS: Array<{ key: FilterKey; label: string }> = [
  { key: "land_use", label: "Land use" },
  { key: "zoning_code", label: "Zoning" },
  { key: "development_status", label: "Development status" },
  { key: "encroachment_status", label: "Potential encroachment" },
  { key: "tenure_class", label: "Tenure" },
];

export type Filters = Record<FilterKey, string> & { minConfidence: number };
export const EMPTY_FILTERS: Filters = {
  land_use: "",
  zoning_code: "",
  development_status: "",
  encroachment_status: "",
  tenure_class: "",
  minConfidence: 0,
};

// --- Local Land AI ------------------------------------------------
export type AiCategory =
  | "boundary"
  | "area"
  | "change"
  | "landuse"
  | "encroachment"
  | "confidence"
  | "context";

export interface AiInsight {
  id: string;
  parcelId: string;
  category: AiCategory;
  text: string;
  confidence: number; // 0..1
  basis: string;
  source: string;
  requiresVerification: boolean;
  ts: number;
}

export interface TwinEvent {
  id: string;
  ts: number;
  kind: "sync" | "analysis" | "detection" | "data" | "ai";
  text: string;
}

export type AiRuntimeState = "running" | "fallback" | "idle";
