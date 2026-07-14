# Per-Video Reference Audio (Unmute) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-video-reference `audioEnabled` toggle (default off = today's silent behavior) that unmutes the video element so it plays its own soundtrack during playback, speed-synced for free.

**Architecture:** `ReferenceLayer.audioEnabled` field; `syncReferenceVideos` enforces `vid.muted = !audioEnabled` (node-unit-tested); a LayerList 🔊/🔇 toggle button (sets the flag + `el.muted` directly for immediacy); save/load in project-file.

**Tech Stack:** TypeScript, Svelte 5 (runes), Vite, Vitest.

## Global Constraints

- Build bar: `npm run build` **0 errors, 0 warnings**.
- `syncReferenceVideos` is DOM-free → node-unit-tested. LayerList/persistence are DOM/IO → build + browser verified. `npm test` baseline (~328 + speed cases) stays green + new audio cases.
- Back-compat: old projects (no `audioEnabled`) load as `false` (off); missing/undefined `audioEnabled` → treated as `false` in sync.
- Audio is the video element's own soundtrack (no separate audio track, no audio engine). Plays only during playback; silent while scrubbing/paused. Speed sync is inherent (same element).
- Preserve the perf pass + speed logic in `syncReferenceVideos`: the `vid.seeking` coalesce guard, the `playbackRate` guard, and the paused/playing seek branches all stay unchanged; only the mute-enforcement lines are added.
- Surgical; match existing style. Pre-commit hook reformats staged files (expected).

---

## Task 1: `audioEnabled` field + mute enforcement in `syncReferenceVideos` (TDD)

**Files:**
- Modify: `src/anim/document.ts` (`ReferenceLayer` interface + `createReferenceLayer`)
- Modify: `src/anim/reference.ts` (`syncReferenceVideos`)
- Test: `src/__tests__/reference.test.ts` (extend)

**Interfaces:**
- Produces: `ReferenceLayer.audioEnabled: boolean`; `syncReferenceVideos` sets `vid.muted = !(layer.audioEnabled ?? false)`.

- [ ] **Step 1: Add the model field**

In `src/anim/document.ts`, `ReferenceLayer` interface, immediately after the `speed: number;` line:
```ts
  audioEnabled: boolean; // video plays its own soundtrack when true (unmuted during playback); video-only, ignored for images
```
In `createReferenceLayer`, immediately after `speed: 1,`:
```ts
    audioEnabled: false,
```

- [ ] **Step 2: Write the failing tests**

In `src/__tests__/reference.test.ts`:

(a) Add `muted: true` to the `fakeVid` return object (after `playbackRate: 1,`):
```ts
    playbackRate: 1,
    muted: true,
```

(b) Give `vidLayer` an `audioEnabled` param and include it in the returned object:
```ts
function vidLayer(el: FakeVid, offsetFrames = 0, speed = 1, audioEnabled = false) {
  return {
    kind: "ref",
    id: 1,
    media: { type: "video", el },
    offsetFrames,
    speed,
    audioEnabled,
  } as unknown as never;
}
```

(c) Add tests inside the `describe("syncReferenceVideos", ...)` block:
```ts
  it("audioEnabled true → unmutes the element", () => {
    const v = fakeVid(); // muted: true initially
    syncReferenceVideos(proj([vidLayer(v, 0, 1, true)]), 0, 12, false);
    expect(v.muted).toBe(false);
  });

  it("audioEnabled false → keeps the element muted", () => {
    const v = fakeVid();
    v.muted = false; // prove sync re-mutes it
    syncReferenceVideos(proj([vidLayer(v, 0, 1, false)]), 0, 12, false);
    expect(v.muted).toBe(true);
  });

  it("missing audioEnabled → treated as muted", () => {
    const v = fakeVid();
    v.muted = false;
    // layer without audioEnabled (simulates old in-memory/project data)
    const layer = { kind: "ref", id: 1, media: { type: "video", el: v }, offsetFrames: 0, speed: 1 };
    syncReferenceVideos(proj([layer as unknown as never]), 0, 12, false);
    expect(v.muted).toBe(true);
  });

  it("toggling audioEnabled between syncs flips muted", () => {
    const v = fakeVid();
    syncReferenceVideos(proj([vidLayer(v, 0, 1, true)]), 0, 12, false);
    expect(v.muted).toBe(false);
    syncReferenceVideos(proj([vidLayer(v, 0, 1, false)]), 0, 12, false);
    expect(v.muted).toBe(true);
  });

  it("mute enforcement does not disturb currentTime", () => {
    const v = fakeVid();
    syncReferenceVideos(proj([vidLayer(v, 0, 1, true)]), 12, 12, false); // wanted 1.0s
    expect(v.currentTime).toBe(1);
    expect(v.muted).toBe(false);
  });
```

