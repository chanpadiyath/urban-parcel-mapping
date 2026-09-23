import { useEffect, useState } from "react";
import { fetchWhatIf, type WhatIfResult } from "./whatif";

interface WhatIfState {
  data: WhatIfResult | null;
  loading: boolean;
  error: string | null;
}

/** Re-fetches whenever the parcel or either intervention amount changes. */
export function useWhatIf(parcelId: string | null, plinthRaiseM: number, levelReductionM: number): WhatIfState {
  const [state, setState] = useState<WhatIfState>({ data: null, loading: false, error: null });

  useEffect(() => {
    if (!parcelId) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchWhatIf(parcelId, plinthRaiseM, levelReductionM)
      .then((data) => { if (!cancelled) setState({ data, loading: false, error: null }); })
      .catch((err: unknown) => {
        if (!cancelled) setState({ data: null, loading: false, error: err instanceof Error ? err.message : String(err) });
      });
    return () => { cancelled = true; };
  }, [parcelId, plinthRaiseM, levelReductionM]);

  return state;
}
