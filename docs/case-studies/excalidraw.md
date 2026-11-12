# Case study: a slow theme switch in Excalidraw

Vitalscope was tested on [Excalidraw](https://github.com/excalidraw/excalidraw), a large open source React app, to see whether it finds real problems in someone else's code. It found one:

- **The problem.** Switching between the light and dark theme redraws every element. With 960 elements and 4× CPU throttling, one switch takes about 750 ms, and switching back costs the same.
- **How Vitalscope helped.** INP attribution showed that almost all of the time was presentation delay, not the event handler. Release comparison then showed the effect of a fix: INP p75 went from 752 ms to 112 ms.
- **The cost of the fix.** About 63 MB of extra memory with 960 elements.
- **Status.** Reported upstream as [excalidraw/excalidraw#12601](https://github.com/excalidraw/excalidraw/issues/12601).

The test also showed where Vitalscope falls short. Those findings are at the end.

## Setup

- Excalidraw `master` at `701b901`, production build, served locally.
- The SDK added to `excalidraw-app/index.tsx`, with the build name as the release:

  ```ts
  void import("@vitalscope/sdk/attribution").then(({ init }) =>
    init({ release: import.meta.env.VITE_VITALSCOPE_RELEASE || "baseline" }),
  );
  ```

- `vitalscope dev` collecting in the background.
- Sessions driven by Playwright in Chromium's headless shell: viewport 1440×900, CPU throttled 4× with `Emulation.setCPUThrottlingRate`, a fresh browser context for every session.
- Windows 11, Intel Core i5-12500.

These are scripted sessions on one machine, not real users. That is what Vitalscope is for: measuring your own app on your own machine before it ships.

## 1. A session that looked fine

The first script used Excalidraw the way a person might. It drew 60 shapes, 10 arrows and some text, then moved and duplicated everything three times. After that it undid and redid, zoomed and panned, switched the theme, and opened the export dialog.

Over six sessions, INP was 184–192 ms, which is rated good. The attribution pointed at a keyboard interaction on the app container (`div.excalidraw.excalidraw-container`).

The theme switch was the slowest interaction, but INP did not show it. In the same session measured step by step (next section), the switch took about 500 ms, while no other step went above 232 ms. A session with more than 50 interactions skips its slowest one, so INP is close to the 98th percentile. That is how INP is defined, and Vitalscope follows the definition. The side effect is that a single slow interaction can disappear from the number.

## 2. Narrowing it down

A second script labelled each step of the session and recorded every interaction with the Event Timing API. The theme switch stood out. A third script then built scenes of different sizes and switched the theme on each. The cost grew with the number of elements on the canvas:

| Elements | Theme switch | Event handler |
| --- | --- | --- |
| 0 | ~60 ms | ~40 ms |
| 60 | ~90 ms | ~20 ms |
| 240 | ~220 ms | ~20 ms |
| 960 | ~750 ms | ~30 ms |

Vitalscope's attribution showed the same split on every slow switch. The input delay was under 1 ms and the handler took 20–30 ms. The rest, 650–750 ms, was presentation delay: the frame after the key press.

## 3. The cause

Excalidraw keeps two render caches per element: the rough.js shape (`ShapeCache`) and a bitmap of the drawn element (`elementWithCanvasCache`). Both keep one entry per element, and both treat a different theme as a cache miss. After a switch, every element is drawn again from scratch in a single frame, and the work for the previous theme is thrown away. Switching back repeats it.

The fix that was tried keeps one entry per theme in both caches. If the other theme's bitmap is still valid when the theme changes, the two are swapped. Anything that cleared the cache before (a resize, a new element object) also clears the other theme's entry. All 2,657 Excalidraw tests pass, and three new tests cover the swap and the invalidation.

## 4. Comparing releases

Each variant was built with its own release name: `baseline`, `shape-cache` (shapes per theme only) and `theme-cache` (shapes and bitmaps per theme). The same script ran against all three in turn. Each run built a scene of 240 or 960 elements and switched the theme three times.

Vitalscope's release comparison over the same ten sessions per release:

| Release | INP p75 | Rating |
| --- | --- | --- |
| `baseline` | 752 ms | poor |
| `shape-cache` | 616 ms | poor |
| `theme-cache` | 112 ms | good |

The median of five runs per switch, measured directly with the Event Timing API, matches:

| 960 elements | baseline | shape-cache | theme-cache |
| --- | --- | --- | --- |
| First switch | 784 ms | 760 ms | 768 ms |
| Switch back | 720 ms | 616 ms | 80 ms |
| Switch again | 752 ms | 592 ms | 72 ms |

The first switch does not get faster, because every element still has to be drawn once for the new theme. Every switch after that does.

## 5. The cost

Keeping the other theme's bitmaps costs memory. With 960 elements, the renderer's private memory grew by 69 MB after three switches, against 6 MB on `baseline` (average of three runs). That is about 65 KB per element. Keeping only the shapes per theme costs almost nothing, but saves only about 20%.

Whether that trade is worth it is the Excalidraw maintainers' call. The [issue](https://github.com/excalidraw/excalidraw/issues/12601) describes the measurements and the change, offers a PR, and suggests ways to limit the memory.

## What this showed about Vitalscope

**What worked:**

- **Attribution pointed in the right direction.** The split into input delay, processing and presentation showed straight away that the event handler was not the problem, so the search moved to rendering.
- **Release comparison needed no extra setup.** A different `release` per build was enough. The before-and-after numbers came from the panel, not from a custom script.
- **Little setup in Excalidraw.** Adding the package and the few lines that start the SDK was enough.

**What fell short:**

- **A single slow interaction can hide.** In a long session, INP skips the slowest interaction by definition, and here the slowest one was the problem. A list of the slowest interactions per page, next to INP, would have shown it in the first session.
- **Attribution does not say which interaction it was.** It records the target element and whether the input was a pointer or a keyboard. In Excalidraw, most shortcuts go to the same container, so "keyboard on the app container" fits the theme switch, duplication and undo alike. Recording the event type (`keydown`, `keyup`, `pointerup`) would have narrowed it down, though only a second script could tell which shortcut it was.
- **Time can land on the next interaction.** In three baseline sessions, the slowest entry was a keyboard interaction whose 640–830 ms were almost all input delay. The step-by-step run shows how this happens: the key release after a theme switch waited 459 ms for the switch's frame to finish. The numbers are correct, but the panel could make it clearer when input delay, not the handler or rendering, dominates.

These are candidates for the next versions of the SDK and the panel.

**Update (12 November 2026).** The measurements above used SDK 0.2.1 and CLI 0.1.1. The first two points are addressed in SDK 0.3.0 and CLI 0.2.0:

- The INP page in the panel lists the slowest interaction of each page view, including the ones INP left out, which are marked "not in INP".
- INP attribution records the name of the interaction's longest event, such as `keydown` or `pointerup`. The key itself is never recorded.

The third point is still open. The Excalidraw sessions were not measured again with the new versions.
