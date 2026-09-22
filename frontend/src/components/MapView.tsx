import { useEffect, useRef } from "react";
import maplibregl, {
  type StyleSpecification,
  type FilterSpecification,
  type ExpressionSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { BASEMAPS, BASEMAP_ATTRIBUTION } from "../config";
import {
  ENCROACHMENT_COLORS,
  LAND_USE_COLORS,
  LAND_USE_FALLBACK_COLOR,
  type BasemapId,
  type BuildingCollection,
  type ParcelCollection,
  type ParcelProperties,
  type StyleMode,
  type ViewMode,
} from "../types";
import { featuresBounds, type BBox } from "../geo";
import { EMPTY_ROADS, type RoadCollection } from "../data/roads";

const SRC = "parcels";
const FILL = "parcels-fill";
const LINE = "parcels-outline";
const AILYR = "parcels-ai";
const BSRC = "buildings";
const BLYR = "buildings-3d";
const RSRC = "roads";
const RLYR = "roads-line";

const SELECTED_LINE = "#eaf2ff";
const HOVER_LINE = "#9fc0e8";
const DEFAULT_LINE = "#c7d2e0";
const AI_LINE = "#e0533b";
const ROAD_LINE = "#8a94a6";

const PITCH_3D = 45;
const BEARING_3D = -18;

function baseStyle(basemap: BasemapId): StyleSpecification {
  return {
    version: 8,
    sources: {
      base: {
        type: "raster",
        tiles: [BASEMAPS[basemap]],
        tileSize: 256,
        attribution: BASEMAP_ATTRIBUTION[basemap],
        maxzoom: 19,
      },
    },
    layers: [
      {
        id: "base",
        type: "raster",
        source: "base",
        paint: { "raster-saturation": basemap === "map" ? -0.5 : -0.15, "raster-brightness-max": basemap === "map" ? 0.92 : 1 },
      },
    ],
  };
}

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

// green -> amber -> red as confidence falls
const confidenceColor = [
  "interpolate",
  ["linear"],
  ["coalesce", ["get", "boundary_confidence"], 0.5],
  0.3, "#c0392b",
  0.55, "#d9902f",
  0.8, "#3f7d52",
] as unknown as ExpressionSpecification;

const isSelected: ExpressionSpecification = ["boolean", ["feature-state", "selected"], false];
const isHover: ExpressionSpecification = ["boolean", ["feature-state", "hover"], false];

function fillColor(mode: StyleMode): ExpressionSpecification {
  if (mode === "encroachment") return encroachmentColor;
  if (mode === "confidence") return confidenceColor;
  return landUseColor;
}

export interface ViewState {
  lng: number;
  lat: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface LayerVisibility {
  parcels: boolean;
  landuse: boolean;
  buildings: boolean;
  ai: boolean;
  roads: boolean;
}

interface MapViewProps {
  parcels: ParcelCollection;
  buildings: BuildingCollection;
  roads?: RoadCollection;
  center: [number, number];
  zoom: number;
  selectedId: string | null;
  styleMode: StyleMode;
  viewMode: ViewMode;
  basemap: BasemapId;
  layers: LayerVisibility;
  visibleIds: string[] | null;
  focusBounds: BBox | null;
  rightPanelOpen: boolean;
  onSelect: (properties: ParcelProperties | null) => void;
  onViewState?: (v: ViewState) => void;
}

export default function MapView(props: MapViewProps) {
  const {
    parcels, buildings, roads, center, zoom, selectedId, styleMode, viewMode,
    basemap, layers, visibleIds, focusBounds, rightPanelOpen, onSelect, onViewState,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const homeRef = useRef<BBox | null>(null);
  const selRef = useRef<string | null>(null);
  const hoverRef = useRef<string | null>(null);
  const styleModeRef = useRef(styleMode);
  const layersRef = useRef(layers);
  const viewModeRef = useRef<ViewMode>(viewMode);
  styleModeRef.current = styleMode;
  layersRef.current = layers;
  viewModeRef.current = viewMode;
  const onSelectRef = useRef(onSelect);
  const onViewStateRef = useRef(onViewState);
  onSelectRef.current = onSelect;
  onViewStateRef.current = onViewState;

  function addParcelLayers(map: maplibregl.Map) {
    map.addSource(SRC, { type: "geojson", data: parcels, promoteId: "parcel_id" });
    map.addSource(BSRC, { type: "geojson", data: buildings, promoteId: "parcel_id" });
    map.addSource(RSRC, { type: "geojson", data: roads ?? EMPTY_ROADS });

    // roads first so parcel fill/outline render on top of them
    map.addLayer({
      id: RLYR,
      type: "line",
      source: RSRC,
      layout: { visibility: layersRef.current.roads ? "visible" : "none" },
      paint: {
        "line-color": ROAD_LINE,
        "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.6, 18, 2.2],
        "line-opacity": 0.8,
      },
    });

    map.addLayer({
      id: FILL,
      type: "fill",
      source: SRC,
      paint: {
        "fill-color": fillColor(styleModeRef.current),
        "fill-opacity": ["case", isSelected, 0.72, isHover, 0.5, 0.34],
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
    // AI detections: parcels with a potential encroachment / discrepancy flag
    map.addLayer({
      id: AILYR,
      type: "line",
      source: SRC,
      filter: [
        "any",
        ["!=", ["coalesce", ["get", "encroachment_status"], "None"], "None"],
        [">=", ["coalesce", ["get", "discrepancy_pct"], 0], 5],
      ] as unknown as FilterSpecification,
      paint: {
        "line-color": AI_LINE,
        "line-width": 2.2,
        "line-dasharray": [2, 1.5],
        "line-opacity": 0.9,
      },
    });
    map.addLayer({
      id: BLYR,
      type: "fill-extrusion",
      source: BSRC,
      layout: { visibility: viewModeRef.current === "3d" ? "visible" : "none" },
      paint: {
        "fill-extrusion-color": ["case", isSelected, "#e39a54", isHover, "#aeb9c6", "#c2c9d3"],
        "fill-extrusion-height": ["coalesce", ["get", "height_m"], 6],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.82,
        "fill-extrusion-vertical-gradient": true,
      },
    });

    applyLayerVisibility(map, layersRef.current);
  }

  // --- init (once) -------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;
    const start3D = viewModeRef.current === "3d";
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: baseStyle(basemap),
      center,
      zoom,
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
      onViewStateRef.current?.({ lng: c.lng, lat: c.lat, zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() });
    };

    map.on("load", () => {
      addParcelLayers(map);
      const b = featuresBounds(parcels.features);
      homeRef.current = b;
      if (b) map.fitBounds(b, { padding: 40, duration: 0, pitch: map.getPitch(), bearing: map.getBearing() });
      readyRef.current = true;
      if (visibleIds) applyFilter(map, visibleIds);
      if (selRef.current) for (const s of [SRC, BSRC]) map.setFeatureState({ source: s, id: selRef.current }, { selected: true });
      emitView();
    });

    const pick = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (f) onSelectRef.current(f.properties as ParcelProperties);
    };
    map.on("click", FILL, pick);
    map.on("click", BLYR, pick);
    map.on("click", (e) => {
      if (map.queryRenderedFeatures(e.point, { layers: [FILL, BLYR] }).length === 0) onSelectRef.current(null);
    });
    const move = (e: maplibregl.MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = "pointer";
      const f = e.features?.[0];
      setHover(typeof f?.id === "string" ? f.id : null);
    };
    map.on("mousemove", FILL, move);
    map.on("mousemove", BLYR, move);
    const leave = () => {
      map.getCanvas().style.cursor = "";
      setHover(null);
    };
    map.on("mouseleave", FILL, leave);
    map.on("mouseleave", BLYR, leave);
    map.on("move", emitView);

    return () => {
      readyRef.current = false;
      hoverRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // basemap swap -> reload style, then re-add parcel layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    readyRef.current = false;
    map.setStyle(baseStyle(basemap));
    map.once("styledata", () => {
      if (!map.getSource(SRC)) addParcelLayers(map);
      if (visibleIds) applyFilter(map, visibleIds);
      if (selRef.current) for (const s of [SRC, BSRC]) map.setFeatureState({ source: s, id: selRef.current }, { selected: true });
      readyRef.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap]);

  useEffect(() => {
    const map = mapRef.current;
    selRef.current = selectedId;
    if (!map || !readyRef.current) return;
    for (const s of [SRC, BSRC]) {
      map.removeFeatureState({ source: s }, "selected");
      if (selectedId) map.setFeatureState({ source: s, id: selectedId }, { selected: true });
    }
  }, [selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setPaintProperty(FILL, "fill-color", fillColor(styleMode));
  }, [styleMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setLayoutProperty(BLYR, "visibility", viewMode === "3d" && layers.buildings ? "visible" : "none");
    map.easeTo({ pitch: viewMode === "3d" ? PITCH_3D : 0, bearing: viewMode === "3d" ? BEARING_3D : 0, duration: 500 });
  }, [viewMode, layers.buildings]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyLayerVisibility(map, layers);
  }, [layers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyFilter(map, visibleIds);
  }, [visibleIds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !focusBounds) return;
    map.fitBounds(focusBounds, { padding: 130, maxZoom: 18.5, duration: 600 });
  }, [focusBounds]);

  // roads may still be loading when the map mounts — push data in once it arrives
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource(RSRC) as maplibregl.GeoJSONSource | undefined;
    src?.setData(roads ?? EMPTY_ROADS);
  }, [roads]);

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
    map.fitBounds(homeRef.current, { padding: 40, duration: 500, pitch: is3D ? PITCH_3D : 0, bearing: is3D ? BEARING_3D : 0 });
  };

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map-canvas" role="application" aria-label="Land Twin map" />
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
  // AI layer keeps its own predicate AND the visibility filter
  const aiBase: unknown[] = [
    "any",
    ["!=", ["coalesce", ["get", "encroachment_status"], "None"], "None"],
    [">=", ["coalesce", ["get", "discrepancy_pct"], 0], 5],
  ];
  map.setFilter(
    AILYR,
    (visibleIds ? ["all", aiBase, ["in", ["get", "parcel_id"], ["literal", visibleIds]]] : aiBase) as FilterSpecification,
  );
}

function applyLayerVisibility(map: maplibregl.Map, v: LayerVisibility) {
  const set = (id: string, on: boolean) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  };
  set(FILL, v.parcels && v.landuse);
  set(LINE, v.parcels);
  set(AILYR, v.ai);
  set(RLYR, v.roads);
  // buildings visibility also gated by 3D in its own effect
  if (map.getLayer(BLYR)) {
    const in3d = map.getPitch() > 1;
    set(BLYR, v.buildings && in3d);
  }
}
