import { useEffect, useRef } from "react";
import maplibregl, {
  type StyleSpecification,
  type ExpressionSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { BASEMAPS, BASEMAP_ATTRIBUTION } from "../config";
import { PITCH_3D, BEARING_3D } from "./MapView";
import type { BuildingCollection, ParcelCollection, ParcelProperties, ViewMode } from "../types";
import type { FloodImpact } from "../sim/flood";
import { EMPTY_ROADS, type RoadCollection } from "../data/roads";

export type SimBasemap = "map" | "satellite" | "drone";

const SRC = "parcels";
const LINE = "p-line";
const FLOOD = "p-flood";
const BSRC = "buildings";
const BLYR = "buildings-fill";
const BLINE = "buildings-outline";
const RSRC = "roads";
const RLYR = "roads-line";
const DEMSRC = "dem";
const HILLLYR = "hillshade";

// Real topographic shading from the same free, keyless Mapzen/Tilezen DEM
// tile family behind the elevation numbers feeding the flood model (see
// backend/app/elevation.py). No API key, no drone imagery involved — this
// is the honest "topographical view" stand-in while there's no real drone
// data yet.
const TERRAIN_TILES = ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"];

const depthColor = [
  "interpolate", ["linear"], ["coalesce", ["feature-state", "depth"], 0],
  0, "#cfe5f7",
  0.5, "#95c1e8",
  1.2, "#5a97d2",
  2.2, "#2f6fb2",
  3.5, "#1c4f8c",
] as unknown as ExpressionSpecification;

const buildingColor = [
  "case",
  ["boolean", ["feature-state", "flooded"], false], depthColor,
  ["boolean", ["feature-state", "selected"], false], "#e8c99a",
  "#d8d2c4",
] as unknown as ExpressionSpecification;

/** Rough, non-georeferenced placement rectangle: the parcel data's own bounding box. */
function boundsOf(parcels: ParcelCollection): maplibregl.LngLatBounds {
  const b = new maplibregl.LngLatBounds();
  for (const f of parcels.features) {
    const g = f.geometry;
    if (g.type === "Polygon") for (const ring of g.coordinates) for (const c of ring) b.extend(c as [number, number]);
  }
  return b;
}

function baseStyle(basemap: SimBasemap, droneImageUrl: string | null, parcels: ParcelCollection): StyleSpecification {
  if (basemap === "drone" && droneImageUrl) {
    const b = boundsOf(parcels);
    return {
      version: 8,
      sources: {
        base: {
          type: "image",
          url: droneImageUrl,
          // NW, NE, SE, SW — a rough overlay across the parcel data's own
          // bounding box, not a real orthorectified/georeferenced placement
          coordinates: [
            [b.getWest(), b.getNorth()],
            [b.getEast(), b.getNorth()],
            [b.getEast(), b.getSouth()],
            [b.getWest(), b.getSouth()],
          ],
        },
      },
      layers: [{ id: "base", type: "raster", source: "base", paint: { "raster-opacity": 1 } }],
    };
  }
  const key = basemap === "drone" ? "map" : basemap; // drone selected with no image yet: fall back
  return {
    version: 8,
    sources: {
      base: {
        type: "raster",
        tiles: [BASEMAPS[key]],
        tileSize: 256,
        attribution: BASEMAP_ATTRIBUTION[key],
        maxzoom: 19,
      },
    },
    layers: [{ id: "base", type: "raster", source: "base", paint: { "raster-saturation": -0.6, "raster-brightness-max": 0.85 } }],
  };
}

interface Props {
  parcels: ParcelCollection;
  buildings?: BuildingCollection;
  roads?: RoadCollection;
  center: [number, number];
  zoom: number;
  impact: FloodImpact;
  selectedId: string | null;
  viewMode: ViewMode;
  basemap: SimBasemap;
  droneImageUrl: string | null;
  showTerrain: boolean;
  onSelect: (p: ParcelProperties | null) => void;
}

export default function SimMap({
  parcels, buildings, roads, center, zoom, impact, selectedId, viewMode, basemap, droneImageUrl, showTerrain, onSelect,
}: Props) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const appliedRef = useRef<Set<string>>(new Set());
  const selRef = useRef<string | null>(null);
  const viewModeRef = useRef<ViewMode>(viewMode);
  viewModeRef.current = viewMode;
  const showTerrainRef = useRef(showTerrain);
  showTerrainRef.current = showTerrain;
  const onSelRef = useRef(onSelect);
  onSelRef.current = onSelect;

  function addLayers(map: maplibregl.Map) {
    map.addSource(SRC, { type: "geojson", data: parcels, promoteId: "parcel_id" });
    map.addSource(RSRC, { type: "geojson", data: roads ?? EMPTY_ROADS });
    map.addSource(BSRC, { type: "geojson", data: buildings ?? { type: "FeatureCollection", features: [] }, promoteId: "parcel_id" });
    map.addSource(DEMSRC, { type: "raster-dem", tiles: TERRAIN_TILES, tileSize: 256, encoding: "terrarium", maxzoom: 15 });

    // real topographic shading, right above the base imagery, under everything else
    map.addLayer({
      id: HILLLYR,
      type: "hillshade",
      source: DEMSRC,
      layout: { visibility: showTerrainRef.current ? "visible" : "none" },
      paint: { "hillshade-exaggeration": 1 },
    });

    // roads next (context), under everything else
    map.addLayer({
      id: RLYR,
      type: "line",
      source: RSRC,
      paint: { "line-color": "#5c6b7e", "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.5, 18, 2] },
    });
    map.addLayer({
      id: FLOOD,
      type: "fill",
      source: SRC,
      paint: {
        "fill-color": depthColor,
        "fill-opacity": ["case", ["boolean", ["feature-state", "flooded"], false], 0.74, 0],
      },
    });
    map.addLayer({
      id: LINE,
      type: "line",
      source: SRC,
      paint: {
        "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#0b1f33", "#8ea6bd"],
        "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 3, 0.6],
      },
    });
    // real building footprints — a fill-extrusion with height 0 at pitch 0 looks
    // identical to a flat fill, so one layer covers both 2D and 3D. Flooded
    // buildings pick up the same depth tint as their parcel (the building is
    // literally what's flooding).
    map.addLayer({
      id: BLYR,
      type: "fill-extrusion",
      source: BSRC,
      paint: {
        "fill-extrusion-color": buildingColor,
        "fill-extrusion-height": viewModeRef.current === "3d" ? ["coalesce", ["get", "height_m"], 6] : 0,
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.88,
      },
    });
    map.addLayer({
      id: BLINE,
      type: "line",
      source: BSRC,
      paint: { "line-color": "#4a4030", "line-width": 0.8 },
    });
  }

  useEffect(() => {
    if (!boxRef.current) return;
    const start3D = viewModeRef.current === "3d";
    const map = new maplibregl.Map({
      container: boxRef.current,
      style: baseStyle(basemap, droneImageUrl, parcels),
      center,
      zoom,
      pitch: start3D ? PITCH_3D : 0,
      bearing: start3D ? BEARING_3D : 0,
      maxPitch: 70,
      attributionControl: { compact: false },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showZoom: true, visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    map.on("load", () => {
      addLayers(map);
      const b = boundsOf(parcels);
      if (!b.isEmpty()) map.fitBounds(b, { padding: 44, duration: 0, pitch: map.getPitch(), bearing: map.getBearing() });
      readyRef.current = true;
      syncFlood(map, impact, appliedRef.current);
      if (selRef.current) {
        map.setFeatureState({ source: SRC, id: selRef.current }, { selected: true });
        map.setFeatureState({ source: BSRC, id: selRef.current }, { selected: true });
      }
    });

    const pick = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      // clicking the already-selected parcel again deselects it (toggle)
      if (typeof f.id === "string" && f.id === selRef.current) {
        onSelRef.current(null);
      } else {
        onSelRef.current(f.properties as ParcelProperties);
      }
    };
    map.on("click", FLOOD, pick);
    map.on("click", BLYR, pick);
    map.on("click", (e) => {
      if (map.queryRenderedFeatures(e.point, { layers: [FLOOD, BLYR] }).length === 0) onSelRef.current(null);
    });
    const hoverOn = () => { map.getCanvas().style.cursor = "pointer"; };
    const hoverOff = () => { map.getCanvas().style.cursor = ""; };
    map.on("mouseenter", FLOOD, hoverOn);
    map.on("mouseleave", FLOOD, hoverOff);
    map.on("mouseenter", BLYR, hoverOn);
    map.on("mouseleave", BLYR, hoverOff);

    return () => { readyRef.current = false; appliedRef.current = new Set(); map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // basemap (incl. drone image) swap -> reload style, then re-add layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    readyRef.current = false;
    map.setStyle(baseStyle(basemap, droneImageUrl, parcels));
    map.once("styledata", () => {
      if (!map.getSource(SRC)) addLayers(map);
      syncFlood(map, impact, appliedRef.current);
      if (selRef.current) {
        map.setFeatureState({ source: SRC, id: selRef.current }, { selected: true });
        map.setFeatureState({ source: BSRC, id: selRef.current }, { selected: true });
      }
      readyRef.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap, droneImageUrl]);

  // 2D/3D toggle -> real building height + camera pitch/bearing
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getLayer(BLYR)) return;
    map.setPaintProperty(BLYR, "fill-extrusion-height", viewMode === "3d" ? ["coalesce", ["get", "height_m"], 6] : 0);
    map.easeTo({ pitch: viewMode === "3d" ? PITCH_3D : 0, bearing: viewMode === "3d" ? BEARING_3D : 0, duration: 500 });
  }, [viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getLayer(HILLLYR)) return;
    map.setLayoutProperty(HILLLYR, "visibility", showTerrain ? "visible" : "none");
  }, [showTerrain]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    syncFlood(map, impact, appliedRef.current);
  }, [impact]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource(RSRC) as maplibregl.GeoJSONSource | undefined;
    src?.setData(roads ?? EMPTY_ROADS);
  }, [roads]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !buildings) return;
    const src = map.getSource(BSRC) as maplibregl.GeoJSONSource | undefined;
    src?.setData(buildings);
  }, [buildings]);

  useEffect(() => {
    const map = mapRef.current;
    selRef.current = selectedId;
    if (!map || !readyRef.current) return;
    for (const s of [SRC, BSRC]) {
      map.removeFeatureState({ source: s }, "selected");
      if (selectedId) map.setFeatureState({ source: s, id: selectedId }, { selected: true });
    }
  }, [selectedId]);

  return <div ref={boxRef} className="map-canvas" role="application" aria-label="Flood simulation map" />;
}

function syncFlood(map: maplibregl.Map, impact: FloodImpact, applied: Set<string>) {
  // clear parcels no longer flooded (buildings share the same id, see BSRC's promoteId)
  for (const id of applied) {
    if (!impact.affectedParcelIds.has(id)) {
      map.setFeatureState({ source: SRC, id }, { flooded: false, depth: 0 });
      map.setFeatureState({ source: BSRC, id }, { flooded: false, depth: 0 });
      applied.delete(id);
    }
  }
  for (const [id, st] of impact.perParcel) {
    map.setFeatureState({ source: SRC, id }, { flooded: true, depth: st.depthM });
    map.setFeatureState({ source: BSRC, id }, { flooded: true, depth: st.depthM });
    applied.add(id);
  }
}
