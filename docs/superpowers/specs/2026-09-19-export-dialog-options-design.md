# Export dialog — pick a format, set its options

**Status:** draft for review · **Date:** 2026-09-19 · **Branch:** `feat/export-options`

## The ask

> "we probably should split exports of different types of exports - image, video, gif etc"
> … "and have export popup with configurable props"

The dialog is a flat column of five buttons, each of which exports immediately with no say in how.
Adding GIF would make seven. Every choice the export makes — size, which frames, quality — is either
hardcoded or inherited silently from somewhere else in the app.

## What it does today

| Button | Size | Frames | Other |
|---|---|---|---|
| PNG sequence → zip | document | In/Out, silently | boil on, refs off |
| PNG (current frame) | document | playhead | same |
| PSD (current frame) | document | playhead | boil OFF (no per-layer equivalent) |
| MP4 / WebM | document, rounded up to even | In/Out, silently | `QUALITY_HIGH`, audio muxed |

"Silently" is the word that matters: a range set an hour ago and forgotten shortens the file, and the
dialog can only warn about it after the fact. Making the range an explicit choice removes the whole
class of surprise.

## Decisions (settled in brainstorming)

| Question | Answer |
|---|---|
| Shape | **One dialog: a grouped format list, options underneath, one Export button.** Rejected: a button per format with inline options (busy and wide); separate dialogs per type (more taps, three panels to keep consistent); tabs (hides options behind a tab on a narrow iPad panel). |
| Configurable | **Size, frame range, format-specific quality.** Rejected for now: toggles for reference layers and for forcing boil on/off — the user did not want them, and both change what the export MEANS rather than how big or how long it is. |
| PSD size | **Always 100%.** Scaling resamples every layer, which defeats exporting layers for paint-up. |
| Size estimate | **Not shown.** The only honest number comes from encoding the thing; a guess in a dialog is worse than no number. |
| Persistence | **Session-only.** Options live in `appState`, not `Preferences`; adding them to the prefs file is additive and can come later. |
| GIF | Its two buttons (full / half) collapse into ONE format plus the shared Size control. |

## 1. The model — `src/state/appState.svelte.ts`

```ts
export type ExportFormat = "png-sequence" | "png-frame" | "psd-frame" | "gif" | "mp4" | "webm";
export type ExportRangeMode = "all" | "inout" | "custom";

export interface ExportOptions {
  format: ExportFormat;
  /** 1 | 0.5 | 0.25. Ignored by PSD, which always exports at 100% — see §3. */
  scale: number;
  rangeMode: ExportRangeMode;
  /** Only read when `rangeMode === "custom"`; 0-based, inclusive, clamped on use. */
  customStart: number;
  customEnd: number;
  gifColors: 64 | 128 | 256;
  videoQuality: "low" | "medium" | "high";
}
```

One field on the store (`exportOptions`), initialised from `defaultExportOptions()`. Session-only, so
it is NOT part of `Project`, not persisted, and not in any undo snapshot.

## 2. Resolving the range — `src/export/export-range.ts`

Pure, unit-tested, because this is where a mistake silently exports the wrong frames.

```ts
export function resolveExportRange(
  opts: Pick<ExportOptions, "rangeMode" | "customStart" | "customEnd">,
  playRange: { in: number; out: number } | null,
  frameCount: number,
): { start: number; end: number };
```

- `all` → `{ start: 0, end: frameCount - 1 }`.
- `inout` → exactly today's `effectiveRange(playRange, frameCount)`, including its fallbacks (no
  range, or an inverted one, means the whole animation).
- `custom` → the typed pair, each clamped to `[0, frameCount - 1]`, swapped if reversed so a
  first-after-last pair exports that span rather than nothing.

**Default is `inout`**, so an artist who never opens the options gets exactly today's behaviour.

## 3. Size

`scale` multiplies the document size, and every raster exporter already takes an `outputScale` (it
exists for the display canvas) or can size its own canvas:

- **PNG sequence, GIF, MP4, WebM:** honour 100% / 50% / 25%.
- **PNG (current frame):** honours it too — it is the same render path as the sequence, and a
  half-size still is a reasonable thing to want.
