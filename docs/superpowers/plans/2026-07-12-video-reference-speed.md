# Per-Video Reference Speed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-video-reference `speed` multiplier (1× = today) that retimes the clip against the timeline, with `playbackRate` matched during playback and the value persisted.

**Architecture:** `ReferenceLayer.speed` field; `syncReferenceVideos` computes `(offset + frame×speed)/fps` and sets `playbackRate` (node-unit-tested); `onPlayingChange` uses the speed-aware seek; a LayerList number field; save/load in project-file.

**Tech Stack:** TypeScript, Svelte 5, Vite, Vitest.

## Global Constraints

- Build bar: `npm run build` **0 errors, 0 warnings**.
- `syncReferenceVideos` is DOM-free → node-unit-tested. LayerList/persistence are DOM/IO → build + browser verified. `npm test` baseline **328** + new speed cases.
- Back-compat: old projects (no `speed`) load as `1×`; `speed ≤ 0`/NaN/missing → treated as `1` in sync.
- Preserve the perf pass: the `vid.seeking` coalesce guard and paused/playing branches stay; only `wanted` gains `× speed` and `playbackRate` is set.
- Surgical; match existing style. Pre-commit hook reformats staged files (expected).

---

## Task 1: `speed` field + speed-aware `syncReferenceVideos` (TDD)

**Files:**
- Modify: `src/anim/document.ts` (`ReferenceLayer` + `createReferenceLayer`)
- Modify: `src/anim/reference.ts` (`syncReferenceVideos`)
- Test: `src/__tests__/reference.test.ts` (extend)

**Interfaces:**
- Produces: `ReferenceLayer.speed: number`; `syncReferenceVideos` uses `(offset + frame×speed)/fps` + sets `playbackRate`.

- [ ] **Step 1: Add the model field**

In `src/anim/document.ts`, `ReferenceLayer` interface, after `offsetFrames`:
```ts
  speed: number; // video playback speed multiplier (1 = real-time; 2 = 2× faster, 0.5 = half); video-only
```
In `createReferenceLayer`, after `offsetFrames: 0,`:
```ts
    speed: 1,
```

- [ ] **Step 2: Write the failing tests**

In `src/__tests__/reference.test.ts`: add `playbackRate: 1` to the `fakeVid` return object (after `seeking`), and give `vidLayer` a `speed` param:
```ts
function vidLayer(el: FakeVid, offsetFrames = 0, speed = 1) {
  return { kind: "ref", id: 1, media: { type: "video", el }, offsetFrames, speed } as unknown as never;
}
```
Then add tests (inside the describe):
```ts
  it("speed > 1 advances the video faster (frame × speed)", () => {
    const v = fakeVid();
    syncReferenceVideos(proj([vidLayer(v, 0, 2)]), 6, 12, false); // (0 + 6*2)/12 = 1.0s (not 0.5)
    expect(v.currentTime).toBe(1);
  });

  it("speed < 1 advances the video slower", () => {
    const v = fakeVid();
    syncReferenceVideos(proj([vidLayer(v, 0, 0.5)]), 12, 12, false); // (0 + 12*0.5)/12 = 0.5s
    expect(v.currentTime).toBe(0.5);
  });

  it("applies offset additively with speed", () => {
    const v = fakeVid();
    syncReferenceVideos(proj([vidLayer(v, 12, 2)]), 6, 12, false); // (12 + 12)/12 = 2.0s
    expect(v.currentTime).toBe(2);
  });

  it("sets playbackRate from speed (clamped to [0.0625, 16])", () => {
    const v = fakeVid();
    syncReferenceVideos(proj([vidLayer(v, 0, 2)]), 0, 12, false);
    expect(v.playbackRate).toBe(2);
    const fast = fakeVid();
    syncReferenceVideos(proj([vidLayer(fast, 0, 100)]), 0, 12, false);
    expect(fast.playbackRate).toBe(16);
    const slow = fakeVid();
    syncReferenceVideos(proj([vidLayer(slow, 0, 0.01)]), 0, 12, false);
    expect(slow.playbackRate).toBe(0.0625);
  });

  it("treats missing/zero/negative speed as 1", () => {
    const a = fakeVid();
    syncReferenceVideos(proj([vidLayer(a, 0, 0)]), 12, 12, false); // speed 0 → 1 → wanted 1.0
    expect(a.currentTime).toBe(1);
    expect(a.playbackRate).toBe(1);
    const b = fakeVid();
    syncReferenceVideos(proj([vidLayer(b, 0, -3)]), 12, 12, false); // negative → 1
    expect(b.currentTime).toBe(1);
  });
```

- [ ] **Step 3: Run → fail** — `npx vitest run src/__tests__/reference.test.ts` → the new speed/playbackRate cases fail.

- [ ] **Step 4: Implement** — in `syncReferenceVideos` (`src/anim/reference.ts`), inside the per-layer loop, replace the `off`/`wanted`/`clamped` lines and add the rate:
```ts
    const off = Number.isFinite(layer.offsetFrames) ? layer.offsetFrames : 0;
    const spd = Number.isFinite(layer.speed) && layer.speed > 0 ? layer.speed : 1;
    const wanted = (off + frame * spd) / fps;
    const dur = isFinite(vid.duration) ? vid.duration : wanted;
    const clamped = Math.max(0, Math.min(dur, wanted));
    const rate = Math.max(0.0625, Math.min(16, spd));
    if (vid.playbackRate !== rate) vid.playbackRate = rate;
```
(Keep the `if (vid.seeking) continue;` guard above these, and the existing `if (!playing) … else if (vid.paused) … else if (drift) …` seek branches below, unchanged — they already use `clamped`.)

