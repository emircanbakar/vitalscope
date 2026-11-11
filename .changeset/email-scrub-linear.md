---
"@vitalscope/protocol": patch
"@vitalscope/sdk": patch
---

Email scrubbing no longer slows down on very long paths or error messages. The previous pattern took time proportional to the square of the input length, so a 32,000-character path blocked the page for about half a second. Emails are now found from the `@` and the result is the same.
