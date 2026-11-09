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

| Option | Default |
| --- | --- |
| `--dir <path>` | `.vitalscope` |
| `--port <port>` (`dev` only) | `8787`. Pass the same port to the SDK: `init({ endpoint: "http://localhost:9000/v1/e" })` |

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
