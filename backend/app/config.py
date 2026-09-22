"""Runtime configuration: paths and environment (optional `.env` files)."""

import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent
DATA_DIR = BACKEND_DIR / "data"
CACHE_DIR = BACKEND_DIR / ".cache"

# Real environment variables win; backend/.env, then the repo-root .env, fill gaps.
load_dotenv(BACKEND_DIR / ".env")
load_dotenv(ROOT_DIR / ".env")

PORT = int(os.getenv("SIM_PORT", "8787"))
SITE = os.getenv("SIM_SITE", "chennai")
# Set OSM_LIVE_REFRESH=0 to skip the startup Overpass refresh (offline dev, tests).
LIVE_REFRESH = os.getenv("OSM_LIVE_REFRESH", "1") != "0"
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:4173").split(",")
    if o.strip()
]


def google_maps_key() -> str | None:
    return os.getenv("GOOGLE_MAPS_API_KEY") or None
