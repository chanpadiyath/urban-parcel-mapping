/** Shared planar-geometry helpers (small polygons, local metric projection). */

const DEG2RAD = Math.PI / 180;

export function ringOf(geom) {
  if (!geom) return [];
  if (geom.type === "Polygon") return geom.coordinates[0] ?? [];
  if (geom.type === "MultiPolygon") return geom.coordinates[0]?.[0] ?? [];
  return [];
}

export function bboxOfRing(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

export function centroidOf(ring) {
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return ring.length ? [x / ring.length, y / ring.length] : [0, 0];
}

export function pointInRing([px, py], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** area in m² via a local equirectangular projection at the ring's latitude */
export function areaM2(ring) {
  if (ring.length < 4) return 0;
  const lat0 = centroidOf(ring)[1] * DEG2RAD;
  const kx = 111320 * Math.cos(lat0), ky = 110540;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * kx * (ring[i][1] * ky) - ring[i][0] * kx * (ring[j][1] * ky);
  }
  return Math.abs(a) / 2;
}

export function scaleAt(lat) {
  const lat0 = lat * DEG2RAD;
  return { kx: 111320 * Math.cos(lat0), ky: 110540 };
}

export function distPointSegM([px, py], [ax, ay], [bx, by], kx, ky) {
  const Ax = ax * kx, Ay = ay * ky, Bx = bx * kx, By = by * ky, Px = px * kx, Py = py * ky;
  const dx = Bx - Ax, dy = By - Ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((Px - Ax) * dx + (Py - Ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(Px - (Ax + t * dx), Py - (Ay + t * dy));
}

export const SQFT_PER_SQM = 10.76391;
