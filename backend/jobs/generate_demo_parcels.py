"""Generate the SYNTHETIC Indian-urban demonstration dataset.

There is NO official cadastral / land-record source behind this file. Every
attribute — survey numbers, ownership status, encroachment, confidence,
valuations, timestamps — is fabricated for demonstration. See DATA.md.

Location via env (Chennai / T. Nagar defaults):
  DEMO_LAT DEMO_LON DEMO_CITY DEMO_STATE DEMO_LOCALITY

Outputs (GeoJSON, EPSG:4326 / CRS84) into backend/data/:
  demo-parcels.geojson    144 derived parcels on a road grid
  demo-buildings.geojson  estimated building footprints / heights

Areas are geodesic (spherical excess), never raw degrees. All non-geometric
values are deterministic (stable across regenerations).

Run:  python -m jobs.generate_demo_parcels   (from backend/)
"""

import json
import math
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import DATA_DIR  # noqa: E402
from app.geo import js_round  # noqa: E402

CENTER_LAT = float(os.getenv("DEMO_LAT", "13.0418"))
CENTER_LNG = float(os.getenv("DEMO_LON", "80.2341"))
CITY = os.getenv("DEMO_CITY", "Chennai")
STATE = os.getenv("DEMO_STATE", "Tamil Nadu")
LOCALITY = os.getenv("DEMO_LOCALITY", "T. Nagar")
DISTRICT = "Chennai"
TALUK = "Mambalam"
LOCAL_BODY = "Greater Chennai Corporation"
PIN = "600017"
ID_PREFIX = "IND-TN-CHN-DEMO"

COLS = ROWS = 12
PLOT_W_M = 11  # ~36 ft frontage
PLOT_H_M = 17  # ~56 ft depth
ROAD_GAP_M = 7
FLOOR_HEIGHT_M = 3.2
SQFT_PER_SQM = 10.76391

DATA_SOURCE = "Demonstration data — synthetic, not an official land record"
DATA_QUALITY = "DEMO"
BOUNDARY_SOURCE = "Derived — regular grid aligned to a real basemap location"
LAST_UPDATED = "2026-09-01"
PREV_OBSERVED = "2026-03-05"

# land use -> planning + massing profile (illustrative CMDA-style codes)
LAND_USE_PROFILE = {
    "Residential": dict(weight=34, zoning_code="R1", zoning_description="Primary Residential Use Zone", coverage=(0.45, 0.68), floors=(1, 3), veg=(8, 30)),
    "Mixed Residential": dict(weight=14, zoning_code="R2", zoning_description="Mixed Residential Use Zone", coverage=(0.5, 0.75), floors=(2, 4), veg=(4, 18)),
    "Commercial": dict(weight=16, zoning_code="C2", zoning_description="General Commercial Use Zone", coverage=(0.6, 0.9), floors=(2, 6), veg=(0, 8)),
    "Institutional": dict(weight=8, zoning_code="I1", zoning_description="Institutional Use Zone", coverage=(0.3, 0.55), floors=(1, 4), veg=(15, 40)),
    "Industrial": dict(weight=5, zoning_code="IND", zoning_description="Primary Industrial Use Zone", coverage=(0.4, 0.7), floors=(1, 2), veg=(2, 12)),
    "Public/Semi-Public": dict(weight=6, zoning_code="PSP", zoning_description="Public & Semi-Public Use Zone", coverage=(0.1, 0.35), floors=(1, 2), veg=(20, 55)),
    "Open Space": dict(weight=8, zoning_code="OSR", zoning_description="Open Space & Recreation Zone", coverage=(0.0, 0.06), floors=(0, 0), veg=(55, 90)),
    "Vacant": dict(weight=9, zoning_code="R1", zoning_description="Primary Residential Use Zone (undeveloped)", coverage=(0.0, 0.04), floors=(0, 0), veg=(20, 65)),
}
LAND_USES = list(LAND_USE_PROFILE)
TENURE = ["Private", "Private", "Private", "Government", "Public", "Institutional"]
STREETS = [
    "1st Main Rd", "2nd Main Rd", "Habibullah Rd", "Thanikachalam Rd", "Bazullah Rd",
    "Burkit Rd", "North Boag Rd", "South Boag Rd", "Venkatnarayana Rd", "G.N. Chetty Rd",
    "Duraiswamy Rd", "Madley Rd",
]
RATE_PER_SQFT = {
    "Residential": 21000, "Mixed Residential": 23500, "Commercial": 34000, "Institutional": 15000,
    "Industrial": 12000, "Public/Semi-Public": 6000, "Open Space": 3000, "Vacant": 18000,
}

