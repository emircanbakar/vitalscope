# @vitalscope/sdk

Measures Core Web Vitals (LCP, INP, CLS, FCP, TTFB) and JavaScript errors on your own machine while you develop. Zero runtime dependencies; metrics are measured with the browser's own `PerformanceObserver` and checked against Google's `web-vitals` in tests.

Vitalscope is a local tool: it shows what your browser measures, not what real users experience.

## Install

```bash
npm install --save-dev @vitalscope/sdk @vitalscope/cli
```

[`@vitalscope/cli`](https://www.npmjs.com/package/@vitalscope/cli) is the local collector and panel. Load the SDK only in development, then start your app and the collector with `npx vitalscope dev`:

```ts
if (import.meta.env.DEV) {
  void import("@vitalscope/sdk").then(({ init }) => init());
}
```

With no options, `init()` sends to `http://localhost:8787/v1/e`. If the collector runs on another port, pass `init({ endpoint: "http://localhost:9000/v1/e" })`.

Open `http://localhost:8787` for the panel, or run `vitalscope report` to see the results in your terminal.

## Staying out of production

- **On real domains the SDK does nothing.** It starts only on `localhost`, `127.0.0.1`, `[::1]` and `*.localhost`, so it cannot collect data from real users even if it reaches a production bundle.
- **Keep it out of the bundle.** A dynamic import behind a development check, as above, adds nothing to the production build. A plain top-level `import` ships the SDK to your users, where it stays off but still costs about 5 kB, and it breaks builds that install with `--omit=dev`.

## Measuring a production build

Development servers run unminified code with HMR, so their numbers differ from what a production build delivers. Treat them as a way to spot changes, and measure a production build before trusting a value.

The SDK labels each measurement by reading `NODE_ENV` from your bundler, and `vitalscope report` shows production and development numbers in separate tables. Without a bundler (the script tag) the label is `development`; set it with `init({ environment: "production" })` or `data-environment="production"`.

With Vite, allow a dedicated mode in the check:

```ts
if (import.meta.env.DEV || import.meta.env.MODE === "vitalscope") {
  void import("@vitalscope/sdk").then(({ init }) => init());
}
```

```bash
vite build --mode vitalscope && vite preview
```

A normal `vite build` still leaves the SDK out. Build again before you deploy.

With Next.js, remove the `NODE_ENV` check for the measurement, run `next build && next start`, then put the check back. Next.js has no equivalent of a build mode, and a `NEXT_PUBLIC_*` flag does not work here: while it is unset, the import stays in the build and breaks installs with `--omit=dev`.

These numbers still come from your machine and your network, not from real users.

## Comparing releases

Pass a `release`, such as a commit hash, and the panel can compare two of them side by side:

```ts
init({ release: "9f2c1ab" });
```

Measure both releases the same way: the same build type, pages and machine. Differences from a few page loads are mostly noise, so the panel gives no verdict below 5 measurements.

## Entry points

| Entry | What it adds |
| --- | --- |
| `@vitalscope/sdk` | Metrics, errors, pageviews, SPA route changes |
| `@vitalscope/sdk/attribution` | Same API; metrics also carry "why slow" data (LCP element and parts, INP target, event and phases, plus the slowest interaction when INP leaves it out, CLS element) |
| `@vitalscope/sdk/react` | `<VitalscopeProvider route="/products/[id]">` |
| `@vitalscope/sdk/next` | `<VitalscopeProvider>` for the App Router; the route template comes from `useParams` |

Both providers take an optional `config` prop with the same options as `init()`. They import the SDK statically, so render them only in development.

### Next.js

```tsx
"use client";

import { useEffect } from "react";

export function Vitalscope() {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      void import("@vitalscope/sdk").then(({ init }) => init());
    }
  }, []);
  return null;
}
```

Render `<Vitalscope />` in your root layout.

## Script tag

Add it to pages only in development. It starts by itself; `data-endpoint`, `data-release` and `data-environment` are optional, and with `data-manual` it waits for `vitalscope.init()`.

Always pin the version and set `integrity`. Compute it from the file of that exact version:

```bash
curl -s https://cdn.jsdelivr.net/npm/@vitalscope/sdk@<version>/dist/vitalscope.iife.js | openssl dgst -sha384 -binary | openssl base64 -A
```

Prefix the result with `sha384-`. Self-hosting `dist/vitalscope.iife.js` is the safest option.

```html
<script async
  src="https://cdn.jsdelivr.net/npm/@vitalscope/sdk@<version>/dist/vitalscope.iife.js"
  integrity="sha384-…" crossorigin="anonymous"></script>
```

The script defines a single frozen `window.vitalscope` object.

## Privacy

Query strings and hashes are dropped (except `keepQuery`), and e-mail addresses, tokens and long numbers are scrubbed from paths and error messages before anything is sent. Selectors never contain text. With `respectDoNotTrack: true`, nothing is collected when Global Privacy Control or Do Not Track is on.

If your app sets a CSP in development, it needs the collector's address in `connect-src`. Metrics belong to the full page load; in SPAs, INP and CLS are reported for the route that is active when the page is hidden.

## Verifying a release

Every version is published only from GitHub Actions, through npm trusted publishing (no long-lived tokens).
