# Video-ref clip drag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Linked video refs show a draggable clip block on the timeline (audio-clone gesture); missing media says re-link; audio waveform gets a visible clip fill; the offset number goes away.

**Architecture:** Pure `videoClipLayout` / `offsetAfterClipDrag` map the existing inverted `offsetFrames` in-point onto a timeline start + span. Timeline paints a CSS block and writes offset on drag. No model or persistence change.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest (pure layout only). Canvas/DOM gestures are build+review.

**Spec:** `docs/superpowers/specs/2026-08-14-video-ref-clip-drag-design.md`

## Global Constraints

- `npm test` green; `npm run build` = 0 errors, 0 warnings after every task.
- No filmstrip, no trim handles, no undo for offset (matches audio).
- Playback formula stays `videoTime = (offsetFrames + frame × speed) / fps`.
- Finger pans, Pencil/mouse edit (gotcha #10: `touch-action: none` on the drag surface).
- Lock does not refuse clip drag.
- One commit per task. Do not merge to main unless asked.

## File map

| File | Role |
|---|---|
| `src/anim/clip-layout.ts` | Pure start/span/drag mapping |
| `src/__tests__/clip-layout.test.ts` | Unit tests for that mapping |
| `src/lib/Timeline.svelte` | Clip block / re-link / type labels on ref rows |
| `src/lib/AudioLane.svelte` | Clip background under waveform peaks |
| `src/lib/LayerList.svelte` | Delete offset number; keep speed |
| `README.md`, `CLAUDE.md` | User-facing + internal notes |

---

### Task 1: `videoClipLayout` + `offsetAfterClipDrag`

**Files:**
- Create: `src/anim/clip-layout.ts`
- Test: `src/__tests__/clip-layout.test.ts`

**Interfaces:**
- Consumes: nothing (pure numbers).
- Produces:
  - `export function videoClipLayout(offsetFrames: number, speed: number, durationSec: number, fps: number): { startFrame: number; spanFrames: number }`
  - `export function offsetAfterClipDrag(startFrame: number, deltaFrames: number, speed: number): number`

- [ ] **Step 1: Write the failing tests** in `src/__tests__/clip-layout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { videoClipLayout, offsetAfterClipDrag } from "../anim/clip-layout";

describe("videoClipLayout", () => {
  it("offset 0, speed 1 → starts at 0, span is ceil(duration*fps)", () => {
    expect(videoClipLayout(0, 1, 2, 12)).toEqual({ startFrame: 0, spanFrames: 24 });
  });

  it("positive in-point shifts the block left (inverted vs audio)", () => {
    // 12 frames into the video at timeline 0, 1× → left edge at -12
    expect(videoClipLayout(12, 1, 2, 12).startFrame).toBe(-12);
  });

  it("negative offset starts the clip after frame 0", () => {
    expect(videoClipLayout(-24, 1, 2, 12).startFrame).toBe(24);
  });

  it("speed 2 halves the span and the start shift", () => {
    // offset 12 at 2× → start = round(-12/2) = -6; span = ceil(2*12/2) = 12
    expect(videoClipLayout(12, 2, 2, 12)).toEqual({ startFrame: -6, spanFrames: 12 });
  });

  it("speed <= 0 is treated as 1", () => {
    expect(videoClipLayout(0, 0, 1, 12).spanFrames).toBe(12);
    expect(videoClipLayout(0, -2, 1, 12).spanFrames).toBe(12);
  });

  it("zero duration → 0 span", () => {
    expect(videoClipLayout(0, 1, 0, 12).spanFrames).toBe(0);
  });
});

describe("offsetAfterClipDrag", () => {
  it("dragging right increases start (lowers offset at 1×)", () => {
    expect(offsetAfterClipDrag(0, 10, 1)).toBe(-10);
  });

  it("scales by speed so one timeline frame stays one visual step", () => {
    expect(offsetAfterClipDrag(-6, 2, 2)).toBe(8); // start -4 at 2× → offset = 4*2
  });

  it("speed <= 0 is treated as 1", () => {
    expect(offsetAfterClipDrag(0, 5, 0)).toBe(-5);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/__tests__/clip-layout.test.ts`

Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/anim/clip-layout.ts`:

```ts
export function videoClipLayout(
  offsetFrames: number,
  speed: number,
  durationSec: number,
  fps: number,
): { startFrame: number; spanFrames: number } {
  const spd = speed > 0 ? speed : 1;
  return {
    startFrame: Math.round(-offsetFrames / spd),
    spanFrames: Math.max(0, Math.ceil((durationSec * fps) / spd)),
  };
}

/** New `offsetFrames` after sliding the visible start by `deltaFrames` (right = +). */
export function offsetAfterClipDrag(
  startFrame: number,
  deltaFrames: number,
  speed: number,
): number {
  const spd = speed > 0 ? speed : 1;
  return -(startFrame + deltaFrames) * spd;
}
```

- [ ] **Step 4: Re-run** `npx vitest run src/__tests__/clip-layout.test.ts` — all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/anim/clip-layout.ts src/__tests__/clip-layout.test.ts
git commit -m "feat: map video-ref offset onto a timeline clip span"
```

---

### Task 2: Timeline clip block, re-link hint, type labels

**Files:**
- Modify: `src/lib/Timeline.svelte` (imports; the `{:else}` ref branch ~1008–1013)

**Interfaces:**
- Consumes: `videoClipLayout`, `offsetAfterClipDrag` from Task 1; existing `touchPanDown` / `touchPanMove` / `touchPanUp` / `isFinePointer` / `bump` / `setActiveLayer`.
- Produces: video rows show a draggable clip; missing rows say **re-link**; image / unknown-duration say `image` / `video`.

- [ ] **Step 1: Add imports** at the top of `Timeline.svelte`:

```ts
import { videoClipLayout, offsetAfterClipDrag } from "../anim/clip-layout";
import type { ReferenceLayer } from "../anim/document";
```

(`ReferenceLayer` can be added to the existing `document` import instead of a second line.)

- [ ] **Step 2: Add clip-drag state + handlers** next to `touchPanUp` (same file, ~line 137). Not undoable — write `offsetFrames` live like `AudioLane.laneDown`.

```ts
let clipDrag: { layer: ReferenceLayer; x: number; startFrame: number } | null = null;

function clipDown(e: PointerEvent, layer: ReferenceLayer) {
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  if (!isFinePointer(e)) {
    touchPanDown(e);
    return;
  }
  if (layer.media.type !== "video") return;
  const dur = layer.media.el.duration;
  if (!Number.isFinite(dur) || dur <= 0) return;
  const { startFrame } = videoClipLayout(
    layer.offsetFrames,
    layer.speed,
    dur,
    appState.project.fps,
  );
  clipDrag = { layer, x: e.clientX, startFrame };
}

function clipMove(e: PointerEvent) {
  if (e.pointerType === "touch") {
    touchPanMove(e);
    return;
  }
  if (!clipDrag) return;
  const delta = Math.round((e.clientX - clipDrag.x) / CELL_W);
  const next = offsetAfterClipDrag(clipDrag.startFrame, delta, clipDrag.layer.speed);
  if (next !== clipDrag.layer.offsetFrames) {
    clipDrag.layer.offsetFrames = next;
    bump();
  }
}

function clipUp() {
  clipDrag = null;
  touchPanUp();
}
```

- [ ] **Step 3: Replace the ref `{:else}` branch** (`Timeline.svelte` ~1008–1013) with:

```svelte
{:else}
  {@const ref = layer}
  {#if ref.media.type === "video" && Number.isFinite(ref.media.el.duration) && ref.media.el.duration > 0}
    {@const lay = videoClipLayout(ref.offsetFrames, ref.speed, ref.media.el.duration, appState.project.fps)}
    {@const tailFrames = Math.max(0, lay.startFrame + lay.spanFrames - appState.project.frameCount)}
    <div
      class="relative box-border h-6 cursor-grab overflow-hidden border border-border bg-surface-active text-xs leading-6 text-text-secondary"
      class:opacity-70={ref.id !== appState.activeLayerId}
      style="touch-action: none; margin-left: {lay.startFrame * CELL_W}px; width: {lay.spanFrames * CELL_W}px"
      role="presentation"
      title="Drag to offset the video"
      onpointerdown={(e) => clipDown(e, ref)}
      onpointermove={clipMove}
      onpointerup={clipUp}
      onpointercancel={clipUp}
    >
      <span class="relative z-10 block truncate px-1">{ref.name}</span>
      {#if tailFrames > 0}
        <div
          class="pointer-events-none absolute inset-y-0 right-0 bg-surface/75"
          style="width: {tailFrames * CELL_W}px"
        ></div>
      {/if}
    </div>
  {:else if ref.media.type === "missing"}
    <span
      class="ml-1 text-xs text-text-muted"
      class:opacity-70={ref.id !== appState.activeLayerId}
      title="Media missing — re-link from the layer panel">re-link</span
    >
  {:else}
    <span
      class="ml-1 text-xs text-text-muted"
      class:opacity-70={ref.id !== appState.activeLayerId}
      >{ref.media.type === "video" ? "video" : "image"}</span
    >
  {/if}
{/if}
```

Do not open a file picker from this row. The name button still selects the layer.

- [ ] **Step 4:** `npx svelte-check` — 0 errors, 0 warnings. `npm test` still green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Timeline.svelte
git commit -m "feat: draggable video-ref clip on the timeline row"
```

---

### Task 3: Audio clip background fill

**Files:**
- Modify: `src/lib/AudioLane.svelte` (`waveform` draw, ~81–94)

**Interfaces:**
- Consumes: existing `audioFrameSpan`, `docEndX`.
- Produces: the canvas rectangle is a filled clip; peaks sit on top; tail past the document stays dim.

- [ ] **Step 1: After `ctx.clearRect(...)`, fill the clip, then draw peaks.** Replace the clear + peak loop so the bound is a rectangle:

```ts
ctx.clearRect(0, 0, node.width, node.height);
const docEndX = (state.project.frameCount - audio.offsetFrames) * cellW * (w / naturalW);
// Clip plate — start/end read as a rectangle, not just a grey scribble.
ctx.globalAlpha = 1;
ctx.fillStyle = "#3a3a3a";
ctx.fillRect(0, 0, Math.min(w, Math.max(0, docEndX)), node.height);
if (docEndX < w) {
  ctx.globalAlpha = 0.25;
  ctx.fillRect(Math.max(0, docEndX), 0, w - Math.max(0, docEndX), node.height);
  ctx.globalAlpha = 1;
}
const peaks = computePeaks(audio.buffer.getChannelData(0), w);
ctx.fillStyle = "#888";
const mid = node.height / 2;
for (let x = 0; x < peaks.length; x++) {
  const h = peaks[x] * (node.height - 2);
  ctx.globalAlpha = x < docEndX ? 1 : 0.25;
  ctx.fillRect(x, mid - h / 2, 1, h);
}
ctx.globalAlpha = 1;
```

(`#3a3a3a` is a dark-theme `surface-active` stand-in; the canvas cannot use CSS tokens. Light theme will look slightly dark on the audio lane — accepted, same as the existing hardcoded `#888` peaks.)

- [ ] **Step 2:** `npx svelte-check` — 0/0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/AudioLane.svelte
git commit -m "fix: audio waveform sits on a visible clip rectangle"
```

---

### Task 4: Drop the offset number; keep speed; docs

**Files:**
- Modify: `src/lib/LayerList.svelte` (~369–404)
- Modify: `README.md` (Features / Animation or Reference bullet if it mentions offset)
- Modify: `CLAUDE.md` (short current-state note)

**Interfaces:**
- Consumes: nothing new.
- Produces: video Row 2 has speed only; README/CLAUDE mention the timeline clip.

- [ ] **Step 1: In `LayerList.svelte`, remove the offset `<label>`.** Leave speed. The wrapping comment above can drop “Offset +”. Result:

```svelte
{#if layer.kind === "ref" && layer.media.type === "video"}
  <label
    class="flex items-center gap-1 text-xs text-text-muted"
    title="Playback speed (× real time)"
  >
    speed
    <input
      class="w-9 text-xs bg-surface border border-border px-0.5 text-text"
      type="number"
      step="0.1"
      min="0.1"
      max="8"
      bind:value={layer.speed}
      oninput={bump}
      onclick={(e) => e.stopPropagation()}
    />×
  </label>
{/if}
```

- [ ] **Step 2: README** — under Reference & audio, add that a video ref is a draggable clip on the timeline (no filmstrip). Do not mention the removed number field.

- [ ] **Step 3: CLAUDE.md** — append a short current-state entry: video-ref clip drag, inverted offset mapping, missing row says re-link, offset number removed, owed iPad pass.

- [ ] **Step 4:** `npm test && npx svelte-check` — 0 failures, 0/0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/LayerList.svelte README.md CLAUDE.md
git commit -m "fix: drop the video offset number; clip on the timeline is the control"
```

---

## Spec coverage

| Spec item | Task |
|---|---|
| `videoClipLayout` / drag inverse | 1 |
| Linked video block + Pencil drag + finger pan | 2 |
| Dim tail past last frame | 2 |
| Missing → **re-link**, no picker | 2 |
| Image / unknown duration type label | 2 |
| Audio clip fill | 3 |
| Delete offset number, keep speed | 4 |
| Lock does not block drag | 2 (no lock guard) |
| No filmstrip / trim / undo / model change | all (omitted) |

## Owed after land

Browser/iPad: drag incl. negative start and speed ≠ 1; speed changes width; missing says re-link; image has no block; audio rectangle reads; finger pans; save/reload.