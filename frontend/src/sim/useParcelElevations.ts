import { useEffect, useState } from "react";

const API = (import.meta.env.VITE_SIM_API as string | undefined) ?? "/api";

/** Real elevation (metres) per simulated parcel, from the backend's DEM snapshot. */
export function useParcelElevations(): Record<string, number> | null {
  const [elevations, setElevations] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/simulation/elevations`)
      .then((res) => (res.ok ? (res.json() as Promise<Record<string, number>>) : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => { if (!cancelled) setElevations(data); })
      .catch(() => { if (!cancelled) setElevations(null); });
    return () => { cancelled = true; };
  }, []);

  return elevations;
}
