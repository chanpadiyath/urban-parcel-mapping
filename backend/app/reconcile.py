"""Reconciliation: compare the demo (synthetic) parcels against the real OSM reference.

Per parcel: is a real building footprint on it, OSM building area vs our
built-up estimate, does OSM's land-use tag agree with ours, and the true
distance to the nearest mapped road — plus dataset-level agreement rates.
This measures agreement with community data; it is NOT validation against an
official record (no such API exists for Indian parcels).
"""

from datetime import datetime, timezone

from .geo import (
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

OSM_LANDUSE_MAP = {
    "residential": "Residential", "retail": "Commercial", "commercial": "Commercial",
    "industrial": "Industrial", "education": "Institutional", "religious": "Institutional",
    "institutional": "Institutional", "civic_admin": "Public/Semi-Public", "railway": "Public/Semi-Public",
    "recreation_ground": "Open Space", "grass": "Open Space", "park": "Open Space",
    "forest": "Open Space", "meadow": "Open Space", "greenfield": "Vacant",
    "brownfield": "Vacant", "construction": "Vacant",
}


def _median(xs: list[float]) -> float | None:
    if not xs:
        return None
    s = sorted(xs)
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


def reconcile(parcels: dict, reference: dict | None) -> dict:
    ref = (reference or {}).get("features", [])
    buildings = []
    for f in ref:
        if f["properties"].get("osm_kind") == "building":
            r = ring_of(f["geometry"])
            if r:
                buildings.append({"r": r, "c": centroid_of(r), "area": area_m2(r)})
    landuses = []
    for f in ref:
        if f["properties"].get("osm_kind") == "landuse":
            r = ring_of(f["geometry"])
            if r:
                landuses.append((r, bbox_of_ring(r), f["properties"].get("landuse")))
    roads = [
        (f["geometry"]["coordinates"], f["properties"].get("name"), f["properties"].get("highway"))
        for f in ref
        if f["properties"].get("osm_kind") == "highway"
    ]

    per_parcel: dict[str, dict] = {}
    with_building = lu_comparable = lu_agree = 0
    built_deltas: list[float] = []
    road_dists: list[float] = []

    for pf in parcels["features"]:
        pid = pf["properties"]["parcel_id"]
        r = ring_of(pf["geometry"])
        c = centroid_of(r)
        pbb = bbox_of_ring(r)
        kx, ky = scale_at(c[1])

        inside = [
            b for b in buildings
            if pbb[0] <= b["c"][0] <= pbb[2] and pbb[1] <= b["c"][1] <= pbb[3] and point_in_ring(b["c"], r)
        ]
        osm_area = sum(b["area"] for b in inside)
        present = len(inside) > 0
        if present:
            with_building += 1

        our = pf["properties"].get("built_up_area_sqm")
        our = our if isinstance(our, (int, float)) else None
        delta = round_to(our - osm_area, 1) if present and our is not None else None
        if delta is not None:
            built_deltas.append(abs(delta))

        osm_landuse = None
        for lr, bb, tag in landuses:
            if bb[0] <= c[0] <= bb[2] and bb[1] <= c[1] <= bb[3] and point_in_ring(c, lr):
                osm_landuse = tag
                break
        match = None
        if osm_landuse:
            mapped = OSM_LANDUSE_MAP.get(osm_landuse)
            if mapped:
                lu_comparable += 1
                match = mapped == pf["properties"].get("land_use")
                if match:
                    lu_agree += 1

        road_m = road_name = road_cls = None
        for line, name, cls in roads:
            for i in range(1, len(line)):
                d = dist_point_seg_m(c, line[i - 1], line[i], kx, ky)
                if road_m is None or d < road_m:
                    road_m, road_name, road_cls = d, name, cls
        if road_m is not None:
            road_dists.append(road_m)

        per_parcel[pid] = {
            "osm_building_present": present,
            "osm_building_count": len(inside),
            "osm_building_area_sqm": js_round(osm_area),
            "our_built_up_area_sqm": our,
            "built_up_delta_sqm": delta,
            "osm_landuse": osm_landuse,
            "our_land_use": pf["properties"].get("land_use"),
            "landuse_match": match,
            "nearest_road_m": None if road_m is None else round_to(road_m, 1),
            "nearest_road_name": road_name,
            "nearest_road_class": road_cls,
        }

    total = len(parcels["features"])
    med_road = _median(road_dists)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "reference_source": ((reference or {}).get("meta") or {}).get("source", "OpenStreetMap"),
        "reference_loaded_at": ((reference or {}).get("meta") or {}).get("fetched_at"),
        "summary": {
            "parcels_total": total,
            "osm_buildings_in_area": len(buildings),
            "osm_landuse_polygons": len(landuses),
            "osm_roads": len(roads),
            "parcels_with_osm_building": with_building,
            "building_presence_rate": round_to(with_building / total * 100, 1) if total else 0,
            "landuse_comparable_parcels": lu_comparable,
            "landuse_agreements": lu_agree,
            "landuse_agreement_rate": round_to(lu_agree / lu_comparable * 100, 1) if lu_comparable else None,
            "median_abs_builtup_delta_sqm": _median(built_deltas),
            "median_nearest_road_m": None if med_road is None else round_to(med_road, 1),
        },
        "note": (
            "Agreement with OpenStreetMap community data. Our parcel boundaries are a derived grid, "
            "so building/land-use overlap is indicative. This is NOT validation against an official land record."
        ),
        "perParcel": per_parcel,
    }
