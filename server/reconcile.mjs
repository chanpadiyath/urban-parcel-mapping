/**
 * Reconciliation: compare our synthetic Land-Twin parcels against the real
 * OpenStreetMap reference (buildings / land-use / roads).
 *
 * Produces, per parcel: whether a real building footprint sits on it, the
 * OSM building area vs our built-up estimate, whether OSM's land-use tag
 * agrees with ours, and the true distance to the nearest mapped road.
 * Plus dataset-level agreement rates.
 *
 * This measures agreement with community data — it is not a validation
 * against an official record (no such API exists for Indian parcels).
 */

const DEG2RAD = Math.PI / 180;

function ringOf(geom) {
  if (geom.type === "Polygon") return geom.coordinates[0];
  if (geom.type === "MultiPolygon") return geom.coordinates[0][0];
  return [];
}
function bbox(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
}
function centroid(ring) {
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
}
function pointInRing([px, py], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** planar area in m² (local equirectangular projection at the ring's latitude) */
function areaM2(ring) {
  if (ring.length < 4) return 0;
  const lat0 = centroid(ring)[1] * DEG2RAD;
  const kx = 111320 * Math.cos(lat0), ky = 110540;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0] * kx, yi = ring[i][1] * ky;
    const xj = ring[j][0] * kx, yj = ring[j][1] * ky;
    a += xj * yi - xi * yj;
  }
  return Math.abs(a) / 2;
}
function distPointSegM([px, py], [ax, ay], [bx, by], kx, ky) {
  const Ax = ax * kx, Ay = ay * ky, Bx = bx * kx, By = by * ky, Px = px * kx, Py = py * ky;
  const dx = Bx - Ax, dy = By - Ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((Px - Ax) * dx + (Py - Ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = Ax + t * dx, cy = Ay + t * dy;
  return Math.hypot(Px - cx, Py - cy);
}

const OSM_LANDUSE_MAP = {
  residential: "Residential",
  retail: "Commercial",
  commercial: "Commercial",
  industrial: "Industrial",
  education: "Institutional",
  religious: "Institutional",
  institutional: "Institutional",
  civic_admin: "Public/Semi-Public",
  railway: "Public/Semi-Public",
  recreation_ground: "Open Space",
  grass: "Open Space",
  park: "Open Space",
  forest: "Open Space",
  meadow: "Open Space",
  greenfield: "Vacant",
  brownfield: "Vacant",
  construction: "Vacant",
};

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function reconcile(parcels, reference) {
  const ref = reference?.features ?? [];
  const buildings = ref
    .filter((f) => f.properties.osm_kind === "building")
    .map((f) => { const r = ringOf(f.geometry); return { r, c: centroid(r), bb: bbox(r), area: areaM2(r), levels: f.properties.levels }; });
  const landuses = ref
    .filter((f) => f.properties.osm_kind === "landuse")
    .map((f) => { const r = ringOf(f.geometry); return { r, bb: bbox(r), tag: f.properties.landuse }; });
  const roads = ref
    .filter((f) => f.properties.osm_kind === "highway")
    .map((f) => ({ line: f.geometry.coordinates, name: f.properties.name, cls: f.properties.highway }));

  const perParcel = {};
  let withBuilding = 0, luComparable = 0, luAgree = 0;
  const builtDeltas = [];
  const roadDists = [];

  for (const pf of parcels.features) {
    const id = pf.properties.parcel_id;
    const r = ringOf(pf.geometry);
    const c = centroid(r);
    const pbb = bbox(r);
    const lat0 = c[1] * DEG2RAD;
    const kx = 111320 * Math.cos(lat0), ky = 110540;

    // buildings whose centroid falls inside this parcel
    const inside = buildings.filter(
      (b) => b.c[0] >= pbb[0] && b.c[0] <= pbb[2] && b.c[1] >= pbb[1] && b.c[1] <= pbb[3] && pointInRing(b.c, r),
    );
    const osmBuildingAreaSqm = inside.reduce((s, b) => s + b.area, 0);
    const osmBuildingPresent = inside.length > 0;
    if (osmBuildingPresent) withBuilding++;

    const ourBuiltUp = typeof pf.properties.built_up_area_sqm === "number" ? pf.properties.built_up_area_sqm : null;
    const builtUpDelta = osmBuildingPresent && ourBuiltUp != null ? Math.round((ourBuiltUp - osmBuildingAreaSqm) * 10) / 10 : null;
    if (builtUpDelta != null) builtDeltas.push(Math.abs(builtUpDelta));

    // OSM land-use polygon containing the parcel centroid
    let osmLanduse = null;
    for (const lu of landuses) {
      if (c[0] >= lu.bb[0] && c[0] <= lu.bb[2] && c[1] >= lu.bb[1] && c[1] <= lu.bb[3] && pointInRing(c, lu.r)) {
        osmLanduse = lu.tag; break;
      }
    }
    let landuseMatch = null;
    if (osmLanduse) {
      const mapped = OSM_LANDUSE_MAP[osmLanduse] ?? null;
      if (mapped) {
        luComparable++;
        landuseMatch = mapped === pf.properties.land_use;
        if (landuseMatch) luAgree++;
      }
    }

    // nearest road (metres)
    let nearestRoadM = null, nearestRoadName = null, nearestRoadCls = null;
    for (const rd of roads) {
      for (let i = 1; i < rd.line.length; i++) {
        const d = distPointSegM(c, rd.line[i - 1], rd.line[i], kx, ky);
        if (nearestRoadM == null || d < nearestRoadM) { nearestRoadM = d; nearestRoadName = rd.name; nearestRoadCls = rd.cls; }
      }
    }
    if (nearestRoadM != null) roadDists.push(nearestRoadM);

    perParcel[id] = {
      osm_building_present: osmBuildingPresent,
      osm_building_count: inside.length,
      osm_building_area_sqm: Math.round(osmBuildingAreaSqm),
      our_built_up_area_sqm: ourBuiltUp,
      built_up_delta_sqm: builtUpDelta,
      osm_landuse: osmLanduse,
      our_land_use: pf.properties.land_use ?? null,
      landuse_match: landuseMatch,
      nearest_road_m: nearestRoadM == null ? null : Math.round(nearestRoadM * 10) / 10,
      nearest_road_name: nearestRoadName ?? null,
      nearest_road_class: nearestRoadCls ?? null,
    };
  }

  const total = parcels.features.length;
  return {
    generated_at: new Date().toISOString(),
    reference_source: reference?.meta?.source ?? "OpenStreetMap",
    reference_loaded_at: reference?.meta?.fetched_at ?? null,
    summary: {
      parcels_total: total,
      osm_buildings_in_area: buildings.length,
      osm_landuse_polygons: landuses.length,
      osm_roads: roads.length,
      parcels_with_osm_building: withBuilding,
      building_presence_rate: total ? Math.round((withBuilding / total) * 1000) / 10 : 0,
      landuse_comparable_parcels: luComparable,
      landuse_agreements: luAgree,
      landuse_agreement_rate: luComparable ? Math.round((luAgree / luComparable) * 1000) / 10 : null,
      median_abs_builtup_delta_sqm: median(builtDeltas),
      median_nearest_road_m: median(roadDists) == null ? null : Math.round(median(roadDists) * 10) / 10,
    },
    note:
      "Agreement with OpenStreetMap community data. Our parcel boundaries are a derived grid, " +
      "so building/land-use overlap is indicative. This is NOT validation against an official land record.",
    perParcel,
  };
}
