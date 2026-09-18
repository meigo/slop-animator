# Animated GIF export — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export the animation as an animated GIF, at document size or half size, beside the existing
PNG sequence / PSD / MP4 / WebM exports.

**Architecture:** One pure timing module (`src/export/gif-timing.ts`, unit-tested) plus one exporter
(`src/export/gif.ts`) shaped exactly like `exportPngSequence` — same signature, same abort/progress
contract, same per-frame yield. Encoding uses `gifenc`, a new 2 kB-gzipped runtime dependency. The
Export dialog gains two buttons that reuse the existing per-frame progress bar, Cancel and delivery.

**Tech Stack:** TypeScript, Svelte 5 runes, Vitest (node env, no DOM), gifenc 1.0.3.

**Spec:** `docs/superpowers/specs/2026-09-19-gif-export-design.md`

## Global Constraints

- `npm run build` (svelte-check + tsc + vite build) must end with **0 errors, 0 warnings**; the
  pre-existing "chunks are larger than 500 kB" notice is not a warning this gate counts.
- Test baseline before this work: **1394 passing** (this branch descends from `main`; the 1399 count belongs to the unmerged `fix/boil-step-across-keys` branch). Update the counts in `README.md` and `CLAUDE.md`
  in the final task, from a real `npm test` run.
- `npm run lint` clean. A pre-commit hook reformats staged files; expect that.
- Commit messages end with: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **gifenc takes `delay` in MILLISECONDS** and divides by 10 for the GIF's hundredths. Passing
  hundredths produces a 100fps GIF — this cost the spike a full round.
- **A global palette means passing `palette` only on the FIRST `writeFrame`** and omitting it on
  every later one. Passing it every time silently writes a local palette per frame.
- Exports honour the play In/Out `range` and exclude reference layers, like every existing exporter.

---

## File structure

| File | Responsibility |
|---|---|
| `src/export/gif-timing.ts` (new) | Pure: whole-hundredth frame delays whose total tracks the true duration. |
| `src/__tests__/gif-timing.test.ts` (new) | Unit tests for the above. |
| `src/export/gif.ts` (new) | The exporter: render loop, palette, encode, abort/progress. |
| `src/lib/ExportDialog.svelte` | Two buttons, the `"gif"`/`"gif-half"` kinds, the transparency note. |
| `package.json` | The `gifenc` dependency. |
| `README.md`, `CLAUDE.md`, `docs/superpowers/CHANGELOG.md` | Documentation. |

---

### Task 1: Frame timing

**Files:**
- Create: `src/export/gif-timing.ts`
- Test: `src/__tests__/gif-timing.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `gifFrameDelays(frameCount: number, fps: number): number[]` — whole hundredths of a
  second, one per frame, each ≥ 1.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/gif-timing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { gifFrameDelays } from "../export/gif-timing";

const total = (d: number[]) => d.reduce((a, b) => a + b, 0);

describe("gifFrameDelays", () => {
  it("is exact when the fps divides 100 evenly", () => {
    expect(gifFrameDelays(5, 25)).toEqual([4, 4, 4, 4, 4]);
    expect(gifFrameDelays(5, 20)).toEqual([5, 5, 5, 5, 5]);
    expect(gifFrameDelays(3, 10)).toEqual([10, 10, 10]);
  });

  // The reason this function exists: one rounded delay for every frame makes a 12fps shot play 4%
  // fast (8 hundredths instead of 8.33), so five seconds becomes 4.8 and drifts against whatever
  // the artist is matching.
  it("keeps the TRUE duration at 12fps by alternating, not rounding every frame the same", () => {
    const d = gifFrameDelays(60, 12);
    expect(total(d)).toBe(500); // 60 frames at 12fps = exactly 5.00s
    expect(new Set(d)).toEqual(new Set([8, 9])); // only ever one hundredth apart
  });

  it("keeps the true duration at 24fps too", () => {
    expect(total(gifFrameDelays(48, 24))).toBe(200);
  });

  it("never drifts more than a hundredth from the ideal at any point", () => {
    for (const fps of [12, 24, 15, 30, 7]) {
      let run = 0;
      gifFrameDelays(40, fps).forEach((d, i) => {
        run += d;
        expect(Math.abs(run - ((i + 1) * 100) / fps)).toBeLessThanOrEqual(0.5);
      });
    }
  });

  // A 0 delay is not "as fast as possible": browsers treat 0 (and 1, historically) as "unspecified"
  // and substitute 10 hundredths, i.e. a 10fps crawl — the opposite of what the number says.
  it("never emits 0, however high the fps", () => {
    for (const d of gifFrameDelays(20, 200)) expect(d).toBeGreaterThanOrEqual(1);
  });

  it("handles a single frame and an empty range", () => {
    expect(gifFrameDelays(1, 12)).toEqual([8]);
    expect(gifFrameDelays(0, 12)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/__tests__/gif-timing.test.ts`
