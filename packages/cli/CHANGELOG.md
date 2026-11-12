# @vitalscope/cli

## 0.2.0

### Minor Changes

- 94d2975: List the slowest interactions. INP attribution now carries the event name (`keydown`, `pointerup`…) and, when INP leaves out a page's slowest interaction, that interaction as `slowest`. The panel's INP page lists the slowest interaction of each page view with its element, event and timings. Older collectors ignore the new fields.

### Patch Changes

- Updated dependencies [94d2975]
  - @vitalscope/protocol@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [d7af146]
  - @vitalscope/protocol@0.1.2

## 0.1.0

### Minor Changes

- e5ad578: First release of the local collector and panel. `npx vitalscope dev` collects what `@vitalscope/sdk` measures into a SQLite file in `.vitalscope/` and serves the panel at `http://localhost:8787`; `vitalscope report` prints the same numbers in the terminal. Needs Node 24.15 or newer.
