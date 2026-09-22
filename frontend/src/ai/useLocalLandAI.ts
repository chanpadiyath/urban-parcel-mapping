import { useCallback, useEffect, useRef, useState } from "react";
import type { AiRuntimeState, ParcelProperties } from "../types";
import { analyzeParcel, type AnalyzeResult } from "./analyze";

/**
 * Orchestrates the on-device Local Land AI. Prefers a Web Worker so analysis
 * never blocks the map; transparently falls back to inline execution when a
 * Worker can't be created (SSR, restricted env). Both paths run the same
 * deterministic analyser — the difference is only where it runs, surfaced as
 * `state: "running"` vs `"fallback"`.
 */
export interface LocalLandAI {
  state: AiRuntimeState;
  reason: string | null;
  result: AnalyzeResult | null;
  busy: boolean;
  lastRanAt: number | null;
  analyze: (props: ParcelProperties, neighbors?: ParcelProperties[]) => void;
  clear: () => void;
}

export function useLocalLandAI(): LocalLandAI {
  const [state, setState] = useState<AiRuntimeState>("idle");
  const [reason, setReason] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastRanAt, setLastRanAt] = useState<number | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const latest = useRef(0);

  useEffect(() => {
    if (typeof Worker === "undefined") {
      setState("fallback");
      setReason("Web Workers unavailable — running analysis inline.");
      return;
    }
    try {
      const w = new Worker(new URL("./localLandAI.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<{ id: number; result?: AnalyzeResult; error?: string }>) => {
        if (e.data.id !== latest.current) return; // stale
        setBusy(false);
        if (e.data.result) {
          setResult(e.data.result);
          setLastRanAt(e.data.result.ranAt);
        }
      };
      w.onerror = () => {
        setState("fallback");
        setReason("Worker error — running analysis inline.");
        workerRef.current = null;
      };
      workerRef.current = w;
      setState("running");
      setReason(null);
      return () => {
        w.terminate();
        workerRef.current = null;
      };
    } catch (err) {
      setState("fallback");
      setReason(`Could not start worker (${err instanceof Error ? err.message : "unknown"}) — running inline.`);
    }
  }, []);

  const analyze = useCallback((props: ParcelProperties, neighbors?: ParcelProperties[]) => {
    const id = ++reqId.current;
    latest.current = id;
    setBusy(true);
    const w = workerRef.current;
    if (w) {
      w.postMessage({ id, props, neighbors });
    } else {
      // inline fallback — cheap, deterministic
      const r = analyzeParcel(props, { neighbors });
      if (id === latest.current) {
        setResult(r);
        setLastRanAt(r.ranAt);
      }
      setBusy(false);
    }
  }, []);

  const clear = useCallback(() => {
    latest.current = ++reqId.current;
    setResult(null);
    setBusy(false);
  }, []);

  return { state, reason, result, busy, lastRanAt, analyze, clear };
}
