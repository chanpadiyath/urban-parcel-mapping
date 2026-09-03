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
  type BuildingCollection,
  type ParcelCollection,
  type ParcelProperties,
  type StyleMode,
  type ViewMode,
} from "../types";
import { featuresBounds, type BBox } from "../geo";

const BASEMAP_TILE_URL =
  (import.meta.env.VITE_BASEMAP_TILE_URL as string | undefined) ??
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

const SRC = "parcels";
const FILL = "parcels-fill";
const LINE = "parcels-outline";
const BSRC = "buildings";
const BLYR = "buildings-3d";

const SELECTED_LINE = "#12305a";
const HOVER_LINE = "#3b5573";
const DEFAULT_LINE = "#ffffff";

const PITCH_3D = 42;
const BEARING_3D = -18;

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
    { id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.45 } },
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
  pitch: number;
  bearing: number;
}

interface MapViewProps {
  parcels: ParcelCollection;
  buildings: BuildingCollection;
  selectedId: string | null;
  styleMode: StyleMode;
  viewMode: ViewMode;
  visibleIds: string[] | null;
  focusBounds: BBox | null;
  rightPanelOpen: boolean;
  onSelect: (properties: ParcelProperties | null) => void;
  onViewState?: (v: ViewState) => void;
}

export default function MapView({
  parcels,
  buildings,
  selectedId,
  styleMode,
  viewMode,
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
  const viewModeRef = useRef<ViewMode>(viewMode);
  viewModeRef.current = viewMode;
  const onSelectRef = useRef(onSelect);
  const onViewStateRef = useRef(onViewState);
  onSelectRef.current = onSelect;
  onViewStateRef.current = onViewState;

  // --- init (once) -------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;

    const start3D = viewModeRef.current === "3d";
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: baseStyle,
      center: [0, 0],
      zoom: 1,
      pitch: start3D ? PITCH_3D : 0,
      bearing: start3D ? BEARING_3D : 0,
      maxPitch: 70,
      attributionControl: { compact: false },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showZoom: true, visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.FullscreenControl(), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    const setHover = (id: string | null) => {
      if (hoverRef.current === id) return;
      for (const s of [SRC, BSRC]) {
        if (hoverRef.current) map.setFeatureState({ source: s, id: hoverRef.current }, { hover: false });
        if (id) map.setFeatureState({ source: s, id }, { hover: true });
      }
      hoverRef.current = id;
    };

    const emitView = () => {
      const c = map.getCenter();
      onViewStateRef.current?.({
        lng: c.lng,
        lat: c.lat,
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      });
    };

    map.on("load", () => {
      map.addSource(SRC, { type: "geojson", data: parcels, promoteId: "parcel_id" });
      map.addSource(BSRC, { type: "geojson", data: buildings, promoteId: "parcel_id" });

      map.addLayer({
        id: FILL,
        type: "fill",
        source: SRC,
        paint: {
          "fill-color": styleMode === "encroachment" ? encroachmentColor : landUseColor,
          "fill-opacity": ["case", isSelected, 0.82, isHover, 0.6, 0.4],
        },
      });
      map.addLayer({
        id: LINE,
        type: "line",
        source: SRC,
        paint: {
          "line-color": ["case", isSelected, SELECTED_LINE, isHover, HOVER_LINE, DEFAULT_LINE],
          "line-width": ["case", isSelected, 2.8, isHover, 1.6, 0.7],
        },
      });
      map.addLayer({
        id: BLYR,
        type: "fill-extrusion",
        source: BSRC,
        layout: { visibility: viewModeRef.current === "3d" ? "visible" : "none" },
        paint: {
          "fill-extrusion-color": [
            "case",
            isSelected,
            "#e39a54",
            isHover,
            "#b9c3cf",
            "#cfd4da",
          ],
          "fill-extrusion-height": ["coalesce", ["get", "height_m"], 6],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.82,
          "fill-extrusion-vertical-gradient": true,
        },
      });

      const b = featuresBounds(parcels.features);
      homeRef.current = b;
      if (b) map.fitBounds(b, { padding: 44, duration: 0, pitch: map.getPitch(), bearing: map.getBearing() });

      readyRef.current = true;
      if (visibleIds) applyFilter(map, visibleIds);
      if (selRef.current) {
        for (const s of [SRC, BSRC]) map.setFeatureState({ source: s, id: selRef.current }, { selected: true });
      }
      emitView();
    });

    const pickHandler = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (f) onSelectRef.current(f.properties as ParcelProperties);
    };
    map.on("click", FILL, pickHandler);
    map.on("click", BLYR, pickHandler);
    map.on("click", (e) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: [FILL, BLYR] });
      if (hits.length === 0) onSelectRef.current(null);
    });

    const moveHandler = (e: maplibregl.MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = "pointer";
      const f = e.features?.[0];
      setHover(typeof f?.id === "string" ? f.id : null);
    };
    map.on("mousemove", FILL, moveHandler);
    map.on("mousemove", BLYR, moveHandler);
    const leaveHandler = () => {
      map.getCanvas().style.cursor = "";
      setHover(null);
    };
    map.on("mouseleave", FILL, leaveHandler);
    map.on("mouseleave", BLYR, leaveHandler);
    map.on("move", emitView);

    return () => {
      readyRef.current = false;
      hoverRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // parcels / buildings are stable for this component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // selection -> feature-state (parcels + buildings)
  useEffect(() => {
    const map = mapRef.current;
    selRef.current = selectedId;
    if (!map || !readyRef.current) return;
    for (const s of [SRC, BSRC]) {
      map.removeFeatureState({ source: s }, "selected");
      if (selectedId) map.setFeatureState({ source: s, id: selectedId }, { selected: true });
    }
  }, [selectedId]);

  // style mode -> parcel fill colour
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setPaintProperty(
      FILL,
      "fill-color",
      styleMode === "encroachment" ? encroachmentColor : landUseColor,
    );
  }, [styleMode]);

  // view mode -> camera + building visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setLayoutProperty(BLYR, "visibility", viewMode === "3d" ? "visible" : "none");
    map.easeTo({
      pitch: viewMode === "3d" ? PITCH_3D : 0,
      bearing: viewMode === "3d" ? BEARING_3D : 0,
      duration: 500,
    });
  }, [viewMode]);

  // filter -> visible parcels + buildings
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyFilter(map, visibleIds);
  }, [visibleIds]);

  // search focus
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !focusBounds) return;
    map.fitBounds(focusBounds, { padding: 120, maxZoom: 18, duration: 500 });
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
    if (!map || !homeRef.current) return;
    const is3D = viewModeRef.current === "3d";
    map.fitBounds(homeRef.current, {
      padding: 44,
      duration: 500,
      pitch: is3D ? PITCH_3D : 0,
      bearing: is3D ? BEARING_3D : 0,
    });
  };

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map-canvas" role="application" aria-label="Parcel map" />
      <button type="button" className="map-home" onClick={resetView} title="Reset camera to full extent">
        Reset view
      </button>
    </div>
  );
}

function applyFilter(map: maplibregl.Map, visibleIds: string[] | null) {
  const f: FilterSpecification | null = visibleIds
    ? (["in", ["get", "parcel_id"], ["literal", visibleIds]] as FilterSpecification)
    : null;
  for (const layer of [FILL, LINE, BLYR]) map.setFilter(layer, f);
}
