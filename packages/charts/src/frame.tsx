import { useLayoutEffect, useState, type KeyboardEvent, type ReactNode } from "react";

const DEFAULT_WIDTH = 640;

/**
 * Grafik kabının genişliği; boyut değişince yeniden çizilir.
 * Boş grafikte kap yoktur, veri gelince oluşur: bu yüzden ref değil, öğeye bağlı state.
 */
export function useWidth(): [(element: HTMLDivElement | null) => void, number] {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useLayoutEffect(() => {
    if (!element) return;
    if (element.clientWidth > 0) setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, width];
}

/** Fare ve klavye aynı seçili noktayı kullanır: üzerine gelmekle odaklanmak aynı bilgiyi gösterir. */
export function useActiveIndex(count: number) {
  const [selected, setActive] = useState<number | null>(null);
  // Veri yenilenip küçülürse seçili nokta dizinin dışında kalabilir.
  const active = selected !== null && selected < count ? selected : null;

  function onKeyDown(event: KeyboardEvent) {
    const last = count - 1;
    const moves: Record<string, number> = {
      ArrowRight: Math.min(last, (active ?? -1) + 1),
      ArrowLeft: Math.max(0, (active ?? count) - 1),
      Home: 0,
      End: last,
    };
    const next = moves[event.key];
    if (event.key === "Escape") setActive(null);
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
  }

  return {
    active,
    setActive,
    keyboard: {
      tabIndex: 0,
      onKeyDown,
      onFocus: () => setActive((current) => current ?? count - 1),
      onBlur: () => setActive(null),
    },
  };
}

export function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const side = x > width / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)";
  return (
    <div className="vs-tooltip" role="status" style={{ left: x, transform: side }}>
      {children}
    </div>
  );
}

export interface LegendItem {
  label: string;
  /** Gösterge işareti grafikteki işaretle aynı biçimde olur. */
  mark: "line" | "block";
  color: string;
  pattern?: "rising" | "falling";
}

export function Legend({ items }: { items: readonly LegendItem[] }) {
  return (
    <ul className="vs-legend">
      {items.map(({ label, mark, color, pattern }) => (
        <li key={label}>
          <span className={`vs-key vs-key-${mark}${pattern ? ` vs-pattern-${pattern}` : ""}`} style={{ backgroundColor: color }} />
          {label}
        </li>
      ))}
    </ul>
  );
}

interface ChartFrameProps {
  title: string;
  /** Grafiğin tek cümlelik özeti; ekran okuyucu grafiği bu metinle tanır. */
  summary: string;
  legend?: readonly LegendItem[];
  columns: readonly string[];
  /** Tablo açılmadan hesaplanmaz: yoğun serilerde binlerce satır olabilir. */
  rows: () => readonly (readonly string[])[];
  /** Kart içinde: başlık sadece ekran okuyucuya. */
  hideTitle?: boolean;
  children?: ReactNode;
}

/** Her grafiğin ortak kabı: başlık, özet, gösterge ve aynı değerleri veren açılır tablo. */
export function ChartFrame({ title, summary, legend, columns, rows, hideTitle = false, children }: ChartFrameProps) {
  const [open, setOpen] = useState(false);
  return (
    <figure className="vs-chart">
      <figcaption>
        <strong className={hideTitle ? "vs-title vs-sr-only" : "vs-title"}>{title}</strong>
        <p className="vs-summary">{summary}</p>
      </figcaption>
      {legend && legend.length > 0 && <Legend items={legend} />}
      {children}
      <details className="vs-table" onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>Show as table</summary>
        {open && (
          <table>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows().map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{cell}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>
    </figure>
  );
}
