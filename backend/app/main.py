"""Urban Parcel Intelligence — backend API (FastAPI).

  GET  /api/health
  GET  /api/parcels                       real OSM-derived parcels + buildings (503 if reference not loaded)
  GET  /api/demo/parcels | /api/demo/buildings   bundled synthetic demo dataset
  GET  /api/elevation/{site}              committed real-DEM snapshot (grid + per-parcel elevation)
  GET  /api/reference/status | /osm | /roads     real OpenStreetMap reference data
  POST /api/reference/refresh             re-fetch OSM from Overpass
  GET  /api/reconcile                     demo parcels vs OSM cross-check
  GET  /api/simulation/state              current flood-simulation snapshot
  GET  /api/simulation/elevations         real elevation per simulated parcel
  GET  /api/simulation/stream             Server-Sent Events, one snapshot per tick
  POST /api/simulation/start|pause|reset
  POST /api/simulation/flood              body: { speed?: 1|2|5, levelDeltaM?: number, cycleSpeed?: true }
  GET  /api/geocode?q=                    Google Geocoding (needs GOOGLE_MAPS_API_KEY, else 503)
  GET  /api/places/nearby?lat=&lon=       Google Places nearby (needs GOOGLE_MAPS_API_KEY, else 503)

The frontend is a separate static app; it only ever talks to /api/*.
"""

import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from . import demo_data, google
from .config import CORS_ORIGINS, LIVE_REFRESH, SITE
from .elevation import ElevationUnavailable, load_snapshot
from .flood import FloodEngine
from .osm_parcels import build_osm_parcels
from .reconcile import reconcile
from .reference import ReferenceStore


class FloodBody(BaseModel):
    speed: int | None = None
    levelDeltaM: float | None = None
    cycleSpeed: bool | None = None


class State:
    """Process-wide singletons, created at startup."""

    engine: FloodEngine
    ref: ReferenceStore
    osm_cache: tuple[str | None, dict] | None = None
    reconcile_cache: tuple[str | None, dict] | None = None


state = State()


def _osm_parcels() -> dict | None:
    """OSM-derived parcels for the current reference data (cached per reference version)."""
    if state.ref.fc is None:
        return None
    version = state.ref.fetched_at
    if state.osm_cache is None or state.osm_cache[0] != version:
        state.osm_cache = (version, build_osm_parcels(state.ref.fc))
    return state.osm_cache[1]


def _sync_engine() -> None:
    """Point the flood engine at the same parcels the API serves (OSM when available, else demo)."""
    osm = _osm_parcels()
    if osm and osm["parcels"]["features"]:
        state.engine.set_parcels(osm["parcels"], osm["buildings"])
    else:
        state.engine.set_parcels(demo_data.load_parcels(), demo_data.load_buildings())


async def _background_refresh() -> None:
    try:
        await state.ref.refresh()
        state.osm_cache = state.reconcile_cache = None
        _sync_engine()
        print(f"[api] reference refreshed live from Overpass: {state.ref.status()['counts']}")
    except Exception as err:  # noqa: BLE001 - best effort; the snapshot/cache keeps serving
        print(f"[api] live OSM refresh skipped: {err}")


