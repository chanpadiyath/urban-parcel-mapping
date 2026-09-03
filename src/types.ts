import type { FeatureCollection, Feature, Polygon, MultiPolygon } from "geojson";

/**
 * Internal parcel attribute schema. Real datasets are expected to be
 * normalised to these field names during data prep. Every parcel must have a
 * stable unique `parcel_id`.
 */
export interface ParcelProperties {
  parcel_id: string;
  address?: string;
  land_use?: string;
  zoning?: string;
  status?: string;
  area_sqm?: number;
  area_acres?: number;
  assessed_value_usd?: number;
  owner?: string;
  jurisdiction?: string;
  last_updated?: string;
  data_source?: string;
  [key: string]: string | number | boolean | null | undefined;
}

export type ParcelGeometry = Polygon | MultiPolygon;
export type ParcelFeature = Feature<ParcelGeometry, ParcelProperties>;
export type ParcelCollection = FeatureCollection<ParcelGeometry, ParcelProperties>;

/** Fields rendered in the info panel, in display order. */
export const PARCEL_FIELD_ORDER: Array<{
  key: keyof ParcelProperties;
  label: string;
}> = [
  { key: "address", label: "Address" },
  { key: "land_use", label: "Land use" },
  { key: "zoning", label: "Zoning" },
  { key: "status", label: "Status" },
  { key: "area_sqm", label: "Area (m²)" },
  { key: "area_acres", label: "Area (acres)" },
  { key: "assessed_value_usd", label: "Assessed value" },
  { key: "owner", label: "Owner / jurisdiction" },
  { key: "last_updated", label: "Last updated" },
  { key: "data_source", label: "Data source" },
];

/** Land-use categories and their map / legend colours. */
export const LAND_USE_COLORS: Record<string, string> = {
  Residential: "#8db8d8",
  Commercial: "#e0a458",
  "Mixed Use": "#b08fc7",
  Industrial: "#9aa0a6",
  "Parks / Open Space": "#8fbf8f",
  "Civic / Institutional": "#d98c8c",
};
export const LAND_USE_FALLBACK_COLOR = "#b5b5b5";

export const FILTER_FIELDS: Array<{
  key: "land_use" | "zoning" | "status";
  label: string;
}> = [
  { key: "land_use", label: "Land use" },
  { key: "zoning", label: "Zoning" },
  { key: "status", label: "Status" },
];

export type Filters = Record<"land_use" | "zoning" | "status", string>;
export const EMPTY_FILTERS: Filters = { land_use: "", zoning: "", status: "" };