Expected: FAIL — `Cannot find module '../export/gif-timing'`.

- [ ] **Step 3: Write the implementation**

Create `src/export/gif-timing.ts`:

```ts
/**
 * Per-frame delays for an animated GIF, in whole hundredths of a second.
 *
 * GIF has no sub-hundredth timing, so 12fps (8.33) and 24fps (4.17) cannot be expressed exactly.
 * Rounding every frame identically compounds the error: 60 frames at 12fps would total 4.80s instead
 * of 5.00s — 4% fast, and visibly adrift from any reference the artist is matching.
 *
 * So the delays are derived from the RUNNING TOTAL rather than from one rounded step: each frame gets
 * whatever is left between where the previous frame ended and where this one should end. At 12fps
 * that gives 8, 9, 8, 8, 9, … — never more than half a hundredth from the ideal at any point, and
 * exactly right at the end. Where the fps divides 100 evenly (25, 20, 10) every delay is identical,
 * because the arithmetic says so and not because of a special case.
 */
export function gifFrameDelays(frameCount: number, fps: number): number[] {
  const rate = fps > 0 ? fps : 1;
  const out: number[] = [];
  let emitted = 0; // hundredths already spent by earlier frames
  for (let i = 1; i <= frameCount; i++) {
    const target = Math.round((i * 100) / rate); // where frame `i` should END
    // Floored at 1: a 0 delay does NOT mean "as fast as possible" — browsers read it as unspecified
    // and substitute 10 hundredths, turning a fast GIF into a 10fps one.
    out.push(Math.max(1, target - emitted));
    emitted = target;
  }
  return out;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/__tests__/gif-timing.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/export/gif-timing.ts src/__tests__/gif-timing.test.ts
git commit -m "feat(gif): frame delays that keep the true duration

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The exporter

**Files:**
- Modify: `package.json` (add `gifenc`)
- Create: `src/export/gif.ts`

**Interfaces:**
- Consumes: `gifFrameDelays` (Task 1); `renderFrame` from `../anim/render`; `abortError`,
  `yieldToEventLoop`, `ExportProgress` from `./progress`; `Project` from `../anim/document`.
- Produces:
  ```ts
  export interface GifExportOptions extends ExportProgress { scale?: number }
  export async function exportGif(
    project: Project, dpr: number,
    range: { start: number; end: number },
    opts?: GifExportOptions,
  ): Promise<Blob>
  ```

There is no DOM or canvas in Vitest, so this task has no unit test; the build is its gate and Task 4
verifies it in a browser by parsing the bytes it writes.

- [ ] **Step 1: Add the dependency**

Run: `npm install gifenc@1.0.3`
Expected: `package.json` gains `"gifenc": "^1.0.3"` under `dependencies` (NOT devDependencies — it
ships in the bundle). Commit the lockfile change with the code below.

- [ ] **Step 2: Write the exporter**

Create `src/export/gif.ts`:

```ts
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { renderFrame } from "../anim/render";
import { gifFrameDelays } from "./gif-timing";
import { abortError, yieldToEventLoop, type ExportProgress } from "./progress";
import type { Project } from "../anim/document";

