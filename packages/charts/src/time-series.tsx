import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { ChartFrame, Tooltip, useActiveIndex, useWidth } from "./frame.js";
import { formatTime, linear, maxOf, minOf, nearestIndex, niceTicks, textWidth, timeTicks } from "./scale.js";

/** Bu kadar noktadan sonra çizgiler Canvas'a geçer; eksenler ve etkileşim SVG'de kalır. */
const SVG_POINT_LIMIT = 1000;
const TOP = 12;
const BOTTOM = 24;
const LABEL_GAP = 14;

export interface Series {
  name: string;
  /** `x` ile aynı uzunlukta. */
  values: readonly number[];
  /** Renk sırası (en fazla 8). Veri süzülünce renk değişmesin diye seriye sabitlenebilir; varsayılan dizideki yeri. */
  slot?: number;
}

export interface TimeSeriesChartProps {
  title: string;
  /** Artan sıralı zamanlar (epoch ms). */
  x: readonly number[];
  series: readonly Series[];
  formatValue?: (value: number) => string;
  /** Eksen bandı dahil yükseklik. */
  height?: number;
}

const seriesColor = (slot: number) => `var(--vs-series-${slot + 1})`;

function linePath(x: readonly number[], values: readonly number[], sx: (v: number) => number, sy: (v: number) => number) {
  return x.map((time, i) => `${i === 0 ? "M" : "L"}${sx(time).toFixed(1)} ${sy(values[i]!).toFixed(1)}`).join("");
}

function summarize(x: readonly number[], series: readonly Series[], format: (value: number) => string) {
  if (x.length === 0) return "No measurements yet.";
  const parts = series.map(({ name, values }) => `${name} is ${format(values.at(-1)!)} (lowest ${format(minOf(values))}, highest ${format(maxOf(values))})`);
  return `Latest of ${x.length} ${x.length === 1 ? "point" : "points"}: ${parts.join("; ")}.`;
}

