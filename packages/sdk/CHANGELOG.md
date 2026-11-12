# @vitalscope/sdk

## 0.3.0

### Minor Changes

- 94d2975: List the slowest interactions. INP attribution now carries the event name (`keydown`, `pointerup`…) and, when INP leaves out a page's slowest interaction, that interaction as `slowest`. The panel's INP page lists the slowest interaction of each page view with its element, event and timings. Older collectors ignore the new fields.

## 0.2.1

### Patch Changes

- d7af146: Email scrubbing no longer slows down on very long paths or error messages. The previous pattern took time proportional to the square of the input length, so a 32,000-character path blocked the page for about half a second. Emails are now found from the `@` and the result is the same.

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
