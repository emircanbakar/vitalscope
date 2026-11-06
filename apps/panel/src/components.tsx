import type { MouseEvent, ReactNode } from "react";
import type { Rating } from "@vitalscope/protocol";
import { viewUrl, type ViewState } from "./filters.js";
import { RATING_LABELS } from "./format.js";

export type Navigate = (view: ViewState) => void;

export function ViewLink({ view, navigate, children, current }: { view: ViewState; navigate: Navigate; children: ReactNode; current?: boolean }) {
  function onClick(event: MouseEvent) {
    // Yeni sekmede açma gibi tarayıcı davranışları korunur.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(view);
  }
  return (
    <a href={viewUrl(view)} onClick={onClick} {...(current ? { "aria-current": "page" as const } : {})}>
      {children}
    </a>
  );
}

export function RatingText({ rating }: { rating: Rating }) {
  const { mark, label } = RATING_LABELS[rating];
  return (
    <span className={`rating rating-${rating}`}>
      <span aria-hidden="true">{mark}</span> {label}
    </span>
  );
}

export function LoadError() {
  return (
    <p className="notice" role="alert">
      Could not load the data. Check that <code>vitalscope dev</code> is still running, then reload.
    </p>
  );
}

export function NoMatches() {
  return <p className="notice">No measurements match these filters.</p>;
}
