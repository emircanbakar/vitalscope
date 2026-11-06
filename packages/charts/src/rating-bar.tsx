import { ChartFrame, Legend, Tooltip, useActiveIndex, useWidth, type LegendItem } from "./frame.js";

/** Bu genişliğin altındaki parçanın içine yüzde yazılmaz; değer ipucunda ve tabloda kalır. */
const MIN_LABEL_WIDTH = 40;

export interface RatingCounts {
  good: number;
  needsImprovement: number;
  poor: number;
}

export interface RatingBarProps {
  title: string;
  counts: RatingCounts;
  /** Yan yana çok çubuk için: başlık gizlenir, gösterge çizilmez; sayfaya bir kez `RatingLegend` konur. */
  compact?: boolean;
}

// Renk körlüğünde yeşil ile kırmızı karışır: desen ve etiket rengin yerini tutar.
const PARTS = [
  { key: "good", label: "Good", color: "var(--vs-good)" },
  { key: "needsImprovement", label: "Needs improvement", color: "var(--vs-needs)", pattern: "rising" },
  { key: "poor", label: "Poor", color: "var(--vs-poor)", pattern: "falling" },
] as const;

/**
 * Yüzdeleri toplamı 100 olacak şekilde yuvarlar (en büyük kalan yöntemi): 97 + 3 + 1 gibi çelişki görünmez.
 * Ölçümü olan parça hiç `0%` görünmez, tek parça olmadıkça hiçbir parça `100%` görünmez.
 */
function roundedPercents(shares: readonly number[]) {
  const exact = shares.map((share) => share * 100);
  const percents = exact.map(Math.floor);
  const missing = 100 - percents.reduce((sum, value) => sum + value, 0);
  const byRemainder = exact.map((value, i) => ({ i, remainder: value - Math.floor(value) })).sort((a, b) => b.remainder - a.remainder);
  for (const { i } of byRemainder.slice(0, missing)) percents[i]!++;
  return percents.map((value, i) => {
    if (exact[i]! < 1) return "<1%";
    return value === 100 && shares.length > 1 ? ">99%" : `${value}%`;
  });
}

const LEGEND: LegendItem[] = PARTS.map(({ label, color, ...rest }) => ({ label, color, mark: "block", ...("pattern" in rest ? { pattern: rest.pattern } : {}) }));

/** Birden çok `compact` çubuğun ortak göstergesi. */
export function RatingLegend() {
  return (
    <div className="vs-chart vs-chart-legend">
      <Legend items={LEGEND} />
    </div>
  );
}

/** Bir bütünün iyi / orta / kötü parçaları. */
export function RatingBar({ title, counts, compact = false }: RatingBarProps) {
  const [ref, width] = useWidth();
  const total = counts.good + counts.needsImprovement + counts.poor;
  const present = total === 0 ? [] : PARTS.filter(({ key }) => counts[key] > 0);
  const percents = roundedPercents(present.map(({ key }) => counts[key] / total));
  const parts = present.map((part, i) => ({ ...part, count: counts[part.key], share: counts[part.key] / total, percent: percents[i]! }));
  const { active, setActive, keyboard } = useActiveIndex(parts.length);

  const frame = {
    title,
    summary: total === 0 ? "No measurements yet." : `${parts.map(({ label, percent }) => `${percent} ${label.toLowerCase()}`).join(", ")}, from ${total} ${total === 1 ? "measurement" : "measurements"}.`,
    legend: total === 0 || compact ? [] : LEGEND,
    hideTitle: compact,
    columns: ["Rating", "Measurements", "Share"],
    rows: () => parts.map(({ label, count, percent }) => [label, String(count), percent]),
  };
  if (total === 0) return <ChartFrame {...frame} />;

  const part = active === null ? undefined : parts[active];
  const before = active === null ? 0 : parts.slice(0, active).reduce((sum, { share }) => sum + share, 0);
  return (
    <ChartFrame {...frame}>
      <div ref={ref} className="vs-rating" role="group" aria-label={`${title}. Use the arrow keys to read values.`} onPointerLeave={() => setActive(null)} {...keyboard}>
        <div className="vs-rating-bar">
          {parts.map(({ key, color, share, percent, ...rest }, i) => (
            <div
              key={key}
              className={`vs-rating-part${"pattern" in rest ? ` vs-pattern-${rest.pattern}` : ""}${key === "needsImprovement" ? " vs-on-light" : ""}${i === active ? " vs-bar-active" : ""}`}
              style={{ flexGrow: share, backgroundColor: color }}
              onPointerEnter={() => setActive(i)}
            >
              {share * width >= MIN_LABEL_WIDTH && <span className="vs-rating-label">{percent}</span>}
            </div>
          ))}
        </div>
        {part && (
          <Tooltip x={(before + part.share / 2) * width} width={width}>
            <div className="vs-tooltip-row">
              <strong>{part.count}</strong> {part.label.toLowerCase()}
            </div>
            <div className="vs-tooltip-title">{part.percent} of measurements</div>
          </Tooltip>
        )}
      </div>
    </ChartFrame>
  );
}
