import { act } from "react";
import { describe, expect, it } from "vitest";
import { Histogram } from "../src/index.js";
import { focus, key, openTable, query, queryAll, render, texts } from "./helpers.js";

const bins = [
  { start: 0, end: 1000, count: 3 },
  { start: 1000, end: 2000, count: 9 },
  { start: 2000, end: 3000, count: 0 },
  { start: 3000, end: 4000, count: 2 },
  { start: 4000, end: 5000, count: 1 },
];
const thresholds = { good: 2000, poor: 4000 };
const ms = (value: number) => `${value} ms`;

describe("Histogram", () => {
  it("draws a bar for each bin that has measurements", () => {
    render(<Histogram title="LCP" bins={bins} />);
    expect(queryAll("path.vs-bar")).toHaveLength(4);
    expect(queryAll("rect.vs-hit")).toHaveLength(5);
    expect(query("path.vs-bar")?.getAttribute("fill")).toBe("var(--vs-series-1)");
  });

  it("caps bars at 24px and rounds only their top", () => {
    render(<Histogram title="LCP" bins={bins} />);
    const path = query("path.vs-bar")!.getAttribute("d")!;
    const [, x, base] = /^M([\d.]+) ([\d.]+)V/.exec(path)!;
    expect(path.endsWith(`V${base}Z`)).toBe(true);
    const right = /H([\d.]+)Q/.exec(path)!;
    expect(Number(right[1]) + 4 - Number(x)).toBeCloseTo(24);
  });

  it("colours bars by rating when thresholds are given, and labels the colours", () => {
    render(<Histogram title="LCP" bins={bins} thresholds={thresholds} formatValue={ms} />);
    expect(queryAll("path.vs-bar").map((bar) => bar.getAttribute("fill"))).toEqual(["var(--vs-good)", "var(--vs-good)", "var(--vs-needs)", "var(--vs-poor)"]);
    expect(texts(".vs-legend li")).toEqual(["Good", "Needs improvement", "Poor"]);
    expect(texts("text.vs-marker-label")).toEqual(["Good up to 2000 ms", "Poor above 4000 ms"]);
  });

  it("has no legend for a single colour", () => {
    render(<Histogram title="LCP" bins={bins} />);
    expect(query(".vs-legend")).toBeNull();
  });

  it("marks percentiles and separates close labels into rows", () => {
    render(<Histogram title="LCP" bins={bins} percentiles={[{ label: "p75", value: 1500 }, { label: "p95", value: 1550 }]} formatValue={ms} />);
    const labels = queryAll("text.vs-marker-label");
    expect(labels.map((label) => label.textContent)).toEqual(["p75 1500 ms", "p95 1550 ms"]);
    expect(labels[0]!.getAttribute("y")).not.toBe(labels[1]!.getAttribute("y"));
    expect(queryAll("line.vs-marker-percentile")).toHaveLength(2);
  });

  it("leaves out markers outside the range", () => {
    render(<Histogram title="LCP" bins={bins.slice(0, 2)} thresholds={{ good: 1500, poor: 9000 }} percentiles={[{ label: "p99", value: 8000 }]} formatValue={ms} />);
    expect(texts("text.vs-marker-label")).toEqual(["Good up to 1500 ms"]);
  });

  it("keeps labels at the right edge inside the chart", () => {
    render(<Histogram title="LCP" bins={bins} percentiles={[{ label: "a long label for the edge", value: 4900 }]} formatValue={ms} />);
    expect(query("text.vs-marker-label")?.getAttribute("text-anchor")).toBe("end");
    const axis = queryAll("text.vs-axis").find((label) => label.textContent === "5000 ms");
    expect(axis?.getAttribute("text-anchor")).toBe("end");
    expect(queryAll("text.vs-axis").find((label) => label.textContent === "0 ms")?.getAttribute("text-anchor")).toBe("middle");
  });

  it("only shows whole numbers on the count axis", () => {
    render(<Histogram title="LCP" bins={[{ start: 0, end: 1, count: 1 }]} />);
    const counts = queryAll("line.vs-grid, line.vs-baseline").length;
    expect(counts).toBe(2);
  });

  it("summarises the distribution", () => {
    render(<Histogram title="LCP" bins={bins} thresholds={thresholds} formatValue={ms} />);
    expect(query(".vs-summary")?.textContent).toBe("15 measurements, 80% good. Most fall between 1000 ms and 2000 ms.");
    render(<Histogram title="LCP" bins={[{ start: 0, end: 1, count: 1 }]} formatValue={ms} />);
    expect(query(".vs-summary")?.textContent).toBe("1 measurement. Most fall between 0 ms and 1 ms.");
  });

  it("explains empty data", () => {
    render(<Histogram title="LCP" bins={[]} />);
    expect(query(".vs-summary")?.textContent).toBe("No measurements yet.");
    expect(query(".vs-plot")).toBeNull();
    render(<Histogram title="LCP" bins={[{ start: 0, end: 1, count: 0 }]} />);
    expect(query(".vs-summary")?.textContent).toBe("No measurements yet.");
  });

  it("shows the bin under the pointer, on a target larger than the bar", () => {
    render(<Histogram title="LCP" bins={bins} formatValue={ms} />);
    act(() => {
      queryAll("rect.vs-hit")[2]!.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    expect(texts(".vs-tooltip-title")).toEqual(["2000 ms – 3000 ms"]);
    expect(texts(".vs-tooltip-row")).toEqual(["0 measurements"]);
    act(() => {
      query(".vs-plot")!.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }));
    });
    expect(query(".vs-tooltip")).toBeNull();
  });

  it("gives keyboard users the same values and highlights the bar", () => {
    render(<Histogram title="LCP" bins={bins} thresholds={thresholds} formatValue={ms} />);
    focus(query(".vs-plot") as HTMLElement);
    expect(texts(".vs-tooltip-title")).toEqual(["4000 ms – 5000 ms, Poor"]);
    key(query(".vs-plot")!, "Home");
    expect(texts(".vs-tooltip-title")).toEqual(["0 ms – 1000 ms, Good"]);
    expect(queryAll("path.vs-bar-active")).toHaveLength(1);
  });

  it("has a table with the same values", () => {
    render(<Histogram title="LCP" bins={bins} thresholds={thresholds} formatValue={ms} />);
    openTable();
    expect(texts("thead th")).toEqual(["Range", "Measurements", "Rating"]);
    expect(texts("tbody tr:nth-child(2) > *")).toEqual(["1000 ms – 2000 ms", "9", "Good"]);
    render(<Histogram title="LCP" bins={bins} />);
    expect(texts("thead th")).toEqual(["Range", "Measurements"]);
  });
});
