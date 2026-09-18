# Animated GIF export — design

**Status:** draft for review · **Date:** 2026-09-19 · **Branch:** `feat/gif-export`

## The ask

> "have we talked about animated gif export?" … "yes, look into gif export" … (after the spike) "yes"

An animated GIF of the animation, beside the existing PNG sequence / PSD / MP4 / WebM exports. GIF is
what you paste into a chat, a forum or a bug report without anyone needing a player — the format this
app's short, low-framerate, monochrome-ink output is made for.

## What the spike established (2026-09-19, measured, not assumed)

Throwaway code in a scratch directory, deleted; nothing was added to the repo.

- **mediabunny cannot write GIF.** Zero mentions of it in its type definitions; its output formats are
  ADTS, CMAF, FLAC, HLS, ISOBMFF/MP4/MOV, MKV, MP3, MPEG-TS, OGG, WAV, WebM. So GIF needs an encoder.
- **`gifenc` (1.0.3, MIT, mattdesl) is the right one.** 9 kB unminified ESM (~2 kB gzipped), zero
  dependencies, no workers required.
- **Measured on frames shaped like this app's output** (cream paper, anti-aliased black strokes,
  1280×720), encode time excluding rendering:

  | | encode | size |
  |---|---|---|
  | 12 frames (1s at 12fps) | 67 ms | 96 kB |
  | 60 frames (5s) | 262 ms | 482 kB |
  | 60 frames, per-frame palettes | 591 ms | 483 kB |
  | 12 frames, transparent | 57 ms | 96 kB |

- **One global palette is the right default:** per-frame palettes cost 2.2× the time for the same
  bytes on this kind of art. 16 colours was already enough for anti-aliased ink on paper.
- **The output was verified**, not just produced: parsed to `GIF89a`, 1280×720, 60 frames, ONE global
  palette, delay 8 hundredths, loop count 0 (infinite) — and played in a browser.

## Decisions (settled in brainstorming)

| Question | Answer |
|---|---|
| Encoder | **gifenc**, a new runtime dependency. Rejected: gif.js (worker-bound, much slower), a wasm gifski (~1 MB download for quality this content does not need). |
| Palette | **One global palette, sampled from several frames** (§2). Rejected: per-frame palettes (2.2× slower, no smaller). |
| Timing | **Alternating delays so the average is the true fps** (§3). Rejected: one rounded delay for every frame — a 12fps shot would run 4% fast. |
| Size | **Full size and half size**, two buttons (§4). Rejected: full size only. |
| Range | Honours the play In/Out range, like the PNG sequence and the videos. |
| Looping | **Infinite**, unconditionally. A GIF that stops on the last frame is not what anyone pastes. |
| Reference layers | Excluded, like every other export. |
| Line boil | Included, like the PNG sequence (and unlike PSD). |

## 1. `src/export/gif.ts` — the exporter

```ts
export interface GifExportOptions extends ExportProgress {
  /** 1 = document size, 0.5 = half. Anything else is clamped into (0, 1]. */
  scale?: number;
}

export async function exportGif(
  project: Project,
  dpr: number,
  range: { start: number; end: number },
  opts?: GifExportOptions,
): Promise<Blob>;
```

Shape mirrors `exportPngSequence` exactly — same signature, same abort/progress contract, same
`yieldToEventLoop()` after each frame so the progress bar paints and Cancel is deliverable. It renders
through the shared `renderFramePng`'s sibling path: `renderFrame` with `drawBg: !transparentBg`,
`includeReference: false`, boil when enabled.

Per frame: `renderFrame` → `ctx.getImageData` → `applyPalette` → `gif.writeFrame`.

## 2. The palette

Built ONCE, from up to **five frames sampled evenly across the range** (first, last and three
between), concatenated and quantised to **64 colours**.

- One frame is not enough: a colour that only appears later — a coloured layer switched on mid-shot,
  a different paper colour behind a transparent region — would be mapped to its nearest neighbour for
  the whole export.
- 64 rather than 256: ink plus paper plus anti-aliasing needs far fewer, and a smaller table is a
  smaller file. 256 would also be correct; 64 is the cheaper default and can be raised if a project
  ever looks posterised.
- Format is `rgb444` normally, `rgba4444` when `project.transparentBg` is set, with index 0 reserved
  as the transparent entry — GIF's transparency is 1-bit, so a semi-transparent pixel lands either
  fully opaque or fully clear. That is a real limitation of the format and is stated in the dialog.

