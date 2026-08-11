# Audio Phase 3 — Export Muxing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mux the project's audio track into the MP4 and WebM video exports, aligned to the same
`offsetFrames` position it plays at in the app.

**Architecture:** A pure planner (`audioExportPlan`) decides whether audio is exported at all and
where the clip sits inside the export window, reusing `bufferOffsetForFrame` from the playback path
so export and playback alignment cannot drift apart. `buildExportAudio` applies that plan with a
single `OfflineAudioContext` render, which does placement, truncation and resampling in one step.
`exportVideo` adds a mediabunny `AudioBufferSource` before its frame loop and returns a warning
instead of throwing when audio cannot be encoded.

**Tech Stack:** TypeScript, Svelte 5 runes, Vitest (node env, no DOM), mediabunny ^1.46.0, Web Audio
(`OfflineAudioContext`), WebCodecs.

**Spec:** `docs/superpowers/specs/2026-08-11-audio-phase3-export-muxing-design.md`

## Global Constraints

- **No new dependencies.** In particular do NOT add `@mediabunny/aac-encoder`; the warning path
  covers browsers without a native AAC encoder.
- `npm run build` (= `svelte-check && tsc --noEmit && vite build`) must end with **0 errors, 0
  warnings**. That is the bar for every task.
- `npm test` baseline before this work: **389 passing**. It must never go down.
- Audio failures must **never** abort a video export — a multi-minute render must not be lost.
- Export duration is `frameCount / fps`, always from frame 0; video export does not honour the
  In/Out playback range, and this plan does not change that.
- Export sample rate is **48000 Hz** (accepted by both AAC and Opus); channels are
  `min(source.numberOfChannels, 2)`.
- Every commit message ends with the project's trailer:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` (the commit commands below
  show only the subject line; append the trailer). The pre-commit hook reformats staged files —
  expect that, it is fine.
- Vitest runs in a node env: `AudioBuffer`, `OfflineAudioContext` and WebCodecs do not exist there.
  Only the pure planner is unit-tested; everything touching those APIs is build + review verified,
  per project convention.

**Refinement of the spec, deliberate:** the spec described `audioExportPlan` as returning
`{ durationS, startAt, sourceOffset, overlaps }`. This plan has it return `null` instead of an
`overlaps: false` flag (null already means "no audio track in this export", which is also what a
missing or muted track produces — one exit, one meaning), and names the window `windowS` so it does
not collide with the input clip's own duration. The behaviour is identical.

---

### Task 1: The pure export planner

**Files:**

- Create: `src/export/audio-mix.ts`
- Create: `src/__tests__/audio-export.test.ts`

**Interfaces:**

- Consumes: `bufferOffsetForFrame(frame: number, offsetFrames: number, fps: number): number` from
  `src/audio/peaks.ts` — signed seconds into the source buffer for an animation frame; negative
  means the clip starts that many seconds in the future.
- Produces:
  ```ts
  export interface AudioExportInput {
    offsetFrames: number;
    muted: boolean;
    durationS: number;
  }
  export interface AudioExportPlan {
    windowS: number;
    startAt: number;
    sourceOffset: number;
  }
  export function audioExportPlan(
    input: AudioExportInput | null,
    fps: number,
    frameCount: number,
  ): AudioExportPlan | null;
  ```
  Task 2 consumes both the type and the function from this same file.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/audio-export.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { audioExportPlan, type AudioExportInput } from "../export/audio-mix";

// 24 frames @ 12fps = a 2s export window.
const FPS = 12;
const FRAMES = 24;
const clip = (over: Partial<AudioExportInput> = {}): AudioExportInput => ({
  offsetFrames: 0,
  muted: false,
  durationS: 5,
  ...over,
});

describe("audioExportPlan — no audio track in the export", () => {
  it("returns null when there is no track", () => {
    expect(audioExportPlan(null, FPS, FRAMES)).toBeNull();
  });

  it("returns null for a muted track (muted = silent export)", () => {
    expect(audioExportPlan(clip({ muted: true }), FPS, FRAMES)).toBeNull();
  });

  it("returns null when the clip starts after the export ends", () => {
    // Offset 100 frames = 8.33s, past the 2s window.
    expect(audioExportPlan(clip({ offsetFrames: 100 }), FPS, FRAMES)).toBeNull();
  });

  it("returns null when the clip ends before frame 0", () => {
    // Offset -120 frames = the export starts 10s into a 5s clip.
    expect(audioExportPlan(clip({ offsetFrames: -120 }), FPS, FRAMES)).toBeNull();
  });
});