- [ ] **Step 3: Run → fail** — `npx vitest run src/__tests__/reference.test.ts` → the new `muted` cases fail (sync doesn't touch `muted` yet).

- [ ] **Step 4: Implement** — in `syncReferenceVideos` (`src/anim/reference.ts`), inside the per-layer loop, immediately AFTER the existing `if (vid.playbackRate !== rate) vid.playbackRate = rate;` line, add:
```ts
    const wantMuted = !(layer.audioEnabled ?? false);
    if (vid.muted !== wantMuted) vid.muted = wantMuted;
```
(Leave the `if (vid.seeking) continue;` guard, the `off`/`spd`/`wanted`/`clamped`/`rate` lines, and the paused/playing seek branches unchanged.)

- [ ] **Step 5: Run → pass** — `npx vitest run src/__tests__/reference.test.ts` → all pass (new + existing speed/seek cases).

- [ ] **Step 6: Commit**
```bash
git add src/anim/document.ts src/anim/reference.ts src/__tests__/reference.test.ts
git commit -m "feat: per-video audioEnabled field + mute enforcement in syncReferenceVideos"
```

---

## Task 2: LayerList audio toggle button + persistence

**Files:**
- Modify: `src/lib/LayerList.svelte` (🔊/🔇 toggle on video ref rows)
- Modify: `src/persist/project-file.ts` (`ReferenceJson` type + save + load)

Build + browser verified (DOM/IO).

**Interfaces:**
- Consumes: `ReferenceLayer.audioEnabled` (Task 1). Toggling sets the flag, sets `el.muted` directly for immediate feedback while paused, and `bump()`s.

- [ ] **Step 1: LayerList toggle button** — in `src/lib/LayerList.svelte`, immediately after the existing video-ref **speed** `<input>` (the one with `bind:value={layer.speed}`, inside the `{#if layer.kind === "ref" && layer.media.type === "video"}` block), add:
```svelte
          <button
            class="layer-btn"
            style="width:auto;padding:2px 6px;font-size:11px"
            onclick={(e) => {
              e.stopPropagation();
              layer.audioEnabled = !layer.audioEnabled;
              if (layer.media.type === "video") layer.media.el.muted = !layer.audioEnabled;
              bump();
            }}
            title={layer.audioEnabled ? "Audio on — click to mute" : "Audio off — click to play video sound"}
          >
            {layer.audioEnabled ? "🔊" : "🔇"}
          </button>
```
(The `if (layer.media.type === "video")` guard is required for TS narrowing — `layer.media.el` is only a video element in that branch. Match the surrounding controls' style; `bump()` and the `stopPropagation` mirror the offset/speed inputs.)

- [ ] **Step 2: Persistence type** — in `src/persist/project-file.ts`, `interface ReferenceJson`, immediately after the `speed?: number;` line, add:
```ts
  audioEnabled?: boolean;
```

- [ ] **Step 3: Save** — in the ref-layer serialize object (the one with `speed: l.speed,`), immediately after that line add:
```ts
        audioEnabled: l.audioEnabled,
```

- [ ] **Step 4: Load** — in the ref reconstruct literal (the `{ kind: "ref", … speed: rj.speed ?? 1, …}` object), immediately after the `speed: rj.speed ?? 1,` line add:
```ts
      audioEnabled: rj.audioEnabled ?? false,
```
(back-compat: pre-audio projects → off.)

- [ ] **Step 5: Verify** — `npm run build` → 0 errors, 0 warnings; `npm test` → baseline + Task-1 cases pass.

- [ ] **Step 6: Browser verification (user-deferred checklist — do NOT run a browser)**
Record for the user's interactive pass: a video ref row shows a 🔇/🔊 toggle; enabling it plays the video's audio during playback; scrubbing is silent; at speed 2× audio is faster + higher-pitched and stays in sync, at 0.5× slower + lower; toggling off mid-playback silences it immediately; save → reload keeps the flag; opening an OLD (pre-audio) project loads video refs with audio off; two video refs with audio on both play.

- [ ] **Step 7: Commit**
```bash
git add src/lib/LayerList.svelte src/persist/project-file.ts
git commit -m "feat: video ref audio toggle (LayerList) + persist audioEnabled"
```

---

## Final verification

- [ ] **Full build:** `npm run build` → 0 errors, 0 warnings.
- [ ] **Full tests:** `npm test` → baseline + new audio cases green.
- [ ] **Interactive pass (flag as verification debt):** audio toggle on video ref rows; hear audio during playback, silent on scrub; 2×/0.5× pitch + sync; toggle-off mid-play; save/reload persistence; old-project audio-off back-compat; two videos with audio.

---

## Spec coverage self-check

- Unmute approach, element's own soundtrack, no audio track/engine (D1) → Task 1 (mute enforcement) + Task 2 (toggle).
- `audioEnabled: boolean`, video-only (D2) → Task 1 Step 1.
- Default `false` (D3) → Task 1 Step 1 (`createReferenceLayer`), Task 2 Step 4 (load default).
- Mute enforced in `syncReferenceVideos`, guarded, load/relink/toggle uniform (D4) → Task 1 Step 4.
- Audio only during playback; silent on scrub (D5) → inherent (no code); recorded in browser checklist.
- Speed sync automatic (D6) → inherent (same element at `playbackRate`); browser checklist.
- 🔊/🔇 toggle on video rows beside offset/speed (D7) → Task 2 Step 1.
- Persist `audioEnabled`; load `?? false` (D8) → Task 2 Steps 2–4.
- `audioEnabled` missing → `false` guard → Task 1 (`?? false` in sync) + Task 2 (load default).
- Node-tested mute logic → Task 1 Step 2 tests.
- Non-goals (volume slider, scrub audio, waveform, export muxing, extract-to-track) → not in plan, per spec.