@asynccontextmanager
async def lifespan(_: FastAPI):
    state.engine = FloodEngine(load_snapshot(SITE))
    state.ref = ReferenceStore(demo_data.load_parcels())
    state.ref.load_local()
    _sync_engine()
    tasks = [asyncio.create_task(state.engine.run_ticker())]
    if LIVE_REFRESH:
        tasks.append(asyncio.create_task(_background_refresh()))
    e = state.engine
    print(f"[api] site '{SITE}': {len(e.rows)} parcels · elevation {e.elev_min:.2f}–{e.elev_max:.2f} m · reference: {state.ref.state}")
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(title="Urban Parcel Intelligence API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])


# --- health / data ----------------------------------------------------------
@app.get("/api/health")
def health():
    return {"ok": True, "listeners": state.engine.listener_count, "status": state.engine.status, "reference": state.ref.state}


@app.get("/api/parcels")
def parcels():
    osm = _osm_parcels()
    if osm is None:
        return JSONResponse({"error": "reference not loaded", "status": state.ref.status()}, status_code=503)
    return {"parcels": osm["parcels"], "buildings": osm["buildings"], "meta": osm["meta"], "reference_state": state.ref.state}


@app.get("/api/demo/parcels")
def demo_parcels():
    return demo_data.load_parcels()


@app.get("/api/demo/buildings")
def demo_buildings():
    return demo_data.load_buildings()


@app.get("/api/elevation/{site}")
def elevation(site: str):
    try:
        return load_snapshot(site)
    except ElevationUnavailable as err:
        raise HTTPException(404, str(err)) from err


# --- reference (real OpenStreetMap) ------------------------------------------
@app.get("/api/reference/status")
def reference_status():
    return state.ref.status()


@app.get("/api/reference/osm")
def reference_osm():
    if state.ref.fc is None:
        return JSONResponse({"error": "reference not loaded", "status": state.ref.status()}, status_code=503)
    return state.ref.fc


@app.get("/api/reference/roads")
def reference_roads():
    if state.ref.fc is None:
        return JSONResponse({"error": "reference not loaded", "status": state.ref.status()}, status_code=503)
    feats = [f for f in state.ref.fc["features"] if f["properties"].get("osm_kind") == "highway"]
    return {"type": "FeatureCollection", "features": feats, "meta": state.ref.fc.get("meta")}


@app.post("/api/reference/refresh")
async def reference_refresh():
    try:
        await state.ref.refresh()
    except Exception as err:  # noqa: BLE001
        return JSONResponse({"error": str(err), "status": state.ref.status()}, status_code=502)
    state.osm_cache = state.reconcile_cache = None
    _sync_engine()
    return state.ref.status()


@app.get("/api/reconcile")
def reconcile_route():
    if state.ref.fc is None:
        return JSONResponse({"error": "reference not loaded", "status": state.ref.status()}, status_code=503)
    version = state.ref.fetched_at
    if state.reconcile_cache is None or state.reconcile_cache[0] != version:
        state.reconcile_cache = (version, reconcile(demo_data.load_parcels(), state.ref.fc))
    return {**state.reconcile_cache[1], "reference_state": state.ref.state}


# --- flood simulation ----------------------------------------------------------
@app.get("/api/simulation/state")
def sim_state():
    return state.engine.snapshot()


@app.get("/api/simulation/elevations")
def sim_elevations():
    """Real elevation (metres) for every parcel the simulation runs over."""
    return {r["id"]: round(r["elev"], 2) for r in state.engine.rows}


@app.get("/api/simulation/stream")
async def sim_stream():
    q = state.engine.add_listener()

    async def gen():
        yield "retry: 3000\n\n"
        try:
            while True:
                try:
                    snap = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"event: state\ndata: {json.dumps(snap)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            state.engine.remove_listener(q)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@app.post("/api/simulation/start")
def sim_start():
    state.engine.start()
    return state.engine.snapshot()


@app.post("/api/simulation/pause")
def sim_pause():
    state.engine.pause()
    return state.engine.snapshot()


@app.post("/api/simulation/reset")
def sim_reset():
    state.engine.reset()
    return state.engine.snapshot()


@app.post("/api/simulation/flood")
def sim_flood(body: FloodBody | None = Body(default=None)):
    e = state.engine
    if body:
        if body.cycleSpeed:
            e.cycle_speed()
        if body.speed is not None:
            e.set_speed(body.speed)
        if body.levelDeltaM is not None:
            e.bump_level(body.levelDeltaM)
    return e.snapshot()


# --- Google Maps Platform (optional) ---------------------------------------------
def _google_error(err: Exception) -> JSONResponse:
    if isinstance(err, google.GoogleNotConfigured):
        return JSONResponse({"error": str(err)}, status_code=503)
    return JSONResponse({"error": str(err)}, status_code=502)


@app.get("/api/geocode")
async def geocode(q: str = Query(min_length=1, max_length=200)):
    try:
        return await google.geocode(q)
    except (google.GoogleNotConfigured, google.GoogleError) as err:
        return _google_error(err)


@app.get("/api/places/nearby")
async def places_nearby(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180)):
    try:
        return {"places": await google.nearby_places(lat, lon)}
    except (google.GoogleNotConfigured, google.GoogleError) as err:
        return _google_error(err)
