const API = (import.meta.env.VITE_SIM_API as string | undefined) ?? "/api";

export type WhatIfImpact = "None" | "Low" | "Moderate" | "High" | "Severe";

export interface WhatIfResult {
  parcelId: string;
  elevationM: number;
  waterLevelM: number;
  road: { name: string | null; distanceM: number | null };
  baseline: { depthM: number; impact: WhatIfImpact };
  scenario: { depthM: number; impact: WhatIfImpact; plinthRaiseM: number; levelReductionM: number };
  deltaDepthM: number;
}

/** Real depth recomputation for one parcel under a hypothetical intervention (backend/app/flood.py:what_if). */
export async function fetchWhatIf(
  parcelId: string,
  plinthRaiseM: number,
  levelReductionM: number,
): Promise<WhatIfResult> {
  const url = `${API}/simulation/whatif?parcel_id=${encodeURIComponent(parcelId)}&plinth_raise_m=${plinthRaiseM}&level_reduction_m=${levelReductionM}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as WhatIfResult;
}
