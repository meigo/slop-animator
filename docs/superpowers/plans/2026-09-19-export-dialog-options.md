# Export dialog with options — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Export dialog's flat list of buttons with a grouped format list plus the
options that apply to the chosen format — size, frame range, and per-format quality — and one Export
button.

**Architecture:** One session-only `exportOptions` object on the store, one pure unit-tested range
resolver (`src/export/export-range.ts`), additive `scale`/`quality` parameters on the existing
exporters, and a rebuilt dialog body. The busy panel, progress bar, Cancel and Save-to-Files delivery
are untouched — they already handle every format.

**Tech Stack:** Svelte 5 runes, TypeScript, Tailwind 4, Vitest (node env, no DOM).

**Spec:** `docs/superpowers/specs/2026-09-19-export-dialog-options-design.md`

## Global Constraints

- `npm run build` (svelte-check + tsc + vite build) must end with **0 errors, 0 warnings**; the
  pre-existing "chunks are larger than 500 kB" notice is not a warning this gate counts.
- Test baseline before this work: **1394 passing** (this branch descends from `main`; the 1399 count belongs to the unmerged `fix/boil-step-across-keys` branch). Update the counts in `README.md` and `CLAUDE.md`
  in the final task, from a real `npm test` run.
- `npm run lint` clean. A pre-commit hook reformats staged files; expect that.
- Commit messages end with: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- Runes mode. A component using the `$state` rune imports the store as `import { state as appState }`
  (CLAUDE.md gotcha #1) — `ExportDialog.svelte` already does.
- **Defaults must reproduce today's behaviour exactly**: scale 1, range mode `inout`, video quality
  high. Someone who never touches the options sees no change.
- **`exportOptions` is session state**, like `onion` and `pose`: on `appState`, never in `Project`,
  never persisted, never in an undo snapshot.
- iPad-first: every control is a tap target in a 320px-wide panel; no hover-only affordances.

---

## File structure

| File | Responsibility |
|---|---|
| `src/export/export-range.ts` (new) | Pure: resolve the three range modes to `{start, end}`; pixel size for a scale. |
| `src/__tests__/export-range.test.ts` (new) | Unit tests for both. |
| `src/state/appState.svelte.ts` | `ExportOptions` type, `exportOptions` field, defaults. |
| `src/export/png-sequence.ts` | `scale` on `exportCanvas` / `renderFramePng` / `exportPngSequence`. |
| `src/export/video.ts` | `scale` and `quality` on `exportVideo`. |
| `src/lib/ExportDialog.svelte` | The rebuilt body: format list, options, Export button. |
| `README.md`, `CLAUDE.md`, `docs/superpowers/CHANGELOG.md` | Documentation. |

---

### Task 1: Range resolution and pixel size

**Files:**
- Create: `src/export/export-range.ts`
- Test: `src/__tests__/export-range.test.ts`

**Interfaces:**
- Consumes: `effectiveRange` from `../anim/playback`.
- Produces:
  ```ts
  export type ExportRangeMode = "all" | "inout" | "custom";
  export function resolveExportRange(
    opts: { rangeMode: ExportRangeMode; customStart: number; customEnd: number },
    playRange: { in: number; out: number } | null,
    frameCount: number,
  ): { start: number; end: number };
  export function exportPixelSize(
    width: number, height: number, scale: number,
  ): { w: number; h: number };
  ```

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/export-range.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveExportRange, exportPixelSize } from "../export/export-range";

const opts = (rangeMode: "all" | "inout" | "custom", customStart = 0, customEnd = 0) => ({
  rangeMode,
  customStart,
  customEnd,
});

