import { useMemo } from "react";
import { ChartFrame, Tooltip, useActiveIndex, useWidth, type LegendItem } from "./frame.js";
import { linear, maxOf, niceTicks, textWidth } from "./scale.js";

const LEFT = 36;
const RIGHT = 12;
const BOTTOM = 24;
const LABEL_ROW = 16;
const MAX_BAR = 24;
const RADIUS = 4;

export interface HistogramBin {
  start: number;
  end: number;
  count: number;
}

export interface HistogramProps {
  title: string;
  /** Eşit genişlikte, artan sıralı aralıklar. */
  bins: readonly HistogramBin[];
  /** Çubuklar bu eşiklere göre iyi / orta / kötü renklenir; aralığa düşen eşik çizgi olarak görünür. */
  thresholds?: { good: number; poor: number };
  percentiles?: readonly { label: string; value: number }[];
  formatValue?: (value: number) => string;
  height?: number;
}

type Rating = "good" | "needs" | "poor";
const STATUS: Record<Rating, { label: string; color: string }> = {
  good: { label: "Good", color: "var(--vs-good)" },
  needs: { label: "Needs improvement", color: "var(--vs-needs)" },
  poor: { label: "Poor", color: "var(--vs-poor)" },
};

/** Aralık orta noktasına göre: eşiğe denk gelen aralıklar doğru görünsün diye eşikler aralık sınırına konmalı. */
function ratingOf({ start, end }: HistogramBin, { good, poor }: { good: number; poor: number }): Rating {
  const middle = (start + end) / 2;
  if (middle <= good) return "good";
  return middle <= poor ? "needs" : "poor";
}

/** Düz tabanlı, üstü yuvarlak çubuk. */
function barPath(x: number, y: number, width: number, base: number) {
  const r = Math.min(RADIUS, width / 2, base - y);
  return `M${x} ${base}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + width - r}Q${x + width} ${y} ${x + width} ${y + r}V${base}Z`;
}

function summarize(bins: readonly HistogramBin[], thresholds: HistogramProps["thresholds"], format: (value: number) => string) {
  const total = bins.reduce((sum, bin) => sum + bin.count, 0);
  if (total === 0) return "No measurements yet.";
  const peak = bins.reduce((best, bin) => (bin.count > best.count ? bin : best));
  const range = `Most fall between ${format(peak.start)} and ${format(peak.end)}`;
  const counted = `${total} ${total === 1 ? "measurement" : "measurements"}`;
  if (!thresholds) return `${counted}. ${range}.`;
  const good = bins.filter((bin) => ratingOf(bin, thresholds) === "good").reduce((sum, bin) => sum + bin.count, 0);
  return `${counted}, ${Math.round((good / total) * 100)}% good. ${range}.`;
}

/** Eşik ve yüzdelik çizgileri. Etiketleri yakınsa alt alta dizilir, sıra sayısına göre grafiğin üstünde yer açılır. */
function placeMarkers(markers: readonly { label: string; value: number; kind: string }[], sx: (v: number) => number, width: number) {
  const rowEnds: number[] = [];
  const placed = [...markers]
    .sort((a, b) => a.value - b.value)
    .map((marker) => {
      const x = sx(marker.value);
      const labelWidth = textWidth(marker.label) + 8;
      // Sağda yer yoksa etiket çizginin soluna geçer; kesilmez.
      const flip = x + labelWidth > width;
      let row = rowEnds.findIndex((end) => end < (flip ? x - labelWidth : x));
      if (row === -1) row = rowEnds.length;
      rowEnds[row] = flip ? x : x + labelWidth;
      return { ...marker, x, row, flip };
    });
  return { placed, rows: rowEnds.length };
}

