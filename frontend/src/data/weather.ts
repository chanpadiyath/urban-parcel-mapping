/**
 * Real weather/precipitation data — Open-Meteo (https://open-meteo.com),
 * free, keyless, open CORS (safe to call directly from the browser, unlike
 * Google Maps Platform elsewhere in this app which is proxied server-side).
 *
 * This is real-world context to interpret the flood *simulation* against —
 * it does NOT drive the simulated water level (which stays a deterministic
 * timer, see src/sim/flood.ts). Conflating the two would overclaim realism
 * for a demo that has no rainfall-runoff/hydrology model.
 */

export interface WeatherSnapshot {
  source: "Open-Meteo";
  fetched_at: string;
  current: { precipitationMm: number; rainMm: number; temperatureC: number; weatherCode: number };
  daily: { date: string; precipitationSumMm: number; precipitationProbabilityMaxPct: number }[];
  outlook: RainOutlook;
}

export type RainOutlook = "Low" | "Elevated" | "High";

function deriveRainOutlook(daily: WeatherSnapshot["daily"]): RainOutlook {
  const maxProb = Math.max(0, ...daily.map((d) => d.precipitationProbabilityMaxPct));
  const maxSum = Math.max(0, ...daily.map((d) => d.precipitationSumMm));
  if (maxProb >= 70 || maxSum >= 20) return "High";
  if (maxProb >= 40 || maxSum >= 5) return "Elevated";
  return "Low";
}

interface OpenMeteoResponse {
  current: { precipitation: number; rain: number; temperature_2m: number; weather_code: number };
  daily: { time: string[]; precipitation_sum: number[]; precipitation_probability_max: number[] };
}

/** Real current + 3-day precipitation forecast for a location. No key needed. */
export async function fetchWeather(lat: number, lon: number): Promise<WeatherSnapshot> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=precipitation,rain,weather_code,temperature_2m` +
    `&daily=precipitation_sum,precipitation_probability_max&timezone=auto&forecast_days=3`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = (await res.json()) as OpenMeteoResponse;

  const daily = raw.daily.time.map((date, i) => ({
    date,
    precipitationSumMm: raw.daily.precipitation_sum[i] ?? 0,
    precipitationProbabilityMaxPct: raw.daily.precipitation_probability_max[i] ?? 0,
  }));

  return {
    source: "Open-Meteo",
    fetched_at: new Date().toISOString(),
    current: {
      precipitationMm: raw.current.precipitation,
      rainMm: raw.current.rain,
      temperatureC: raw.current.temperature_2m,
      weatherCode: raw.current.weather_code,
    },
    daily,
    outlook: deriveRainOutlook(daily),
  };
}
