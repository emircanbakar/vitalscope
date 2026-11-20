---
"@vitalscope/cli": patch
---

The panel's slowest interactions list marks interactions that were mostly input delay ("mostly waiting"): the page was still busy with earlier work, so the cause is in what ran before, not in the interaction's own handler.
