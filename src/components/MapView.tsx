import { useEffect, useRef } from "react";
import maplibregl, {
  type StyleSpecification,
  type FilterSpecification,
  type ExpressionSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  LAND_USE_COLORS,
  LAND_USE_FALLBACK_COLOR,
  type ParcelCollection,
  type ParcelProperties,
} from "../types";
import { featuresBounds, type BBox } from "../geo";

const BASEMAP_TILE_URL =
  (import.meta.env.VITE_BASEMAP_TILE_URL as string | undefined) ??
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

const SRC = "parcels";
const FILL = "parcels-fill";
const LINE = "parcels-outline";

const SELECTED_LINE = "#111827";
const HOVER_LINE = "#334155";
const DEFAULT_LINE = "#ffffff";

const baseStyle: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: [BASEMAP_TILE_URL],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

// fill-color: categorical by land_use.
const fillColorExpr: ExpressionSpecification = [
  "match",
  ["get", "land_use"],
  ...Object.entries(LAND_USE_COLORS).flatMap(([k, v]) => [k, v]),
  LAND_USE_FALLBACK_COLOR,
] as unknown as ExpressionSpecification;

const isSelected: ExpressionSpecification = [
  "boolean",
  ["feature-state", "selected"],
  false,
];
const isHover: ExpressionSpecification = [
  "boolean",
  ["feature-state", "hover"],
  false,
];

interface MapViewProps {
  parcels: ParcelCollection;
  selectedId: string | null;
  filter: FilterSpecification | null;
  focusBounds: BBox | null;
  rightPanelOpen: boolean;
  onSelect: (properties: ParcelProperties | null) => void;
}

export default function MapView({
  parcels,
  selectedId,
  filter,
  focusBounds,
  rightPanelOpen,
  onSelect,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const selRef = useRef<string | null>(null);
  const hoverRef = useRef<string | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // --- init (once) ---------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: baseStyle,
      center: [0, 0],
      zoom: 1,
      attributionControl: { compact: false },
    });
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({ showZoom: true, visualizePitch: false }),
      "top-right",
    );
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    const setHover = (id: string | null) => {
      if (hoverRef.current === id) return;
      if (hoverRef.current) {
        map.setFeatureState(
          { source: SRC, id: hoverRef.current },
          { hover: false },
        );
      }
      if (id) map.setFeatureState({ source: SRC, id }, { hover: true });
      hoverRef.current = id;
    };

    map.on("load", () => {
      map.addSource(SRC, {
        type: "geojson",
        data: parcels,
        promoteId: "parcel_id",
      });

      map.addLayer({
        id: FILL,
        type: "fill",
        source: SRC,
        paint: {
          "fill-color": fillColorExpr,
          "fill-opacity": [
            "case",
            isSelected,
            0.85,
            isHover,
            0.7,
            0.55,
          ],
        },
      });

      map.addLayer({
        id: LINE,
        type: "line",
        source: SRC,
        paint: {
          "line-color": [
            "case",
            isSelected,
            SELECTED_LINE,
            isHover,
            HOVER_LINE,
            DEFAULT_LINE,
          ],
          "line-width": ["case", isSelected, 3, isHover, 1.8, 0.8],
        },
      });

      const b = featuresBounds(parcels.features);
      if (b) map.fitBounds(b, { padding: 48, duration: 0 });

      readyRef.current = true;
      if (filter) {
        map.setFilter(FILL, filter);
        map.setFilter(LINE, filter);
      }
      if (selRef.current) {
        map.setFeatureState(
          { source: SRC, id: selRef.current },
          { selected: true },
        );
      }
    });

    map.on("click", FILL, (e) => {
      const f = e.features?.[0];
      if (f) onSelectRef.current(f.properties as ParcelProperties);
    });

    map.on("click", (e) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: [FILL] });
      if (hits.length === 0) onSelectRef.current(null);
    });

    map.on("mousemove", FILL, (e) => {
      map.getCanvas().style.cursor = "pointer";
      const f = e.features?.[0];
      const id = typeof f?.id === "string" ? f.id : null;
      setHover(id);
    });
    map.on("mouseleave", FILL, () => {
      map.getCanvas().style.cursor = "";
      setHover(null);
    });

    return () => {
      readyRef.current = false;
      hoverRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // parcels is stable for this component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- selection -> feature-state ----------------------------------
  useEffect(() => {
    const map = mapRef.current;
    selRef.current = selectedId;
    if (!map || !readyRef.current) return;
    // Clear any previously-selected feature, then set the new one.
    map.removeFeatureState({ source: SRC }, "selected");
    if (selectedId) {
      map.setFeatureState({ source: SRC, id: selectedId }, { selected: true });
    }
  }, [selectedId]);

  // --- filter -----------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setFilter(FILL, filter);
    map.setFilter(LINE, filter);
  }, [filter]);

  // --- focus (search result) ------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !focusBounds) return;
    map.fitBounds(focusBounds, { padding: 96, maxZoom: 18, duration: 500 });
  }, [focusBounds]);

  // --- resize when the side panel opens/closes -----------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const id = window.setTimeout(() => map.resize(), 60);
    return () => window.clearTimeout(id);
  }, [rightPanelOpen]);

  return (
    <div
      ref={containerRef}
      className="map-canvas"
      role="application"
      aria-label="Parcel map"
    />
  );
}
