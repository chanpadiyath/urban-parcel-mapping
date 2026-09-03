import type { ParcelFeature, ParcelGeometry } from "./types";

export type BBox = [[number, number], [number, number]];

function extend(bbox: BBox, coords: unknown): void {
  if (
    Array.isArray(coords) &&
    typeof coords[0] === "number" &&
    typeof coords[1] === "number"
  ) {
    const [x, y] = coords as [number, number];
    if (x < bbox[0][0]) bbox[0][0] = x;
    if (y < bbox[0][1]) bbox[0][1] = y;
    if (x > bbox[1][0]) bbox[1][0] = x;
    if (y > bbox[1][1]) bbox[1][1] = y;
    return;
  }
  if (Array.isArray(coords)) coords.forEach((c) => extend(bbox, c));
}

/** Bounding box of a single geometry, or null if it has no coordinates. */
export function geometryBounds(geom: ParcelGeometry | null | undefined): BBox | null {
  if (!geom) return null;
  const bbox: BBox = [
    [Infinity, Infinity],
    [-Infinity, -Infinity],
  ];
  extend(bbox, geom.coordinates);
  return Number.isFinite(bbox[0][0]) ? bbox : null;
}

/** Bounding box covering every feature, or null if the list is empty. */
export function featuresBounds(features: ParcelFeature[]): BBox | null {
  const bbox: BBox = [
    [Infinity, Infinity],
    [-Infinity, -Infinity],
  ];
  for (const f of features) extend(bbox, f.geometry?.coordinates);
  return Number.isFinite(bbox[0][0]) ? bbox : null;
}
