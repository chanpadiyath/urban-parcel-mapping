"""Authoritative flood simulation engine.

A rising water level over a REAL elevation surface (see elevation.py — Open
Topo Data DEM, committed snapshot), with impact derived from the parcels'
geometry and attributes. The water-level RISE is a SIMULATION — a fixed-rate
timer, not a hydrological/rainfall model — but the terrain it rises over is
real, and the state is real, shared by every client, and advanced by a real
server timer. State is pushed to clients over Server-Sent Events.
"""

import asyncio
import re
import time

from .elevation import sample_grid
from .geo import bbox_center, js_round, round_to

GRID_COLS = 12  # demo parcels sit on a 12-column grid (jobs/generate_demo_parcels.py)
TICK_S = 0.5
RISE_RATE_M_PER_S = 0.05
SPEEDS = (1, 2, 5)
CRITICAL_USES = {"Institutional", "Public/Semi-Public"}
DEMO_ID_PREFIX = "IND-"


def impact_from_depth(d: float) -> str:
    if d < 0.3:
        return "Low"
    if d < 1:
        return "Moderate"
    if d < 2:
        return "High"
    return "Severe"


def _seq_of(pid: str) -> int:
    m = re.search(r"(\d+)\s*$", pid)
    return int(m.group(1)) if m else 0


def _clamp(n: float, lo: float, hi: float) -> float:
    return min(hi, max(lo, n))


