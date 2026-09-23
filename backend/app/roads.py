"""Nearest-road lookup against real OSM road geometry (from reference.py).

Shared by the flood engine's per-parcel road annotation (see main.py's
_sync_engine) — the same distance-to-segment approach osm_parcels.py and
reconcile.py already use per-building, lifted into one place for reuse.
"""

from .geo import dist_point_seg_m, scale_at


def nearest_road(lon: float, lat: float, road_features: list[dict]) -> tuple[float, str | None, str | None] | tuple[None, None, None]:
    """Real distance (m) + name/class of the nearest OSM highway to a point, or all-None if no roads given."""
    kx, ky = scale_at(lat)
    best_m: float | None = None
    best_name: str | None = None
    best_cls: str | None = None
    for f in road_features:
        if f["properties"].get("osm_kind") != "highway":
            continue
        line = f["geometry"]["coordinates"]
        for i in range(1, len(line)):
            d = dist_point_seg_m((lon, lat), line[i - 1], line[i], kx, ky)
            if best_m is None or d < best_m:
                best_m, best_name, best_cls = d, f["properties"].get("name"), f["properties"].get("highway")
    if best_m is None:
        return None, None, None
    return best_m, best_name, best_cls
