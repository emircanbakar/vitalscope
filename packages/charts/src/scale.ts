const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const TIME_STEPS = [1000, 5000, 15_000, 30_000, MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 30 * DAY];

/** Tek değerli aralık (tek ölçüm) çizim alanının ortasına düşer. */
export function linear([d0, d1]: readonly [number, number], [r0, r1]: readonly [number, number]) {
  if (d0 === d1) return () => (r0 + r1) / 2;
  const ratio = (r1 - r0) / (d1 - d0);
  return (value: number) => r0 + (value - d0) * ratio;
}

/** 0'dan başlayan, 1 / 2 / 5 adımlı eksen değerleri; son değer `max`'ı kapsar. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const rough = max / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const multiple = [1, 2, 5, 10].find((m) => m * power >= rough)!;
  const step = multiple * power;
  const ticks: number[] = [];
  // Ondalık adımlarda birikmeli kayan nokta hatası etikete yansımasın.
  for (let i = 0; ; i++) {
    const tick = Number((i * step).toPrecision(12));
    ticks.push(tick);
    if (tick >= max) return ticks;
  }
}

/** Yerel saate hizalı zaman etiketleri ve adıma uygun biçim. */
export function timeTicks(min: number, max: number, count = 5): { ticks: number[]; format: (time: number) => string } {
  const span = max - min;
  const step = TIME_STEPS.find((s) => s * count >= span) ?? TIME_STEPS.at(-1)!;
  const offset = new Date(min).getTimezoneOffset() * MINUTE;
  const ticks: number[] = [];
  for (let t = Math.ceil((min - offset) / step) * step + offset; t <= max; t += step) ticks.push(t);
  if (ticks.length === 0) ticks.push(min);

  const options: Intl.DateTimeFormatOptions =
    step < MINUTE ? { hour: "2-digit", minute: "2-digit", second: "2-digit" } : step < DAY ? { hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric" };
  const formatter = new Intl.DateTimeFormat(undefined, options);
  return { ticks, format: (time) => formatter.format(time) };
}

export function formatTime(time: number) {
  return new Date(time).toLocaleString();
}

/** Sıralı dizide `value`'ya en yakın öğenin sırası. */
export function nearestIndex(sorted: readonly number[], value: number) {
  let low = 0;
  let high = sorted.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (sorted[mid]! < value) low = mid;
    else high = mid;
  }
  return value - sorted[low]! <= sorted[high]! - value ? low : high;
}

export function maxOf(values: readonly number[]) {
  let max = -Infinity;
  for (const value of values) if (value > max) max = value;
  return max;
}

export function minOf(values: readonly number[]) {
  let min = Infinity;
  for (const value of values) if (value < min) min = value;
  return min;
}

/** Ölçülmeden, etiket genişliğine yer ayırmak için yaklaşık değer (12px sistem yazı tipi). */
export function textWidth(text: string) {
  return text.length * 6.5;
}