describe("resolveExportRange", () => {
  it("all: the whole animation, whatever the play range says", () => {
    expect(resolveExportRange(opts("all"), { in: 3, out: 5 }, 10)).toEqual({ start: 0, end: 9 });
  });

  it("inout: exactly the play range — today's behaviour, now explicit", () => {
    expect(resolveExportRange(opts("inout"), { in: 3, out: 5 }, 10)).toEqual({ start: 3, end: 5 });
  });

  it("inout with no range set, or an inverted one, is the whole animation", () => {
    expect(resolveExportRange(opts("inout"), null, 10)).toEqual({ start: 0, end: 9 });
    expect(resolveExportRange(opts("inout"), { in: 7, out: 2 }, 10)).toEqual({ start: 0, end: 9 });
  });

  it("custom: the typed pair, ignoring the play range", () => {
    expect(resolveExportRange(opts("custom", 2, 6), { in: 0, out: 1 }, 10)).toEqual({
      start: 2,
      end: 6,
    });
  });

  it("custom: a reversed pair exports that span rather than nothing", () => {
    expect(resolveExportRange(opts("custom", 6, 2), null, 10)).toEqual({ start: 2, end: 6 });
  });

  it("custom: clamps past either end of the document", () => {
    expect(resolveExportRange(opts("custom", -5, 999), null, 10)).toEqual({ start: 0, end: 9 });
  });

  it("a one-frame document exports that one frame in every mode", () => {
    for (const m of ["all", "inout", "custom"] as const) {
      expect(resolveExportRange(opts(m, 4, 8), { in: 2, out: 3 }, 1)).toEqual({ start: 0, end: 0 });
    }
  });
});