/** `data-theme` değişimi tepkisel değil: Canvas renkleri CSS'ten okuduğu için temada yeniden çizilmeli. */
function useThemeVersion() {
  const [version, setVersion] = useState(0);
  useLayoutEffect(() => {
    const update = () => setVersion((v) => v + 1);
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      media.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);
  return version;
}

interface LinesProps {
  x: readonly number[];
  series: readonly Series[];
  slots: readonly number[];
  sx: (value: number) => number;
  sy: (value: number) => number;
  width: number;
  height: number;
}

function CanvasLines({ x, series, slots, sx, sy, width, height }: LinesProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useThemeVersion();
  useLayoutEffect(() => {
    const canvas = ref.current!;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = devicePixelRatio;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.scale(ratio, ratio);
    context.lineWidth = 2;
    context.lineJoin = "round";
    context.lineCap = "round";
    const styles = getComputedStyle(canvas);
    series.forEach(({ values }, s) => {
      context.strokeStyle = styles.getPropertyValue(`--vs-series-${slots[s]! + 1}`);
      context.beginPath();
      for (let i = 0; i < x.length; i++) context.lineTo(sx(x[i]!), sy(values[i]!));
      context.stroke();
    });
  }, [x, series, slots, sx, sy, width, height, theme]);
  return <canvas ref={ref} className="vs-canvas" style={{ width, height }} aria-hidden="true" />;
}

/** Çizgi grafik. Tek eksen; ölçekleri farklı değerler aynı grafiğe konmaz. */
export function TimeSeriesChart({ title, x, series, formatValue = String, height = 240 }: TimeSeriesChartProps) {
  const [ref, width] = useWidth();
  const { active, setActive, keyboard } = useActiveIndex(x.length);
  const slots = useMemo(() => series.map((s, i) => s.slot ?? i), [series]);

  const scales = useMemo(() => {
    if (x.length === 0) return undefined;
    const yTicks = niceTicks(maxOf(series.map((s) => maxOf(s.values))));
    const left = Math.max(...yTicks.map((tick) => textWidth(formatValue(tick)))) + 12;
    const lastLabels = series.map((s) => formatValue(s.values.at(-1)!));
    const right = Math.max(...lastLabels.map(textWidth)) + 16;
    const sx = linear([x[0]!, x.at(-1)!], [left, width - right]);
    const sy = linear([0, yTicks.at(-1)!], [height - BOTTOM, TOP]);
    // Sona yakın seriler üst üste binerse etiket düşer; değer göstergede, ipucunda ve tabloda kalır.
    const kept: { y: number; label: string }[] = [];
    series.forEach((s, i) => {
      const y = sy(s.values.at(-1)!);
      if (kept.every((other) => Math.abs(other.y - y) >= LABEL_GAP)) kept.push({ y, label: lastLabels[i]! });
    });
    // Dar ekranda etiketler çakışmasın; saniyeli saat etiketi yaklaşık 60px.
    const tickCount = Math.max(2, Math.floor((width - left - right) / 80));
    return { sx, sy, yTicks, left, right, endLabels: kept, time: timeTicks(x[0]!, x.at(-1)!, tickCount) };
  }, [x, series, width, height, formatValue]);

  const useCanvas = x.length * series.length > SVG_POINT_LIMIT;

  // Fare hareketinde yeniden hesaplanmaz: seçili nokta değişince sadece üstteki katman değişir.
  const marks = useMemo(() => {
    if (!scales) return null;
    const { sx, sy, yTicks, left, right, endLabels, time } = scales;
    const baseline = sy(0);
    return (
      <>
        {yTicks.map((tick) => (
          <g key={tick}>
            <line className={tick === 0 ? "vs-baseline" : "vs-grid"} x1={left} x2={width - right} y1={sy(tick)} y2={sy(tick)} />
            <text className="vs-axis" x={left - 8} y={sy(tick)} dy="0.32em" textAnchor="end">
              {formatValue(tick)}
            </text>
          </g>
        ))}
        {time.ticks.map((tick) => (
          <text key={tick} className="vs-axis" x={sx(tick)} y={baseline + 16} textAnchor="middle">
            {time.format(tick)}
          </text>
        ))}
        {!useCanvas &&
          series.map((s, i) => <path key={s.name} className="vs-line" d={linePath(x, s.values, sx, sy)} stroke={seriesColor(slots[i]!)} />)}
        {series.map((s, i) => (
          <circle key={s.name} className="vs-dot" cx={sx(x.at(-1)!)} cy={sy(s.values.at(-1)!)} r={4} fill={seriesColor(slots[i]!)} />
        ))}
        {endLabels.map(({ y, label }) => (
          <text key={label} className="vs-end-label" x={sx(x.at(-1)!) + 8} y={y} dy="0.32em">
            {label}
          </text>
        ))}
      </>
    );
  }, [scales, series, slots, x, width, formatValue, useCanvas]);

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!scales) return;
    const left = event.currentTarget.getBoundingClientRect().left;
    const pointer = event.clientX - left;
    const time = x[0]! + ((pointer - scales.left) / Math.max(1, width - scales.left - scales.right)) * (x.at(-1)! - x[0]!);
    setActive(nearestIndex(x, time));
  }

  const frame = {
    title,
    summary: summarize(x, series, formatValue),
    legend: series.length > 1 ? series.map((s, i) => ({ label: s.name, mark: "line" as const, color: seriesColor(slots[i]!) })) : [],
    columns: ["Time", ...series.map((s) => s.name)],
    rows: () => x.map((time, i) => [formatTime(time), ...series.map((s) => formatValue(s.values[i]!))]),
  };
  if (!scales) return <ChartFrame {...frame} />;

  const activeX = active === null ? undefined : scales.sx(x[active]!);
  return (
    <ChartFrame {...frame}>
      <div
        ref={ref}
        className="vs-plot"
        style={{ height }}
        role="group"
        aria-label={`${title}. Use the arrow keys to read values.`}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setActive(null)}
        {...keyboard}
      >
        {useCanvas && <CanvasLines x={x} series={series} slots={slots} sx={scales.sx} sy={scales.sy} width={width} height={height} />}
        <svg width={width} height={height} aria-hidden="true">
          {marks}
          {activeX !== undefined && (
            <>
              <line className="vs-crosshair" x1={activeX} x2={activeX} y1={TOP} y2={height - BOTTOM} />
              {series.map((s, i) => (
                <circle key={s.name} className="vs-dot" cx={activeX} cy={scales.sy(s.values[active!]!)} r={4} fill={seriesColor(slots[i]!)} />
              ))}
            </>
          )}
        </svg>
        {activeX !== undefined && (
          <Tooltip x={activeX} width={width}>
            <div className="vs-tooltip-title">{formatTime(x[active!]!)}</div>
            {series.map((s, i) => (
              <div key={s.name} className="vs-tooltip-row">
                <span className="vs-key vs-key-line" style={{ backgroundColor: seriesColor(slots[i]!) }} />
                <strong>{formatValue(s.values[active!]!)}</strong> {s.name}
              </div>
            ))}
          </Tooltip>
        )}
      </div>
    </ChartFrame>
  );
}
