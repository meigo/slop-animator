# Plan 6 — Export (PNG sequence + video) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export the animation as a numbered PNG sequence (zipped) or as an MP4/WebM video, compositing drawing layers over the paper background and excluding reference layers.

**Architecture:** Each frame is rendered to an offscreen canvas via the existing `renderFrame` with a new `includeReference:false` option (so reference layers and onion are excluded). PNG sequence zips the per-frame PNGs with `fflate`. Video uses `mediabunny` (zero-dependency WebCodecs wrapper, successor to webm-muxer/mp4-muxer) driving a `CanvasSource` — redraw the canvas per frame, `source.add(t, dt)`, finalize to a `Blob`. An `ExportDialog` offers the three outputs; video options are disabled when WebCodecs is unavailable.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vitest, `fflate` (zip), `mediabunny` (MP4/WebM via WebCodecs).

> ⚠️ **VERIFICATION NOTE:** the pure helpers (`frameFileName`, `evenDimensions`) and the `renderFrame` `includeReference` passthrough are unit-tested. The actual **PNG-zip and video encoding are browser-only** (`canvas.toBlob`, WebCodecs) and NOT unit-testable — those tasks' gate is type-check/build/no-regression plus **human** verification (export a clip and open the files). Do not claim a real file was produced from automated checks alone.

**Builds on Plans 1–5 (on `main`).** Relevant existing code:
- `src/anim/render.ts`: `renderFrame(ctx, project, frame, dpr, opts)` where `opts = { drawBg?: boolean }`, and `compositeFrameLayers(ctx, project, frame, dpr, includeReference=true)`.
- `src/anim/document.ts`: `Project { width, height, fps, bgColor, frameCount, layers }`.
- `src/state/appState.svelte.ts`: `state`, `DPR`.
- `src/lib/Toolbar.svelte`: existing tool/import buttons.
- tsconfig: `erasableSyntaxOnly`, `noUnusedLocals`.

---

## File Structure

```
src/
  anim/render.ts          ← MODIFY: renderFrame gains includeReference option
  export/
    frames.ts             ← NEW: pure helpers frameFileName, evenDimensions (+ exportCanvas dims)
    png-sequence.ts       ← NEW: exportPngSequence(project, dpr) → zip Blob (fflate)
    video.ts              ← NEW: exportVideo(project, dpr, format) + isVideoExportSupported (mediabunny)
    download.ts           ← NEW: downloadBlob(blob, filename)
  lib/ExportDialog.svelte ← NEW: modal with PNG/MP4/WebM buttons + status
  lib/Toolbar.svelte      ← MODIFY: "Export" button toggling the dialog
  App.svelte              ← MODIFY: mount ExportDialog (state-driven open/close)
  __tests__/export.test.ts ← NEW (frameFileName, evenDimensions)
  __tests__/render.test.ts ← MODIFY (includeReference passthrough)
```

---

## Task 1: Add dependencies + `renderFrame` includeReference option

**Files:**
- Modify: `package.json`, `src/anim/render.ts`
- Test: `src/__tests__/render.test.ts`

- [ ] **Step 1: Install the two runtime dependencies**

Run:
```bash
npm install fflate mediabunny
```
Expected: both added to `dependencies`, install succeeds with 0 vulnerabilities. (Both are zero-dependency, ESM, browser-oriented; they only need to type-check and bundle here.)

- [ ] **Step 2: Add a failing test for the includeReference passthrough**

