"""Reference data: real OpenStreetMap features for the demo area (Overpass API).

India has no public cadastral-parcel API (state land-record portals are
CAPTCHA-gated, per-record web forms), so OSM is the closest lawful, automatable
reference. It is community data: good for building footprints / roads /
land-use, NOT for ownership or legal boundaries.

Load order: fresh runtime cache (24 h) -> committed snapshot
(`data/osm-reference.json`) -> background refresh from Overpass.
"""

import json
import time
from datetime import datetime, timezone
from urllib.parse import quote

import httpx

from .config import CACHE_DIR, DATA_DIR

SNAPSHOT = DATA_DIR / "osm-reference.json"  # committed
CACHE = CACHE_DIR / "osm-reference.json"  # runtime, gitignored
CACHE_TTL_S = 24 * 60 * 60

OVERPASS_ENDPOINTS = [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.osm.jp/api/interpreter",
]
UA = "UrbanParcelIntelligence/0.1 (land-twin cross-check)"


def bbox_of(parcels: dict) -> tuple[float, float, float, float]:
    """South, West, North, East (Overpass order), padded 15% around the parcels."""
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
    mx = (max(xs) - min(xs)) * 0.15 + 0.0006
    my = (max(ys) - min(ys)) * 0.15 + 0.0006
    return min(ys) - my, min(xs) - mx, max(ys) + my, max(xs) + mx


def overpass_to_geojson(raw: dict) -> dict:
    feats = []
    for el in raw.get("elements", []):
        if el.get("type") != "way" or not el.get("geometry"):
            continue
        coords = [[p["lon"], p["lat"]] for p in el["geometry"]]
        t = el.get("tags", {})
        if t.get("building"):
            kind = "building"
        elif t.get("landuse"):
            kind = "landuse"
        elif t.get("highway"):
            kind = "highway"
        else:
            continue
        if kind == "highway":
            feats.append(
                {
                    "type": "Feature",
                    "id": f"osm-way-{el['id']}",
                    "geometry": {"type": "LineString", "coordinates": coords},
                    "properties": {"osm_kind": "highway", "osm_id": el["id"], "highway": t["highway"], "name": t.get("name")},
                }
            )
        else:
            ring = coords if coords[0] == coords[-1] else [*coords, coords[0]]
            addr = " ".join(x for x in (t.get("addr:housenumber"), t.get("addr:street")) if x) or None
            levels = None
            if t.get("building:levels"):
                try:
                    levels = float(t["building:levels"])
                    levels = int(levels) if levels.is_integer() else levels
                except ValueError:
                    levels = None
            props = {
                "osm_kind": kind,
                "osm_id": el["id"],
                "building": (t.get("building") or "yes") if kind == "building" else None,
                "landuse": t["landuse"] if kind == "landuse" else None,
                "name": t.get("name"),
                "levels": levels,
                "addr": addr,
                "shop": t.get("shop"),
                "office": t.get("office"),
                "amenity": t.get("amenity"),
            }
            # name/addr are explicit nulls in the wire format; the rest are omitted when absent
            props = {k: v for k, v in props.items() if v is not None or k in ("name", "addr")}
            feats.append(
                {
                    "type": "Feature",
                    "id": f"osm-way-{el['id']}",
                    "geometry": {"type": "Polygon", "coordinates": [ring]},
                    "properties": props,
                }
            )
    return {"type": "FeatureCollection", "features": feats}


async def fetch_overpass(bbox: tuple[float, float, float, float]) -> dict:
    s, w, n, e = bbox
    ql = (
        f"[out:json][timeout:90];("
        f'way["building"]({s},{w},{n},{e});'
        f'way["landuse"]({s},{w},{n},{e});'
        f'way["highway"]({s},{w},{n},{e});'
        f");out geom;"
    )
    last_err = "no endpoints tried"
    async with httpx.AsyncClient() as client:
        for ep in OVERPASS_ENDPOINTS:
            try:
                res = await client.get(f"{ep}?data={quote(ql)}", headers={"User-Agent": UA}, timeout=120)
                if res.status_code != 200:
                    last_err = f"{ep}: HTTP {res.status_code}"
                    continue
                raw = res.json()
                if not raw.get("elements"):
                    last_err = f"{ep}: empty"
                    continue
                fc = overpass_to_geojson(raw)
                count = lambda k: sum(1 for f in fc["features"] if f["properties"]["osm_kind"] == k)  # noqa: E731
                fc["meta"] = {
                    "source": "OpenStreetMap via Overpass",
                    "endpoint": ep,
                    "fetched_at": datetime.now(timezone.utc).isoformat(),
                    "bbox": {"south": s, "west": w, "north": n, "east": e},
                    "counts": {"building": count("building"), "landuse": count("landuse"), "highway": count("highway")},
                    "disclaimer": (
                        "OpenStreetMap community data. Not an official cadastral / land-record source. "
                        "Coverage and accuracy vary; no ownership or legal-boundary information."
                    ),
                }
                return fc
            except Exception as err:  # noqa: BLE001 - try the next mirror
                last_err = f"{ep}: {err}"
    raise RuntimeError(f"Overpass unreachable — {last_err}")


class ReferenceStore:
    def __init__(self, parcels: dict):
        self.bbox = bbox_of(parcels)
        self.fc: dict | None = None
        self.state = "empty"  # empty | snapshot | cache | live | error
        self.error: str | None = None
        self.loaded_at: str | None = None

    def load_local(self) -> None:
        """Fresh runtime cache, else the committed snapshot. Never touches the network."""
        try:
            if time.time() - CACHE.stat().st_mtime < CACHE_TTL_S:
                self.fc = json.loads(CACHE.read_text("utf-8"))
                self.state = "cache"
                self.loaded_at = datetime.fromtimestamp(CACHE.stat().st_mtime, timezone.utc).isoformat()
                return
        except OSError:
            pass
        try:
            self.fc = json.loads(SNAPSHOT.read_text("utf-8"))
            self.state = "snapshot"
            self.loaded_at = (self.fc.get("meta") or {}).get("fetched_at")
        except OSError:
            pass

    async def refresh(self) -> dict:
        try:
            fc = await fetch_overpass(self.bbox)
        except Exception as err:  # noqa: BLE001
            self.error = str(err)
            if self.fc is None:
                self.state = "error"
            raise
        self.fc = fc
        self.state = "live"
        self.error = None
        self.loaded_at = fc["meta"]["fetched_at"]
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(fc), "utf-8")
        return fc

    @property
    def fetched_at(self) -> str | None:
        return ((self.fc or {}).get("meta") or {}).get("fetched_at") or self.loaded_at

    def status(self) -> dict:
        meta = (self.fc or {}).get("meta") or {}
        return {
            "state": self.state,
            "source": meta.get("source"),
            "endpoint": meta.get("endpoint"),
            "loaded_at": self.loaded_at,
            "counts": meta.get("counts"),
            "error": self.error,
            "note": "OpenStreetMap community data — not official cadastral. India has no public parcel API.",
        }