EARTH_RADIUS_M = 6371008.8
DEG2RAD = math.pi / 180


def round1(n: float) -> float:
    return js_round(n * 10) / 10


def round2(n: float) -> float:
    return js_round(n * 100) / 100


def ring_area_sqm(ring) -> float:
    total = 0.0
    for i in range(len(ring) - 1):
        lng1, lat1 = ring[i]
        lng2, lat2 = ring[i + 1]
        total += (lng2 * DEG2RAD - lng1 * DEG2RAD) * (2 + math.sin(lat1 * DEG2RAD) + math.sin(lat2 * DEG2RAD))
    return abs(total * EARTH_RADIUS_M * EARTH_RADIUS_M / 2)


def unit(seed: float) -> float:
    x = math.sin(seed * 127.1 + 311.7) * 43758.5453
    return x - math.floor(x)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def pick_land_use(seq: int) -> str:
    total = sum(p["weight"] for p in LAND_USE_PROFILE.values())
    r = unit(seq * 3.17) * total
    for k in LAND_USES:
        r -= LAND_USE_PROFILE[k]["weight"]
        if r <= 0:
            return k
    return "Residential"


def encroachment_band(seq: int):
    roll = unit(seq * 5.53)
    if roll < 0.66:
        return "None", 0, 0
    if roll < 0.82:
        return "Minor", 0.5, 4.5
    if roll < 0.93:
        return "Moderate", 5, 14
    if roll < 0.985:
        return "Significant", 15, 29
    return "Critical", 30, 45


def confidence_label(c: float) -> str:
    return "High" if c >= 0.8 else "Medium" if c >= 0.55 else "Low"


def d_lat(m: float) -> float:
    return m / 111320


def d_lng(m: float, lat: float) -> float:
    return m / (111320 * math.cos(lat * DEG2RAD))


