import os

os.environ["OSM_LIVE_REFRESH"] = "0"  # tests must not hit the network

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def fresh_sim(client):
    client.post("/api/simulation/reset")
    yield
    client.post("/api/simulation/reset")


def test_health(client):
    body = client.get("/api/health").json()
    assert body["ok"] is True
    assert body["reference"] in ("snapshot", "cache")


def test_parcels_are_real_osm_footprints_in_chennai(client):
    body = client.get("/api/parcels").json()
    feats = body["parcels"]["features"]
    assert len(feats) > 100
    assert all(f["properties"]["parcel_id"].startswith("OSM-") for f in feats)
    lon, lat = feats[0]["geometry"]["coordinates"][0][0]
    assert 80.0 < lon < 80.5 and 12.8 < lat < 13.3  # study-area sanity
    # fields with no public source must stay unset, never fabricated
    assert all("survey_no" not in f["properties"] and "encroachment_status" not in f["properties"] for f in feats)
    assert len(body["buildings"]["features"]) == len(feats)


def test_roads_are_named_linestrings(client):
    feats = client.get("/api/reference/roads").json()["features"]
    assert feats and all(f["geometry"]["type"] == "LineString" for f in feats)
    assert any(f["properties"].get("name") for f in feats)


def test_demo_dataset(client):
    assert len(client.get("/api/demo/parcels").json()["features"]) == 144
    assert client.get("/api/demo/buildings").json()["features"]


def test_reconcile_summary(client):
    s = client.get("/api/reconcile").json()["summary"]
    assert s["parcels_total"] == 144
    assert s["osm_roads"] > 0


def test_elevation_snapshot_and_bad_site(client):
    snap = client.get("/api/elevation/chennai").json()
    assert snap["grid"]["cols"] == 24 and len(snap["grid"]["values"]) == 24
    assert client.get("/api/elevation/nope").status_code == 404
    assert client.get("/api/elevation/..%2Fetc").status_code == 404


def test_simulation_flow(client):
    idle = client.get("/api/simulation/state").json()
    assert idle["status"] == "idle" and idle["impact"]["affectedParcels"] == 0
    assert idle["totalParcels"] == len(client.get("/api/simulation/elevations").json())

    high = client.post("/api/simulation/flood", json={"levelDeltaM": 3}).json()
    assert high["impact"]["affectedParcels"] > 0
    assert high["waterLevelM"] > idle["waterLevelM"]
    for state in high["impact"]["perParcel"].values():
        assert state["impact"] in ("Low", "Moderate", "High", "Severe")
        assert state["depthM"] > 0

    assert client.post("/api/simulation/start").json()["status"] == "running"
    assert client.post("/api/simulation/pause").json()["status"] == "paused"
    reset = client.post("/api/simulation/reset").json()
    assert reset["status"] == "idle" and reset["levelOffsetM"] == 0


def test_speed_cycle_and_empty_flood_body(client):
    assert client.post("/api/simulation/flood", json={"cycleSpeed": True}).json()["speed"] == 2
    assert client.post("/api/simulation/flood").status_code == 200  # no body is fine


def test_whatif_baseline_matches_elevations_and_scenario_improves_with_intervention(client):
    parcel_id = next(iter(client.get("/api/simulation/elevations").json()))
    client.post("/api/simulation/flood", json={"levelDeltaM": 5})  # force a real flooded baseline

    baseline = client.get("/api/simulation/whatif", params={"parcel_id": parcel_id}).json()
    assert baseline["parcelId"] == parcel_id
    assert baseline["scenario"]["depthM"] == baseline["baseline"]["depthM"]  # zero intervention == baseline
    assert baseline["baseline"]["impact"] in ("None", "Low", "Moderate", "High", "Severe")

    raised = client.get(
        "/api/simulation/whatif", params={"parcel_id": parcel_id, "plinth_raise_m": 1.0}
    ).json()
    assert raised["scenario"]["depthM"] < baseline["baseline"]["depthM"] + 1e-9
    assert raised["deltaDepthM"] >= 0  # raising the plinth never makes it worse

    reduced = client.get(
        "/api/simulation/whatif", params={"parcel_id": parcel_id, "level_reduction_m": 0.5}
    ).json()
    assert reduced["deltaDepthM"] >= 0

    assert client.get("/api/simulation/whatif", params={"parcel_id": "nope-not-real"}).status_code == 404
    assert client.get(
        "/api/simulation/whatif", params={"parcel_id": parcel_id, "plinth_raise_m": 5}
    ).status_code == 422  # out of the 0-2m allowed range


def test_google_routes_degrade_to_503_without_key(client, monkeypatch):
    monkeypatch.delenv("GOOGLE_MAPS_API_KEY", raising=False)
    assert client.get("/api/geocode", params={"q": "T Nagar"}).status_code == 503
    assert client.get("/api/places/nearby", params={"lat": 13.04, "lon": 80.23}).status_code == 503
    assert client.get("/api/places/nearby", params={"lat": 999, "lon": 0}).status_code == 422  # validated input
