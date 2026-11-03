# @vitalscope/sdk

Real user monitoring for Core Web Vitals (LCP, INP, CLS, FCP, TTFB) and JavaScript errors. Zero runtime dependencies; metrics are measured with the browser's own `PerformanceObserver` and checked against Google's `web-vitals` in tests.

## Install

```bash
npm install @vitalscope/sdk
```

```ts
import { init } from "@vitalscope/sdk";

init({
  key: "pk_…", // public project key
  endpoint: "https://ingest.example.com/v1/e",
  environment: "production",
});
```

| Entry | What it adds |
| --- | --- |
| `@vitalscope/sdk` | Metrics, errors, pageviews, SPA route changes |
| `@vitalscope/sdk/attribution` | Same API; metrics also carry "why slow" data (LCP element and parts, INP target and phases, CLS element) |
| `@vitalscope/sdk/react` | `<VitalscopeProvider config={…} route="/products/[id]">` |
| `@vitalscope/sdk/next` | `<VitalscopeProvider config={…}>` for the App Router; the route template comes from `useParams` |

## Script tag

Always pin the version and use the `integrity` value from the [GitHub release](https://github.com/emircanbakar/vitalscope/releases) of that version. Self-hosting `dist/vitalscope.iife.js` is the safest option.

```html
<script async
  src="https://cdn.jsdelivr.net/npm/@vitalscope/sdk@<version>/dist/vitalscope.iife.js"
  integrity="sha384-…" crossorigin="anonymous"
  data-key="pk_…" data-endpoint="https://ingest.example.com/v1/e"></script>
```

The script defines a single frozen `window.vitalscope` object.

## Privacy

Query strings and hashes are dropped (except `keepQuery`), and e-mail addresses, tokens and long numbers are scrubbed from paths and error messages before anything is sent. Selectors never contain text. With `respectDoNotTrack: true`, nothing is collected when Global Privacy Control or Do Not Track is on.

Your site's CSP needs only the ingest address in `connect-src`. Metrics belong to the full page load; in SPAs, INP and CLS are reported for the route that is active when the page is hidden.

## Verifying a release

Every version is published from GitHub Actions with npm provenance. Check it with `npm audit signatures`.