def build():
    step_x = PLOT_W_M + ROAD_GAP_M
    step_y = PLOT_H_M + ROAD_GAP_M
    origin_lng = CENTER_LNG - d_lng((COLS * step_x - ROAD_GAP_M) / 2, CENTER_LAT)
    origin_lat = CENTER_LAT - d_lat((ROWS * step_y - ROAD_GAP_M) / 2)

    features, buildings = [], []
    seq = 0
    for row in range(ROWS):
        for col in range(COLS):
            seq += 1
            pid = f"{ID_PREFIX}-{seq:04d}"
            west = origin_lng + d_lng(col * step_x, CENTER_LAT)
            east = west + d_lng(PLOT_W_M, CENTER_LAT)
            south = origin_lat + d_lat(row * step_y)
            north = south + d_lat(PLOT_H_M)
            ring = [[west, south], [east, south], [east, north], [west, north], [west, south]]

            area_sqm = ring_area_sqm(ring)
            area_sqft = area_sqm * SQFT_PER_SQM
            perimeter_m = 2 * (PLOT_W_M + PLOT_H_M)

            land_use = pick_land_use(seq)
            p = LAND_USE_PROFILE[land_use]

            coverage = lerp(p["coverage"][0], p["coverage"][1], unit(seq * 7.7))
            built_up = coverage * area_sqm

            status, lo, hi = encroachment_band(seq)
            enc_pct = 0 if status == "None" else lerp(lo, hi, unit(seq * 9.13))
            enc_area = (enc_pct / 100) * area_sqm
            if built_up + enc_area > 0.95 * area_sqm:
                built_up = max(0, 0.95 * area_sqm - enc_area)
            built_pct = built_up / area_sqm * 100

            floors = 0 if p["floors"][1] == 0 else js_round(lerp(p["floors"][0], p["floors"][1], unit(seq * 6.1)))
            veg_pct = js_round(lerp(p["veg"][0], p["veg"][1], unit(seq * 4.2)))

            ref_offset = (unit(seq * 2.3) - 0.5) * 0.14  # ±7%
            reference_area = area_sqm * (1 + ref_offset)
            discrepancy_area = abs(area_sqm - reference_area)
            discrepancy_pct = discrepancy_area / reference_area * 100

            confidence = 0.4 + unit(seq * 11.7) * 0.5
            if status in ("Significant", "Critical"):
                confidence -= 0.1
            confidence = max(0.3, min(0.92, confidence))

            if land_use == "Vacant" or built_pct < 3:
                dev_status = "Vacant / Undeveloped"
            elif status in ("Significant", "Critical"):
                dev_status = "Developed — discrepancy flagged"
            elif built_pct < 30:
                dev_status = "Partly developed"
            elif unit(seq * 12.7) < 0.08:
                dev_status = "Under review"
            else:
                dev_status = "Developed"

            if land_use in ("Open Space", "Public/Semi-Public"):
                tenure = "Public"
            elif land_use == "Institutional":
                tenure = "Institutional"
            else:
                tenure = TENURE[math.floor(unit(seq * 8.9) * len(TENURE))]

            assessed = js_round(
                (RATE_PER_SQFT[land_use] * area_sqft + built_up * SQFT_PER_SQM * 1800 * max(1, floors) * 0.12)
                * (0.9 + unit(seq * 8.2) * 0.3)
                / 100000
            ) * 100000

            prev_built = max(0, built_up * (0.78 + unit(seq * 13.3) * 0.18))
            prev_veg = min(95, veg_pct + js_round(unit(seq * 14.1) * 10))
            prev_enc = 0 if status == "None" else enc_area * (0 if unit(seq * 15.7) < 0.5 else 0.6)

            features.append({
                "type": "Feature",
                "id": pid,
                "geometry": {"type": "Polygon", "coordinates": [ring]},
                "properties": {
                    "parcel_id": pid,
                    "survey_no": f"T.S. No. {1000 + math.floor(seq * 2.7)}",
                    "subdivision_no": f"{1 + (seq % 9)}",
                    "state": STATE,
                    "district": DISTRICT,
                    "taluk": TALUK,
                    "village_ward": f"Ward {120 + (row % 8)}, {LOCALITY}",
                    "local_body": LOCAL_BODY,
                    "pin_code": PIN,
                    "city": CITY,
                    "locality": LOCALITY,
                    "address": f"Plot {col + 1}, {STREETS[row % len(STREETS)]}, {LOCALITY}",
                    "land_use": land_use,
                    "observed_use": "No active use observed" if land_use == "Vacant" else land_use,
                    "zoning_code": p["zoning_code"],
                    "zoning_description": p["zoning_description"],
                    "development_status": dev_status,
                    "tenure_class": tenure,
                    "agri_status": "Non-agricultural",
                    "ownership_status": "On record (details not public in this dataset)",
                    "owner_record_available": False,
                    "ownership_type": "Individual / private" if tenure == "Private" else tenure,
                    "last_verified": LAST_UPDATED,
                    "area_sqm": round1(area_sqm),
                    "area_sqft": js_round(area_sqft),
                    "perimeter_m": round1(perimeter_m),
                    "reference_area_sqm": round1(reference_area),
                    "reference_area_sqft": js_round(reference_area * SQFT_PER_SQM),
                    "discrepancy_area_sqm": round1(discrepancy_area),
                    "discrepancy_pct": round2(discrepancy_pct),
                    "boundary_confidence": round2(confidence),
                    "boundary_confidence_label": confidence_label(confidence),
                    "boundary_source": BOUNDARY_SOURCE,
                    "built_up_area_sqm": round1(built_up),
                    "built_up_pct": round1(built_pct),
                    "floors": floors,
                    "vegetation_pct": veg_pct,
                    "encroachment_area_sqm": round1(enc_area),
                    "encroachment_status": status,
                    "previous": {
                        "observed_on": PREV_OBSERVED,
                        "built_up_area_sqm": round1(prev_built),
                        "vegetation_pct": prev_veg,
                        "encroachment_area_sqm": round1(prev_enc),
                    },
                    "assessed_value_inr": assessed,
                    "last_updated": LAST_UPDATED,
                    "data_source": DATA_SOURCE,
                    "data_quality": DATA_QUALITY,
                },
            })

            if floors > 0 and built_up > 20:
                footprint = min(built_up, 0.88 * area_sqm)
                s = math.sqrt(footprint / area_sqm)
                cx, cy = (west + east) / 2, (south + north) / 2
                hw, hh = (east - west) / 2 * s, (north - south) / 2 * s
                buildings.append({
                    "type": "Feature",
                    "id": pid,
                    "geometry": {"type": "Polygon", "coordinates": [[
                        [cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh], [cx - hw, cy - hh],
                    ]]},
                    "properties": {
                        "parcel_id": pid,
                        "floors": floors,
                        "height_m": round1(floors * FLOOR_HEIGHT_M),
                        "height_basis": f"Estimated: {floors} floors x {FLOOR_HEIGHT_M} m",
                        "footprint_area_sqm": round1(footprint),
                        "land_use": land_use,
                        "data_source": DATA_SOURCE,
                        "data_quality": DATA_QUALITY,
                    },
                })
    return features, buildings


