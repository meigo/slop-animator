# Audio Track — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a single audio file, render its waveform in the timeline (anchored at frame 0), play it in sync with the playhead, and save/load it with the project.

**Architecture:** One decoded Web Audio `AudioBuffer` is the substrate. Pure helpers (`computePeaks`, `audioFrameSpan`, `bufferOffsetForFrame`) hold the Node-testable logic. `decode.ts`/`engine.ts` wrap Web Audio (manual-verified). Frames stay master: the existing `Playback` callbacks drive an `AudioEngine` that (re)starts audio on play and on loop/jump. Audio bytes persist in the project zip.

**Tech Stack:** TypeScript, Svelte 5 (runes-free components that import `state` use legacy reactive `let`/`$:`), Vitest (Node — no Web Audio/canvas/jsdom), fflate (zip), mediabunny (export — Phase 3 only).

**Spec:** `docs/superpowers/specs/2026-06-15-audio-track-phase1-design.md`

**Branch:** execute on a new branch `audio-phase1` (off `main`).

**Key constraints (verified against the codebase):**
- Vitest runs in **Node**: no `AudioContext`/`AudioBuffer`/`canvas`. Only the pure helpers are unit-tested; decode, engine, persistence blobs, import, and the lane are build- + manual-verified. Do NOT write tests that construct an `AudioContext`/`AudioBuffer` or call `decodeAudioData`.
- `Project.audio` is a **required** field (`AudioTrack | null`). Adding it ripples to every typed `Project` literal — `createProject`, `loadProjectBlob`'s literal, and the test literals in `render.test.ts` (~6) and `persist.test.ts` (1). Use `npm run build` (tsc) to find them all and add `audio: null`.
- `persist.test.ts` only unit-tests the pure `projectToJson`/`migrateBoil`; `saveProjectBlob`/`loadProjectBlob` (canvas/zip/decode) are not unit-tested.
- During playback the driver calls `setFrame` with `playhead+1` each step (multi-frame catch-up loops call it repeatedly, each +1). A loop wrap or the play-range snap make `setFrame` jump non-contiguously. So the audio re-sync trigger is **`isPlaying && f !== playhead + 1`** — this covers both the backward loop wrap and the forward snap-into-range, without resyncing on normal steps.
- `appState` imports `engine`/`decode` (one-way: `appState → audio/*`). The engine keeps its own track ref (set via `setTrack`) to avoid importing `appState` back.

---

### Task 1: pure audio helpers

**Files:**
- Create: `src/audio/peaks.ts`
- Test: `src/__tests__/audio.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/audio.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computePeaks, audioFrameSpan, bufferOffsetForFrame } from "../audio/peaks";

describe("computePeaks", () => {
  it("returns exactly `columns` values", () => {
    expect(computePeaks(new Float32Array(1000), 50)).toHaveLength(50);
  });
  it("silence → all zeros", () => {
    expect(computePeaks(new Float32Array(1000), 10).every((v) => v === 0)).toBe(true);
  });
  it("full-scale block → peak ~1", () => {
    const ch = new Float32Array(1000).fill(1);
    expect(computePeaks(ch, 10).every((v) => Math.abs(v - 1) < 1e-6)).toBe(true);
  });
  it("values are within [0,1] (uses absolute amplitude)", () => {
    const ch = Float32Array.from({ length: 1000 }, (_, i) => (i % 2 ? -0.5 : 0.5));
    const peaks = computePeaks(ch, 20);
    expect(peaks.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(Math.max(...peaks)).toBeCloseTo(0.5, 5);
  });
});

describe("audioFrameSpan", () => {
  it("ceils duration*fps", () => {
    expect(audioFrameSpan(2.0, 12)).toBe(24);
    expect(audioFrameSpan(2.01, 12)).toBe(25);
  });
  it("zero duration → 0", () => {
    expect(audioFrameSpan(0, 12)).toBe(0);
  });
});

describe("bufferOffsetForFrame", () => {
  it("maps frame to seconds at fps", () => {
    expect(bufferOffsetForFrame(12, 0, 12)).toBe(1);
  });
  it("subtracts the offset", () => {
    expect(bufferOffsetForFrame(18, 12, 12)).toBeCloseTo(0.5, 6);
  });
  it("clamps to 0 before the offset", () => {
    expect(bufferOffsetForFrame(6, 12, 12)).toBe(0);
  });
});
```

- [ ] **Step 2: Verify FAIL**

Run: `npx vitest run src/__tests__/audio.test.ts` → FAIL (module `../audio/peaks` not found).

- [ ] **Step 3: Implement**

