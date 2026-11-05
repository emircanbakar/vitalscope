import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { TimeSeriesChart } from "../src/index.js";
import { blur, container, focus, key, openTable, query, queryAll, render, resize, texts } from "./helpers.js";

const MINUTE = 60_000;
const START = new Date(2026, 10, 5, 12, 0).getTime();
const x = [START, START + MINUTE, START + 2 * MINUTE];
const ms = (value: number) => `${value} ms`;
const p75 = { name: "p75", values: [100, 300, 200] };
const p95 = { name: "p95", values: [400, 900, 800] };
const plot = () => query(".vs-plot") as HTMLElement;

function hover(clientX: number) {
  act(() => {
    plot().dispatchEvent(new MouseEvent("pointermove", { clientX, bubbles: true }));
  });
}

describe("TimeSeriesChart", () => {
  it("draws one line per series on one axis, with round ticks", () => {
    render(<TimeSeriesChart title="LCP" x={x} series={[p75, p95]} formatValue={ms} />);
    expect(queryAll("path.vs-line")).toHaveLength(2);
    expect(queryAll("path.vs-line")[0]!.getAttribute("stroke")).toBe("var(--vs-series-1)");
    expect(texts("text.vs-axis")).toEqual(expect.arrayContaining(["0 ms", "500 ms", "1000 ms"]));
  });

  it("summarises every series in one sentence", () => {
    render(<TimeSeriesChart title="LCP" x={x} series={[p75]} formatValue={ms} />);
    expect(query(".vs-summary")?.textContent).toBe("Latest of 3 points: p75 is 200 ms (lowest 100 ms, highest 300 ms).");
  });

  it("makes a single measurement visible", () => {
    render(<TimeSeriesChart title="LCP" x={[START]} series={[{ name: "p75", values: [120] }]} formatValue={ms} />);
    expect(query(".vs-summary")?.textContent).toContain("1 point:");
    expect(queryAll("circle.vs-dot")).toHaveLength(1);
    expect(query("circle.vs-dot")?.getAttribute("cx")).not.toBe("NaN");
  });

  it("keeps the value label beside the last point", () => {
    render(<TimeSeriesChart title="LCP" x={[START]} series={[{ name: "p75", values: [120] }]} formatValue={ms} />);
    const dot = Number(query("circle.vs-dot")?.getAttribute("cx"));
    expect(Number(query("text.vs-end-label")?.getAttribute("x"))).toBe(dot + 8);
  });

  it("uses fewer time labels on a narrow chart", () => {
    const hour = Array.from({ length: 61 }, (_, i) => START + i * MINUTE);
    const values = hour.map(() => 1);
    render(<TimeSeriesChart title="LCP" x={hour} series={[{ name: "p75", values }]} />);
    const timeLabels = () => queryAll("text.vs-axis").filter((label) => label.getAttribute("text-anchor") === "middle").length;
    const wide = timeLabels();
    resize(200);
    expect(timeLabels()).toBeLessThan(wide);
    expect(timeLabels()).toBeGreaterThanOrEqual(2);
  });

  it("explains an empty chart and starts measuring when data arrives", () => {
    render(<TimeSeriesChart title="LCP" x={[]} series={[{ name: "p75", values: [] }]} />);
    expect(query(".vs-summary")?.textContent).toBe("No measurements yet.");
    expect(query(".vs-plot")).toBeNull();

    render(<TimeSeriesChart title="LCP" x={x} series={[p75]} />);
    resize(320);
    expect(query("svg")?.getAttribute("width")).toBe("320");
  });

  it("uses a legend only for two or more series", () => {
    render(<TimeSeriesChart title="LCP" x={x} series={[p75]} />);
    expect(query(".vs-legend")).toBeNull();
    render(<TimeSeriesChart title="LCP" x={x} series={[p75, p95]} />);
    expect(texts(".vs-legend li")).toEqual(["p75", "p95"]);
  });

  it("keeps a series colour when the others are filtered out", () => {
    render(<TimeSeriesChart title="LCP" x={x} series={[{ ...p95, slot: 1 }]} />);
    expect(query("path.vs-line")?.getAttribute("stroke")).toBe("var(--vs-series-2)");
  });

  it("drops end labels that would overlap instead of stacking them", () => {
    render(<TimeSeriesChart title="LCP" x={x} series={[p75, { name: "same", values: [1, 2, 201] }, p95]} formatValue={ms} />);
    expect(texts("text.vs-end-label")).toEqual(["200 ms", "800 ms"]);
  });

  it("snaps to the nearest point and lists every series", () => {
    render(<TimeSeriesChart title="LCP" x={x} series={[p75, p95]} formatValue={ms} />);
    vi.spyOn(plot(), "getBoundingClientRect").mockReturnValue({ left: 0 } as DOMRect);
    expect(query(".vs-tooltip")).toBeNull();

    hover(640 / 2);
    expect(query("line.vs-crosshair")).not.toBeNull();
    expect(texts(".vs-tooltip-row")).toEqual(["300 ms p75", "900 ms p95"]);

    act(() => {
      plot().dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }));
    });
    expect(query(".vs-tooltip")).toBeNull();
  });

  it("gives keyboard users the same values", () => {
    render(<TimeSeriesChart title="LCP" x={x} series={[p75]} formatValue={ms} />);
    expect(plot().tabIndex).toBe(0);
    focus(plot());
    expect(texts(".vs-tooltip-row")).toEqual(["200 ms p75"]);
    key(plot(), "ArrowLeft");
    expect(texts(".vs-tooltip-row")).toEqual(["300 ms p75"]);
    key(plot(), "Home");
    key(plot(), "ArrowLeft");
    expect(texts(".vs-tooltip-row")).toEqual(["100 ms p75"]);
    key(plot(), "End");
    key(plot(), "ArrowRight");
    expect(texts(".vs-tooltip-row")).toEqual(["200 ms p75"]);
    key(plot(), "Escape");
    expect(query(".vs-tooltip")).toBeNull();
    key(plot(), "ArrowRight");
    expect(texts(".vs-tooltip-row")).toEqual(["100 ms p75"]);
    key(plot(), "a");
    expect(texts(".vs-tooltip-row")).toEqual(["100 ms p75"]);
    blur(plot());
    expect(query(".vs-tooltip")).toBeNull();
  });

  it("builds the table only when it is opened", () => {
    render(<TimeSeriesChart title="LCP" x={x} series={[p75, p95]} formatValue={ms} />);
    expect(query("table")).toBeNull();
    openTable();
    expect(texts("thead th")).toEqual(["Time", "p75", "p95"]);
    expect(queryAll("tbody tr")).toHaveLength(3);
    expect(texts("tbody tr:first-child td")).toEqual(["100 ms", "400 ms"]);
  });

  it("renders page data as text, not markup", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    render(<TimeSeriesChart title={hostile} x={x} series={[{ name: hostile, values: [1, 2, 3] }, p95]} />);
    expect(query("img")).toBeNull();
    expect(query(".vs-title")?.textContent).toBe(hostile);
    expect(container.textContent).toContain(hostile);
  });

  it("follows the width of its container", () => {
    render(<TimeSeriesChart title="LCP" x={x} series={[p75]} />);
    expect(query("svg")?.getAttribute("width")).toBe("640");
    resize(300);
    expect(query("svg")?.getAttribute("width")).toBe("300");
    resize(0);
    expect(query("svg")?.getAttribute("width")).toBe("300");
  });

  describe("dense series", () => {
    const dense = Array.from({ length: 1001 }, (_, i) => START + i * 1000);
    const values = dense.map((_, i) => i);

    function fakeContext() {
      const context = { scale: vi.fn(), beginPath: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() };
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as ReturnType<HTMLCanvasElement["getContext"]> & null);
      return context;
    }

    it("stays in SVG at the limit", () => {
      fakeContext();
      render(<TimeSeriesChart title="LCP" x={dense.slice(0, 1000)} series={[{ name: "p75", values: values.slice(0, 1000) }]} />);
      expect(query("canvas")).toBeNull();
      expect(queryAll("path.vs-line")).toHaveLength(1);
    });

    it("draws lines on canvas past the limit and keeps the axes in SVG", () => {
      const context = fakeContext();
      render(<TimeSeriesChart title="LCP" x={dense} series={[{ name: "p75", values }]} />);
      expect(query("canvas")).not.toBeNull();
      expect(queryAll("path.vs-line")).toHaveLength(0);
      expect(queryAll("text.vs-axis").length).toBeGreaterThan(0);
      expect(context.lineTo).toHaveBeenCalledTimes(1001);
      expect(context.stroke).toHaveBeenCalledTimes(1);
    });

    it("counts points across all series", () => {
      fakeContext();
      render(<TimeSeriesChart title="LCP" x={dense.slice(0, 501)} series={[{ name: "a", values: values.slice(0, 501) }, { name: "b", values: values.slice(0, 501) }]} />);
      expect(query("canvas")).not.toBeNull();
    });

    it("redraws when the theme changes", async () => {
      const context = fakeContext();
      render(<TimeSeriesChart title="LCP" x={dense} series={[{ name: "p75", values }]} />);
      expect(context.stroke).toHaveBeenCalledTimes(1);
      await act(async () => {
        document.documentElement.dataset.theme = "dark";
        await Promise.resolve();
      });
      delete document.documentElement.dataset.theme;
      expect(context.stroke).toHaveBeenCalledTimes(2);
    });

    it("does not redraw the lines while the pointer moves", () => {
      const context = fakeContext();
      render(<TimeSeriesChart title="LCP" x={dense} series={[{ name: "p75", values }]} />);
      vi.spyOn(plot(), "getBoundingClientRect").mockReturnValue({ left: 0 } as DOMRect);
      hover(200);
      expect(context.stroke).toHaveBeenCalledTimes(1);
    });

    it("survives a browser without canvas support", () => {
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
      render(<TimeSeriesChart title="LCP" x={dense} series={[{ name: "p75", values }]} />);
      expect(query(".vs-summary")?.textContent).toContain("1001 points");
    });
  });
});
