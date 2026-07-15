# Video Reference Perf Implementation Plan

> **Superseded 2026-07-14 (playing-branch drift only):** the Task 1 drift branch shown here as
> `Math.abs(vid.currentTime - clamped) > PLAY_DRIFT` is now **directional** —
> `vid.currentTime - clamped > PLAY_DRIFT` (re-seek only when the element is *ahead* / loop-wrap;
> free-run on forward drift, for clean unmuted-ref audio). Everything else in this plan is current.
> See `2026-07-14-video-reference-audio.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Free video/image blob URLs + decoder when unreachable, lazy `preload="metadata"`, and `play()` the video during playback (drift-corrected) instead of seeking every frame.

**Architecture:** `syncReferenceVideos` gains a `playing` flag with drift/resume logic (node-unit-tested with a fake video); a new `releaseReferenceMedia` frees blob URLs + tears down the decoder; `loadVideoMedia` preloads metadata only; `appState` releases media on relink/replaceProject and drives play/pause via `onPlayingChange`; `Canvas` passes the playing flag.

**Tech Stack:** TypeScript, Vite, Vitest (node env).

## Global Constraints

- Build bar: `npm run build` must be **0 errors, 0 warnings**.
- `reference.ts`'s `syncReferenceVideos` is DOM-free (operates on passed objects) → node-unit-tested. `releaseReferenceMedia`/`loadVideoMedia`/playback smoothness are DOM/decoder → build + reasoning + browser verified. `npm test` baseline (**319**) + new sync tests.
- **Undo-safety:** do NOT release media in `removeLayer` (undo snapshots share the media object). Only `relinkReference` and `replaceProject` (which clears history) release.
- Real-time mapping holds: 1 frame = 1/fps s → `playbackRate` stays 1.
- Surgical; match existing style. Pre-commit hook reformats staged files (expected).

---

## Task 1: `syncReferenceVideos` — playing flag + drift/resume (TDD)

**Files:**
- Modify: `src/anim/reference.ts`
- Test: `src/__tests__/reference.test.ts` (new)

**Interfaces:**
- Produces: `syncReferenceVideos(project: Project, frame: number, fps: number, playing?: boolean): void` (4th arg added, default `false`).

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/reference.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Project } from "../anim/document";
import { syncReferenceVideos } from "../anim/reference";

// Fake <video>: mutable currentTime/paused/duration + a play() spy.
function fakeVid(init: Partial<{ currentTime: number; paused: boolean; duration: number }> = {}) {
  return {
    currentTime: init.currentTime ?? 0,
    paused: init.paused ?? true,
    duration: init.duration ?? 10,
    playCount: 0,
    play() {
      this.playCount++;
      this.paused = false;
      return Promise.resolve();
    },
  };
}
type FakeVid = ReturnType<typeof fakeVid>;
function vidLayer(el: FakeVid, offsetFrames = 0) {
  return { kind: "ref", id: 1, media: { type: "video", el }, offsetFrames } as unknown as never;
}
function proj(layers: unknown[]): Project {
  return { layers } as unknown as Project;
}

describe("syncReferenceVideos", () => {
  it("paused: exact-seeks to (frame+offset)/fps", () => {
    const v = fakeVid();
    syncReferenceVideos(proj([vidLayer(v)]), 12, 12, false); // 12/12 = 1s
    expect(v.currentTime).toBe(1);
  });

  it("paused: no seek when already within epsilon", () => {
    const v = fakeVid({ currentTime: 1 });
    syncReferenceVideos(proj([vidLayer(v)]), 12, 12, false);
    expect(v.currentTime).toBe(1);
    expect(v.playCount).toBe(0);
  });

  it("applies offsetFrames and clamps to [0, duration]", () => {
    const a = fakeVid({ duration: 5 });
    syncReferenceVideos(proj([vidLayer(a, 24)]), 12, 12, false); // (12+24)/12 = 3s
    expect(a.currentTime).toBe(3);
    const b = fakeVid({ duration: 2 });
    syncReferenceVideos(proj([vidLayer(b)]), 120, 12, false); // 10s clamped to 2
    expect(b.currentTime).toBe(2);
    const c = fakeVid();
    syncReferenceVideos(proj([vidLayer(c, -120)]), 12, 12, false); // -9s clamped to 0
    expect(c.currentTime).toBe(0);
  });

  it("playing + within drift: does NOT seek (lets it run)", () => {
    const v = fakeVid({ currentTime: 1.1, paused: false });
    syncReferenceVideos(proj([vidLayer(v)]), 12, 12, true); // wanted 1.0, drift 0.1 < 0.3
    expect(v.currentTime).toBe(1.1);
    expect(v.playCount).toBe(0);
  });

  it("playing + drift > 0.3: re-seeks", () => {
    const v = fakeVid({ currentTime: 5, paused: false });
    syncReferenceVideos(proj([vidLayer(v)]), 12, 12, true); // wanted 1.0, drift 4 > 0.3
    expect(v.currentTime).toBe(1);
  });

  it("playing + paused element: seeks and resumes play()", () => {
    const v = fakeVid({ currentTime: 0, paused: true });
    syncReferenceVideos(proj([vidLayer(v)]), 12, 12, true);
    expect(v.currentTime).toBe(1);
    expect(v.playCount).toBe(1);
    expect(v.paused).toBe(false);
  });

  it("skips non-video / missing layers without error", () => {
    const draw = { kind: "draw", id: 2, cells: [] } as unknown;
    const miss = { kind: "ref", id: 3, media: { type: "missing", was: "video", name: "x" }, offsetFrames: 0 } as unknown;
    expect(() => syncReferenceVideos(proj([draw, miss]), 5, 12, true)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run → fail** — `npx vitest run src/__tests__/reference.test.ts` → some assertions fail (the `playing` branch doesn't exist yet).

- [ ] **Step 3: Implement** — replace `syncReferenceVideos` in `src/anim/reference.ts`:

```ts
const SEEK_EPSILON = 1e-3;
const PLAY_DRIFT = 0.3; // s — while playing, only re-seek when the video drifts more than this
                        //     (also catches the end→start jump on loop-wrap)

