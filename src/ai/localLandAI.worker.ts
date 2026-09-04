/// <reference lib="webworker" />
import { analyzeParcel } from "./analyze";
import type { ParcelProperties } from "../types";

interface Req {
  id: number;
  props: ParcelProperties;
  neighbors?: ParcelProperties[];
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, props, neighbors } = e.data;
  try {
    const result = analyzeParcel(props, { neighbors });
    (self as unknown as Worker).postMessage({ id, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
