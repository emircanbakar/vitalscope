---
"@vitalscope/sdk": minor
---

`environment` now defaults to what the bundler built for (`NODE_ENV`), and to `development` when there is no bundler, instead of always `production`. Pass `environment` to set it yourself.