/**
 * Align each video reference to the playhead. Paused (scrubbing) → exact seek. Playing → let the
 * element run and only re-seek on large drift, and resume play() if it paused (ended / joined
 * mid-playback). `onSeeked` (set at load) recomposites when a seek lands.
 */
export function syncReferenceVideos(
  project: Project,
  frame: number,
  fps: number,
  playing = false,
): void {
  for (const layer of project.layers) {
    if (layer.kind !== "ref" || layer.media.type !== "video") continue;
    const vid = layer.media.el;
    const off = Number.isFinite(layer.offsetFrames) ? layer.offsetFrames : 0;
    const wanted = (frame + off) / fps;
    const dur = isFinite(vid.duration) ? vid.duration : wanted;
    const clamped = Math.max(0, Math.min(dur, wanted));
    if (!playing) {
      if (Math.abs(vid.currentTime - clamped) > SEEK_EPSILON) vid.currentTime = clamped;
    } else if (vid.paused) {
      vid.currentTime = clamped;
      void vid.play().catch(() => {});
    } else if (Math.abs(vid.currentTime - clamped) > PLAY_DRIFT) {
      vid.currentTime = clamped;
    }
  }
}
```

- [ ] **Step 4: Run → pass** — `npx vitest run src/__tests__/reference.test.ts` → all pass.

- [ ] **Step 5: Commit**
```bash
git add src/anim/reference.ts src/__tests__/reference.test.ts
git commit -m "feat: syncReferenceVideos playing flag — play()+drift-correct instead of per-frame seek"
```

---

## Task 2: `releaseReferenceMedia` + lazy preload

**Files:**
- Modify: `src/anim/reference.ts`

**Interfaces:**
- Produces: `releaseReferenceMedia(media: ReferenceMedia): void`.
- Changes: `loadVideoMedia` → `preload="metadata"`, resolve on `loadedmetadata`.

DOM/decoder → build + reasoning verified.

- [ ] **Step 1: Lazy preload** — in `loadVideoMedia`, change `el.preload = "auto"` → `el.preload = "metadata"`, and change the resolve listener from `loadeddata` to `loadedmetadata`:

```ts
    el.addEventListener("loadedmetadata", () => resolve({ type: "video", el }), { once: true });
```
(Keep the `seeked` → `onSeeked` and `error` listeners. `videoWidth/Height` are set by `loadedmetadata`, so `mediaIntrinsicSize` is unaffected; the first frame paints via the initial sync seek.)

- [ ] **Step 2: Add `releaseReferenceMedia`**

```ts
/** Free a reference layer's media: revoke its blob URL and (for video) detach the source so the
 *  decoder can be reclaimed. Call ONLY when the media is unreachable (relink of the old media,
 *  or replaceProject clearing the old document) — NOT on removeLayer (undo shares the object). */
