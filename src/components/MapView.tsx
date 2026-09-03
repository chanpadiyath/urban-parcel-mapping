import { useEffect, useRef } from "react";
import maplibregl, {
  type StyleSpecification,
  type FilterSpecification,
  type ExpressionSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  ENCROACHMENT_COLORS,
  LAND_USE_COLORS,
  LAND_USE_FALLBACK_COLOR,
  type ParcelCollection,
  type ParcelProperties,
  type StyleMode,
} from "../types";
import { featuresBounds, type BBox } from "../geo";

const BASEMAP_TILE_URL =
  (import.meta.env.VITE_BASEMAP_TILE_URL as string | undefined) ??
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

const SRC = "parcels";
const FILL = "parcels-fill";
const LINE = "parcels-outline";

const SELECTED_LINE = "#12305a";
const HOVER_LINE = "#3b5573";
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
  layers: [
    { id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.4 } },
  ],
};

const landUseColor = [
  "match",
  ["get", "land_use"],
  ...Object.entries(LAND_USE_COLORS).flatMap(([k, v]) => [k, v]),
  LAND_USE_FALLBACK_COLOR,
] as unknown as ExpressionSpecification;

const encroachmentColor = [
  "match",
  ["get", "encroachment_status"],
  ...Object.entries(ENCROACHMENT_COLORS).flatMap(([k, v]) => [k, v]),
  ENCROACHMENT_COLORS.None,
] as unknown as ExpressionSpecification;

const isSelected: ExpressionSpecification = ["boolean", ["feature-state", "selected"], false];
const isHover: ExpressionSpecification = ["boolean", ["feature-state", "hover"], false];

export interface ViewState {
  lng: number;
  lat: number;
  zoom: number;
}

interface MapViewProps {
  parcels: ParcelCollection;
  selectedId: string | null;
  styleMode: StyleMode;
  visibleIds: string[] | null;
  focusBounds: BBox | null;
  rightPanelOpen: boolean;
  onSelect: (properties: ParcelProperties | null) => void;
  onViewState?: (v: ViewState) => void;
}

export default function MapView({
  parcels,
  selectedId,
  styleMode,
  visibleIds,
  focusBounds,
  rightPanelOpen,
  onSelect,
  onViewState,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const homeRef = useRef<BBox | null>(null);
  const selRef = useRef<string | null>(null);
  const hoverRef = useRef<string | null>(null);
  const onSelectRef = useRef(onSelect);
  const onViewStateRef = useRef(onViewState);
  onSelectRef.current = onSelect;
  onViewStateRef.current = onViewState;

  // --- init (once) -------------------------------------------------
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
    map.addControl(new maplibregl.NavigationControl({ showZoom: true }), "top-right");
    map.addControl(new maplibregl.FullscreenControl(), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    const setHover = (id: string | null) => {
      if (hoverRef.current === id) return;
      if (hoverRef.current) map.setFeatureState({ source: SRC, id: hoverRef.current }, { hover: false });
      if (id) map.setFeatureState({ source: SRC, id }, { hover: true });
      hoverRef.current = id;
    };

    const emitView = () => {
      const c = map.getCenter();
      onViewStateRef.current?.({ lng: c.lng, lat: c.lat, zoom: map.getZoom() });
    };

    map.on("load", () => {
      map.addSource(SRC, { type: "geojson", data: parcels, promoteId: "parcel_id" });

      map.addLayer({
        id: FILL,
        type: "fill",
        source: SRC,
        paint: {
          "fill-color": styleMode === "encroachment" ? encroachmentColor : landUseColor,
          "fill-opacity": ["case", isSelected, 0.8, isHover, 0.62, 0.42],
        },
      });
      map.addLayer({
        id: LINE,
        type: "line",
        source: SRC,
        paint: {
          "line-color": ["case", isSelected, SELECTED_LINE, isHover, HOVER_LINE, DEFAULT_LINE],
          "line-width": ["case", isSelected, 2.6, isHover, 1.6, 0.7],
        },
      });

      const b = featuresBounds(parcels.features);
      homeRef.current = b;
      if (b) map.fitBounds(b, { padding: 44, duration: 0 });

      readyRef.current = true;
      if (visibleIds) {
        map.setFilter(FILL, ["in", ["get", "parcel_id"], ["literal", visibleIds]] as FilterSpecification);
        map.setFilter(LINE, ["in", ["get", "parcel_id"], ["literal", visibleIds]] as FilterSpecification);
      }
      if (selRef.current) map.setFeatureState({ source: SRC, id: selRef.current }, { selected: true });
      emitView();
    });

    map.on("click", FILL, (e) => {
      const f = e.features?.[0];
      if (f) onSelectRef.current(f.properties as ParcelProperties);
    });
    map.on("click", (e) => {
      if (map.queryRenderedFeatures(e.point, { layers: [FILL] }).length === 0) {
        onSelectRef.current(null);
      }
    });
    map.on("mousemove", FILL, (e) => {
      map.getCanvas().style.cursor = "pointer";
      const f = e.features?.[0];
      setHover(typeof f?.id === "string" ? f.id : null);
    });
    map.on("mouseleave", FILL, () => {
      map.getCanvas().style.cursor = "";
      setHover(null);
    });
    map.on("move", emitView);

    return () => {
      readyRef.current = false;
      hoverRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // parcels is stable for this component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // selection -> feature-state
  useEffect(() => {
    const map = mapRef.current;
    selRef.current = selectedId;
    if (!map || !readyRef.current) return;
    map.removeFeatureState({ source: SRC }, "selected");
    if (selectedId) map.setFeatureState({ source: SRC, id: selectedId }, { selected: true });
  }, [selectedId]);

  // style mode -> fill colour
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setPaintProperty(
      FILL,
      "fill-color",
      styleMode === "encroachment" ? encroachmentColor : landUseColor,
    );
  }, [styleMode]);

  // filter -> visible parcels
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const f: FilterSpecification | null = visibleIds
      ? (["in", ["get", "parcel_id"], ["literal", visibleIds]] as FilterSpecification)
      : null;
    map.setFilter(FILL, f);
    map.setFilter(LINE, f);
  }, [visibleIds]);

  // search focus
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !focusBounds) return;
    map.fitBounds(focusBounds, { padding: 110, maxZoom: 18, duration: 500 });
  }, [focusBounds]);

  // resize when the info panel opens/closes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const id = window.setTimeout(() => map.resize(), 60);
    return () => window.clearTimeout(id);
  }, [rightPanelOpen]);

  const resetView = () => {
    const map = mapRef.current;
    if (map && homeRef.current) {
      map.fitBounds(homeRef.current, { padding: 44, duration: 400 });
    }
  };

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map-canvas" role="application" aria-label="Parcel map" />
      <button type="button" className="map-home" onClick={resetView} title="Reset to full extent">
        Reset view
      </button>
    </div>
  );
}
