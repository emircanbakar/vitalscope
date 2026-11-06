import { act } from "react";
import { describe, expect, it } from "vitest";
import { RatingBar } from "../src/index.js";
import { focus, key, openTable, query, queryAll, render, resize, texts } from "./helpers.js";

const counts = { good: 62, needsImprovement: 25, poor: 13 };
const parts = () => queryAll(".vs-rating-part") as HTMLElement[];

describe("RatingBar", () => {
  it("splits the bar by share", () => {
    render(<RatingBar title="LCP" counts={counts} />);
    expect(parts().map((part) => part.style.flexGrow)).toEqual(["0.62", "0.25", "0.13"]);
    expect(texts(".vs-rating-label")).toEqual(["62%", "25%", "13%"]);
  });

  it("carries the rating in pattern and label as well as colour", () => {
    render(<RatingBar title="LCP" counts={counts} />);
    expect(parts()[1]!.classList.contains("vs-pattern-rising")).toBe(true);
    expect(parts()[2]!.classList.contains("vs-pattern-falling")).toBe(true);
    expect(texts(".vs-legend li")).toEqual(["Good", "Needs improvement", "Poor"]);
    expect(query(".vs-legend .vs-pattern-falling")).not.toBeNull();
  });

  it("uses dark text on the yellow part", () => {
    render(<RatingBar title="LCP" counts={counts} />);
    expect(parts().map((part) => part.classList.contains("vs-on-light"))).toEqual([false, true, false]);
  });

  it("draws nothing for a rating with no measurements", () => {
    render(<RatingBar title="LCP" counts={{ good: 5, needsImprovement: 0, poor: 5 }} />);
    expect(parts()).toHaveLength(2);
    expect(query(".vs-legend")).not.toBeNull();
  });

  it("does not print a label that would not fit", () => {
    render(<RatingBar title="LCP" counts={{ good: 97, needsImprovement: 2, poor: 1 }} />);
    expect(texts(".vs-rating-label")).toEqual(["97%"]);
    resize(4000);
    expect(texts(".vs-rating-label")).toEqual(["97%", "2%", "1%"]);
  });

  it("summarises in one sentence", () => {
    render(<RatingBar title="LCP" counts={counts} />);
    expect(query(".vs-summary")?.textContent).toBe("62% good, 25% needs improvement, 13% poor, from 100 measurements.");
    render(<RatingBar title="LCP" counts={{ good: 1, needsImprovement: 0, poor: 0 }} />);
    expect(query(".vs-summary")?.textContent).toBe("100% good, from 1 measurement.");
  });

  it("shows shares that add up to 100", () => {
    render(<RatingBar title="LCP" counts={{ good: 970, needsImprovement: 25, poor: 5 }} />);
    expect(query(".vs-summary")?.textContent).toBe("97% good, 3% needs improvement, <1% poor, from 1000 measurements.");
    render(<RatingBar title="LCP" counts={{ good: 1, needsImprovement: 1, poor: 1 }} />);
    expect(query(".vs-summary")?.textContent).toBe("34% good, 33% needs improvement, 33% poor, from 3 measurements.");
  });

  it("never rounds a rating with measurements away", () => {
    render(<RatingBar title="LCP" counts={{ good: 996, needsImprovement: 3, poor: 1 }} />);
    expect(query(".vs-summary")?.textContent).toBe(">99% good, <1% needs improvement, <1% poor, from 1000 measurements.");
  });

  it("explains empty data", () => {
    render(<RatingBar title="LCP" counts={{ good: 0, needsImprovement: 0, poor: 0 }} />);
    expect(query(".vs-summary")?.textContent).toBe("No measurements yet.");
    expect(query(".vs-rating")).toBeNull();
    expect(query(".vs-legend")).toBeNull();
  });

  it("shows amount and share on hover and keyboard focus", () => {
    render(<RatingBar title="LCP" counts={counts} />);
    act(() => {
      parts()[1]!.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    expect(texts(".vs-tooltip-row")).toEqual(["25 needs improvement"]);
    expect(texts(".vs-tooltip-title")).toEqual(["25% of measurements"]);
    act(() => {
      query(".vs-rating")!.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }));
    });
    expect(query(".vs-tooltip")).toBeNull();

    focus(query(".vs-rating") as HTMLElement);
    expect(texts(".vs-tooltip-row")).toEqual(["13 poor"]);
    key(query(".vs-rating")!, "Home");
    expect(texts(".vs-tooltip-row")).toEqual(["62 good"]);
  });

  it("has a table with the same values", () => {
    render(<RatingBar title="LCP" counts={counts} />);
    openTable();
    expect(texts("tbody tr:first-child > *")).toEqual(["Good", "62", "62%"]);
  });
});
