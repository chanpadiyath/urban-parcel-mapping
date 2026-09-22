"""One-time data prep: fetch real elevation (DEM) data for a site from Open Topo
Data and commit the snapshot to backend/data/elevation-<site>.json.

DEM data for a fixed site doesn't change, so this is a manual, re-runnable step
(not part of dev/build). See app/elevation.py for the fetch/format logic.

Run (from backend/):
  python -m jobs.fetch_elevation --site chennai
  python -m jobs.fetch_elevation --site nilgiris --parcels data/demo-parcels-nilgiris.geojson
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import BACKEND_DIR, DATA_DIR  # noqa: E402
from app.elevation import build_snapshot  # noqa: E402


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", default="chennai")
    ap.add_argument("--parcels", default=str(DATA_DIR / "demo-parcels.geojson"))
    args = ap.parse_args()

    parcels_path = Path(args.parcels)
    if not parcels_path.is_absolute():
        parcels_path = BACKEND_DIR / parcels_path
    parcels = json.loads(parcels_path.read_text("utf-8"))
    print(f'[elevation] site "{args.site}": {len(parcels["features"])} parcels from {parcels_path}')

    snapshot = await build_snapshot(args.site, parcels, log=lambda m: print(f"[elevation] {m}"))
    out = DATA_DIR / f"elevation-{args.site}.json"
    out.write_text(json.dumps(snapshot), "utf-8")
    vals = list(snapshot["parcelElevations"].values())
    print(f"[elevation] wrote {out} — dataset={snapshot['dataset']}, parcel elevation {min(vals):.1f}–{max(vals):.1f} m")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as err:  # noqa: BLE001
        print(f"[elevation] failed: {err}", file=sys.stderr)
        sys.exit(1)