Note: `vid.playbackRate` is set BEFORE the `seeking` guard would matter — but the guard is above; keep the rate-set AFTER the guard (so a mid-seek element still isn't seeked, but its rate still updates — either order is fine; place it with the `off`/`wanted` block as shown, which is after the guard).

- [ ] **Step 5: Run → pass** — `npx vitest run src/__tests__/reference.test.ts` → all pass.

- [ ] **Step 6: Commit**
```bash
git add src/anim/document.ts src/anim/reference.ts src/__tests__/reference.test.ts
git commit -m "feat: per-video reference speed — (offset+frame*speed)/fps + playbackRate"
```

---

## Task 2: `onPlayingChange` speed-aware start-seek

**Files:**
- Modify: `src/state/appState.svelte.ts` (`playbackController` config `onPlayingChange` play branch)

Build-verified.

- [ ] **Step 1: Update the play branch** — replace the per-video seek loop in `onPlayingChange(p)`'s `if (p)` branch:
```ts
      for (const l of state.project.layers) {
        if (l.kind !== "ref" || l.media.type !== "video") continue;
        const el = l.media.el;
        const spd = Number.isFinite(l.speed) && l.speed > 0 ? l.speed : 1;
        el.playbackRate = Math.max(0.0625, Math.min(16, spd));
        el.currentTime = (l.offsetFrames + state.playhead * spd) / state.project.fps;
        void el.play().catch(() => {});
      }
```
(Leave the pause branch — `for (const el of videoRefEls()) el.pause()` — unchanged.)

- [ ] **Step 2: Verify** — `npm run build` 0/0; `npm test` (baseline + Task-1 tests).

- [ ] **Step 3: Commit**
```bash
git add src/state/appState.svelte.ts
git commit -m "feat: onPlayingChange seeks/rates videos by per-layer speed"
```

---

## Task 3: LayerList speed input + persistence

**Files:**
- Modify: `src/lib/LayerList.svelte` (speed number field on video ref rows)
- Modify: `src/persist/project-file.ts` (`ReferenceJson` type + save + load)

Build + browser verified.

- [ ] **Step 1: LayerList speed field** — in `src/lib/LayerList.svelte`, immediately after the existing video-ref offset `<input>` (the one with `bind:value={layer.offsetFrames}`, inside the `{#if layer.kind === "ref" && layer.media.type === "video"}` block), add:
```svelte
          <input
            class="w-9 text-xs bg-surface border border-border px-0.5 text-text"
            type="number"
            step="0.1"
            min="0.1"
            max="8"
            bind:value={layer.speed}
            oninput={bump}
            onclick={(e) => e.stopPropagation()}
            title="Playback speed (×)"
          />
```

- [ ] **Step 2: Persistence type** — in `src/persist/project-file.ts`, `interface ReferenceJson`, after `offsetFrames: number;` add:
```ts
  speed?: number;
```

- [ ] **Step 3: Save** — in the ref-layer serialize (the object with `offsetFrames: l.offsetFrames,`), add:
```ts
        speed: l.speed,
```

- [ ] **Step 4: Load** — in the ref reconstruct (the `{ kind: "ref", … offsetFrames: rj.offsetFrames, …}` literal), add:
```ts
      speed: rj.speed ?? 1,
```
(back-compat: pre-speed projects → 1×.)

- [ ] **Step 5: Verify** — `npm run build` 0/0; `npm test` passing.

- [ ] **Step 6: Browser verification (user-deferred checklist — do NOT run a browser)**
Record: a video ref row shows a speed field; set 2× (clip covers half the frames) and 0.5× (stepped/held frames); scrub + play at each behave; save → reload keeps the speed; opening an OLD (pre-speed) project loads video refs at 1×; editing speed live updates immediately.

- [ ] **Step 7: Commit**
```bash
git add src/lib/LayerList.svelte src/persist/project-file.ts
git commit -m "feat: per-video speed field (LayerList) + persist speed in project.json"
```

---

## Final verification

- [ ] **Full build:** `npm run build` → 0/0.
- [ ] **Full tests:** `npm test` → 328 + new speed cases.
- [ ] **Interactive pass (flag as verification debt):** speed field on video ref rows; 2×/0.5× scrub+play; save/reload persistence; old-project 1× back-compat; live edit.

---

## Spec coverage self-check

- Speed multiplier model + `(offset + frame×speed)/fps` + playbackRate (D1-D3) → Task 1 (+ Task 2 for play-start).
- LayerList number field, video-only, 0.1–8 (D4) → Task 3 Step 1.
- Persist speed; load `?? 1` (D5) → Task 3 Steps 2-4.
- `speed ≤ 0`/NaN → 1 guard → Task 1 (`spd`) + Task 2.
- Node-tested sync/rate logic → Task 1 tests.
- Deferred (presets, keyframing, reverse, audio/image speed) → per spec Non-goals.
