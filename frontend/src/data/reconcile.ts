import { useCallback, useEffect, useState } from "react";

const API = (import.meta.env.VITE_SIM_API as string | undefined) ?? "/api";

export interface ParcelReconcile {
  osm_building_present: boolean;
  osm_building_count: number;
  osm_building_area_sqm: number;
  our_built_up_area_sqm: number | null;
  built_up_delta_sqm: number | null;
  osm_landuse: string | null;
  our_land_use: string | null;
  landuse_match: boolean | null;
  nearest_road_m: number | null;
  nearest_road_name: string | null;
  nearest_road_class: string | null;
}

export interface ReconcileSummary {
  parcels_total: number;
  osm_buildings_in_area: number;
  osm_landuse_polygons: number;
  osm_roads: number;
  parcels_with_osm_building: number;
  building_presence_rate: number;
  landuse_comparable_parcels: number;
  landuse_agreements: number;
  landuse_agreement_rate: number | null;
  median_abs_builtup_delta_sqm: number | null;
  median_nearest_road_m: number | null;
}

export interface ReconcileResult {
  generated_at: string;
  reference_source: string;
  reference_loaded_at: string | null;
  reference_state: string;
  summary: ReconcileSummary;
  note: string;
  perParcel: Record<string, ParcelReconcile>;
}

export type ReconcileState =
  | { status: "loading" }
  | { status: "unavailable"; reason: string }
  | { status: "ready"; data: ReconcileResult };

export function useReconciliation() {
  const [state, setState] = useState<ReconcileState>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetch(`${API}/reconcile`, { signal: AbortSignal.timeout(15000) })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as ReconcileResult;
      })
      .then((data) => { if (!cancelled) setState({ status: "ready", data }); })
      .catch((e) => {
        if (!cancelled) {
          setState({ status: "unavailable", reason: e instanceof Error ? e.message : String(e) });
        }
      });
    return () => { cancelled = true; };
  }, [nonce]);

  const refresh = useCallback(async () => {
    try {
      await fetch(`${API}/reference/refresh`, { method: "POST", signal: AbortSignal.timeout(90000) });
    } catch { /* refresh best-effort; reconcile reload below still runs */ }
    setNonce((n) => n + 1);
  }, []);

  return { state, refresh };
}