export function Histogram({ title, bins, thresholds, percentiles = [], formatValue = String, height = 240 }: HistogramProps) {
  const [ref, width] = useWidth();
  const { active, setActive, keyboard } = useActiveIndex(bins.length);

  const chart = useMemo(() => {
    if (bins.length === 0) return undefined;
    const min = bins[0]!.start;
    const max = bins.at(-1)!.end;
    const sx = linear([min, max], [LEFT, width - RIGHT]);
    const lines = [
      ...(thresholds
        ? [
            { label: `Good up to ${formatValue(thresholds.good)}`, value: thresholds.good, kind: "threshold" },
            { label: `Poor above ${formatValue(thresholds.poor)}`, value: thresholds.poor, kind: "threshold" },
          ]
        : []),
      ...percentiles.map(({ label, value }) => ({ label: `${label} ${formatValue(value)}`, value, kind: "percentile" })),
    ].filter(({ value }) => value >= min && value <= max);
    const { placed, rows } = placeMarkers(lines, sx, width);
    const top = 8 + rows * LABEL_ROW;
    // Sayım eksenlerinde kesirli etiket anlamsız.
    const yTicks = niceTicks(maxOf(bins.map((bin) => bin.count))).filter((tick) => Number.isInteger(tick));
    const sy = linear([0, yTicks.at(-1)!], [height - BOTTOM, top]);
    const xTicks = niceTicks(max, 5).filter((tick) => tick >= min && tick <= max);
    return { sx, sy, yTicks, xTicks, placed, top };
  }, [bins, thresholds, percentiles, width, height, formatValue]);

  const legend: LegendItem[] = thresholds ? (["good", "needs", "poor"] as const).map((rating) => ({ ...STATUS[rating], mark: "block" })) : [];
  const frame = {
    title,
    summary: summarize(bins, thresholds, formatValue),
    legend,
    columns: ["Range", "Measurements", ...(thresholds ? ["Rating"] : [])],
    rows: () =>
      bins.map((bin) => [`${formatValue(bin.start)} – ${formatValue(bin.end)}`, String(bin.count), ...(thresholds ? [STATUS[ratingOf(bin, thresholds)].label] : [])]),
  };
  if (!chart) return <ChartFrame {...frame} />;

  const { sx, sy, yTicks, xTicks, placed, top } = chart;
  const base = sy(0);
  const slot = sx(bins[0]!.end) - sx(bins[0]!.start);
  const barWidth = Math.max(1, Math.min(MAX_BAR, slot - 2));
  const activeBin = active === null ? undefined : bins[active];

  return (
    <ChartFrame {...frame}>
      <div ref={ref} className="vs-plot" style={{ height }} role="group" aria-label={`${title}. Use the arrow keys to read values.`} onPointerLeave={() => setActive(null)} {...keyboard}>
        <svg width={width} height={height} aria-hidden="true">
          {yTicks.map((tick) => (
            <g key={tick}>
              <line className={tick === 0 ? "vs-baseline" : "vs-grid"} x1={LEFT} x2={width - RIGHT} y1={sy(tick)} y2={sy(tick)} />
              <text className="vs-axis" x={LEFT - 8} y={sy(tick)} dy="0.32em" textAnchor="end">
                {tick}
              </text>
            </g>
          ))}
          {xTicks.map((tick) => (
            <text key={tick} className="vs-axis" x={sx(tick)} y={base + 16} textAnchor={sx(tick) + textWidth(formatValue(tick)) / 2 > width ? "end" : "middle"}>
              {formatValue(tick)}
            </text>
          ))}
          {bins.map((bin, i) => {
            const middle = sx((bin.start + bin.end) / 2);
            const fill = thresholds ? STATUS[ratingOf(bin, thresholds)].color : "var(--vs-series-1)";
            return (
              <g key={bin.start} onPointerEnter={() => setActive(i)}>
                <rect className="vs-hit" x={middle - slot / 2} y={top} width={slot} height={base - top} />
                {bin.count > 0 && <path className={i === active ? "vs-bar vs-bar-active" : "vs-bar"} d={barPath(middle - barWidth / 2, sy(bin.count), barWidth, base)} fill={fill} />}
              </g>
            );
          })}
          {placed.map(({ label, x, row, kind, flip }) => (
            <g key={label}>
              <line className={`vs-marker vs-marker-${kind}`} x1={x} x2={x} y1={4 + row * LABEL_ROW} y2={base} />
              <text className="vs-marker-label" x={flip ? x - 4 : x + 4} y={14 + row * LABEL_ROW} textAnchor={flip ? "end" : "start"}>
                {label}
              </text>
            </g>
          ))}
        </svg>
        {activeBin && (
          <Tooltip x={sx((activeBin.start + activeBin.end) / 2)} width={width}>
            <div className="vs-tooltip-row">
              <strong>{activeBin.count}</strong> measurements
            </div>
            <div className="vs-tooltip-title">
              {formatValue(activeBin.start)} – {formatValue(activeBin.end)}
              {thresholds && `, ${STATUS[ratingOf(activeBin, thresholds)].label}`}
            </div>
          </Tooltip>
        )}
      </div>
    </ChartFrame>
  );
}