describe("exportPixelSize", () => {
  it("scales and rounds, never to zero", () => {
    expect(exportPixelSize(1280, 720, 1)).toEqual({ w: 1280, h: 720 });
    expect(exportPixelSize(1280, 720, 0.5)).toEqual({ w: 640, h: 360 });
    expect(exportPixelSize(1281, 721, 0.25)).toEqual({ w: 320, h: 180 });
    expect(exportPixelSize(3, 3, 0.25)).toEqual({ w: 1, h: 1 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/__tests__/export-range.test.ts`
Expected: FAIL — `Cannot find module '../export/export-range'`.

- [ ] **Step 3: Write the implementation**

Create `src/export/export-range.ts`:

```ts
import { effectiveRange } from "../anim/playback";

export type ExportRangeMode = "all" | "inout" | "custom";

/**
 * Which frames an export writes.
 *
 * Until 2026-09-19 every exporter silently followed the play In/Out range, so a range set an hour
 * ago and forgotten shortened the file and the dialog could only warn about it afterwards. The mode
 * makes that a choice; `inout` stays the DEFAULT, so nothing changes for anyone who ignores it.
 */
export function resolveExportRange(
  opts: { rangeMode: ExportRangeMode; customStart: number; customEnd: number },
  playRange: { in: number; out: number } | null,
  frameCount: number,
): { start: number; end: number } {
  const last = Math.max(0, frameCount - 1);
  if (opts.rangeMode === "all") return { start: 0, end: last };
  if (opts.rangeMode === "inout") return effectiveRange(playRange, frameCount);
  const a = Math.max(0, Math.min(last, Math.round(opts.customStart)));
  const b = Math.max(0, Math.min(last, Math.round(opts.customEnd)));
  // Reversed pair → that span, not nothing: typing the end first is a slip, not an instruction to
  // export zero frames.
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/** The pixel size an export writes at `scale` — what the dialog's size label must show, so the
 *  label cannot drift from what is actually rendered. Floored at 1: a 25% export of a tiny document
 *  still has to have pixels. */
export function exportPixelSize(
  width: number,
  height: number,
  scale: number,
): { w: number; h: number } {
  return {
    w: Math.max(1, Math.round(width * scale)),
    h: Math.max(1, Math.round(height * scale)),
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/__tests__/export-range.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/export/export-range.ts src/__tests__/export-range.test.ts
git commit -m "feat(export): resolve the export range from an explicit mode

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The options on the store

**Files:**
- Modify: `src/state/appState.svelte.ts`

**Interfaces:**
- Consumes: `ExportRangeMode` from `../export/export-range` (Task 1).
- Produces: `ExportFormat`, `ExportOptions`, `defaultExportOptions()`, and `state.exportOptions`.

- [ ] **Step 1: Add the type and the field**

In `src/state/appState.svelte.ts`, beside the other session-only UI state (`onion`, `pose`), add:

```ts
export type ExportFormat = "png-sequence" | "png-frame" | "psd-frame" | "gif" | "mp4" | "webm";

/** Session-only export settings — deliberately NOT part of `Project` (they describe an output, not
 *  the artwork), NOT persisted (the same reasoning as `onion`), and never in an undo snapshot. */
export interface ExportOptions {
  format: ExportFormat;
  /** 1 | 0.5 | 0.25. PSD ignores it and always writes at 100%. */
  scale: number;
  rangeMode: ExportRangeMode;
  /** Read only when `rangeMode === "custom"`; 0-based, inclusive, clamped where it is used. */
  customStart: number;
  customEnd: number;
  gifColors: number;
  videoQuality: "low" | "medium" | "high";
}

export function defaultExportOptions(): ExportOptions {
  // Every default reproduces the pre-2026-09-19 behaviour exactly: document size, the play In/Out
  // range, and the quality `exportVideo` used to hardcode.
  return {
    format: "png-sequence",
    scale: 1,
    rangeMode: "inout",
    customStart: 0,
    customEnd: 0,
    gifColors: 64,
    videoQuality: "high",
  };
}
```

Add `exportOptions: ExportOptions;` to the state interface next to `exportOpen`/`exportBusy`, and
`exportOptions: defaultExportOptions(),` to the object that initialises it.

- [ ] **Step 2: Verify**

Run: `npm run build && npm test`
Expected: 0 errors, 0 warnings; tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/state/appState.svelte.ts
git commit -m "feat(export): session-only export options on the store

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Scale and quality on the exporters

**Files:**
- Modify: `src/export/png-sequence.ts`
- Modify: `src/export/video.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `exportCanvas(project, dpr, scale = 1)`
  - `renderFramePng(canvas, project, frame, dpr, scale = 1)`
  - `exportPngSequence(project, dpr, range, { signal, onProgress, scale })`
  - `exportVideo(project, dpr, format, range, { signal, onProgress, scale, quality })`

- [ ] **Step 1: PNG paths take a scale**

In `src/export/png-sequence.ts`:

```ts
/** A fresh canvas at the project's export size, scaled by `scale` (1 = document size). */
export function exportCanvas(project: Project, dpr: number, scale = 1): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(project.width * dpr * scale));
  canvas.height = Math.max(1, Math.round(project.height * dpr * scale));
  return canvas;
}
```

`renderFramePng` gains the same trailing parameter and passes it to `renderFrame` as `outputScale`:

```ts
export async function renderFramePng(
  canvas: HTMLCanvasElement,
  project: Project,
  frame: number,
  dpr: number,
  scale = 1,
): Promise<Blob> {
  const ctx = canvas.getContext("2d")!;
  renderFrame(ctx, project, frame, dpr, {
    drawBg: !project.transparentBg,
    includeReference: false,
    boil: project.boil.enabled ? project.boil : undefined,
    outputScale: scale,
  });
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
  );
}
```

`exportPngSequence`'s options object gains `scale?: number` (default 1), it builds its canvas with
`exportCanvas(project, dpr, scale)` and passes `scale` through to `renderFramePng`. Nothing else in
the loop changes — the filenames, the level-0 zip entries and the abort checks all stay.

- [ ] **Step 2: Video takes a scale and a quality**

In `src/export/video.ts`, import the quality constants alongside the existing ones:

```ts
import { QUALITY_HIGH, QUALITY_MEDIUM, QUALITY_LOW } from "mediabunny";
```

Add to the options parameter `scale = 1` and `quality: "low" | "medium" | "high" = "high"`, then:

```ts
  // Rounded UP to even AFTER scaling: H.264 needs even dimensions, and rounding down would crop the
  // last row/column — the rule `evenDimensions` already records.
  const { w, h } = evenDimensions(
    Math.max(1, Math.round(project.width * dpr * scale)),
    Math.max(1, Math.round(project.height * dpr * scale)),
  );
```

and the source's bitrate:

```ts
  const bitrate =
    quality === "low" ? QUALITY_LOW : quality === "medium" ? QUALITY_MEDIUM : QUALITY_HIGH;
  const source = new CanvasSource(canvas, {
    codec: format === "mp4" ? "avc" : "vp9",
    bitrate,
  });
```

and the per-frame render gains `outputScale: scale` beside its existing options.

- [ ] **Step 3: Verify**

Run: `npm run build && npm test`
Expected: 0 errors, 0 warnings; tests pass. Every existing call site omits the new arguments and so
keeps today's behaviour.

- [ ] **Step 4: Commit**

```bash
git add src/export/png-sequence.ts src/export/video.ts
git commit -m "feat(export): scale on the PNG paths, scale and quality on video

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The dialog

**Files:**
- Modify: `src/lib/ExportDialog.svelte`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: nothing for later tasks.

This is the only task with no unit test (no DOM in Vitest); Task 5 verifies it in a browser.

- [ ] **Step 1: Replace the kind plumbing with the format option**

`run()` currently takes an `ExportKind`. It now reads the chosen format from the store instead, so
the Export button calls `run()` with no argument. Keep the existing `singleFrame()` idea, rewritten
against the format union:

```ts
  const opts = $derived(appState.exportOptions);
  const singleFrame = (f: ExportFormat) => f === "psd-frame" || f === "png-frame";
  // PSD always writes at 100%; every other format honours the size control.
  const scaleFor = (f: ExportFormat) => (f === "psd-frame" ? 1 : opts.scale);
```

The range comes from the resolver rather than straight from the playbar:

```ts
  const range = $derived(
    resolveExportRange(opts, appState.playback.range, appState.project.frameCount),
  );
```

`partial` (the existing "In/Out is set" note) is now only interesting in `inout` mode — the other two
modes SAY what they export, so the warning would be noise:

```ts
  const partial = $derived(
    opts.rangeMode === "inout" && range.end - range.start + 1 < appState.project.frameCount,
  );
```

- [ ] **Step 2: Route `run()` by format**

Replace the `kind` switch with one on `opts.format`, keeping every branch's body as it is apart from
the new arguments:

```ts
  async function run() {
    if (busy) return;
    const format = opts.format;
    const scale = scaleFor(format);
    // …the existing busy/pause/liftGuard/exportBusy/controller/status setup, with:
    //   status = `Exporting ${formatLabel(format)}…`;
    let closeAfter = false;
    try {
      if (format === "png-sequence") {
        const blob = await exportPngSequence(appState.project, DPR, range, {
          signal,
          onProgress,
          scale,
        });
        closeAfter = await deliver(blob, `${stem}.zip`);
      } else if (format === "png-frame") {
        await yieldToEventLoop();
        const blob = await renderFramePng(
          exportCanvas(appState.project, DPR, scale),
          appState.project,
          appState.playhead,
          DPR,
          scale,
        );
        closeAfter = await deliver(blob, pngFrameFilename);
      } else if (format === "psd-frame") {
        await yieldToEventLoop();
        const bytes = exportPsdFrame(appState.project, appState.playhead, DPR);
        closeAfter = await deliver(
          new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/vnd.adobe.photoshop" }),
          psdFilename,
        );
      } else {
        const { blob, warning } = await exportVideo(appState.project, DPR, format, range, {
          signal,
          onProgress,
          scale,
          quality: opts.videoQuality,
        });
        const note = warning ? `exported without audio: ${warning}` : "";
        closeAfter = await deliver(blob, `${stem}.${format}`, note);
        status = warning ? `Done — ${note}.` : "Done.";
      }
      // …the existing catch/finally/closeAfter tail, unchanged
    }
  }
```

Keep every comment that explains WHY a branch is shaped as it is (the PSD yield, the PNG-frame yield,
the abort-is-not-a-failure catch). They are still true.

The `"gif"` format is part of the union but has no branch yet — the GIF plan adds it. Until then,
guard the format list so GIF is not selectable (see Step 3's `available()`), rather than letting
`run()` fall through to the video branch.

- [ ] **Step 3: The format list**

Replace the column of format buttons (inside the `{:else}` of the busy check) with a grouped
two-column radio grid. Each row is a `<button>` with `aria-pressed`, not an `<input type=radio>`:
this codebase's other segmented pickers are buttons, and a real radio inside the dialog would need
its own focus styling for no gain.

```svelte
        {#snippet formatRow(f: ExportFormat, label: string, enabled = true)}
          <button
            class="border border-border rounded py-1 text-xs hover:bg-surface-hover aria-disabled:opacity-40 aria-disabled:hover:bg-transparent"
            class:ui-on={opts.format === f}
            aria-pressed={opts.format === f}
            aria-disabled={!enabled}
            onclick={() => enabled && (appState.exportOptions.format = f)}>{label}</button
          >
        {/snippet}

        <span class="text-text-secondary text-xs uppercase tracking-wide">Image</span>
        <div class="grid grid-cols-2 gap-1">
          {@render formatRow("png-sequence", "PNG sequence")}
          {@render formatRow("png-frame", "PNG frame")}
          {@render formatRow("psd-frame", "PSD frame")}
        </div>
        <span class="text-text-secondary text-xs uppercase tracking-wide">Video</span>
        <div class="grid grid-cols-2 gap-1">
          {@render formatRow("mp4", "MP4", videoOk)}
          {@render formatRow("webm", "WebM", videoOk)}
        </div>
```

`ui-on` is the codebase's single on-state class (`app.css` defines it as the accent fill, and its
comment says every shared on-state goes through it) — do not hand-roll `bg-accent` here, which is
exactly what that comment forbids.

- [ ] **Step 4: The options**

Below the format list, only the controls that apply to the chosen format:

```svelte
        <span class="text-text-secondary text-xs uppercase tracking-wide">Options</span>
        {#if opts.format !== "psd-frame"}
          <div class="flex items-center gap-1 text-xs">
            <span class="w-10 text-text-secondary">Size</span>
            {#each [1, 0.5, 0.25] as s (s)}
              <button
                class="flex-1 border border-border rounded py-1 hover:bg-surface-hover"
                class:ui-on={opts.scale === s}
                aria-pressed={opts.scale === s}
                onclick={() => (appState.exportOptions.scale = s)}>{s * 100}%</button
              >
            {/each}
            <span class="text-text-muted tabular-nums">{pixels.w}×{pixels.h}</span>
          </div>
        {/if}
        {#if !singleFrame(opts.format)}
          <div class="flex items-center gap-1 text-xs">
            <span class="w-10 text-text-secondary">Range</span>
            {#each [["all", "All"], ["inout", "In/Out"], ["custom", "Custom"]] as const as [m, label] (m)}
              <button
                class="flex-1 border border-border rounded py-1 hover:bg-surface-hover"
                class:ui-on={opts.rangeMode === m}
                aria-pressed={opts.rangeMode === m}
                onclick={() => (appState.exportOptions.rangeMode = m)}>{label}</button
              >
            {/each}
          </div>
          {#if opts.rangeMode === "custom"}
            <div class="flex items-center gap-2 text-xs">
              <span class="w-10 text-text-secondary">Frames</span>
              <NumberField
                class="w-14 bg-surface border border-border rounded px-1 text-xs text-text"
                value={opts.customStart + 1}
                min={1}
                max={appState.project.frameCount}
                step={1}
                title="First frame to export"
                ariaLabel="First frame to export"
                onInput={(v) => (appState.exportOptions.customStart = v - 1)}
                onCommit={(v) => (appState.exportOptions.customStart = v - 1)}
              />
              <span class="text-text-muted">–</span>
              <NumberField
                class="w-14 bg-surface border border-border rounded px-1 text-xs text-text"
                value={opts.customEnd + 1}
                min={1}
                max={appState.project.frameCount}
                step={1}
                title="Last frame to export"
                ariaLabel="Last frame to export"
                onInput={(v) => (appState.exportOptions.customEnd = v - 1)}
                onCommit={(v) => (appState.exportOptions.customEnd = v - 1)}
              />
              <span class="text-text-muted tabular-nums">{range.end - range.start + 1} frames</span>
            </div>
          {/if}
        {/if}
        {#if opts.format === "mp4" || opts.format === "webm"}
          <div class="flex items-center gap-1 text-xs">
            <span class="w-10 text-text-secondary">Quality</span>
            {#each [["low", "Low"], ["medium", "Medium"], ["high", "High"]] as const as [q, label] (q)}
              <button
                class="flex-1 border border-border rounded py-1 hover:bg-surface-hover"
                class:ui-on={opts.videoQuality === q}
                aria-pressed={opts.videoQuality === q}
                onclick={() => (appState.exportOptions.videoQuality = q)}>{label}</button
              >
            {/each}
          </div>
        {/if}
```

The frame fields are 1-BASED in the UI and 0-based in the store, matching every other frame number
the app shows (the timeline, the PSD filename). `pixels` is:

```ts
  const pixels = $derived(
    exportPixelSize(appState.project.width, appState.project.height, scaleFor(opts.format)),
  );
```

- [ ] **Step 5: Filename line and Export button**

```svelte
        <span class="text-xs text-text-muted">{outputName}</span>
        <button
          class="border border-border rounded py-1 hover:bg-surface-hover aria-disabled:opacity-40 aria-disabled:hover:bg-transparent"
          class:ui-on={formatAvailable}
          aria-disabled={!formatAvailable}
          onclick={() => formatAvailable && run()}>Export</button
        >
```

with

```ts
  const outputName = $derived(
    opts.format === "png-sequence"
      ? `${stem}.zip`
      : opts.format === "png-frame"
        ? pngFrameFilename
        : opts.format === "psd-frame"
          ? psdFilename
          : `${stem}.${opts.format}`,
  );
  const formatAvailable = $derived(
    opts.format === "mp4" || opts.format === "webm" ? videoOk : true,
  );
```

Keep the existing notes (In/Out, references, boil, video-unsupported) below the button, unchanged
except for `partial` from Step 1.

- [ ] **Step 6: Verify**

Run: `npm run build && npm test && npm run lint`
Expected: 0 errors, 0 warnings; tests pass; lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ExportDialog.svelte
git commit -m "feat(export): pick a format, then set its options

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Browser verification and documentation

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/superpowers/CHANGELOG.md`

- [ ] **Step 1: Exercise every format and option in the browser**

Run `npm run dev`, open a project with several frames, and check:

1. **Each format exports** and produces the named file: PNG sequence (zip), PNG frame, PSD frame,
   MP4, WebM.
2. **Size 50%** halves the pixels — open the written PNG and check its dimensions, do not trust the
   label. 25% likewise. PSD shows no size control at all.
3. **Range All** exports every frame; **In/Out** matches the playbar; **Custom** exports exactly the
   typed span, and a reversed pair still exports that span.
4. **Video quality Low** produces a visibly smaller file than High for the same clip.
5. **Cancel** mid-export still leaves no file, and the message still reads "Cancelled".
6. **Without WebCodecs** (or by forcing `videoOk` false) the video rows dim and still explain
   themselves; Export refuses rather than throwing.

- [ ] **Step 2: Check the panel on a narrow viewport**

Resize the window to roughly an iPad portrait width and confirm the dialog does not scroll or clip:
the format grid, the option rows and the Export button must all be visible at once. If it clips, say
so in the report rather than silently shrinking the text — the spec calls this out as the main risk.

- [ ] **Step 3: Documentation**

Append a dated entry to `docs/superpowers/CHANGELOG.md` covering: the ask; the format list plus
options; that defaults reproduce the old behaviour exactly; the range modes and why `inout` stayed
the default; PSD's exemption from size; what was deliberately left out (size estimate, persistence,
reference/boil toggles); and what was verified where.

In `README.md`, replace the export bullets' flat list with a line describing the dialog: pick a
format, set size (100/50/25%), frame range (all / In-Out / custom) and video quality. Run `npm test`
and update the count in the README scripts block and `CLAUDE.md`'s `Baseline **N passing**`.

- [ ] **Step 4: Final verification and commit**

Run: `npm run build && npm test && npm run lint`

```bash
git add -A
git commit -m "docs: export dialog with options

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Deploy for the iPad pass**

Run `npm run deploy`, confirm the live bundle changed (compare `dist/index.html`'s `index-*.js`
against a cache-busted fetch; the first fetch after a deploy can be stale), and tell the user what to
try: the panel fits in portrait, the segmented controls are tappable with a finger, the custom-range
fields drag to change, and an export still reaches Save to Files.

---

## Self-review

**Spec coverage:** §1 model → Task 2. §2 range resolution → Task 1. §3 size (including PSD's
exemption and video's even-dimension rounding) → Tasks 3 and 4. §4 quality → Tasks 3 and 4. §5 dialog
→ Task 4. §6 exporter signatures → Task 3. §7 out of scope → no task adds an estimate, persistence or
extra toggles. §8 testing → Task 1's units, Task 5's browser pass. §9 risks → Task 5 Step 2 measures
the panel width explicitly.

**Placeholders:** none — every step carries its code or its exact command.

**Type consistency:** `ExportRangeMode` is defined in Task 1 and imported by Task 2's `ExportOptions`.
`ExportFormat` is defined in Task 2 and used by Task 4's `formatRow`, `scaleFor`, `outputName` and
`run()`. `resolveExportRange` and `exportPixelSize` are defined in Task 1 and called in Task 4 with
exactly those signatures. The exporters' new parameters are defined in Task 3 and passed in Task 4.
`"gif"` exists in the union from Task 2 but is unselectable until the GIF plan adds its branch, which
Task 4 Step 2 states.
