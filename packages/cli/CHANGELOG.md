# @vitalscope/cli

## 0.1.0

### Minor Changes

- e5ad578: First release of the local collector and panel. `npx vitalscope dev` collects what `@vitalscope/sdk` measures into a SQLite file in `.vitalscope/` and serves the panel at `http://localhost:8787`; `vitalscope report` prints the same numbers in the terminal. Needs Node 24.15 or newer.
