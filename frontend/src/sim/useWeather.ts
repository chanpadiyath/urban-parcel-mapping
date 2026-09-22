import { useEffect, useState } from "react";
import { fetchWeather, type WeatherSnapshot } from "../data/weather";

interface WeatherState {
  data: WeatherSnapshot | null;
  loading: boolean;
  error: string | null;
}

/** Real current + forecast precipitation for a location (Open-Meteo). */
export function useWeather(lat: number, lon: number): WeatherState {
  const [state, setState] = useState<WeatherState>({ data: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    setState({ data: null, loading: true, error: null });
    fetchWeather(lat, lon)
      .then((data) => { if (!cancelled) setState({ data, loading: false, error: null }); })
      .catch((err: unknown) => {
        if (!cancelled) setState({ data: null, loading: false, error: err instanceof Error ? err.message : String(err) });
      });
    return () => { cancelled = true; };
  }, [lat, lon]);

  return state;
}
