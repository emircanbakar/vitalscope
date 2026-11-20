import type { MetricName } from "@vitalscope/protocol";

/** Bundan az ölçümle "yavaşladı" denmez: birkaç sayfa yüklemesinin farkı çoğunlukla gürültüdür. */
export const MIN_SAMPLES = 5;
/** Bu oranın altındaki fark "aynı" sayılır. */
const SAME_RATIO = 0.05;
/** Küçük değerlerde oran yanıltır: 9 ms'den 4 ms'ye düşmek %57 görünür ama yerel ölçümde gürültüdür. */
const MIN_TIME_DIFFERENCE = 20;
const MIN_CLS_DIFFERENCE = 0.01;

export interface Measured {
  value: number | null;
  count: number;
}

export type Change =
  | { kind: "no-data" }
  | { kind: "too-few" }
  | { kind: "same" }
  | { kind: "worse" | "better"; difference: number; /** Sonsuz olabilir (önceki değer 0). */ ratio: number };

/** Panelin release karşılaştırması ve `vitalscope run` aynı kuralla hüküm verir. */
export function compareMeasured(name: MetricName, a: Measured, b: Measured): Change {
  if (a.value === null || b.value === null) return { kind: "no-data" };
  if (a.count < MIN_SAMPLES || b.count < MIN_SAMPLES) return { kind: "too-few" };
  const difference = b.value - a.value;
  const ratio = a.value === 0 ? (difference === 0 ? 0 : Infinity) : Math.abs(difference) / a.value;
  if (ratio < SAME_RATIO || Math.abs(difference) < (name === "CLS" ? MIN_CLS_DIFFERENCE : MIN_TIME_DIFFERENCE)) return { kind: "same" };
  return { kind: difference > 0 ? "worse" : "better", difference, ratio };
}
