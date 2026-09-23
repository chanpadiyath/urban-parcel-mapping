import { useEffect, useRef } from "react";
import maplibregl, {
  type StyleSpecification,
  type ExpressionSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { BASEMAPS, BASEMAP_ATTRIBUTION } from "../config";
import type { BuildingCollection, ParcelCollection, ParcelProperties } from "../types";
import type { FloodImpact } from "../sim/flood";
import { EMPTY_ROADS, type RoadCollection } from "../data/roads";

const SRC = "parcels";
const LINE = "p-line";
const FLOOD = "p-flood";
const BSRC = "buildings";
const BLYR = "buildings-fill";
const BLINE = "buildings-outline";
const RSRC = "roads";
const RLYR = "roads-line";

const style: StyleSpecification = {
  version: 8,
  sources: {
    base: {
      type: "raster",
      tiles: [BASEMAPS.map],
      tileSize: 256,
      attribution: BASEMAP_ATTRIBUTION.map,
      maxzoom: 19,
    },
  },
  layers: [{ id: "base", type: "raster", source: "base", paint: { "raster-saturation": -0.6, "raster-brightness-max": 0.85 } }],
};

const depthColor = [
  "interpolate", ["linear"], ["coalesce", ["feature-state", "depth"], 0],
  0, "#cfe5f7",
  0.5, "#95c1e8",
  1.2, "#5a97d2",
  2.2, "#2f6fb2",
  3.5, "#1c4f8c",
] as unknown as ExpressionSpecification;

interface Props {
  parcels: ParcelCollection;
  buildings?: BuildingCollection;
  roads?: RoadCollection;
  center: [number, number];
  zoom: number;
  impact: FloodImpact;
  selectedId: string | null;
  onSelect: (p: ParcelProperties | null) => void;
}

export default function SimMap({ parcels, buildings, roads, center, zoom, impact, selectedId, onSelect }: Props) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const appliedRef = useRef<Set<string>>(new Set());
  const selRef = useRef<string | null>(null);
  const onSelRef = useRef(onSelect);
  onSelRef.current = onSelect;

  useEffect(() => {
    if (!boxRef.current) return;
    const map = new maplibregl.Map({ container: boxRef.current, style, center, zoom, attributionControl: { compact: false } });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showZoom: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    map.on("load", () => {
      map.addSource(SRC, { type: "geojson", data: parcels, promoteId: "parcel_id" });
      map.addSource(RSRC, { type: "geojson", data: roads ?? EMPTY_ROADS });
      map.addSource(BSRC, { type: "geojson", data: buildings ?? { type: "FeatureCollection", features: [] }, promoteId: "parcel_id" });

      // roads first (context), under everything else
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
      // real building footprints, drawn on top so they're visible over the flood tint
      map.addLayer({
        id: BLYR,
        type: "fill",
        source: BSRC,
        paint: {
          // flooded buildings pick up the same depth tint as their parcel (the
          // building is literally what's flooding) — dry buildings stay neutral
          "fill-color": [
            "case",
            ["boolean", ["feature-state", "flooded"], false], depthColor,
            ["boolean", ["feature-state", "selected"], false], "#e8c99a",
            "#d8d2c4",
          ] as unknown as ExpressionSpecification,
          "fill-opacity": 0.88,
        },
      });
      map.addLayer({
        id: BLINE,
        type: "line",
        source: BSRC,
        paint: { "line-color": "#4a4030", "line-width": 0.8 },
      });

      const b = new maplibregl.LngLatBounds();
      for (const f of parcels.features) {
        const g = f.geometry;
        if (g.type === "Polygon") for (const ring of g.coordinates) for (const c of ring) b.extend(c as [number, number]);
      }
      if (!b.isEmpty()) map.fitBounds(b, { padding: 44, duration: 0 });
      readyRef.current = true;
      syncFlood(map, impact, appliedRef.current);
      if (selRef.current) {
        map.setFeatureState({ source: SRC, id: selRef.current }, { selected: true });
        map.setFeatureState({ source: BSRC, id: selRef.current }, { selected: true });
      }
    });

    const pick = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (f) onSelRef.current(f.properties as ParcelProperties);
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
