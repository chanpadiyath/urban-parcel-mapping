import type { FeatureCollection, Feature, Polygon, MultiPolygon } from "geojson";

/**
 * Internal parcel attribute schema. Real datasets are normalised to these
 * field names during data prep. Every parcel must have a stable unique
 * `parcel_id`. Derived metrics (built-up %, open area, encroachment %, FAR,
 * ground coverage) are NOT stored — see `metrics.ts`.
 */
export interface ParcelProperties {
  parcel_id: string;
  address?: string;
  locality?: string;
  ward?: string;
  zone?: string;

  land_use?: string;
  zoning_code?: string;
  zoning_description?: string;
  permitted_use?: string;
  development_status?: string;

  area_sqm?: number;
  area_acres?: number;
  built_up_area_sqm?: number;
  floors?: number;
  row_area_sqm?: number;
  encroachment_area_sqm?: number;
  encroachment_status?: string;

  assessed_value_usd?: number;
  owner?: string;
  jurisdiction?: string;
  last_updated?: string;
  data_source?: string;
  data_quality?: string;

  [key: string]: string | number | boolean | null | undefined;
}

export type ParcelGeometry = Polygon | MultiPolygon;
export type ParcelFeature = Feature<ParcelGeometry, ParcelProperties>;
export type ParcelCollection = FeatureCollection<ParcelGeometry, ParcelProperties>;

/** Estimated building footprints (demo geometry — not surveyed). */
export interface BuildingProperties {
  parcel_id: string;
  floors?: number;
  height_m?: number;
  height_basis?: string;
  footprint_area_sqm?: number;
  land_use?: string;
  [key: string]: string | number | boolean | null | undefined;
}
export type BuildingCollection = FeatureCollection<Polygon, BuildingProperties>;

/** Map camera mode. */
export type ViewMode = "2d" | "3d";

/** Land-use categories and their map / legend colours (muted, print-safe). */
export const LAND_USE_COLORS: Record<string, string> = {
  Residential: "#8fb3d9",
  Commercial: "#e0a458",
  "Mixed Use": "#b493c9",
  Industrial: "#9aa0a6",
  Institutional: "#6cae9e",
  "Public/Semi-Public": "#c7b56b",
  Recreational: "#8fc08a",
  Vacant: "#cbd0d6",
};
export const LAND_USE_FALLBACK_COLOR = "#c2c7cd";

/** Encroachment severity → colour, ordered least→most severe. */
export const ENCROACHMENT_LEVELS = [
  "None",
  "Minor",
  "Moderate",
  "Significant",
  "Critical",
] as const;
export type EncroachmentLevel = (typeof ENCROACHMENT_LEVELS)[number];

export const ENCROACHMENT_COLORS: Record<EncroachmentLevel, string> = {
  None: "#a7c9a3",
  Minor: "#e8d288",
  Moderate: "#e6b166",
  Significant: "#d98a5a",
  Critical: "#c65f4e",
};

export const DEVELOPMENT_STATUSES = [
  "Developed",
  "Partially Developed",
  "Under Development",
  "Vacant",
  "Encroached",
  "Requires Review",
] as const;

/** Map colouring modes. */
export type StyleMode = "land_use" | "encroachment";

export type FilterKey =
  | "land_use"
  | "zoning_code"
  | "development_status"
  | "encroachment_status";

export const FILTER_FIELDS: Array<{ key: FilterKey; label: string }> = [
  { key: "land_use", label: "Land use" },
  { key: "zoning_code", label: "Zoning" },
  { key: "development_status", label: "Development status" },
  { key: "encroachment_status", label: "Encroachment" },
];

export type Filters = Record<FilterKey, string> & { minArea: number };
export const EMPTY_FILTERS: Filters = {
  land_use: "",
  zoning_code: "",
  development_status: "",
  encroachment_status: "",
  minArea: 0,
};

export const AREA_THRESHOLDS = [
  { label: "Any size", value: 0 },
  { label: "≥ 1,000 m²", value: 1000 },
  { label: "≥ 2,000 m²", value: 2000 },
  { label: "≥ 2,400 m²", value: 2400 },
];

/** Info-panel layout: sections and the fields within them. */
export const INFO_SECTIONS: Array<{
  title: string;
  rows: Array<{ key: keyof ParcelProperties; label: string }>;
}> = [
  {
    title: "Parcel overview",
    rows: [
      { key: "address", label: "Address" },
      { key: "locality", label: "Locality" },
      { key: "ward", label: "Ward" },
      { key: "zone", label: "Zone" },
      { key: "land_use", label: "Land use" },
      { key: "development_status", label: "Development status" },
    ],
  },
  {
    title: "Planning",
    rows: [
      { key: "zoning_code", label: "Zoning code" },
      { key: "zoning_description", label: "Zoning" },
      { key: "permitted_use", label: "Permitted use" },
      { key: "floors", label: "Floors (approx.)" },
    ],
  },
  {
    title: "Assessment",
    rows: [
      { key: "assessed_value_usd", label: "Assessed value" },
      { key: "owner", label: "Owner / jurisdiction" },
      { key: "last_updated", label: "Last updated" },
      { key: "data_source", label: "Data source" },
    ],
  },
];
