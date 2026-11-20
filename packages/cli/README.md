# @vitalscope/cli

The local collector and panel for [`@vitalscope/sdk`](https://www.npmjs.com/package/@vitalscope/sdk). While you develop, it stores the Core Web Vitals and JavaScript errors your browser measures in a SQLite file in your project. You see them in a panel at `http://localhost:8787` or in your terminal. There is no server, account or Docker.

Vitalscope is a local tool: it shows what your browser measures, not what real users experience.

## Install

Needs Node 24.15 or newer.

```bash
npm install --save-dev @vitalscope/cli @vitalscope/sdk
```

Load the SDK in development (see the [SDK README](https://www.npmjs.com/package/@vitalscope/sdk) for React, Next.js and the script tag):

```ts
if (import.meta.env.DEV) {
  void import("@vitalscope/sdk").then(({ init }) => init());
}
```

Start the collector next to your dev server:

```bash
npx vitalscope dev
```

Open your app on `localhost`, then open `http://localhost:8787` for the panel.

## Commands

| Command | What it does |
| --- | --- |
| `vitalscope dev` | Starts the collector and the panel. Ctrl+C writes what is still in memory, then stops |
| `vitalscope report` | Prints p75 per page and the grouped errors in the terminal. Works while `dev` is running |
| `vitalscope run <scenario>` | Runs a Playwright scenario several times in Chromium and prints a summary. See [Repeatable measurements](#repeatable-measurements) |

| Option | Default |
| --- | --- |
| `--dir <path>` | `.vitalscope` |
| `--port <port>` (`dev` and `run`) | `8787`. Pass the same port to the SDK: `init({ endpoint: "http://localhost:9000/v1/e" })` |

## Repeatable measurements

Two visits to your app are rarely comparable: different clicks, warm or cold caches. `vitalscope run` repeats the same scenario under the same conditions, so the numbers can be compared between commits.

It needs Playwright and its Chromium, which are not installed with the CLI:

```sh
npm install --save-dev playwright
npx playwright install chromium
```

A scenario is a module whose default export receives a Playwright [`page`](https://playwright.dev/docs/api/class-page). The page is already open at `--url`; the scenario only does the interactions:

```js
// scenarios/checkout.js
export default async function ({ page }) {
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.getByRole("link", { name: "Cart" }).click();
}
```

Start your production build (for example `vite preview`), stop `vitalscope dev` if it is running, then:

```sh
npx vitalscope run scenarios/checkout.js --url http://localhost:4173/
```

| Option | Default |
| --- | --- |
| `--url <url>` | Required. Must be a local page; the SDK sends nothing from other sites |
| `--runs <n>` | `5`. Each run is a fresh browser context, with empty cache and storage |
| `--cpu <rate>` | `auto`: the CPU is slowed down to roughly a mid-tier phone, calibrated on your machine. A number sets the rate, `1` turns it off |
| `--label <name>` | The current commit's short hash |
| `--json` | Off. Prints the summary as JSON |

`run` starts its own collector on `--port`, so the app needs no change. It prints the median and range of each metric, compares them with the previous run of the same scenario, and lists the slowest interactions. The comparison uses the panel's rules: no verdict below 5 measurements, or when the difference is too small. The sessions are stored in the data folder like any other, so the panel shows them too.

TypeScript scenarios work without a build step (Node strips the types). Only Chromium is supported, because CPU throttling and some metrics exist only there.

## The panel

- **Overview:** p75 and the good / needs improvement / poor split for each metric, and the p75 of each page, most visited first. Open a metric for its trend and distribution.
- **Errors:** the same error is counted once, even when line numbers, build hashes or ids in the message change. The detail shows the last stack and which pages, devices and releases it appeared on.
- **Releases:** pass a `release` to the SDK, such as a commit hash, and compare two releases side by side. Below 5 measurements, or when the difference is too small, the panel gives no verdict.
- **Filters:** environment, page, device and time range. The panel opens on the last 30 days. The view is kept in the address, so you can bookmark it.
- **Live:** the panel updates as measurements arrive.

Development and production builds are shown separately and never mixed. The [SDK README](https://www.npmjs.com/package/@vitalscope/sdk#measuring-a-production-build) explains how to measure a production build.

## Your data

- Everything is stored in `.vitalscope/vitalscope.db`. The folder contains its own `.gitignore`, so measurements are not committed. Delete the folder to start over.
- The collector listens only on `127.0.0.1`, and accepts measurements only from local pages (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`). Other sites open in your browser cannot send to it or read the panel.
- Nothing is sent anywhere else.

## Verifying a release

Every version is published only from GitHub Actions, through npm trusted publishing (no long-lived tokens).
