import { useCallback, useEffect, useRef, useState } from "react";
import { SYNC_INTERVAL_MS } from "../config";
import type { TwinEvent } from "../types";

/**
 * Controlled real-time loop for the Land Twin. This is a *cadence*, not a
 * data faker: it emits a heartbeat on a fixed interval and collects real
 * events the app produces (selection, analysis, detections). The underlying
 * land data is still whatever the provider stack resolved (demo here) — the
 * loop only keeps the twin state and the event feed current.
 */
const MAX_EVENTS = 60;

export interface LandTwinSync {
  events: TwinEvent[];
  lastSyncTs: number;
  /** increments each cycle — use as a dependency to re-run periodic work */
  tick: number;
  pushEvent: (kind: TwinEvent["kind"], text: string) => void;
}

export function useLandTwinSync(enabled: boolean): LandTwinSync {
  const [events, setEvents] = useState<TwinEvent[]>([]);
  const [lastSyncTs, setLastSyncTs] = useState<number>(Date.now());
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  const pushEvent = useCallback((kind: TwinEvent["kind"], text: string) => {
    setEvents((prev) => {
      const ev: TwinEvent = { id: `e${++seq.current}`, ts: Date.now(), kind, text };
      return [ev, ...prev].slice(0, MAX_EVENTS);
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    pushEvent("data", "Land Twin session started");
    const iv = window.setInterval(() => {
      setTick((t) => t + 1);
      setLastSyncTs(Date.now());
      pushEvent("sync", "Land Twin state synchronised");
    }, SYNC_INTERVAL_MS);
    return () => window.clearInterval(iv);
  }, [enabled, pushEvent]);

  return { events, lastSyncTs, tick, pushEvent };
}