Create `src/audio/peaks.ts`:

```ts
/** Downsample one channel to `columns` peak amplitudes in [0,1] (max |sample| per bucket). */
export function computePeaks(channel: Float32Array, columns: number): number[] {
  const n = channel.length;
  if (columns <= 0) return [];
  if (n === 0) return new Array(columns).fill(0);
  const bucket = n / columns;
  const peaks: number[] = [];
  for (let c = 0; c < columns; c++) {
    const start = Math.floor(c * bucket);
    const end = Math.min(n, Math.floor((c + 1) * bucket));
    let peak = 0;
    for (let i = start; i < end; i++) {
      const a = Math.abs(channel[i]);
      if (a > peak) peak = a;
    }
    peaks.push(Math.min(1, peak));
  }
  return peaks;
}

/** Number of frame columns the audio occupies at `fps`. */
export function audioFrameSpan(durationSec: number, fps: number): number {
  return Math.max(0, Math.ceil(durationSec * fps));
}

/** Buffer time (seconds) the audio should be at for animation `frame`; clamped >= 0. */
export function bufferOffsetForFrame(frame: number, offsetFrames: number, fps: number): number {
  return Math.max(0, (frame - offsetFrames) / fps);
}
```

- [ ] **Step 4: Verify PASS**

Run: `npx vitest run src/__tests__/audio.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/audio/peaks.ts src/__tests__/audio.test.ts
git commit -m "feat: pure audio helpers (computePeaks, audioFrameSpan, bufferOffsetForFrame)"
```

---

### Task 2: data model

**Files:**
- Modify: `src/anim/document.ts` (add `AudioTrack`; add `audio` to `Project`; set it in `createProject`)
- Modify (ripple): `src/persist/project-file.ts` (`loadProjectBlob` literal), `src/__tests__/render.test.ts`, `src/__tests__/persist.test.ts` — add `audio: null` to each typed `Project` literal tsc flags.

- [ ] **Step 1: Add the type + field**

In `src/anim/document.ts`, add the interface (near the layer types):

```ts
export interface AudioTrack {
  name: string;          // file name (display)
  bytes: Uint8Array;     // original encoded file -> persisted
  buffer: AudioBuffer;   // decoded PCM -> session-only, rebuilt on load
  offsetFrames: number;  // start frame (Phase 1: always 0)
  muted: boolean;        // Phase 1: always false
}
```

Add `audio: AudioTrack | null;` to the `Project` interface. In `createProject`, add `audio: null,` to the returned object.

- [ ] **Step 2: Find every broken literal with tsc**

Run: `npm run build`
Expected: tsc errors "Property 'audio' is missing" at the `Project` literals in `src/persist/project-file.ts` (`loadProjectBlob`), `src/__tests__/render.test.ts`, and `src/__tests__/persist.test.ts`.

- [ ] **Step 3: Add `audio: null` to each flagged literal**

In `loadProjectBlob` (`src/persist/project-file.ts`), the constructed `const project: Project = { width, height, fps, bgColor, frameCount, boil: …, layers };` gets `audio: null,` added (Phase 5 fills in real loading).

In `src/__tests__/render.test.ts` and `src/__tests__/persist.test.ts`, add `audio: null,` to each `Project` literal tsc flagged (the render tests near `boil: defaultBoilConfig()`; the persist `projectToJson` input literal). Do NOT change the persist `toEqual({...})` expected object yet — `projectToJson` does not emit `audio` until Task 5.

- [ ] **Step 4: Build + tests**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → all pass (146 + the Task 1 additions; unchanged here).

- [ ] **Step 5: Commit**

```bash
git add src/anim/document.ts src/persist/project-file.ts src/__tests__/render.test.ts src/__tests__/persist.test.ts
git commit -m "feat: AudioTrack model + Project.audio field"
```

---

### Task 3: audio core (context, decode, engine)

**Files:**
- Create: `src/audio/context.ts`, `src/audio/decode.ts`, `src/audio/engine.ts`

No unit tests (Web Audio is unavailable in Node). Verification = build.

- [ ] **Step 1: Shared AudioContext**

Create `src/audio/context.ts`:

```ts
let ctx: AudioContext | null = null;

/** Lazily create one shared AudioContext (constructed on first use, i.e. a user gesture). */
export function getAudioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}
```

- [ ] **Step 2: Decode**

Create `src/audio/decode.ts`:

