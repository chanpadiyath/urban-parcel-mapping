"""Derive a live "parcel" dataset from real OpenStreetMap building footprints.

Each OSM building becomes one Land-Twin record: REAL geometry, REAL area, REAL
land-use where OSM tags it, REAL nearest-road distance, REAL address / name /
storeys where mapped. Fields with no public source — survey number, ownership,
encroachment, guideline value, tenure — are deliberately LEFT UNSET (the UI
shows "not available"), never fabricated. Community data, not a cadastral record.
"""

from .geo import (
    SQFT_PER_SQM,
    area_m2,
    bbox_of_ring,
    centroid_of,
    dist_point_seg_m,
    js_round,
    point_in_ring,
    ring_of,
    round_to,
    scale_at,
)

LU_MAP = {
    "retail": "Commercial", "commercial": "Commercial", "industrial": "Industrial",
    "residential": "Residential", "education": "Institutional", "religious": "Institutional",
    "construction": "Vacant", "recreation_ground": "Open Space", "grass": "Open Space",
    "park": "Open Space", "railway": "Public/Semi-Public",
}
AMENITY_INST = {"school", "college", "university", "hospital", "clinic", "place_of_worship", "library", "community_centre"}
AMENITY_PSP = {"parking", "bus_station", "police", "fire_station", "townhall"}


def _classify(props: dict, containing: str | None) -> str:
    if containing and containing in LU_MAP:
        return LU_MAP[containing]
    b = props.get("building")
    if b and b != "yes" and b in LU_MAP:
        return LU_MAP[b]
    if b in ("commercial", "retail") or props.get("shop") or props.get("office"):
        return "Commercial"
    if b in ("residential", "apartments", "house"):
        return "Residential"
    if b in ("industrial", "warehouse"):
        return "Industrial"
    amenity = props.get("amenity")
    if amenity in AMENITY_INST:
        return "Institutional"
    if amenity in AMENITY_PSP:
        return "Public/Semi-Public"
    return "Unclassified"


def build_osm_parcels(reference_fc: dict | None) -> dict:
    feats = (reference_fc or {}).get("features", [])
    buildings_in = [f for f in feats if f["properties"].get("osm_kind") == "building" and f["geometry"]["type"] == "Polygon"]
    landuses = []
    for f in feats:
        if f["properties"].get("osm_kind") == "landuse":
            r = ring_of(f["geometry"])
            if r:
                landuses.append((r, bbox_of_ring(r), f["properties"].get("landuse")))
    roads = [
        (f["geometry"]["coordinates"], f["properties"].get("name"), f["properties"].get("highway"))
        for f in feats
        if f["properties"].get("osm_kind") == "highway" and f["geometry"]["type"] == "LineString"
    ]

    fetched_at = ((reference_fc or {}).get("meta") or {}).get("fetched_at")
    parcels, buildings = [], []
    cov = {"total": 0, "land_use": 0, "address_or_name": 0, "floors": 0}

    for bf in buildings_in:
        ring = ring_of(bf["geometry"])
        if len(ring) < 4:
            continue
        c = centroid_of(ring)
        kx, ky = scale_at(c[1])
        area_sqm = round_to(area_m2(ring), 1)
        if area_sqm < 8:
            continue
        cov["total"] += 1

        containing = None
        for r, bb, tag in landuses:
            if bb[0] <= c[0] <= bb[2] and bb[1] <= c[1] <= bb[3] and point_in_ring(c, r):
                containing = tag
                break
        props = bf["properties"]
        land_use = _classify(props, containing)
        if land_use != "Unclassified":
            cov["land_use"] += 1

        road_m = road_name = road_cls = None
        for line, name, cls in roads:
            for i in range(1, len(line)):
                d = dist_point_seg_m(c, line[i - 1], line[i], kx, ky)
                if road_m is None or d < road_m:
                    road_m, road_name, road_cls = d, name, cls

        levels = props.get("levels")
        floors = levels if isinstance(levels, (int, float)) else None
        if floors is not None:
            cov["floors"] += 1
        addr = props.get("addr") or props.get("name") or None
        if addr:
            cov["address_or_name"] += 1

        pid = f"OSM-{props['osm_id']}"
        p = {
            "parcel_id": pid,
            "osm_id": props["osm_id"],
            "osm_type": "way",
            "name": props.get("name"),
            "address": addr,
            "city": "Chennai",
            "locality": "T. Nagar",
            "land_use": land_use,
            "observed_use": "Not classified in OpenStreetMap" if land_use == "Unclassified" else land_use,
            "development_status": "Mapped structure (OSM)",
            "area_sqm": area_sqm,
            "area_sqft": js_round(area_sqm * SQFT_PER_SQM),
            "built_up_area_sqm": area_sqm,  # OSM gives the footprint, not the plot
            "built_up_pct": 100,
            "floors": floors,
            "nearest_road_m": None if road_m is None else round_to(road_m, 1),
            "nearest_road_name": road_name,
            "nearest_road_class": road_cls,
            # no public source for survey_no, ownership_*, encroachment_*, reference_area_*,
            # discrepancy_*, boundary_confidence, tenure_class, assessed_value_inr — left unset
            "data_source": "OpenStreetMap (live via Overpass)",
            "data_quality": "OSM-LIVE",
            "last_updated": fetched_at[:10] if fetched_at else None,
        }
        parcels.append({"type": "Feature", "id": pid, "geometry": bf["geometry"], "properties": {k: v for k, v in p.items() if v is not None}})

        h = (floors if floors is not None else 2) * 3.2
        b = {
            "parcel_id": pid,
            "floors": floors,
            "height_m": round_to(h, 1),
            "height_basis": f"OSM building:levels ({floors} × 3.2 m)" if floors is not None else "assumed 2 floors × 3.2 m",
            "footprint_area_sqm": area_sqm,
            "land_use": land_use,
            "data_source": "OpenStreetMap (live via Overpass)",
            "data_quality": "OSM-LIVE",
        }
        buildings.append({"type": "Feature", "id": pid, "geometry": bf["geometry"], "properties": {k: v for k, v in b.items() if v is not None}})

    def pct(n: int) -> int:
        return js_round(n / cov["total"] * 100) if cov["total"] else 0

    crs = {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}}
    meta = {
        "source": "OpenStreetMap (live via Overpass)",
        "fetched_at": fetched_at,
        "parcel_count": len(parcels),
        "attribute_coverage": {
            "land_use_pct": pct(cov["land_use"]),
            "address_or_name_pct": pct(cov["address_or_name"]),
            "floors_pct": pct(cov["floors"]),
        },
        "disclaimer": (
            "Parcels are real OSM building footprints. Community data — not an official cadastral "
            "or land-record source. No ownership, survey-number, encroachment or valuation data "
            "exists in this source and those fields are left unset."
        ),
    }
    return {
        "parcels": {"type": "FeatureCollection", "name": "osm-parcels", "crs": crs, "metadata": meta, "features": parcels},
        "buildings": {"type": "FeatureCollection", "name": "osm-buildings", "crs": crs, "metadata": meta, "features": buildings},
        "meta": meta,
    }
