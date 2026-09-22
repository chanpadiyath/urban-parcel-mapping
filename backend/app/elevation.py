"""Real elevation (DEM) data from Open Topo Data (public, keyless).

`build_snapshot` is used by the one-time job (`jobs/fetch_elevation.py`) and
writes `data/elevation-<site>.json`; the API only ever *reads* that committed
snapshot. This is also the seam a future drone-derived DEM slots into: same
snapshot shape (`grid` + `parcelElevations`), different `source`.

Datasets: "mapzen" (Mapzen/Tilezen composite DEM), falling back to
"srtm30m" (SRTM, ~30 m / ~±10 m vertical accuracy).
"""

import asyncio
import json
import re
from datetime import datetime, timezone
from functools import lru_cache

import httpx

from .config import DATA_DIR
from .geo import bbox_center

DATASETS = ["mapzen", "srtm30m"]
BATCH_SIZE = 100
REQUEST_GAP_S = 1.1  # public instance allows ~1 request/second
UA = "UrbanParcelIntelligence/0.1 (elevation lookup)"

DATASET_LABEL = {
    "mapzen": "Open Topo Data — Mapzen/Tilezen composite DEM",
    "srtm30m": "Open Topo Data — SRTM 30m DEM",
}
DATASET_ACCURACY = {
    "mapzen": "Composite DEM, ~30m-class resolution — a value is a cell average, not a surveyed spot height.",
    "srtm30m": "SRTM 30m, approx. ±10m vertical accuracy — a value is a ~30m cell average, not a surveyed spot height.",
}

_SITE_RE = re.compile(r"^[a-z0-9_-]+$")


class ElevationUnavailable(Exception):
    pass


def snapshot_path(site: str):
    if not _SITE_RE.match(site):
        raise ElevationUnavailable(f"invalid site '{site}'")
    return DATA_DIR / f"elevation-{site}.json"


@lru_cache(maxsize=8)
def load_snapshot(site: str) -> dict:
    p = snapshot_path(site)
    if not p.exists():
        raise ElevationUnavailable(f"no elevation snapshot for site '{site}' (run jobs/fetch_elevation.py)")
    return json.loads(p.read_text("utf-8"))


def sample_grid(grid: dict, lon: float, lat: float) -> float:
    """Bilinear-sample the elevation grid at (lon, lat); edges clamp."""
    cols, rows, b, values = grid["cols"], grid["rows"], grid["bounds"], grid["values"]
    fx = min(1.0, max(0.0, (lon - b["west"]) / (b["east"] - b["west"]))) * (cols - 1)
    fy = min(1.0, max(0.0, (b["north"] - lat) / (b["north"] - b["south"]))) * (rows - 1)  # row 0 = north
    x0, y0 = int(fx), int(fy)
    x1, y1 = min(cols - 1, x0 + 1), min(rows - 1, y0 + 1)
    tx, ty = fx - x0, fy - y0
    top = values[y0][x0] + (values[y0][x1] - values[y0][x0]) * tx
    bot = values[y1][x0] + (values[y1][x1] - values[y1][x0]) * tx
    return top + (bot - top) * ty


# --- fetching (job only) ----------------------------------------------------


async def _fetch_batch(client: httpx.AsyncClient, points, dataset: str) -> list[float]:
    locations = "|".join(f"{lat},{lon}" for lat, lon in points)
    res = await client.post(
        f"https://api.opentopodata.org/v1/{dataset}",
        json={"locations": locations},
        headers={"User-Agent": UA},
        timeout=30,
    )
    res.raise_for_status()
    data = res.json()
    if data.get("status") != "OK":
        raise RuntimeError(data.get("error") or data.get("status") or "unknown error")
    return [r["elevation"] for r in data["results"]]


async def _fetch_elevations(points, log) -> tuple[list[float], str]:
    last_err = "no datasets tried"
    async with httpx.AsyncClient() as client:
        for dataset in DATASETS:
            try:
                batches = [points[i : i + BATCH_SIZE] for i in range(0, len(points), BATCH_SIZE)]
                values: list[float] = []
                for i, batch in enumerate(batches):
                    log(f"  {dataset}: batch {i + 1}/{len(batches)} ({len(batch)} points)")
                    values += await _fetch_batch(client, batch, dataset)
                    if i < len(batches) - 1:
                        await asyncio.sleep(REQUEST_GAP_S)
                return values, dataset
            except Exception as err:  # noqa: BLE001 - try the next dataset
                last_err = f"{dataset}: {err}"
                log(f"  {dataset} failed ({last_err}); trying next dataset")
    raise RuntimeError(f"Open Topo Data unreachable — {last_err}")


def _parcels_bbox(parcels: dict) -> dict:
    xs: list[float] = []
    ys: list[float] = []

    def visit(c):
        if isinstance(c, list) and c and isinstance(c[0], (int, float)):
            xs.append(c[0])
            ys.append(c[1])
        elif isinstance(c, list):
            for i in c:
                visit(i)

    for f in parcels["features"]:
        visit(f["geometry"]["coordinates"])
    mx = (max(xs) - min(xs)) * 0.15 + 0.001
    my = (max(ys) - min(ys)) * 0.15 + 0.001
    return {"west": min(xs) - mx, "south": min(ys) - my, "east": max(xs) + mx, "north": max(ys) + my}


async def build_snapshot(site: str, parcels: dict, grid_cols: int = 24, grid_rows: int = 24, log=print) -> dict:
    bbox = _parcels_bbox(parcels)
    lons = [bbox["west"] + (bbox["east"] - bbox["west"]) * i / (grid_cols - 1) for i in range(grid_cols)]
    lats = [bbox["north"] - (bbox["north"] - bbox["south"]) * i / (grid_rows - 1) for i in range(grid_rows)]  # row 0 = north
    grid_points = [(lat, lon) for lat in lats for lon in lons]

    centroids = []
    for f in parcels["features"]:
        lon, lat = bbox_center(f["geometry"])
        centroids.append((str(f["properties"]["parcel_id"]), lat, lon))

    all_points = grid_points + [(lat, lon) for _, lat, lon in centroids]
    log(f'fetching {len(all_points)} elevation points for "{site}"...')
    values, dataset = await _fetch_elevations(all_points, log)

    grid_values = [values[r * grid_cols : (r + 1) * grid_cols] for r in range(grid_rows)]
    parcel_elevations = {pid: values[len(grid_points) + i] for i, (pid, _, _) in enumerate(centroids)}

    return {
        "site": site,
        "dataset": dataset,
        "source": DATASET_LABEL.get(dataset, f"Open Topo Data ({dataset})"),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "bbox": bbox,
        "grid": {"cols": grid_cols, "rows": grid_rows, "bounds": bbox, "values": grid_values},
        "parcelElevations": parcel_elevations,
        "meta": {
            "vertical_accuracy_note": DATASET_ACCURACY.get(dataset, "Resolution/accuracy varies by dataset."),
            "disclaimer": "Real digital-elevation-model data (Open Topo Data), not a surveyed or drone-derived terrain model.",
        },
    }