```ts
import { getAudioContext } from "./context";
import type { AudioTrack } from "../anim/document";

/** Decode raw encoded audio bytes to an AudioBuffer via the shared AudioContext. */
export async function decodeAudioBytes(bytes: Uint8Array): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return ctx.decodeAudioData(ab);
}

/** Read a File, keep its bytes (for persistence), decode it, and build an AudioTrack. */
export async function loadAudioTrack(file: File): Promise<AudioTrack> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const buffer = await decodeAudioBytes(bytes);
  return { name: file.name, bytes, buffer, offsetFrames: 0, muted: false };
}
```

- [ ] **Step 3: Engine**

Create `src/audio/engine.ts`:

```ts
import { getAudioContext } from "./context";
import { bufferOffsetForFrame } from "./peaks";
import type { AudioTrack } from "../anim/document";

/** Frames-master audio playback: (re)starts the buffer in sync on play and on loop/jump; stops on
 *  pause. Holds its own track ref (set via setTrack) so it doesn't import appState. */
class AudioEngine {
  private track: AudioTrack | null = null;
  private source: AudioBufferSourceNode | null = null;

  setTrack(track: AudioTrack | null): void {
    this.track = track;
    this.stop();
  }

  /** Start audio aligned to animation `frame`. */
  play(frame: number, fps: number): void {
    if (!this.track) return;
    const ctx = getAudioContext();
    void ctx.resume();
    this.stop();
    const src = ctx.createBufferSource();
    src.buffer = this.track.buffer;
    src.connect(ctx.destination);
    src.start(0, bufferOffsetForFrame(frame, this.track.offsetFrames, fps));
    this.source = src;
  }

  /** Re-align to `frame` only if currently playing (used on loop wrap / range snap). */
  syncTo(frame: number, fps: number): void {
    if (this.source) this.play(frame, fps);
  }

  pause(): void {
    this.stop();
  }

  stop(): void {
    if (this.source) {
      try { this.source.stop(); } catch { /* already stopped */ }
      this.source.disconnect();
      this.source = null;
    }
  }
}

export const audioEngine = new AudioEngine();
```

- [ ] **Step 4: Build**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → unchanged, all pass.

- [ ] **Step 5: Commit**

```bash
git add src/audio/context.ts src/audio/decode.ts src/audio/engine.ts
git commit -m "feat: audio core (shared context, decode, frames-master engine)"
```

---

### Task 4: store actions + playback wiring

**Files:**
- Modify: `src/state/appState.svelte.ts`

No unit test (store). Verification = build + suite.

- [ ] **Step 1: Imports**

Add to `src/state/appState.svelte.ts`:

```ts
import { audioEngine } from "../audio/engine";
import type { AudioTrack } from "../anim/document";
```

(If `AudioTrack` is easier to add to the existing `from "../anim/document"` type import, do that instead — avoid a duplicate import line.)

- [ ] **Step 2: Store actions**

Add near the other project mutations:

```ts
/** Set/replace the project audio track (not undoable; persisted with the project). */
export function setAudioTrack(track: AudioTrack) {
  state.project.audio = track;
  audioEngine.setTrack(track);
  bump();
}
/** Remove the audio track. */
export function removeAudioTrack() {
  state.project.audio = null;
  audioEngine.setTrack(null);
  bump();
}
```

- [ ] **Step 3: Keep the engine in sync with project loads**

In `replaceProject` (where it sets `state.project = project;`), add right after that line:

```ts
  audioEngine.setTrack(project.audio);
```

- [ ] **Step 4: Drive the engine from playback**

In the `playbackController` options, update `setFrame` and `onPlayingChange`:

```ts
  setFrame: (f) => {
    if (state.playback.isPlaying && f !== state.playhead + 1) audioEngine.syncTo(f, state.project.fps);
    state.playhead = f;
  },
  onPlayingChange: (p) => {
    state.playback.isPlaying = p;
    if (p) audioEngine.play(state.playhead, state.project.fps);
    else audioEngine.pause();
    state.version++;
  },
```

