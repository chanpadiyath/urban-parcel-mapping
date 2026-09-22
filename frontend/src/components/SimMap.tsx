import { useEffect, useRef } from "react";
import maplibregl, {
  type StyleSpecification,
  type ExpressionSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { BASEMAPS, BASEMAP_ATTRIBUTION } from "../config";
import type { ParcelCollection, ParcelProperties } from "../types";
import type { FloodImpact } from "../sim/flood";

const SRC = "parcels";
const LINE = "p-line";
const FLOOD = "p-flood";

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
  center: [number, number];
  zoom: number;
  impact: FloodImpact;
  selectedId: string | null;
  onSelect: (p: ParcelProperties | null) => void;
}

export default function SimMap({ parcels, center, zoom, impact, selectedId, onSelect }: Props) {
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
      const b = new maplibregl.LngLatBounds();
      for (const f of parcels.features) {
        const g = f.geometry;
        if (g.type === "Polygon") for (const ring of g.coordinates) for (const c of ring) b.extend(c as [number, number]);
      }
      if (!b.isEmpty()) map.fitBounds(b, { padding: 44, duration: 0 });
      readyRef.current = true;
      syncFlood(map, impact, appliedRef.current);
      if (selRef.current) map.setFeatureState({ source: SRC, id: selRef.current }, { selected: true });
    });

    map.on("click", FLOOD, (e) => {
      const f = e.features?.[0];
      if (f) onSelRef.current(f.properties as ParcelProperties);
    });
    map.on("click", (e) => {
      if (map.queryRenderedFeatures(e.point, { layers: [FLOOD] }).length === 0) onSelRef.current(null);
    });
    map.on("mouseenter", FLOOD, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", FLOOD, () => { map.getCanvas().style.cursor = ""; });

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
    selRef.current = selectedId;
    if (!map || !readyRef.current) return;
    map.removeFeatureState({ source: SRC }, "selected");
    if (selectedId) map.setFeatureState({ source: SRC, id: selectedId }, { selected: true });
  }, [selectedId]);

  return <div ref={boxRef} className="map-canvas" role="application" aria-label="Flood simulation map" />;
}

function syncFlood(map: maplibregl.Map, impact: FloodImpact, applied: Set<string>) {
  // clear parcels no longer flooded
  for (const id of applied) {
    if (!impact.affectedParcelIds.has(id)) {
      map.setFeatureState({ source: SRC, id }, { flooded: false, depth: 0 });
      applied.delete(id);
    }
  }
  for (const [id, st] of impact.perParcel) {
    map.setFeatureState({ source: SRC, id }, { flooded: true, depth: st.depthM });
    applied.add(id);
  }
}