class FloodEngine:
    def __init__(self, elevation: dict):
        self.elevation = elevation
        self.elev_source: str = elevation["source"]
        self.rows: list[dict] = []
        self.building_parcel_ids: set[str] = set()
        self.total_area = 0.0
        self.elev_min = self.elev_max = 0.0
        self.base_level = self.max_level = 0.0

        self.status = "idle"
        self.sim_time_s = 0.0
        self.speed = 1
        self.level_offset_m = 0.0
        self._listeners: set[asyncio.Queue] = set()

    # --- data ------------------------------------------------------------
    def set_parcels(self, parcels: dict, buildings: dict) -> None:
        """(Re)build the parcel table. Simulation timing state is preserved."""
        self.building_parcel_ids = {str(f["properties"]["parcel_id"]) for f in buildings["features"]}
        parcel_elev = self.elevation["parcelElevations"]
        rows = []
        for f in parcels["features"]:
            p = f["properties"]
            pid = str(p["parcel_id"])
            x, y = bbox_center(f["geometry"])
            elev = parcel_elev.get(pid)
            if not isinstance(elev, (int, float)):
                elev = sample_grid(self.elevation["grid"], x, y)
            rows.append(
                {
                    "id": pid,
                    "area_sqm": p["area_sqm"] if isinstance(p.get("area_sqm"), (int, float)) else 0,
                    "land_use": str(p.get("land_use") or ""),
                    "road": p.get("nearest_road_name"),
                    "elev": elev,
                }
            )
        self.rows = rows
        self.total_area = sum(r["area_sqm"] for r in rows)
        elevs = [r["elev"] for r in rows] or [0.0]
        self.elev_min, self.elev_max = min(elevs), max(elevs)
        self.base_level = self.elev_min - 0.25
        self.max_level = self.elev_max + 1

    # --- model -----------------------------------------------------------
    @property
    def water_level_m(self) -> float:
        raw = self.base_level + RISE_RATE_M_PER_S * self.sim_time_s + self.level_offset_m
        return max(0.0, min(self.max_level, raw))

    def compute_impact(self) -> dict:
        level = js_round(self.water_level_m * 20) / 20
        per_parcel: dict[str, dict] = {}
        ids: list[str] = []
        roads_hit: set[str] = set()
        rows_hit: set[int] = set()
        cols_hit: set[int] = set()
        area = 0.0
        critical = buildings = 0
        max_depth = 0.0
        for r in self.rows:
            depth = level - r["elev"]
            if depth <= 0:
                continue
            ids.append(r["id"])
            per_parcel[r["id"]] = {
                "depthM": round_to(depth, 2),
                "elevationM": round_to(r["elev"], 2),
                "impact": impact_from_depth(depth),
            }
            area += r["area_sqm"]
            max_depth = max(max_depth, depth)
            if r["land_use"] in CRITICAL_USES:
                critical += 1
            if r["id"] in self.building_parcel_ids:
                buildings += 1
            if r["road"]:
                roads_hit.add(r["road"])  # real: distinct named roads beside flooded parcels
            elif r["id"].startswith(DEMO_ID_PREFIX):
                s = _seq_of(r["id"]) - 1  # demo grid: roads bordering the wetted rows/columns
                if s >= 0:
                    rows_hit.add(s // GRID_COLS)
                    cols_hit.add(s % GRID_COLS)
        return {
            "parcelIds": ids,
            "perParcel": per_parcel,
            "affectedParcels": len(ids),
            "affectedBuildings": buildings,
            "affectedRoadsApprox": len(roads_hit) + len(rows_hit) + len(cols_hit),
            "affectedAreaSqm": js_round(area),
            "affectedAreaPct": (area / self.total_area) * 100 if self.total_area > 0 else 0,
            "criticalInfrastructure": critical,
            "maxDepthM": round_to(max_depth, 2),
        }

    def snapshot(self) -> dict:
        return {
            "source": "server",
            "status": self.status,
            "simTimeSec": round_to(self.sim_time_s, 1),
            "speed": self.speed,
            "waterLevelM": round_to(self.water_level_m, 2),
            "levelOffsetM": round_to(self.level_offset_m, 2),
            "elevMin": round_to(self.elev_min, 2),
            "elevMax": round_to(self.elev_max, 2),
            "elevSource": self.elev_source,
            "maxLevelM": round_to(self.max_level, 2),
            "totalParcels": len(self.rows),
            "totalAreaSqm": js_round(self.total_area),
            "updatedAt": int(time.time() * 1000),
            "impact": self.compute_impact(),
        }

    # --- control ---------------------------------------------------------
    def start(self) -> None:
        if self.status != "running":
            self.status = "running"
            self._broadcast()

    def pause(self) -> None:
        if self.status == "running":
            self.status = "paused"
            self._broadcast()

    def reset(self) -> None:
        self.status = "idle"
        self.sim_time_s = 0.0
        self.level_offset_m = 0.0
        self._broadcast()

    def set_speed(self, v: int) -> None:
        if v in SPEEDS:
            self.speed = v
            self._broadcast()

    def cycle_speed(self) -> None:
        self.speed = SPEEDS[(SPEEDS.index(self.speed) + 1) % len(SPEEDS)]
        self._broadcast()

    def bump_level(self, delta_m: float) -> None:
        self.level_offset_m = _clamp(self.level_offset_m + delta_m, -self.base_level, self.max_level)
        self._broadcast()

    # --- ticking + SSE fan-out -------------------------------------------
    async def run_ticker(self) -> None:
        while True:
            await asyncio.sleep(TICK_S)
            if self.status != "running":
                continue
            self.sim_time_s += TICK_S * self.speed
            if self.base_level + RISE_RATE_M_PER_S * self.sim_time_s + self.level_offset_m >= self.max_level:
                self.status = "paused"
            self._broadcast()

    def add_listener(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=4)
        q.put_nowait(self.snapshot())
        self._listeners.add(q)
        return q

    def remove_listener(self, q: asyncio.Queue) -> None:
        self._listeners.discard(q)

    @property
    def listener_count(self) -> int:
        return len(self._listeners)

    def _broadcast(self) -> None:
        if not self._listeners:
            return
        snap = self.snapshot()
        for q in list(self._listeners):
            if q.full():  # slow client: drop its oldest frame, keep the newest
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(snap)