Append to `src/__tests__/render.test.ts` (the `recordingCtx`, `keyCanvas`, `layer`, and the `createReferenceLayer`/`imageMedia` helpers already exist from Plans 2 & 5 — reuse them):
```ts
describe("renderFrame includeReference", () => {
  function imageMediaR(id: number, w = 50, h = 50) {
    return { type: "image" as const, el: { __id: id, naturalWidth: w, naturalHeight: h } as unknown as HTMLImageElement };
  }
  it("excludes reference layers when opts.includeReference is false", () => {
    const ref = createReferenceLayer(imageMediaR(7), "bg");
    ref.id = 1;
    const drawC = keyCanvas();
    const p: Project = {
      width: 100, height: 100, fps: 12, bgColor: "#fff", frameCount: 1,
      layers: [ref, layer([{ kind: "key", canvas: drawC }], { id: 2 })],
    };
    const ctx = recordingCtx();
    renderFrame(ctx as unknown as CanvasRenderingContext2D, p, 0, 1, { drawBg: false, includeReference: false });
    // The ref media (sized draw) must NOT appear; only the drawing layer's keyframe.
    expect(ctx.calls.filter((c) => c.startsWith("drawImage"))).toEqual([
      `drawImage:${(drawC as unknown as { __id: number }).__id}@1`,
    ]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- render`
Expected: FAIL — `renderFrame` ignores `includeReference`, so the ref media (`drawImage:7@...:sized`) appears.

- [ ] **Step 4: Implement the option**

