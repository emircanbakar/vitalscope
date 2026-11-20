# Design: `vitalscope run`

Status: first version built, 20 November 2026. Usage is documented in the [CLI README](../../packages/cli/README.md#repeatable-measurements); this note keeps the reasoning.

## Problem

Today Vitalscope measures whatever the developer happens to do in the browser. Two sessions are rarely comparable: different clicks, a warm or cold cache, a fast laptop. The Excalidraw case study (`docs/case-studies/excalidraw.md`) only produced numbers worth comparing because of Playwright scripts written outside Vitalscope. Those scripts throttled the CPU, opened a fresh browser context for every session, repeated each scenario ten times and kept a release name per build.

`vitalscope run` moves that work into the CLI: run the same scenario N times under the same conditions, store the sessions, and print a summary that can be compared with the previous run.

## Goals for the first version

- Run a user-written scenario against a local URL N times, in Chromium, with CPU throttling.
- Store the sessions in the normal `.vitalscope` data folder, so the panel shows them too.
- Print a per-metric summary (median and range over the sessions) and compare it with the previous run of the same scenario.
- Make the output readable by scripts (`--json`), so `vitalscope check` can be built on top of it later.

## Not in the first version

- Firefox and WebKit. CPU throttling, and Chromium's CLS and long animation frame data, exist only in Chromium.
- `vitalscope check` (budgets and exit codes for CI). Planned as the next step on top of `run`.
- Memory measurement, network throttling presets, and labelled steps inside a scenario (see "Open questions").
- Starting the user's app. The user runs their own preview server (`vite preview`, `next start`, …) and passes its URL.

## Usage

```sh
vitalscope run scenarios/editor.js --url http://localhost:4173/ --runs 5
```

| Option | Default | Meaning |
| --- | --- | --- |
| `<scenario>` | (required) | JavaScript or TypeScript module with the scenario |
| `--url <url>` | (required) | Page the scenario starts on; must be local |
| `--runs <n>` | 5 | Sessions to run, each in a fresh browser context |
| `--cpu <rate>` | `auto` | CPU slowdown: `auto` calibrates to a mid-tier phone, a number sets it, `1` disables it |
| `--label <name>` | git short SHA, else a timestamp | Name of this run, for comparison |
| `--dir`, `--port` | `.vitalscope`, `8787` | Same as `vitalscope dev` |
| `--json` | off | Print the summary as JSON instead of a table |

## Scenario format

A module whose default export receives a Playwright page:

```js
// scenarios/editor.js
export default async function ({ page }) {
  await page.getByRole("button", { name: "Rectangle" }).click();
  await page.mouse.move(200, 200);
  await page.mouse.down();
  await page.mouse.move(400, 300);
  await page.mouse.up();
  await page.keyboard.press("Alt+Shift+D"); // theme switch
}
```

`run` opens `--url` before calling the function and ends the session after it returns, so the scenario contains only the interactions. TypeScript works without a build step, because Node 24 strips types from `.ts` files (erasable syntax only).

Why code and not a declarative step list (JSON or YAML): real scenarios need waits, loops and conditions; the Excalidraw scenario built scenes with hundreds of elements in a loop. Playwright's API is already documented and known. A step format would need its own documentation and would still miss cases.

## How a session runs

For each of the N runs:

1. New browser context (empty cache and storage), new page.
2. CPU throttling with CDP `Emulation.setCPUThrottlingRate`. With `auto`, the rate is calibrated once per run with the same benchmark as the SDK's performance tests (`apps/playground/e2e/perf.spec.ts`: a fixed JS workload, scaled to 4× of the reference machine, clamped to 1–20×).
3. `page.goto(url)`, wait for `load`, call the scenario.
4. Close the page. The SDK sends its last batch on `pagehide`, and Chromium delivers that beacon to a local server (verified in the E2E suite since #13).

After the last session, `run` drains the collector's buffer, writes the run record and prints the summary.

## Collecting the data

`run` starts the collector in the same process, on the same port as `vitalscope dev` (8787 by default). The app's SDK already sends to that address, so the app needs no change.

- If the port is in use (usually because `vitalscope dev` is running), `run` stops with: "Port 8787 is in use. Stop vitalscope dev, or pass --port with the port your SDK sends to."
- Because the collector belongs to the run, every session it receives during the run comes from the run's browser. `run` records those session ids; no change to the protocol or the SDK is needed.

The alternative is attaching to a running `vitalscope dev` through a new local API that starts and stops a run. It is more convenient, but it needs a write endpoint on the panel API (today the API is read-only and rejects cross-site requests), and manual browsing during the run would be counted. It can be added later without changing the stored format.

## Storage

Two new tables in the existing SQLite file; the event tables do not change:

```sql
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  scenario TEXT NOT NULL,   -- path relative to the project, used to find the previous run
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  cpu_rate REAL NOT NULL,
  runs INTEGER NOT NULL,    -- requested sessions; a multi-page scenario has one SDK session per page load
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS run_sessions (
  run_id INTEGER NOT NULL REFERENCES runs (id),
  session_id TEXT NOT NULL,
  PRIMARY KEY (run_id, session_id)
);
```

Older CLIs open the same file and ignore these tables (`CREATE TABLE IF NOT EXISTS`).

## Summary

One row per metric, from the sessions of this run:

```
vitalscope run: scenarios/editor.js, label a1b2c3d, 5 runs, CPU 4.2×

Metric  Median    Range            Measured  Previous (e918dab)  Change
LCP     1.21 s    1.18 s – 1.30 s  5/5       1.24 s              about the same
INP     752 ms !  720 ms – 784 ms  5/5       112 ms              ! slower, +640 ms (+571%)
CLS     0.02      0.01 – 0.02      5/5       0.02                about the same
```

- Each page view counts once, with the last value the SDK sent for that metric, as in `vitalscope report`.
- "change" reuses the release comparison rules from #39: no verdict under 5 sessions, under 5 % or under 20 ms (0.01 for CLS).
- Sessions that sent no value for a metric (for example LCP when the scenario did not wait for it) are counted and shown, not hidden.
- The 3 slowest interactions of the run follow, with the same columns as the panel's table.

## Dependencies

Playwright becomes an optional peer dependency of `@vitalscope/cli` and is loaded only by `run`. Without it, `run` exits with an install hint (`npm i -D playwright` and `npx playwright install chromium`). The other commands and the published package size do not change.

## Safety

- The URL must be local (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`). The SDK sends nothing from other pages (#33), so a remote URL could never produce data. Rejecting it also keeps `run` from being used to drive real sites.
- The scenario file is the user's own code, executed with the user's permissions, like a test file.
- The collector keeps its existing checks (local `Origin` and `Host` only).

## Testing

- Unit tests: argument parsing, summary and comparison against a stored previous run, the missing-Playwright message, rejection of non-local URLs.
- One E2E test in CI: `run` against the playground with 2 sessions, checking the stored sessions and the summary. This needs the Chromium that CI already installs.

## Open questions

1. **Labelled steps.** The Excalidraw work needed to know which interaction was the theme switch. A `step("theme switch", fn)` helper would need the interaction's start time in the attribution, which the protocol does not carry today. Proposal: leave it out of the first version.
2. **Panel.** The first version has no run filter in the panel; the terminal summary is the main output. Run sessions are visible in the panel with everything else.
3. **Warm-up.** The first session is often slower because of the browser's and the server's cold caches. On the playground, the first of five sessions had an LCP of 1.72 s against 84–100 ms for the others. The first version reports it like the others; the median absorbs it, the range shows it. An extra session that is not stored is the alternative if this turns out to mislead.