export function releaseReferenceMedia(media: ReferenceMedia): void {
  if (media.type === "missing") return;
  const el = media.el;
  if (media.type === "video") el.pause();
  if (el.src.startsWith("blob:")) URL.revokeObjectURL(el.src);
  if (media.type === "video") {
    el.removeAttribute("src");
    el.load(); // detach the source; lets the media element release its decode buffers
  }
}
```
(Import/keep `ReferenceMedia` in the type imports — it's already imported.)

- [ ] **Step 3: Verify** — `npm run build` 0/0; `npm test` (baseline + Task-1 tests).

- [ ] **Step 4: Commit**
```bash
git add src/anim/reference.ts
git commit -m "feat: releaseReferenceMedia (revoke blob + decoder teardown) + preload=metadata"
```

---

## Task 3: appState release + play/pause wiring; Canvas playing flag

**Files:**
- Modify: `src/state/appState.svelte.ts` (`relinkReference`, `replaceProject`, `onPlayingChange`, import)
- Modify: `src/lib/Canvas.svelte` (tick `syncReferenceVideos` 4th arg)

**Interfaces:**
- Consumes: `releaseReferenceMedia`, `syncReferenceVideos` (Tasks 1-2).

Build + browser verified.

- [ ] **Step 1: Import** — add `releaseReferenceMedia` to the existing `../anim/reference` import in `appState.svelte.ts` (already imports `syncReferenceVideos`/load fns). Add a tiny local helper near the playback controller:

```ts
/** Video ref elements in the current project. */
function videoRefEls(): HTMLVideoElement[] {
  return state.project.layers
    .filter((l): l is ReferenceLayer => l.kind === "ref" && l.media.type === "video")
    .map((l) => (l.media as { el: HTMLVideoElement }).el);
}
```
(Use whatever `ReferenceLayer` type import is already present; if not, narrow inline.)

- [ ] **Step 2: Release on relink** — in `relinkReference`, before `layer.media = media`:

```ts
  if (layer && layer.kind === "ref") {
    releaseReferenceMedia(layer.media); // free the old media (this is not undoable)
    layer.media = media;
    bump();
  }
```

- [ ] **Step 3: Release on replaceProject** — in `replaceProject`, before `state.project = project;` (history is cleared here → old media unreachable):

```ts
  for (const l of state.project.layers) if (l.kind === "ref") releaseReferenceMedia(l.media);
  state.project = project;
```

- [ ] **Step 4: Play/pause the videos** — in the `playbackController` config's `onPlayingChange(p)`, alongside the existing audio play/pause:

```ts
  onPlayingChange: (p) => {
    state.playback.isPlaying = p;
    if (p) {
      audioEngine.play(state.playhead, state.project.fps);
      for (const el of videoRefEls()) {
        el.currentTime = (state.playhead + 0) / state.project.fps; // seek onto the frame, then run
        void el.play().catch(() => {});
      }
    } else {
      audioEngine.pause();
      for (const el of videoRefEls()) el.pause(); // next tick exact-seeks onto the paused frame
    }
    state.version++;
  },
```
(The per-layer `offsetFrames` re-aligns on the very next `syncReferenceVideos` tick, so the simple playhead seek here is only a starting point — leave it as shown; the drift path handles the offset.)

- [ ] **Step 5: Canvas passes the playing flag** — in `Canvas.svelte`'s tick, change:
```ts
        syncReferenceVideos(appState.project, appState.playhead, appState.project.fps);
```
to:
```ts
        syncReferenceVideos(
          appState.project,
          appState.playhead,
          appState.project.fps,
          appState.playback.isPlaying,
        );
```

- [ ] **Step 6: Verify** — `npm run build` 0/0; `npm test` 319 + Task-1 tests.

- [ ] **Step 7: Browser verification (user-deferred checklist — do NOT run a browser)**
Record: import a video → scrub (frame-exact, snappier) → play (smooth, rate-matched, not frozen/laggy) → loop-wrap re-aligns → relink a video (old released) → New/Open (all released); repeated import/relink doesn't climb memory; a large file isn't fully buffered on import (`preload=metadata`).

- [ ] **Step 8: Commit**
```bash
git add src/state/appState.svelte.ts src/lib/Canvas.svelte
git commit -m "feat: release ref media on relink/replaceProject; play/pause videos with playback"
```

---

## Final verification

- [ ] **Full build:** `npm run build` → 0 errors, 0 warnings.
- [ ] **Full tests:** `npm test` → 319 + the new syncReferenceVideos tests.
- [ ] **Interactive pass (flag as verification debt):** import/scrub/play/loop/relink/New-Open per Task 3 Step 7; confirm playback smoothness + no memory climb.

---

## Spec coverage self-check

- Blob-URL + decoder release on relink/replaceProject, NOT removeLayer (D1) → Task 2 (`releaseReferenceMedia`) + Task 3 Steps 2-3.
- `preload="metadata"` + `loadedmetadata` (D2) → Task 2 Step 1.
- Playing → play()+drift, paused → exact seek (D3) → Task 1 (`syncReferenceVideos`) + Task 3 Steps 4-5 (`onPlayingChange` + Canvas flag).
- Rate-matched-not-frame-locked (D4) → the drift branch in Task 1.
- Reference-only scope; no WebCodecs/cache (D5) → not implemented, per spec Non-goals.
- Node-testable sync logic → Task 1 tests.