describe("audioExportPlan — placement", () => {
  it("zero offset: clip and export both start at 0", () => {
    expect(audioExportPlan(clip(), FPS, FRAMES)).toEqual({
      windowS: 2,
      startAt: 0,
      sourceOffset: 0,
    });
  });

  it("positive offset delays the clip inside the window (silence head)", () => {
    // Dragged 6 frames right = starts 0.5s into the export, from the top of the buffer.
    expect(audioExportPlan(clip({ offsetFrames: 6 }), FPS, FRAMES)).toEqual({
      windowS: 2,
      startAt: 0.5,
      sourceOffset: 0,
    });
  });

  it("negative offset starts partway into the buffer", () => {
    // Dragged 6 frames left = the export begins 0.5s into the clip.
    expect(audioExportPlan(clip({ offsetFrames: -6 }), FPS, FRAMES)).toEqual({
      windowS: 2,
      startAt: 0,
      sourceOffset: 0.5,
    });
  });

  it("windowS is the animation length, not the clip length", () => {
    // A clip shorter than the export and one longer than it both yield the same window;
    // truncation is the renderer's job, not the plan's.
    expect(audioExportPlan(clip({ durationS: 0.5 }), FPS, FRAMES)?.windowS).toBe(2);
    expect(audioExportPlan(clip({ durationS: 600 }), FPS, FRAMES)?.windowS).toBe(2);
  });

  it("never sets both startAt and sourceOffset", () => {
    for (const offsetFrames of [-6, -1, 0, 1, 6]) {
      const p = audioExportPlan(clip({ offsetFrames }), FPS, FRAMES)!;
      expect(Math.min(p.startAt, p.sourceOffset)).toBe(0);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/audio-export.test.ts`
Expected: FAIL — `Failed to resolve import "../export/audio-mix"`.

- [ ] **Step 3: Write the implementation**

Create `src/export/audio-mix.ts`:

```ts
import { bufferOffsetForFrame } from "../audio/peaks";

/** Just the fields the plan needs, so it stays node-testable (an AudioBuffer cannot be built
 *  in the test env — `durationS` is the source buffer's duration in seconds). */
export interface AudioExportInput {
  offsetFrames: number;
  muted: boolean;
  durationS: number;
}

export interface AudioExportPlan {
  /** The export window: the animation's own length in seconds. */
  windowS: number;
  /** Seconds into the window where the clip begins (0 unless it was dragged right of frame 0). */
  startAt: number;
  /** Seconds into the source buffer to start from (0 unless it was dragged left of frame 0). */
  sourceOffset: number;
}

/**
 * Where the audio clip sits inside an export of `frameCount` frames, or null when the export
 * should carry no audio track at all: no track, muted (mute means silent export), or the clip
 * lies entirely outside the window in either direction.
 *
 * The two branches mirror `AudioEngine.play` exactly — same `bufferOffsetForFrame` rule — so
 * export alignment and playback alignment cannot drift apart.
 */
export function audioExportPlan(
  input: AudioExportInput | null,
  fps: number,
  frameCount: number,
): AudioExportPlan | null {
  if (!input || input.muted) return null;
  const windowS = frameCount / fps;
  const at = bufferOffsetForFrame(0, input.offsetFrames, fps);
  const startAt = at >= 0 ? 0 : -at;
  const sourceOffset = at >= 0 ? at : 0;
  if (startAt >= windowS || sourceOffset >= input.durationS) return null;
  return { windowS, startAt, sourceOffset };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/audio-export.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the full gate**

Run: `npm test` — expected 398 passing (389 + 9).
Run: `npm run build` — expected 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/export/audio-mix.ts src/__tests__/audio-export.test.ts
git commit -m "feat: pure planner for audio placement in a video export"
```

---

### Task 2: Render the aligned buffer and mux it

**Files:**

- Modify: `src/export/audio-mix.ts` (append `buildExportAudio`)
- Modify: `src/export/video.ts` (whole file — imports, return type, audio track)
- Modify: `src/lib/ExportDialog.svelte:13-31` (`run()` — destructure the result, surface the warning)

**Interfaces:**

- Consumes: `audioExportPlan`, `AudioExportInput`, `AudioExportPlan` from Task 1; `AudioTrack`
  (`{ name, bytes, buffer: AudioBuffer, offsetFrames, muted }`) and `Project`
  (`{ fps, frameCount, width, height, audio: AudioTrack | null, ... }`) from `src/anim/document.ts`.
- Produces:
  ```ts
  export async function buildExportAudio(
    track: AudioTrack | null,
    fps: number,
    frameCount: number,
  ): Promise<AudioBuffer | null>;

  export interface VideoExportResult {
    blob: Blob;
    warning?: string;
  }
  export async function exportVideo(
    project: Project,
    dpr: number,
    format: VideoFormat,
  ): Promise<VideoExportResult>; // was Promise<Blob>
  ```

There is no test cycle in this task: every line touches `OfflineAudioContext`, mediabunny or the
DOM, none of which exist in the node test env. The gate is `npm run build` plus the browser pass in
Task 3. Do not add DOM shims or a browser test runner to work around this — it is the project's
standing convention.

- [ ] **Step 1: Append `buildExportAudio` to `src/export/audio-mix.ts`**

Add this import at the top of the file, beside the existing `bufferOffsetForFrame` import:

```ts
import type { AudioTrack } from "../anim/document";
```

Append at the end of the file:

```ts
/** Accepted by both AAC (MP4) and Opus (WebM), so a 44.1 kHz import needs no special case. */
const EXPORT_SAMPLE_RATE = 48000;

/**
 * The project's audio as ONE buffer exactly the export's length, with the clip at its
 * `offsetFrames` position: silence before it, cut off at the window end, resampled to 48 kHz.
 * Null when the export should carry no audio track (see `audioExportPlan`).
 *
 * One OfflineAudioContext render does placement, truncation and resampling together — the
 * context's own length is the truncation, and its sample rate is the resample.
 */
export async function buildExportAudio(
  track: AudioTrack | null,
  fps: number,
  frameCount: number,
): Promise<AudioBuffer | null> {
  const plan = audioExportPlan(
    track && {
      offsetFrames: track.offsetFrames,
      muted: track.muted,
      durationS: track.buffer.duration,
    },
    fps,
    frameCount,
  );
  if (!plan || !track) return null;

  const ctx = new OfflineAudioContext(
    Math.min(track.buffer.numberOfChannels, 2),
    Math.ceil(plan.windowS * EXPORT_SAMPLE_RATE),
    EXPORT_SAMPLE_RATE,
  );
  const src = ctx.createBufferSource();
  src.buffer = track.buffer;
  src.connect(ctx.destination);
  // The same two branches AudioEngine.play takes: the clip either starts late inside the
  // window, or begins partway into its own buffer. Never both (see audioExportPlan).
  src.start(plan.startAt, plan.sourceOffset);
  return ctx.startRendering();
}
```

Note `track && {...}`: `audioExportPlan` accepts `AudioExportInput | null`, and `track && {...}`
is `null` when `track` is null. The redundant-looking `!track` in the guard below it is what
narrows `track` for TypeScript afterwards — keep it.

- [ ] **Step 2: Rewrite `src/export/video.ts`**

Replace the whole file with:

```ts
import {
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget,
  CanvasSource,
  AudioBufferSource,
  QUALITY_HIGH,
  getFirstEncodableAudioCodec,
} from "mediabunny";
import { renderFrame } from "../anim/render";
import { evenDimensions } from "./frames";
import { buildExportAudio } from "./audio-mix";
import type { Project } from "../anim/document";

export type VideoFormat = "mp4" | "webm";

export interface VideoExportResult {
  blob: Blob;
  /** Set when the video was produced but its audio had to be dropped. */
  warning?: string;
}

/** Video export needs the WebCodecs VideoEncoder (Chromium/Edge, Safari 16.4+). */
export function isVideoExportSupported(): boolean {
  return typeof window !== "undefined" && "VideoEncoder" in window;
}

/**
 * Encode every frame (drawing layers over the paper background, reference layers excluded)
 * to an MP4 (H.264) or WebM (VP9) Blob via mediabunny + WebCodecs, with the project audio
 * track muxed in when there is one.
 */
export async function exportVideo(
  project: Project,
  dpr: number,
  format: VideoFormat,
): Promise<VideoExportResult> {
  if (!isVideoExportSupported())
    throw new Error("Video export requires WebCodecs (try Chrome/Edge).");

  const { w, h } = evenDimensions(project.width * dpr, project.height * dpr);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const outputFormat = format === "mp4" ? new Mp4OutputFormat() : new WebMOutputFormat();
  const output = new Output({ format: outputFormat, target: new BufferTarget() });
  const source = new CanvasSource(canvas, {
    codec: format === "mp4" ? "avc" : "vp9",
    bitrate: QUALITY_HIGH,
  });
  output.addVideoTrack(source);

  // Audio is decided BEFORE start() — tracks cannot be added afterwards. Every failure here
  // drops the audio and reports it; none of them may cost the caller the whole render.
  let warning: string | undefined;
  let audioBuffer: AudioBuffer | null = null;
  try {
    audioBuffer = await buildExportAudio(project.audio, project.fps, project.frameCount);
  } catch {
    warning = "the audio could not be prepared";
  }
  let audioSource: AudioBufferSource | null = null;
  if (audioBuffer) {
    const codec = await getFirstEncodableAudioCodec(outputFormat.getSupportedAudioCodecs());
    if (codec) {
      audioSource = new AudioBufferSource({ codec, bitrate: QUALITY_HIGH });
      output.addAudioTrack(audioSource);
    } else {
      warning = `this browser has no audio encoder for ${format.toUpperCase()}`;
    }
  }

  await output.start();

  if (audioSource && audioBuffer) {
    try {
      await audioSource.add(audioBuffer);
    } catch {
      warning = "the audio failed to encode";
    }
  }

  const dt = 1 / project.fps;
  for (let f = 0; f < project.frameCount; f++) {
    renderFrame(ctx, project, f, dpr, {
      // Video has no alpha codec here (MP4/H.264); a transparent project is intentionally
      // flattened onto project.bgColor.
      drawBg: true,
      includeReference: false,
      boil: project.boil.enabled ? project.boil : undefined,
    });
    await source.add(f * dt, dt);
  }

  await output.finalize();
  const buffer = output.target.buffer!;
  return {
    blob: new Blob([buffer], { type: format === "mp4" ? "video/mp4" : "video/webm" }),
    warning,
  };
}
```

Known residual risk, accept it rather than engineer around it: a track cannot be removed once
added, so if `audioSource.add()` throws the file keeps an empty audio track. The codec check above
makes that path unlikely, and the alternative — aborting the render — is exactly what the spec
rules out.

- [ ] **Step 3: Surface the warning in `src/lib/ExportDialog.svelte`**

Replace the body of `run()` (currently lines 13-31) with:

```ts
  async function run(kind: "png" | VideoFormat) {
    if (busy) return;
    busy = true;
    status = `Exporting ${kind.toUpperCase()}… (${appState.project.frameCount} frames)`;
    try {
      if (kind === "png") {
        const blob = await exportPngSequence(appState.project, DPR);
        downloadBlob(blob, `${stem}.zip`);
        status = "Done.";
      } else {
        const { blob, warning } = await exportVideo(appState.project, DPR, kind);
        downloadBlob(blob, `${stem}.${kind}`);
        status = warning ? `Done — exported without audio: ${warning}.` : "Done.";
      }
    } catch (e) {
      status = `Failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      busy = false;
    }
  }
```

The shared `status = "Done."` that used to sit after the if/else is gone — each branch sets its
own now. Nothing else in the component changes.

- [ ] **Step 4: Run the gate**

Run: `npm run build`
Expected: 0 errors, 0 warnings. If `svelte-check` reports an unused import or an unhandled
promise, fix it here rather than deferring.

Run: `npm test`
Expected: still 398 passing — this task adds no tests and must break none.

- [ ] **Step 5: Verify no other caller of `exportVideo` broke**

Run: `grep -rn "exportVideo" src`
Expected: exactly two hits — the definition in `src/export/video.ts` and the call in
`src/lib/ExportDialog.svelte`. If a third exists, update it to destructure `{ blob }`.

- [ ] **Step 6: Commit**

```bash
git add src/export/audio-mix.ts src/export/video.ts src/lib/ExportDialog.svelte
git commit -m "feat: mux the project audio track into MP4/WebM export"
```

---

### Task 3: Documentation and the browser pass

**Files:**

- Modify: `README.md:33` (audio feature bullet), `README.md:63` (test count), `README.md:79`
  (roadmap line)
- Modify: `CLAUDE.md` (append an entry after the eyedropper one, at the end of the file)

**Interfaces:**

- Consumes: nothing. This task ships the user-facing record of Tasks 1-2.
- Produces: nothing consumed by later tasks.

Per `CLAUDE.md`, the README is not optional follow-up work — a feature that changes what the app
DOES is not finished until the README says so.

- [ ] **Step 1: Update the README audio bullet**

`README.md:33` currently reads:

```markdown
- Audio track: import, waveform, synced playback, **scrub-while-you-drag**, drag-to-offset and mute
```

Replace with:

```markdown
- Audio track: import, waveform, synced playback, **scrub-while-you-drag**, drag-to-offset, mute, and muxed into the MP4/WebM export
```

- [ ] **Step 2: Update the README test count**

Run `npm test` and read the real number — do not guess. `README.md:63` currently reads:

```markdown
npm test           # Vitest — pure-logic unit tests (~380); canvas/DOM code isn't node-testable
```

Update `~380` to match the actual count (expected `~400` after Task 1's 9 tests).

- [ ] **Step 3: Update the README roadmap**

`README.md:79` currently reads:

```markdown
Animated/keyframed transforms, audio in exported video (muxing), group-transform apply
```

Delete the shipped item:

```markdown
Animated/keyframed transforms, group-transform apply
```

- [ ] **Step 4: Append the CLAUDE.md entry**

Add at the end of `CLAUDE.md`:

```markdown
**Audio Phase 3 — export muxing (2026-08-11):** the project audio track is now muxed into the
MP4/WebM export, closing the audio roadmap (P1 import/playback, P2 scrub/offset/mute, P3 export).
Alignment reuses the PLAYBACK rule rather than restating it: `audioExportPlan`
(`src/export/audio-mix.ts`, pure + unit-tested, 9 cases) calls the same `bufferOffsetForFrame` that
`AudioEngine.play` does, so the two cannot drift apart; it returns null — meaning **no audio track
in the file at all**, never a silent one — for no track, a **muted** track (mute means silent
export, WYSIWYG), or a clip dragged entirely outside the export window. `buildExportAudio` applies
the plan with ONE `OfflineAudioContext` render, which does placement, truncation at the window end
and **resampling to 48 kHz** (accepted by both AAC and Opus, so a 44.1 kHz import needs no special
case) in a single step. `exportVideo` now returns `{ blob, warning? }` instead of a bare Blob:
audio is decided before `output.start()` (mediabunny cannot add a track later) and **any audio
failure drops the audio, never the render** — a multi-minute encode must not be lost to a missing
encoder. `@mediabunny/aac-encoder` was deliberately NOT added: every browser with the WebCodecs
VideoEncoder this export already requires also encodes AAC natively. No UI control — a track that
exists and is not muted is included, and mute is already the control for excluding it. Residual
risk, accepted: a track cannot be un-added, so an `AudioBufferSource.add()` failure after start
leaves an empty audio track in the file. Reference-video soundtracks (`audioEnabled`) are still
preview-only. **Owed a browser pass:** see the list below. Spec/plan:
`…/2026-08-11-audio-phase3-export-muxing*.md`.
```

- [ ] **Step 5: Run the gate and commit**

Run: `npm run build` (0 errors, 0 warnings) and `npm test`.

```bash
git add README.md CLAUDE.md
git commit -m "docs: record audio phase 3 export muxing"
```

- [ ] **Step 6: Hand the browser pass to the user**

This feature cannot be verified by the test suite — WebCodecs, `OfflineAudioContext` and the
download path are all browser-only. Tell the user it is build + review verified and list what needs
eyeballing, in this order (each one covers a different branch of the plan):

1. Import audio, export **MP4** — the file has sound and stays in sync at the end as well as the start.
2. Same project, export **WebM** — Opus path.
3. Drag the clip right by a visible amount, export — audio starts late by that amount.
4. Drag the clip left past frame 0, export — audio starts partway into the clip.
5. Mute the track, export — the file has no audio at all.
6. Audio longer than the animation — the file ends with the video, not the clip.
7. Drag the clip entirely past the last frame, export — no audio track, and the export still works.
8. PNG-sequence export still works (it never had audio and must be untouched).
9. iPad (Safari WebCodecs) for at least the MP4 path.
```

---

## Self-Review

**Spec coverage:** requirement 1 (mux into MP4+WebM) → Task 2; requirement 2 (project track only,
no reference audio) → nothing added for reference layers, and the CLAUDE.md entry in Task 3 records
it; requirement 3 (muted = silent) → Task 1 tests + `audioExportPlan`; requirement 4 (degrade,
don't fail) → Task 2 Step 2's two try/catch blocks and the codec check, surfaced in Step 3.
Spec §Testing's unit list → Task 1's 9 cases, one per listed case. Spec §UI (no new control) →
Task 2 Step 3 changes only the status line.

**Placeholder scan:** no TBDs; every code step carries the literal code; the browser-pass step
enumerates the nine checks rather than saying "verify it works".

**Type consistency:** `audioExportPlan`/`AudioExportInput`/`AudioExportPlan`/`buildExportAudio`/
`VideoExportResult` are spelled identically in Task 1's Produces block, Task 2's Consumes block and
both implementations. `windowS`/`startAt`/`sourceOffset` match across the tests, the implementation
and `buildExportAudio`'s use of them.
