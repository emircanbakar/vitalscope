---
"@vitalscope/cli": minor
---

Add `vitalscope run <scenario>`: runs a Playwright scenario several times in Chromium, each time in a fresh browser context with a slowed-down CPU, and prints the median and range of each metric, a comparison with the previous run of the same scenario, and the slowest interactions. Playwright is an optional peer dependency, needed only for this command.
