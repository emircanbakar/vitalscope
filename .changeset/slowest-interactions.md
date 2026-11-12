---
"@vitalscope/protocol": minor
"@vitalscope/sdk": minor
"@vitalscope/cli": minor
---

List the slowest interactions. INP attribution now carries the event name (`keydown`, `pointerup`…) and, when INP leaves out a page's slowest interaction, that interaction as `slowest`. The panel's INP page lists the slowest interaction of each page view with its element, event and timings. Older collectors ignore the new fields.
