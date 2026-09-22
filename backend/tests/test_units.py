import json
import math

from app.config import DATA_DIR
from app.elevation import sample_grid
from app.flood import impact_from_depth
from app.geo import area_m2, js_round, point_in_ring


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
