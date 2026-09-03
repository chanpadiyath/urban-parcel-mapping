# Data sources, licences, and PII

## Parcel data — SYNTHETIC

The parcels shown in this prototype are **not real**. There is no cadastral
source behind them.

- **File:** `public/demo-parcels.geojson`
- **Generator:** `scripts/generate-demo-parcels.mjs` (`npm run gen:data`)
- **Contents:** a regular 10×10 grid of rectangular parcels (100 features)
  arranged around a fictional town centre ("City of Demoville"). Coordinates
  sit on arbitrary land near Portland, Oregon and correspond to no real
  property boundaries.
- **CRS:** EPSG:4326 / CRS84 (`[longitude, latitude]`).
- **Areas:** computed geodesically in the generator (spherical-excess formula
  on a mean-radius sphere), not from raw degrees. Reported in m² and acres.
- **Attributes per feature:** `parcel_id`, `address`, `land_use`, `zoning`,
  `status`, `area_sqm`, `area_acres`, `assessed_value_usd`, `owner`,
  `jurisdiction`, `last_updated`, `data_source`. Every feature carries
  `data_source = "SYNTHETIC DEMO DATA — not real parcels"`.
- **`assessed_value_usd`:** a **fabricated demo figure** (indicative $/m² by
  land use × area × deterministic jitter), not a real assessment. Exempt
  parcels are set to 0. Labelled "(demo)" wherever it is displayed.
- **Land-use classes:** Residential, Commercial, Mixed Use, Industrial,
  Parks / Open Space, Civic / Institutional. **Status values:** Active,
  Pending Review, Exempt, Subdivision Proposed. All fabricated.
- All non-geometric values are deterministic, so regenerating the file
  produces the same data (only the metadata timestamp changes).
- **Licence:** none required — generated in-repo, released with the project.

### PII

None. The `owner` field is a fixed synthetic string
(`"City of Demoville (synthetic — no personal data)"`). No names, mailing
addresses, or other personal data are present. If real parcel data is
introduced later, owner/contact fields must be redacted or aggregated in the
data-prep script before the dataset is committed or displayed (see
`CLAUDE.md` §8).

## Base map — OpenStreetMap raster tiles

- **URL template:** `https://tile.openstreetmap.org/{z}/{x}/{y}.png`
  (override with `VITE_BASEMAP_TILE_URL`).
- **Attribution:** "© OpenStreetMap contributors", shown in the map
  attribution control and the page footer. Required by the
  [ODbL](https://www.openstreetmap.org/copyright).
- **Usage policy:** the public OSM tile server is acceptable for low-volume
  prototype and demo use only. For production or heavy use, switch to a
  dedicated tile provider via `VITE_BASEMAP_TILE_URL`. See
  <https://operations.osmfoundation.org/policies/tiles/>.
- **API key:** none.

## Replacing the demo data with a real dataset

Not done in P0. When it happens:

1. Add a documented, re-runnable prep script under `scripts/` that downloads
   the raw source (raw data is **not** committed).
2. Reproject to EPSG:4326, clip to the study area, simplify for rendering,
   normalise field names to the `ParcelProperties` schema in `src/types.ts`.
3. Validate geometry; drop or fix invalid polygons and log what was dropped.
4. Redact PII.
5. Record the source, licence, and attribution requirements in this file.
