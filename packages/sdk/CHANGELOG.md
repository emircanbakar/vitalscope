# @vitalscope/sdk

## 0.2.0

### Minor Changes

- 4f02a89: `environment` now defaults to what the bundler built for (`NODE_ENV`), and to `development` when there is no bundler, instead of always `production`. Pass `environment` to set it yourself.
- e68f13f: The SDK now works with the local Vitalscope collector and needs no configuration: `init()` sends to `http://localhost:8787/v1/e`, and `key` and `endpoint` are optional.
  
  Breaking: the SDK does nothing on pages that are not local (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`), so it cannot collect data from real users if it reaches a production bundle. The script tag now starts without any `data-*` attributes; add `data-manual` to wait for `vitalscope.init()`.

## 0.1.1

### Patch Changes

- 99cd9e2: Include a security policy with a reporting address.

## 0.1.0

### Minor Changes

- 6390c4c: First public release.
