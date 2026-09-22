"""Google Maps Platform proxy — Geocoding API + Places API (Nearby Search, New).

Both need a billing-enabled Google Cloud API key, which this project does not
provide: set GOOGLE_MAPS_API_KEY in a local `.env`. When it is unset these raise
`GoogleNotConfigured`, which the route layer turns into a 503 — the same
graceful-degrade every other optional source uses. The key stays server-side;
responses contain only results.
"""

import time

import httpx

from .config import google_maps_key

UA = "UrbanParcelIntelligence/0.1 (search + places enrichment)"
CACHE_TTL_S = 3600  # avoid re-billing the same lookup within an hour

_geocode_cache: dict[str, tuple[float, dict]] = {}
_places_cache: dict[str, tuple[float, list]] = {}


class GoogleNotConfigured(Exception):
    pass


class GoogleError(Exception):
    pass


def _key() -> str:
    key = google_maps_key()
    if not key:
        raise GoogleNotConfigured("GOOGLE_MAPS_API_KEY not configured")
    return key


async def geocode(query: str) -> dict:
    key = _key()
    ck = query.strip().lower()
    hit = _geocode_cache.get(ck)
    if hit and time.time() - hit[0] < CACHE_TTL_S:
        return hit[1]
    async with httpx.AsyncClient() as client:
        res = await client.get(
            "https://maps.googleapis.com/maps/api/geocode/json",
            params={"address": query, "key": key},
            headers={"User-Agent": UA},
            timeout=10,
        )
    if res.status_code != 200:
        raise GoogleError(f"Geocoding API HTTP {res.status_code}")
    data = res.json()
    if data.get("status") != "OK" or not data.get("results"):
        raise GoogleError(f"Geocoding API: {data.get('status')}")
    top = data["results"][0]
    result = {
        "formatted_address": top["formatted_address"],
        "lat": top["geometry"]["location"]["lat"],
        "lon": top["geometry"]["location"]["lng"],
        "place_id": top["place_id"],
    }
    _geocode_cache[ck] = (time.time(), result)
    return result


async def nearby_places(lat: float, lon: float, radius_m: int = 120) -> list[dict]:
    key = _key()
    ck = f"{lat:.5f},{lon:.5f},{radius_m}"
    hit = _places_cache.get(ck)
    if hit and time.time() - hit[0] < CACHE_TTL_S:
        return hit[1]
    async with httpx.AsyncClient() as client:
        res = await client.post(
            "https://places.googleapis.com/v1/places:searchNearby",
            headers={
                "User-Agent": UA,
                "X-Goog-Api-Key": key,
                "X-Goog-FieldMask": "places.displayName,places.types,places.formattedAddress",
            },
            json={
                "maxResultCount": 8,
                "locationRestriction": {"circle": {"center": {"latitude": lat, "longitude": lon}, "radius": radius_m}},
            },
            timeout=10,
        )
    if res.status_code != 200:
        raise GoogleError(f"Places API HTTP {res.status_code}")
    result = [
        {
            "name": (p.get("displayName") or {}).get("text", "Unnamed"),
            "types": p.get("types", []),
            "address": p.get("formattedAddress"),
        }
        for p in res.json().get("places", [])
    ]
    _places_cache[ck] = (time.time(), result)
    return result
