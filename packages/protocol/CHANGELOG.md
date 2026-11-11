# @vitalscope/protocol

## 0.1.2

### Patch Changes

- d7af146: Email scrubbing no longer slows down on very long paths or error messages. The previous pattern took time proportional to the square of the input length, so a 32,000-character path blocked the page for about half a second. Emails are now found from the `@` and the result is the same.

## 0.1.1

### Patch Changes

- 99cd9e2: Include a security policy with a reporting address.

## 0.1.0

### Minor Changes

- 6390c4c: First public release.
