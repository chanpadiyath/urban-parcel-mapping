/**
 * Derive a live "parcel" dataset from real OpenStreetMap building footprints.
 *
 * Each OSM building becomes one Land-Twin record: REAL geometry, REAL area,
 * REAL land-use where OSM tags it, REAL nearest-road distance, REAL address /
 * name / storeys where mapped. Fields with no public source — survey number,
 * ownership, encroachment, guideline value, tenure — are deliberately LEFT
 * UNSET (the UI shows "not available"), never fabricated.
 *
 * This is community data, not an official cadastral record.
 */

import {
  ringOf, bboxOfRing, centroidOf, pointInRing, areaM2, scaleAt, distPointSegM, SQFT_PER_SQM,
} from "./geo.mjs";

const LU_MAP = {
  retail: "Commercial", commercial: "Commercial", industrial: "Industrial",
  residential: "Residential", education: "Institutional", religious: "Institutional",
  construction: "Vacant", recreation_ground: "Open Space", grass: "Open Space",
  park: "Open Space", railway: "Public/Semi-Public",
};
const AMENITY_INST = new Set(["school", "college", "university", "hospital", "clinic", "place_of_worship", "library", "community_centre"]);
const AMENITY_PSP = new Set(["parking", "bus_station", "police", "fire_station", "townhall"]);

function classify(props, containingLanduse) {
  if (containingLanduse && LU_MAP[containingLanduse]) return LU_MAP[containingLanduse];
  const b = props.building;
  if (b && b !== "yes" && LU_MAP[b]) return LU_MAP[b];
  if (b === "commercial" || b === "retail" || props.shop || props.office) return "Commercial";
  if (b === "residential" || b === "apartments" || b === "house") return "Residential";
  if (b === "industrial" || b === "warehouse") return "Industrial";
  if (props.amenity && AMENITY_INST.has(props.amenity)) return "Institutional";
  if (props.amenity && AMENITY_PSP.has(props.amenity)) return "Public/Semi-Public";
  return "Unclassified";
}

export function buildOsmParcels(referenceFC) {
  const feats = referenceFC?.features ?? [];
  const buildingsIn = feats.filter((f) => f.properties.osm_kind === "building" && f.geometry?.type === "Polygon");
  const landuses = feats
    .filter((f) => f.properties.osm_kind === "landuse")
    .map((f) => { const r = ringOf(f.geometry); return { r, bb: bboxOfRing(r), tag: f.properties.landuse }; });
  const roads = feats
    .filter((f) => f.properties.osm_kind === "highway" && f.geometry?.type === "LineString")
    .map((f) => ({ line: f.geometry.coordinates, name: f.properties.name, cls: f.properties.highway }));

  const fetchedAt = referenceFC?.meta?.fetched_at ?? null;
  const parcels = [];
  const buildings = [];
  const coverage = { total: 0, land_use: 0, address_or_name: 0, floors: 0 };

  for (const bf of buildingsIn) {
    const ring = ringOf(bf.geometry);
    if (ring.length < 4) continue;
    const c = centroidOf(ring);
    const { kx, ky } = scaleAt(c[1]);
    const areaSqm = Math.round(areaM2(ring) * 10) / 10;
    if (areaSqm < 8) continue;
    coverage.total++;

    let containing = null;
    for (const lu of landuses) {
      if (c[0] >= lu.bb[0] && c[0] <= lu.bb[2] && c[1] >= lu.bb[1] && c[1] <= lu.bb[3] && pointInRing(c, lu.r)) {
        containing = lu.tag; break;
      }
    }
    const landUse = classify(bf.properties, containing);
    if (landUse !== "Unclassified") coverage.land_use++;

    let roadM = null, roadName = null, roadCls = null;
    for (const rd of roads) {
      for (let i = 1; i < rd.line.length; i++) {
        const d = distPointSegM(c, rd.line[i - 1], rd.line[i], kx, ky);
        if (roadM == null || d < roadM) { roadM = d; roadName = rd.name; roadCls = rd.cls; }
      }
    }

    const floors = Number.isFinite(bf.properties.levels) ? bf.properties.levels : null;
    if (floors != null) coverage.floors++;
    const addr = bf.properties.addr || bf.properties.name || null;
    if (addr) coverage.address_or_name++;

    const id = `OSM-${bf.properties.osm_id}`;
    parcels.push({
      type: "Feature",
      id,
      geometry: bf.geometry,
      properties: {
        parcel_id: id,
        osm_id: bf.properties.osm_id,
        osm_type: "way",
        name: bf.properties.name ?? undefined,
        address: addr ?? undefined,
        city: "Chennai",
        locality: "T. Nagar",

        land_use: landUse,
        observed_use: landUse === "Unclassified" ? "Not classified in OpenStreetMap" : landUse,
        development_status: "Mapped structure (OSM)",

        area_sqm: areaSqm,
        area_sqft: Math.round(areaSqm * SQFT_PER_SQM),
        built_up_area_sqm: areaSqm, // OSM gives the footprint, not the plot
        built_up_pct: 100,
        floors: floors ?? undefined,

        nearest_road_m: roadM == null ? undefined : Math.round(roadM * 10) / 10,
        nearest_road_name: roadName ?? undefined,
        nearest_road_class: roadCls ?? undefined,

        // no public source for these — left unset on purpose
        // survey_no, ownership_status, encroachment_*, reference_area_*,
        // discrepancy_*, boundary_confidence, tenure_class, assessed_value_inr

        data_source: "OpenStreetMap (live via Overpass)",
        data_quality: "OSM-LIVE",
        last_updated: fetchedAt ? fetchedAt.slice(0, 10) : undefined,
      },
    });

    const h = (floors ?? 2) * 3.2;
    buildings.push({
      type: "Feature",
      id,
      geometry: bf.geometry,
      properties: {
        parcel_id: id,
        floors: floors ?? undefined,
        height_m: Math.round(h * 10) / 10,
        height_basis: floors != null ? `OSM building:levels (${floors} × 3.2 m)` : "assumed 2 floors × 3.2 m",
        footprint_area_sqm: areaSqm,
        land_use: landUse,
        data_source: "OpenStreetMap (live via Overpass)",
        data_quality: "OSM-LIVE",
      },
    });
  }

  const crs = { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } };
  const meta = {
    source: "OpenStreetMap (live via Overpass)",
    fetched_at: fetchedAt,
    parcel_count: parcels.length,
    attribute_coverage: {
      land_use_pct: coverage.total ? Math.round((coverage.land_use / coverage.total) * 100) : 0,
      address_or_name_pct: coverage.total ? Math.round((coverage.address_or_name / coverage.total) * 100) : 0,
      floors_pct: coverage.total ? Math.round((coverage.floors / coverage.total) * 100) : 0,
    },
    disclaimer:
      "Parcels are real OSM building footprints. Community data — not an official cadastral " +
      "or land-record source. No ownership, survey-number, encroachment or valuation data " +
      "exists in this source and those fields are left unset.",
  };
  return {
    parcels: { type: "FeatureCollection", name: "osm-parcels", crs, metadata: meta, features: parcels },
    buildings: { type: "FeatureCollection", name: "osm-buildings", crs, metadata: meta, features: buildings },
    meta,
  };
}
