---
"@vitalscope/sdk": minor
---

The SDK now works with the local Vitalscope collector and needs no configuration: `init()` sends to `http://localhost:8787/v1/e`, and `key` and `endpoint` are optional.

Breaking: the SDK does nothing on pages that are not local (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`), so it cannot collect data from real users if it reaches a production bundle. The script tag now starts without any `data-*` attributes; add `data-manual` to wait for `vitalscope.init()`.
