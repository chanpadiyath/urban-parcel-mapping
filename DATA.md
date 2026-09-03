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
- **Stored attributes per feature:** `parcel_id`, `address`, `locality`,
  `ward`, `zone`, `land_use`, `zoning_code`, `zoning_description`,
  `permitted_use`, `development_status`, `area_sqm`, `area_acres`,
  `built_up_area_sqm`, `floors`, `row_area_sqm`, `encroachment_area_sqm`,
  `encroachment_status`, `assessed_value_usd`, `owner`, `jurisdiction`,
  `last_updated`, `data_source`, `data_quality`. Every feature carries
  `data_source = "SYNTHETIC DEMO DATA — not real parcels"` and
  `data_quality = "DEMO DATA"`.
- **Derived at runtime, not stored** (`src/metrics.ts`): built-up %, open /
  vacant area and %, encroachment %, ground coverage %, and floor area ratio
  (`built_up_area × floors ÷ parcel_area`). All guarded against zero /
  missing / non-finite inputs.
- **`encroachment_area_sqm` / `encroachment_status`:** **fabricated demo
  values.** They do **not** represent officially detected encroachment, and no
  encroachment geometry is generated — only the metric. ~60% of parcels have
  none; the rest are spread across Minor / Moderate / Significant / Critical.
- **`assessed_value_usd`:** a **fabricated demo figure** (indicative $/m² by
  land use × area + a built-up premium × deterministic jitter), not a real
  assessment. Labelled "(demo)" wherever displayed.
- **Planning metrics (FAR, ground coverage, built-up ratio):** demo analysis
  derived from the fabricated areas — not official planning determinations.
  Labelled "Demo analysis" / "estimated" in the UI.
- **Land-use classes:** Residential, Commercial, Mixed Use, Industrial,
  Institutional, Public/Semi-Public, Recreational, Vacant.
  **Development statuses:** Developed, Partially Developed, Under Development,
  Vacant, Encroached, Requires Review.
  **Encroachment levels:** None, Minor, Moderate, Significant, Critical.
  All fabricated.
- All non-geometric values are deterministic, so regenerating the file
  produces the same data (only the metadata timestamp changes). The file's
  `metadata.disclaimer` restates the above.
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