In `src/anim/render.ts`, change the `RenderOpts` interface:
```ts
interface RenderOpts {
  /** Paint the project background color first. Default true. */
  drawBg?: boolean;
  /** Include reference layers. Default true (display); export passes false. */
  includeReference?: boolean;
}
```
In `renderFrame`, change the destructure and the `compositeFrameLayers` call. The current body is:
```ts
  const { drawBg = true } = opts;
  …
  compositeFrameLayers(ctx, project, frame, dpr);
```
Change to:
```ts
  const { drawBg = true, includeReference = true } = opts;
  …
  compositeFrameLayers(ctx, project, frame, dpr, includeReference);
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- render` — PASS. Then `npm run check` — 0 errors (`fflate`/`mediabunny` types resolve; they're not yet imported so only package presence matters).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/anim/render.ts src/__tests__/render.test.ts
git commit -m "feat(export): add fflate+mediabunny deps; renderFrame includeReference option"
```

---

## Task 2: Pure export helpers (`export/frames.ts`)

**Files:**
- Create: `src/export/frames.ts`
- Test: `src/__tests__/export.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/export.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { frameFileName, evenDimensions } from "../export/frames";

describe("frameFileName", () => {
  it("zero-pads to at least 4 digits, 1-based", () => {
    expect(frameFileName(0, 3)).toBe("frame_0001.png");
    expect(frameFileName(9, 3)).toBe("frame_0010.png");
  });
  it("widens padding for large frame counts", () => {
    expect(frameFileName(0, 20000)).toBe("frame_00001.png");
  });
});

describe("evenDimensions", () => {
  it("rounds odd dimensions down to even (required by H.264)", () => {
    expect(evenDimensions(1281, 721)).toEqual({ w: 1280, h: 720 });
  });
  it("leaves even dimensions unchanged", () => {
    expect(evenDimensions(1280, 720)).toEqual({ w: 1280, h: 720 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- export`
Expected: FAIL — cannot find module `../export/frames`.

- [ ] **Step 3: Implement**

Create `src/export/frames.ts`:
```ts
/** Zero-padded, 1-based PNG filename for frame `i` of `total`. */
export function frameFileName(i: number, total: number): string {
  const pad = Math.max(4, String(total).length);
  return `frame_${String(i + 1).padStart(pad, "0")}.png`;
}

/** Round dimensions down to even values (H.264 / many encoders require even width & height). */
export function evenDimensions(w: number, h: number): { w: number; h: number } {
  return { w: w - (w % 2), h: h - (h % 2) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- export` — PASS (4 assertions). `npm run check` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/export/frames.ts src/__tests__/export.test.ts
git commit -m "feat(export): pure frame-name + even-dimension helpers"
```

---

## Task 3: PNG sequence export + download helper

**Files:**
- Create: `src/export/png-sequence.ts`, `src/export/download.ts`

These are DOM-only (canvas.toBlob, object URLs) — no unit tests; verified by build + manual.

- [ ] **Step 1: Create `src/export/download.ts`**

```ts
/** Trigger a browser download of `blob` as `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Create `src/export/png-sequence.ts`**

```ts
import { zipSync } from "fflate";
import { renderFrame } from "../anim/render";
import { frameFileName } from "./frames";
import type { Project } from "../anim/document";

/**
 * Render every frame (drawing layers over the paper background, reference layers excluded)
 * to a PNG and return a zip Blob containing `frame_0001.png`, `frame_0002.png`, ….
 */
export async function exportPngSequence(project: Project, dpr: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = project.width * dpr;
  canvas.height = project.height * dpr;
  const ctx = canvas.getContext("2d")!;

  const files: Record<string, Uint8Array> = {};
  for (let f = 0; f < project.frameCount; f++) {
    renderFrame(ctx, project, f, dpr, { drawBg: true, includeReference: false });
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png")
    );
    files[frameFileName(f, project.frameCount)] = new Uint8Array(await blob.arrayBuffer());
  }
  return new Blob([zipSync(files)], { type: "application/zip" });
}
```

- [ ] **Step 3: Verify**

Run: `npm run check` — 0 errors (`fflate`'s `zipSync` typed; `renderFrame` opts accept `includeReference`). `npm test` — all pass (no new unit tests). `npx vite build` — succeeds (fflate bundles).

- [ ] **Step 4: Commit**

```bash
git add src/export/png-sequence.ts src/export/download.ts
git commit -m "feat(export): PNG-sequence zip export + download helper"
```

---

## Task 4: Video export (`export/video.ts`)

**Files:**
- Create: `src/export/video.ts`

DOM/WebCodecs only — no unit tests; **highest-risk, browser-only** (manual verification required).

- [ ] **Step 1: Create `src/export/video.ts`**

```ts
import { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, QUALITY_HIGH } from "mediabunny";
import { renderFrame } from "../anim/render";
import { evenDimensions } from "./frames";
import type { Project } from "../anim/document";

export type VideoFormat = "mp4" | "webm";

/** Video export needs the WebCodecs VideoEncoder (Chromium/Edge, Safari 16.4+). */
export function isVideoExportSupported(): boolean {
  return typeof window !== "undefined" && "VideoEncoder" in window;
}

/**
 * Encode every frame (drawing layers over the paper background, reference layers excluded)
 * to an MP4 (H.264) or WebM (VP9) Blob via mediabunny + WebCodecs.
 */
export async function exportVideo(project: Project, dpr: number, format: VideoFormat): Promise<Blob> {
  if (!isVideoExportSupported()) throw new Error("Video export requires WebCodecs (try Chrome/Edge).");

  const { w, h } = evenDimensions(project.width * dpr, project.height * dpr);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const output = new Output({
    format: format === "mp4" ? new Mp4OutputFormat() : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(canvas, {
    codec: format === "mp4" ? "avc" : "vp9",
    bitrate: QUALITY_HIGH,
  });
  output.addVideoTrack(source);
  await output.start();

  const dt = 1 / project.fps;
  for (let f = 0; f < project.frameCount; f++) {
    renderFrame(ctx, project, f, dpr, { drawBg: true, includeReference: false });
    await source.add(f * dt, dt);
  }

  await output.finalize();
  const buffer = output.target.buffer!;
  return new Blob([buffer], { type: format === "mp4" ? "video/mp4" : "video/webm" });
}
```

- [ ] **Step 2: Verify — and reconcile the mediabunny API with the installed version**

Run: `npm run check`.
- If 0 errors: good.
- If `mediabunny` exports differ from the code above (the API is version-sensitive), DO NOT guess — inspect the installed types and adjust the import/calls minimally to match, preserving the same flow (Output + BufferTarget + CanvasSource(codec,bitrate) → addVideoTrack → start → per-frame renderFrame + `source.add(t, dt)` → finalize → `output.target.buffer`). To inspect: `cat node_modules/mediabunny/dist/modules/src/index.d.ts | grep -E "export|class (Output|CanvasSource|BufferTarget)" | head -60`. Report exactly what you changed and why.

Then `npm test` — all pass; `npx vite build` — succeeds (mediabunny bundles).

- [ ] **Step 3: Commit**

```bash
git add src/export/video.ts
git commit -m "feat(export): MP4/WebM video export via mediabunny + WebCodecs"
```

---

## Task 5: Export dialog, toolbar button, and verification

**Files:**
- Create: `src/lib/ExportDialog.svelte`
- Modify: `src/lib/Toolbar.svelte`, `src/App.svelte`, `src/state/appState.svelte.ts`

- [ ] **Step 1: Add an `exportOpen` flag to app state**

In `src/state/appState.svelte.ts`, in the `interface AnimState { … }` add after `version: number;`:
```ts
  exportOpen: boolean;
```
and in the `$state({ … })` initializer add after `version: 0,`:
```ts
  exportOpen: false,
```

- [ ] **Step 2: Create `src/lib/ExportDialog.svelte`**

```svelte
<script lang="ts">
  import { state, DPR } from "../state/appState.svelte";
  import { exportPngSequence } from "../export/png-sequence";
  import { exportVideo, isVideoExportSupported, type VideoFormat } from "../export/video";
  import { downloadBlob } from "../export/download";

  let status = $state("");
  let busy = $state(false);
  const videoOk = isVideoExportSupported();

  async function run(kind: "png" | VideoFormat) {
    if (busy) return;
    busy = true;
    status = `Exporting ${kind.toUpperCase()}… (${state.project.frameCount} frames)`;
    try {
      if (kind === "png") {
        const blob = await exportPngSequence(state.project, DPR);
        downloadBlob(blob, "animation.zip");
      } else {
        const blob = await exportVideo(state.project, DPR, kind);
        downloadBlob(blob, `animation.${kind}`);
      }
      status = "Done.";
    } catch (e) {
      status = `Failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      busy = false;
    }
  }
</script>

{#if state.exportOpen}
  <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
       onclick={() => { if (!busy) state.exportOpen = false; }} role="presentation">
    <div class="bg-neutral-100 rounded-lg p-4 w-80 flex flex-col gap-2 text-sm"
         onclick={(e) => e.stopPropagation()} role="presentation">
      <div class="flex justify-between items-center">
        <span class="font-semibold">Export</span>
        <button onclick={() => { if (!busy) state.exportOpen = false; }}>✕</button>
      </div>
      <button class="border border-neutral-300 rounded py-1" disabled={busy} onclick={() => run("png")}>
        PNG sequence (.zip)
      </button>
      <button class="border border-neutral-300 rounded py-1 disabled:opacity-40" disabled={busy || !videoOk}
              onclick={() => run("mp4")}>MP4 video</button>
      <button class="border border-neutral-300 rounded py-1 disabled:opacity-40" disabled={busy || !videoOk}
              onclick={() => run("webm")}>WebM video</button>
      {#if !videoOk}
        <span class="text-xs text-neutral-500">Video export needs WebCodecs (Chrome/Edge or Safari 16.4+).</span>
      {/if}
      {#if status}<span class="text-xs text-neutral-600">{status}</span>{/if}
    </div>
  </div>
{/if}
```

- [ ] **Step 3: Add the Export button to the toolbar**

In `src/lib/Toolbar.svelte`, after the `Add Video` button line, add:
```svelte
  <button onclick={() => (state.exportOpen = true)}>Export</button>
```
(`state` is already imported in Toolbar's script.)

- [ ] **Step 4: Mount the dialog in `App.svelte`**

In `src/App.svelte`, add the import alongside the other lib imports:
```ts
  import ExportDialog from "./lib/ExportDialog.svelte";
```
And add `<ExportDialog />` immediately after the closing `</div>` of the main layout (so the modal overlays everything), before nothing else — i.e. as the last element in the markup:
```svelte
<div class="h-full flex flex-col">
  …existing layout…
</div>
<ExportDialog />
```

- [ ] **Step 5: Automated verification (Definition of Done — run all, paste real output)**

1. `npm run check` — 0 errors.
2. `npm test` — all pass (60 + 4 export = 64; the gate is all-green). Paste the `Tests` line.
3. `npx vite build` — successful production build (fflate + mediabunny bundle).
4. Dev boot (headless): `npm run dev` short timeout — `Local:` URL, no compile/runtime errors, stop.

Do NOT claim a real PNG zip or video file was produced — that's the human's manual step.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ExportDialog.svelte src/lib/Toolbar.svelte src/App.svelte src/state/appState.svelte.ts
git commit -m "feat(ui): export dialog (PNG sequence / MP4 / WebM) + toolbar button"
```

- [ ] **Step 7: Manual verification checklist (HUMAN — required; no browser automation here)**

Run `npm run dev`, draw a few frames, then:
1. **Export → PNG sequence**: click Export → "PNG sequence" → a `animation.zip` downloads; unzip → `frame_0001.png …` one per frame, each showing the drawing on the paper bg, **no reference layers**, at the document resolution.
2. **Export → MP4** (Chrome/Edge): click "MP4 video" → `animation.mp4` downloads and plays at the project fps; reference layers absent.
3. **Export → WebM**: `animation.webm` downloads and plays.
4. **Reference exclusion**: add an image reference, export → it is NOT in the output.
5. **WebCodecs absent** (e.g. older Safari): MP4/WebM buttons are disabled with the note; PNG sequence still works.

---

## Self-Review (completed during planning)

**Spec coverage (spec §7 export — "PNG sequence (zip)" + "Video (WebM/MP4) via WebCodecs, feature-detected, PNG fallback"):** PNG sequence via fflate (Task 3); MP4/WebM via mediabunny+WebCodecs (Task 4); feature detection `isVideoExportSupported` disables video buttons, PNG always available (Tasks 4–5); reference layers excluded via `includeReference:false` (Task 1, used in Tasks 3–4); paper background included; export at document (×DPR) resolution. The spec's "WebCodecs VideoEncoder + webm-muxer/mp4-muxer" is realised with mediabunny, the maintained successor that wraps WebCodecs and both containers in one zero-dependency library.

**Placeholder scan:** none — every step has complete code and an exact command + expected result. Task 4 Step 2 explicitly handles the one version-sensitive risk (mediabunny API) by directing inspection of the installed types rather than guessing.

**Type consistency:** `renderFrame(…, { drawBg, includeReference })` option defined in Task 1 and used by `exportPngSequence`/`exportVideo` (Tasks 3–4). `frameFileName`/`evenDimensions` defined in Task 2, used in Tasks 3–4. `exportPngSequence(project, dpr)`, `exportVideo(project, dpr, format)`, `isVideoExportSupported()`, `downloadBlob(blob, filename)`, `VideoFormat` defined in Tasks 2–4 and consumed by `ExportDialog` (Task 5). `state.exportOpen` defined in Task 5 Step 1 and used by the dialog + toolbar.

**Risks / known limitations (flagged):**
- **Video encoding is browser-only and the riskiest part** — manual verification required; the mediabunny API is pinned to the installed version and reconciled in Task 4 Step 2.
- **Whole-sequence in memory**: PNG zip holds every frame's PNG in memory; video holds one canvas at a time but the muxer buffers output. Fine for short clips; large projects could strain memory — acceptable at MVP.
- **Export resolution = document × DPR** (DPR captured at startup) — predictable per machine; a resolution chooser is deferred.
- **No progress bar** beyond a status line and no per-frame cancel — acceptable for an MVP dialog.