(The `f !== state.playhead + 1` guard re-syncs on loop wrap and on the play-range snap, but not on normal +1 steps. See the plan's Key constraints.)

- [ ] **Step 5: Build + tests**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → all pass (the playback unit tests use a custom harness that does not involve `audioEngine`, so they are unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/state/appState.svelte.ts
git commit -m "feat: audio store actions + playback engine wiring"
```

---

### Task 5: persistence

**Files:**
- Modify: `src/persist/project-file.ts` (`ProjectJson`, `projectToJson`, `saveProjectBlob`, `loadProjectBlob`)
- Test: `src/__tests__/persist.test.ts` (update the `projectToJson` expectation to include `audio: null`)

- [ ] **Step 1: Update the `projectToJson` test expectation**

In `src/__tests__/persist.test.ts`, the `projectToJson` test's `expect(projectToJson(p)).toEqual({...})` — add `audio: null,` to the expected object (the input literal already has `audio: null` from Task 2). Run `npx vitest run src/__tests__/persist.test.ts` → it FAILS now (projectToJson doesn't emit `audio` yet).

- [ ] **Step 2: Serialize audio metadata**

In `src/persist/project-file.ts`:

(a) Add to `ProjectJson`:

```ts
  audio: { name: string; offsetFrames: number; muted: boolean } | null;
```

(b) In `projectToJson`, add to the returned object:

```ts
    audio: project.audio
      ? { name: project.audio.name, offsetFrames: project.audio.offsetFrames, muted: project.audio.muted }
      : null,
```

Run `npx vitest run src/__tests__/persist.test.ts` → PASS again.

- [ ] **Step 3: Write audio bytes into the zip**

In `saveProjectBlob`, after building `files`, before zipping, add:

```ts
  if (project.audio) files["audio/track"] = project.audio.bytes;
```

- [ ] **Step 4: Rebuild audio on load**

In `loadProjectBlob`, import `decodeAudioBytes`:

```ts
import { decodeAudioBytes } from "../audio/decode";
```

Replace the `audio: null,` placeholder (added in Task 2) in the constructed `project` with a real value. After the `project` object is built (it currently ends `refreshLength(project); return project;`), insert before the `return`:

```ts
  const aj = json.audio;
  const audioBytes = zip["audio/track"];
  if (aj && audioBytes) {
    try {
      const buffer = await decodeAudioBytes(audioBytes);
      project.audio = { name: aj.name, bytes: audioBytes, buffer, offsetFrames: aj.offsetFrames, muted: aj.muted };
    } catch {
      project.audio = null; // corrupt/unsupported audio → open the project without it
    }
  }
```

Keep `audio: null` in the initial `project` literal so it is valid before this block runs. (`json.audio` is `undefined` for old saves → skipped → stays null.)

- [ ] **Step 5: Build + tests**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → all pass.

- [ ] **Step 6: Commit**

```bash
git add src/persist/project-file.ts src/__tests__/persist.test.ts
git commit -m "feat: persist audio track (bytes in zip + metadata, re-decode on load)"
```

---

### Task 6: import in the Toolbar

**Files:**
- Modify: `src/lib/Toolbar.svelte`

No automated test. Verification = build + manual.

- [ ] **Step 1: Wire the audio file kind**

In `src/lib/Toolbar.svelte`:
- Import the loader and the store action:
  ```ts
  import { loadAudioTrack } from "../audio/decode";
  ```
  and add `setAudioTrack` to the existing import from `../state/appState.svelte`.
- Widen `pendingKind`: `let pendingKind: "image" | "video" | "project" | "audio" = "image";`
- In `pick(kind)`, widen the param type to include `"audio"` and extend the `accept` ternary so `"audio"` → `"audio/*"`.
- In `onFile`, add an audio branch before the image/video block:
  ```ts
    if (pendingKind === "audio") { setAudioTrack(await loadAudioTrack(file)); return; }
  ```

- [ ] **Step 2: Add the button**

Add an "Import audio" button next to the image/video import buttons. Use the existing icon-button pattern in this file; an appropriate `@lucide/svelte` icon is `Music` (add it to the lucide import). The button calls `() => pick("audio")`.

- [ ] **Step 3: Build**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → unchanged.

- [ ] **Step 4: Manual verification**

Run `npm run dev`: clicking "Import audio" opens an audio file picker; choosing an mp3/wav sets the track (verified by the lane appearing in Task 7). A non-audio file rejects without changing state.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Toolbar.svelte
git commit -m "feat: import audio from the toolbar"
```

---

### Task 7: timeline waveform lane

**Files:**
- Create: `src/lib/AudioLane.svelte`
- Modify: `src/lib/Timeline.svelte` (render `<AudioLane>` under the ruler, passing the grid metrics)

No automated test. Verification = build + manual.

- [ ] **Step 1: Create `src/lib/AudioLane.svelte`**

```svelte
<script lang="ts">
  import { Music, X } from "@lucide/svelte";
  import { state, removeAudioTrack } from "../state/appState.svelte";
  import { computePeaks, audioFrameSpan } from "../audio/peaks";

  // Grid metrics passed from Timeline so the lane aligns with the frame columns.
  export let cellW: number;
  export let labelW: number;

  // Draw the waveform onto the canvas; redraws when params change (legacy-mode action).
  function waveform(node: HTMLCanvasElement, p: { audioVersion: number }) {
    const draw = () => {
      const audio = state.project.audio;
      const ctx = node.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, node.width, node.height);
      if (!audio) return;
      const cols = audioFrameSpan(audio.buffer.duration, state.project.fps);
      node.width = Math.max(1, cols * cellW);
      node.height = 28;
      const peaks = computePeaks(audio.buffer.getChannelData(0), node.width);
      ctx.fillStyle = "#888";
      const mid = node.height / 2;
      for (let x = 0; x < peaks.length; x++) {
        const h = peaks[x] * (node.height - 2);
        ctx.fillRect(x, mid - h / 2, 1, h);
      }
    };
    draw();
    return { update: draw };
  }
</script>

{#if state.project.audio}
  <div class="flex items-center">
    <div class="shrink-0 sticky left-0 z-20 bg-surface flex items-center gap-1 h-7 px-1 text-xs text-text-secondary"
         style="width: {labelW}px">
      <Music size={13} />
      <span class="truncate flex-1" title={state.project.audio.name}>{state.project.audio.name}</span>
      <button class="text-text-muted hover:text-text-secondary" title="Remove audio" onclick={removeAudioTrack}><X size={13} /></button>
    </div>
    <canvas class="h-7" use:waveform={{ audioVersion: state.version }}></canvas>
  </div>
{/if}
```

(The `audioVersion: state.version` param makes the action's `update` re-run when the document version bumps — e.g. after import/remove/fps change. `cellW`/`labelW` come from Timeline's `CELL_W`/`LABEL_W`.)

- [ ] **Step 2: Render it in `src/lib/Timeline.svelte`**

Import the component in the Timeline `<script>`:

```ts
  import AudioLane from "./AudioLane.svelte";
```

Render `<AudioLane cellW={CELL_W} labelW={LABEL_W} />` immediately after the ruler block (the `<div class="flex items-stretch">…</div>` that holds the ruler) and before the `{#each [...].reverse() as layer}` layer rows.

- [ ] **Step 3: Build**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → unchanged.

- [ ] **Step 4: Manual verification (browser)**

Run `npm run dev`:
- Import an mp3/wav → a waveform lane appears under the ruler with the file name; the waveform spans from frame 0 across the audio's duration in frames.
- Press play → audio plays in sync with the playhead; pause stops it; with loop on it restarts each loop and stays aligned; with an in/out play range set, audio aligns to the range.
- ✕ removes the lane and silences playback.
- Save the project, reload → the audio + waveform return and still play.
- Import a second file → replaces the first.

- [ ] **Step 5: Commit**

```bash
git add src/lib/AudioLane.svelte src/lib/Timeline.svelte
git commit -m "feat: timeline audio waveform lane"
```

---

## Final verification

- [ ] `npm run build` → 0 errors, 0 warnings.
- [ ] `npm test` → all pass (146 baseline + Task 1's new assertions).
- [ ] Manual checklists in Tasks 6 & 7 confirmed (import, waveform, synced play/loop, range-aligned, remove, save/reload).

## Self-Review (completed by plan author)

**Spec coverage:**
- Pure helpers `computePeaks`/`audioFrameSpan`/`bufferOffsetForFrame` + tests → Task 1. ✅
- `AudioTrack` + `Project.audio` (offsetFrames/muted present, anchored 0) → Task 2. ✅
- Decode + shared context + frames-master `AudioEngine` (play/pause/syncTo/setTrack) → Task 3. ✅
- Store actions + engine wired through `Playback` callbacks (re-sync on play/loop/snap) + `replaceProject` → Task 4. ✅
- Persistence: bytes in zip + metadata in json + re-decode on load (+ corrupt-audio fallback to null) → Task 5. ✅
- Toolbar import (replace) → Task 6. ✅
- Frame-aligned waveform lane + remove → Task 7. ✅
- Out of scope (offset drag, mute UI, scrub, export) correctly absent. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete, ready-to-paste code. ✅

**Type consistency:** `AudioTrack` (Task 2) used by `decode`/`engine` (Task 3), store (Task 4), persistence (Task 5). `bufferOffsetForFrame`/`computePeaks`/`audioFrameSpan` (Task 1) used in engine (Task 3) and lane (Task 7). `setAudioTrack`/`removeAudioTrack` (Task 4) used in Toolbar (Task 6) and lane (Task 7). `audioEngine` (Task 3) used in store (Task 4). `ProjectJson.audio` shape `{ name, offsetFrames, muted } | null` consistent across `projectToJson`/`loadProjectBlob` (Task 5). ✅