- **PSD:** ignores it; the control hides when PSD is selected rather than showing a dead choice.
- **Video:** the chosen size still passes through `evenDimensions`, which rounds UP, so a 25% export
  of an odd-sized document gains at most one pixel per axis rather than cropping (the rule that entry
  already records).

The label shows the resulting pixels, e.g. `50%  ·  640 × 360`, because a percentage alone does not
tell you whether the result is big enough to read.

## 4. Quality

- **GIF colours** — 64 (default), 128, 256. Fewer is smaller and, on ink over paper, indistinguishable;
  the option exists for painted work. Feeds `quantize(…, colors, …)` in the GIF spec's exporter.
- **Video quality** — Low / Medium / High mapped to mediabunny's `QUALITY_LOW`, `QUALITY_MEDIUM`,
  `QUALITY_HIGH`. Default High, which is what `exportVideo` hardcodes today, so nothing changes for
  someone who ignores the control.

## 5. The dialog — `src/lib/ExportDialog.svelte`

```
Export                                   ✕

FORMAT
  ( ) PNG sequence      ( ) PNG frame
  (•) GIF               ( ) PSD frame
  ( ) MP4               ( ) WebM

OPTIONS
  Size    [ 100% ][ 50% ][ 25% ]   640 × 360
  Range   [ All ][ In/Out ][ Custom ]  3 – 48
  Colours [ 64 ][ 128 ][ 256 ]

  name.gif
  [            Export            ]

  <the existing notes: references, boil, transparency>
```

- **Format** is a two-column radio grid: six items fit a 320px panel without scrolling, and the
  grouping is by row order with a small heading per group (`text-text-secondary text-xs uppercase
  tracking-wide`, the idiom the Project settings panel already uses).
- **Unavailable formats are `aria-disabled`, not hidden** — MP4/WebM without WebCodecs keep their
  existing explanation underneath, because a missing row explains nothing (the codebase's
  refusals-explain-themselves rule).
- **Segmented controls** for size/range/quality: single-tap targets, no popovers, no keyboard — the
  iPad-first rule. Custom range reveals two `NumberField`s (first / last), which drag-to-change.
- **The filename line** shows exactly what will be written, including the frame-numbered name for the
  single-frame formats.
- **Busy panel, progress bar, Cancel and delivery are untouched.** They already handle every format.

## 6. What the exporters need

Small, additive signature changes; no exporter's internals move:

| Exporter | Change |
|---|---|
| `exportPngSequence` | takes `scale` (it already builds its own canvas; `renderFrame` takes `outputScale`) |
| `renderFramePng` / `exportCanvas` | take `scale` |
| `exportVideo` | takes `scale` and a `quality` |
| `exportGif` | takes `scale` and `colors` (already in its spec) |
| `exportPsdFrame` | unchanged |

## 7. Out of scope

- Estimated file size, per §Decisions.
- Persisting the options across sessions.
- Reference-layer and boil toggles.
- Per-format extras beyond the three named: no GIF dithering, no frame-rate override, no audio
  toggle, no PNG bit-depth.
- Batch export (several formats at once).

## 8. Testing

- **Unit (Vitest):** `resolveExportRange` — all three modes, a null play range, an inverted play
  range, a reversed custom pair, clamping past the end, a single-frame document. And a small
  `exportPixelSize(project, scale)` helper for the label, so `50% · 640 × 360` cannot drift from what
  is actually rendered.
- **Not unit-testable:** the dialog itself (no DOM in Vitest). Browser pass: each format exports;
  size 50% halves the pixels (check the written file, not the label); a custom range exports exactly
  those frames; Cancel still works; the disabled video rows still explain themselves.
- **iPad pass:** the panel fits in portrait without scrolling, the segmented controls are tappable,
  and the custom-range fields drag.

## 9. Risks

- **The dialog grows past the panel on a small screen.** Mitigated by the two-column grid and by
  showing only the options that apply. Worth measuring on the device early rather than at the end.
- **A silent behaviour change:** exports have always followed In/Out; that becomes the DEFAULT rather
  than the rule. Anyone who never opens the options sees no difference.
- **More surface per exporter.** Each new parameter is one more thing a format can get wrong; the
  range resolution is unit-tested precisely because it is the one that silently writes the wrong
  frames.