## 3. Timing — `gifFrameDelays(frameCount, fps)`

Pure, unit-tested, in `src/export/gif-timing.ts`.

GIF stores a per-frame delay in **hundredths of a second**, so 12fps (8.33) and 24fps (4.17) cannot be
expressed exactly. Rounding every frame the same way makes a 12fps shot play 4% fast — five seconds
becomes 4.8, and it drifts against any reference the artist is matching.

Instead the delays are distributed so the RUNNING TOTAL tracks the true time:

```ts
/** Whole-hundredths delays whose cumulative total tracks `frameCount / fps` seconds. */
export function gifFrameDelays(frameCount: number, fps: number): number[] {
  const out: number[] = [];
  let emitted = 0; // hundredths already spent
  for (let i = 1; i <= frameCount; i++) {
    const target = Math.round((i * 100) / fps); // where frame i SHOULD end, in hundredths
    out.push(Math.max(1, target - emitted)); // browsers clamp 0 to 10; never emit 0
    emitted = target;
  }
  return out;
}
```

At 12fps this yields 8, 8, 9, 8, 8, 9… — 60 frames total exactly 500 hundredths. At 25, 20 or 10fps
every delay is identical, because those divide cleanly. The `Math.max(1, …)` floor matters above
50fps, where the true delay rounds to 0 and browsers silently substitute 10 (a 10fps crawl).

**gifenc takes MILLISECONDS** and divides by 10 internally, so each delay is passed as `d * 10`. The
spike's first attempt passed hundredths and produced a 100fps GIF — this is the one API trap here.

## 4. UI — `src/lib/ExportDialog.svelte`

> **SUPERSEDED 2026-09-19 by `2026-09-19-export-dialog-options-design.md`:** the dialog became a
> format list plus options, so GIF is ONE format and "half size" is the shared Size control, not a
> second button. The transparency note below still stands. Everything in §1–§3 (the encoder, the
> palette, the timing) is unaffected — only the two buttons are.

Two buttons under the PNG sequence entry:

```
GIF — name.gif
GIF, half size — name.gif
```

They share one `"gif"` busy kind with the existing per-frame progress bar and Cancel, since a GIF is
a per-frame loop like the PNG sequence and the videos. Both deliver through the existing path, so
Save to Files works on iPad without extra work.

A note appears in the dialog only when it applies, beside the existing reference-layer and boil notes:

- when `transparentBg` is set: "GIF transparency is on or off per pixel — soft edges against the
  transparent background will harden."

## 5. Out of scope

- Dithering. It trades banding for noise, and neither helps line art. If a painted project ever needs
  it, `applyPalette` supports it as an option.
- Per-frame palettes, frame differencing/disposal optimisation, and colour-count UI. Measured as not
  worth it for this content; the file sizes are already small.
- Audio, obviously. A GIF has none — the dialog does not warn about it any more than it warns that a
  PNG has none.

## 6. Testing

- **Unit (Vitest):** `gifFrameDelays` — exact division (25, 20, 10fps), inexact (12, 24fps: the total
  must equal `round(frameCount * 100 / fps)` and every delay must be within 1 of the ideal), the
  `Math.max(1, …)` floor above 50fps, a single frame, and a zero-frame range.
- **Not unit-testable** (no DOM/canvas in Vitest): the encode itself. Verified in the browser by
  exporting, then PARSING the bytes — signature, dimensions, frame count, one global palette, the
  delay sequence, infinite loop — and by playing it. The spike already proved this method works.
- **iPad pass:** export a real animation, check the time to encode is tolerable and that the file
  opens in Photos and pastes into a chat.

## 7. Risks

- **A new runtime dependency.** 2 kB gzipped, MIT, no transitive dependencies; the project already
  ships fflate, delaunator, perfect-freehand and mediabunny on the same terms.
- **`getImageData` per frame is the real cost on iPad**, not the encoding — the PSD exporter already
  records that readback as its slow part. The progress bar and Cancel already cover a slow export.
- **Memory:** frames are encoded one at a time, but `GIFEncoder` accumulates the whole file in
  memory. Half a megabyte for 5 seconds is nothing; a very long 1080p export could reach tens of MB,
  which is the same order as the existing zip and video exports already hold.
