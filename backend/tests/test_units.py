import json
import math

from app.config import DATA_DIR
from app.elevation import sample_grid
from app.flood import FloodEngine, impact_from_depth
from app.geo import area_m2, js_round, point_in_ring
from app.roads import nearest_road


def test_js_round_rounds_half_up_unlike_python():
    assert js_round(0.5) == 1 and js_round(1.5) == 2 and js_round(2.5) == 3 and js_round(-0.5) == 0


def test_impact_thresholds_match_frontend_guidance():
    # thresholds documented in frontend/src/sim/flood.ts IMPACT_GUIDANCE
    assert [impact_from_depth(d) for d in (0.1, 0.3, 0.99, 1.0, 1.99, 2.0)] == [
        "Low", "Moderate", "Moderate", "High", "High", "Severe",
    ]


def test_area_of_known_square():
    # ~100 m x 100 m square near Chennai
    lat = 13.04
    dlon = 100 / (111320 * math.cos(math.radians(lat)))
    dlat = 100 / 110540
    ring = [[80, lat], [80 + dlon, lat], [80 + dlon, lat + dlat], [80, lat + dlat], [80, lat]]
    assert abs(area_m2(ring) - 10000) < 50


def test_point_in_ring():
    ring = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]
    assert point_in_ring((1, 1), ring) and not point_in_ring((3, 1), ring)


def test_sample_grid_bilinear_and_clamped():
    grid = {
        "cols": 2, "rows": 2,
        "bounds": {"west": 0, "east": 1, "south": 0, "north": 1},
        "values": [[10, 20], [30, 40]],  # row 0 = north
    }
    assert sample_grid(grid, 0, 1) == 10  # NW corner
    assert sample_grid(grid, 1, 0) == 40  # SE corner
    assert sample_grid(grid, 0.5, 0.5) == 25
    assert sample_grid(grid, -5, 9) == 10  # outside bounds clamps to the edge


def test_committed_elevation_snapshot_is_sane_for_chennai():
    snap = json.loads((DATA_DIR / "elevation-chennai.json").read_text("utf-8"))
    vals = list(snap["parcelElevations"].values())
    assert len(vals) == 144
    assert -5 < min(vals) and max(vals) < 60  # coastal plain, not the mountains


def test_nearest_road_known_distance_and_empty_input():
    lat = 13.0
    dlon = 100 / (111320 * math.cos(math.radians(lat)))  # 100m east-west at this latitude
    dlat = 50 / 110540  # 50m north
    road = {
        "properties": {"osm_kind": "highway", "name": "Test Rd", "highway": "residential"},
        "geometry": {"type": "LineString", "coordinates": [[80, lat], [80 + dlon, lat]]},
    }
    dist_m, name, cls = nearest_road(80 + dlon / 2, lat + dlat, [road])
    assert name == "Test Rd" and cls == "residential"
    assert abs(dist_m - 50) < 5
    assert nearest_road(80, 13, []) == (None, None, None)


def _tiny_engine() -> FloodEngine:
    elevation = {
        "source": "test-fixture",
        "grid": {"cols": 2, "rows": 2, "bounds": {"west": 0, "east": 1, "south": 0, "north": 1}, "values": [[10, 10], [10, 10]]},
        "parcelElevations": {"P1": 10.0, "P2": 12.0},
    }
    engine = FloodEngine(elevation)
    ring = [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]
    parcels = {
        "features": [
            {"properties": {"parcel_id": "P1", "area_sqm": 100, "land_use": "Residential", "nearest_road_m": 5.0, "nearest_road_name": "Test Rd"}, "geometry": {"type": "Polygon", "coordinates": [ring]}},
            {"properties": {"parcel_id": "P2", "area_sqm": 100, "land_use": "Residential"}, "geometry": {"type": "Polygon", "coordinates": [ring]}},
        ]
    }
    engine.set_parcels(parcels, {"features": []})
    return engine


def test_what_if_plinth_raise_and_level_reduction_are_real_arithmetic():
    engine = _tiny_engine()
    # base_level = elev_min - 0.25 = 9.75; push to exactly 10.5 m
    engine.level_offset_m = 10.5 - engine.base_level

    baseline = engine.what_if("P1")
    assert baseline["elevationM"] == 10.0
    assert baseline["waterLevelM"] == 10.5
    assert baseline["baseline"]["depthM"] == 0.5  # 10.5 - 10.0
    assert baseline["baseline"]["impact"] == "Moderate"
    assert baseline["road"] == {"name": "Test Rd", "distanceM": 5.0}

    raised = engine.what_if("P1", plinth_raise_m=0.5)
    assert raised["scenario"]["depthM"] == 0.0  # 10.5 - (10.0 + 0.5)
    assert raised["scenario"]["impact"] == "None"  # not "Low" — must not mislabel an unflooded parcel

    reduced = engine.what_if("P1", level_reduction_m=0.3)
    assert reduced["scenario"]["depthM"] == 0.2  # (10.5 - 0.3) - 10.0
    assert reduced["scenario"]["impact"] == "Low"

    combined = engine.what_if("P1", plinth_raise_m=0.5, level_reduction_m=0.3)
    assert combined["scenario"]["depthM"] == 0.0  # clamped — raw scenario depth is negative
    assert combined["deltaDepthM"] == 0.8  # 0.5 - (-0.3), using the real (unclamped) depths

    assert engine.what_if("no-such-parcel") is None
