/**
 * Thin client for the Google Maps Platform proxy (server/google.mjs) — the
 * API key stays server-side, the browser only ever talks to /api/*. Both
 * calls return `null` (not throw) when the feature is unavailable — no key
 * configured, or Google returned nothing — so callers can degrade quietly,
 * matching every other optional source in this app.
 */

const SIM_API = (import.meta.env.VITE_SIM_API as string | undefined) ?? "/api";

export interface GeocodeResult {
  formatted_address: string;
  lat: number;
  lon: number;
  place_id: string;
}

export async function geocodeAddress(query: string): Promise<GeocodeResult | null> {
  try {
    const res = await fetch(`${SIM_API}/geocode?q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return (await res.json()) as GeocodeResult;
  } catch {
    return null;
  }
}

export interface NearbyPlace {
  name: string;
  types: string[];
  address: string | null;
}

export async function nearbyPlaces(lat: number, lon: number): Promise<NearbyPlace[]> {
  try {
    const res = await fetch(`${SIM_API}/places/nearby?lat=${lat}&lon=${lon}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { places: NearbyPlace[] };
    return data.places;
  } catch {
    return [];
  }
}