def main() -> None:
    features, buildings = build()
    crs = {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}}
    parcels = {
        "type": "FeatureCollection", "name": "demo-parcels", "crs": crs,
        "metadata": {
            "generated_by": "backend/jobs/generate_demo_parcels.py",
            "location": f"{LOCALITY}, {CITY}, {STATE}, India",
            "center": [round2(CENTER_LNG), round2(CENTER_LAT)],
            "note": DATA_SOURCE,
            "disclaimer": (
                "DEMONSTRATION DATA. Not an official land record. Survey numbers, ownership status, "
                "encroachment, boundary confidence, valuations and timestamps are all fabricated. "
                "Parcel geometry is a derived regular grid, NOT verified cadastral boundary. "
                "Discrepancy / encroachment figures are potential indicators only, not legal determinations."
            ),
            "feature_count": len(features),
        },
        "features": features,
    }
    blds = {
        "type": "FeatureCollection", "name": "demo-buildings", "crs": crs,
        "metadata": {
            "generated_by": "backend/jobs/generate_demo_parcels.py",
            "note": DATA_SOURCE,
            "disclaimer": "ESTIMATED demo massing: centred rectangle sized to the built-up area; height = floors x 3.2 m. Not surveyed structures.",
            "feature_count": len(buildings),
        },
        "features": buildings,
    }
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out_dir = Path(os.getenv("DEMO_OUT_DIR", str(DATA_DIR)))
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "demo-parcels.geojson").write_text(json.dumps(parcels, indent=2, ensure_ascii=False) + "\n", "utf-8")
    (out_dir / "demo-buildings.geojson").write_text(json.dumps(blds, indent=2, ensure_ascii=False) + "\n", "utf-8")
    print(f"Wrote {len(features)} demo parcels + {len(buildings)} buildings for {LOCALITY}, {CITY} ({CENTER_LAT}, {CENTER_LNG}) -> {out_dir}")


if __name__ == "__main__":
    main()