/** Colours in the global palette. Ink, paper and their anti-aliasing need far fewer than GIF's 256,
 *  and a smaller table is a smaller file. Raise it if a painted project ever looks posterised. */
const PALETTE_COLORS = 64;

/** Frames sampled to build that palette. One is not enough: a colour introduced later — a coloured
 *  layer switched on mid-shot — would otherwise be mapped to its nearest neighbour for the whole
 *  export. Five costs one extra render each and covers the shot. */
const PALETTE_SAMPLES = 5;

export interface GifExportOptions extends ExportProgress {
  /** 1 = document size, 0.5 = half. Clamped into (0, 1]. */
  scale?: number;
}

/**
 * Encode the range as an animated GIF (drawing layers over the paper background, reference layers
 * excluded, line boil applied when enabled — the same picture the PNG sequence exports).
 *
 * Shaped like `exportPngSequence` on purpose: same signature, same abort/progress contract, same
 * yield after every frame so the bar paints and Cancel is deliverable.
 */
export async function exportGif(
  project: Project,
  dpr: number,
  range: { start: number; end: number },
  { signal, onProgress, scale = 1 }: GifExportOptions = {},
): Promise<Blob> {
  const s = Math.min(1, Math.max(0.01, scale));
  const w = Math.max(1, Math.round(project.width * dpr * s));
  const h = Math.max(1, Math.round(project.height * dpr * s));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  const total = range.end - range.start + 1;
  const transparent = !!project.transparentBg;
  // GIF transparency is one bit per pixel, so RGBA4444 (the alpha channel quantised alongside the
  // colour) is as close as the format goes; a soft edge lands either fully opaque or fully clear.
  const format = transparent ? "rgba4444" : "rgb444";

  const draw = (frame: number) => {
    renderFrame(ctx, project, frame, dpr, {
      drawBg: !transparent,
      includeReference: false,
      boil: project.boil.enabled ? project.boil : undefined,
      outputScale: s,
    });
    return ctx.getImageData(0, 0, w, h).data;
  };

  // ── One global palette, sampled across the range ──────────────────────────────────────────────
  // Evenly spaced across the range, always including the first and last frame, deduped so a range
  // shorter than the sample count does not render the same frame twice.
  const sampleFrames: number[] = [];
  const span = Math.max(1, PALETTE_SAMPLES - 1);
  for (let i = 0; i < PALETTE_SAMPLES; i++) {
    const f = range.start + Math.round(((range.end - range.start) * i) / span);
    if (sampleFrames[sampleFrames.length - 1] !== f) sampleFrames.push(f);
  }

  const samples: Uint8ClampedArray[] = [];
  for (const f of sampleFrames) {
    if (signal?.aborted) throw abortError();
    samples.push(draw(f));
    await yieldToEventLoop();
  }
  const merged = new Uint8ClampedArray(samples.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of samples) {
    merged.set(a, at);
    at += a.length;
  }
  const palette = quantize(merged, PALETTE_COLORS, { format });

  // ── Encode ────────────────────────────────────────────────────────────────────────────────────
  const gif = GIFEncoder();
  const delays = gifFrameDelays(total, project.fps);
  for (let f = range.start; f <= range.end; f++) {
    // OUTSIDE the try below, deliberately: an abort must not be re-thrown as "frame N could not be
    // encoded", which would report a deliberate cancel as a defect. Same rule as the PNG sequence.
    if (signal?.aborted) throw abortError();
    const i = f - range.start;
    try {
      const index = applyPalette(draw(f), palette, format);
      gif.writeFrame(index, w, h, {
        // The global palette is written ONCE, with the first frame. Passing it again would write a
        // local palette per frame: same bytes on this kind of art, 2.2× the time (measured).
        palette: i === 0 ? palette : undefined,
        // gifenc takes MILLISECONDS and divides by 10 for the GIF's hundredths.
        delay: delays[i] * 10,
        transparent,
        transparentIndex: 0,
      });
    } catch (e) {
      throw new Error(
        `frame ${i + 1} of ${total} (timeline frame ${f + 1}) could not be encoded — ${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      );
    }
    onProgress?.(i + 1, total);
    await yieldToEventLoop(); // paint the bar, deliver a Cancel tap
  }
  if (signal?.aborted) throw abortError(); // the last frame's cancel, before the file is assembled
  gif.finish();
  return new Blob([gif.bytes() as Uint8Array<ArrayBuffer>], { type: "image/gif" });
}
```

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: `0 ERRORS 0 WARNINGS`.

If svelte-check reports that gifenc has no type declarations, add `src/gifenc.d.ts`:

```ts
declare module "gifenc" {
  export function GIFEncoder(): {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: {
        palette?: number[][];
        delay?: number;
        transparent?: boolean;
        transparentIndex?: number;
      },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  };
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: { format?: string },
  ): number[][];
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: string,
  ): Uint8Array;
}
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/export/gif.ts src/gifenc.d.ts
git commit -m "feat(gif): encode the range as an animated GIF

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The Export dialog

> **SUPERSEDED 2026-09-19 by the export-options spec** (`2026-09-19-export-dialog-options-design.md`):
> the dialog is being rebuilt as a format list plus options FIRST, so this task becomes "add GIF as
> one format, wired to the shared Size and the new Colours control" — not two buttons. Tasks 1, 2 and
> 4 stand as written; Task 2's `scale` option is exactly what the shared Size control feeds.

**Files:**
- Modify: `src/lib/ExportDialog.svelte`

**Interfaces:**
- Consumes: `exportGif` (Task 2).
- Produces: nothing for later tasks.

- [ ] **Step 1: Wire the kinds**

In `src/lib/ExportDialog.svelte`, add the import beside the other exporters:

```ts
  import { exportGif } from "../export/gif";
```

Widen the kind union (it currently reads `type ExportKind = "png" | "png-frame" | "psd" | VideoFormat;`):

```ts
  type ExportKind = "png" | "png-frame" | "psd" | "gif" | "gif-half" | VideoFormat;
```

`singleFrame()` is unchanged — a GIF is a per-frame loop, so it gets the progress bar and Cancel that
the PNG sequence and the videos use.

The status line builds from the kind, so give GIF its own label. Replace:

```ts
    status = `Exporting ${kind === "png-frame" ? "PNG" : kind.toUpperCase()}…`;
```

with:

```ts
    const label =
      kind === "png-frame" ? "PNG" : kind === "gif-half" ? "GIF (half size)" : kind.toUpperCase();
    status = `Exporting ${label}…`;
```

- [ ] **Step 2: Add the branch**

In `run()`, add this branch immediately after the `if (kind === "png") { … }` block and before
`else if (kind === "png-frame")`:

```ts
      } else if (kind === "gif" || kind === "gif-half") {
        const blob = await exportGif(appState.project, DPR, range, {
          signal,
          onProgress,
          scale: kind === "gif-half" ? 0.5 : 1,
        });
        closeAfter = await deliver(blob, `${stem}.gif`);
        status = "Done.";
```

Both sizes deliver as `${stem}.gif`: they are the same export at a different resolution, and a
`-half` suffix in the filename is noise in the place the file finally lands.

- [ ] **Step 3: Add the buttons**

In the format list, directly after the existing "PNG sequence" button and before "PNG (current
frame)", add:

```svelte
        <button
          class="border border-border rounded py-1 hover:bg-surface-hover"
          onclick={() => run("gif")}
        >
          GIF — {stem}.gif
        </button>
        <button
          class="border border-border rounded py-1 hover:bg-surface-hover"
          onclick={() => run("gif-half")}
        >
          GIF, half size — {stem}.gif
        </button>
```

- [ ] **Step 4: Add the transparency note**

GIF transparency is one bit per pixel, which is worth saying exactly where it bites. Beside the
existing reference-layer and boil notes, add:

```svelte
      {#if appState.project.transparentBg}
        <span class="text-xs text-text-secondary">
          GIF transparency is per pixel, on or off — soft edges against the transparent background
          will harden.
        </span>
      {/if}
```

- [ ] **Step 5: Verify**

Run: `npm run build && npm test`
Expected: 0 errors, 0 warnings; tests pass (the count from Task 1's run).

- [ ] **Step 6: Commit**

```bash
git add src/lib/ExportDialog.svelte
git commit -m "feat(gif): GIF and half-size GIF in the export dialog

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Browser verification and documentation

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/superpowers/CHANGELOG.md`

- [ ] **Step 1: Export a GIF and PARSE it**

Run `npm run dev`, open the app, draw a few frames (or open a project), then Export → GIF.

A GIF that plays is not enough evidence — parse what was written. In the browser console:

```js
const b = new Uint8Array(await (await fetch(URL.createObjectURL(blob))).arrayBuffer());
```

or simply re-export through the module and inspect the bytes. Check, and record in the changelog:

1. Signature `GIF89a` and the expected pixel dimensions (half those at half size).
2. Frame count equals the exported range.
3. **Exactly one** global palette — no frame after the first carries its own colour table.
4. The delay sequence matches `gifFrameDelays(frameCount, project.fps)` (at 12fps: 8s and 9s, never
   1 — a 1 would mean the milliseconds trap bit).
5. Loop count 0 (infinite), from the NETSCAPE2.0 extension.

Then open the file and watch it: it must animate, loop, and look like the artwork.

- [ ] **Step 2: Check the four surfaces that share this path**

1. A range set with In/Out exports only those frames.
2. Cancel mid-export leaves no file and reads "Cancelled — no file was written."
3. A transparent-background project exports with transparency, and the note appears.
4. Half size produces an image half the width and height, and a file appreciably smaller.

- [ ] **Step 3: Write the changelog entry**

Append a dated entry to `docs/superpowers/CHANGELOG.md` covering: the ask; what the spike measured
(gifenc's times and sizes, mediabunny's lack of GIF support); the global-palette and sampled-frames
choice; the timing function and WHY a flat rounded delay was rejected; the two gotchas (milliseconds,
first-frame-only palette); what was verified by parsing; and what remains owed (the iPad pass).
Follow the file's style: bold lead sentence with the date, then bullets.

- [ ] **Step 4: Update README and CLAUDE.md**

In `README.md`, add to the Files & export section:

```markdown
- **Animated GIF export**, full or half size — one global palette and frame delays that keep the true duration (a 12fps GIF really does last five seconds)
```

Run `npm test`, read the real number, and update the README scripts block (`pure-logic unit tests
(N)`) and `CLAUDE.md`'s `Baseline **N passing**`. Add GIF to the export list in CLAUDE.md's
"Current state" paragraph.

- [ ] **Step 5: Final verification and commit**

Run: `npm run build && npm test && npm run lint`
Expected: 0 errors, 0 warnings, tests pass, lint clean.

```bash
git add -A
git commit -m "docs: animated GIF export

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Deploy for the iPad pass**

Run `npm run deploy`, confirm the live bundle changed (compare the `index-*.js` name in
`dist/index.html` against a cache-busted fetch — the first fetch after a deploy can be stale), and
tell the user what to try: export a GIF on the iPad, check the encode time is tolerable, that Save to
Files offers it, and that the file plays in Photos and pastes into a chat.

---

## Self-review

**Spec coverage:** §1 exporter → Task 2. §2 palette (64 colours, 5 samples, rgba4444 when
transparent) → Task 2. §3 timing → Task 1. §4 UI (two buttons, shared progress/Cancel, transparency
note) → Task 3. §5 out of scope → no task adds dithering, per-frame palettes or differencing. §6
testing → Task 1's units and Task 4's parse-the-bytes pass. §7 risks → the dependency lands in Task
2; the `getImageData` cost is inherent and covered by the existing progress/Cancel.

**Placeholders:** none — every step carries its code or its exact command.

**Type consistency:** `gifFrameDelays(frameCount, fps): number[]` is defined in Task 1 and consumed
under that name in Task 2. `exportGif`'s signature is defined in Task 2 and called with exactly those
arguments in Task 3. `ExportKind` gains `"gif" | "gif-half"` in Task 3 and both are handled in the
same task's branch and status label.
