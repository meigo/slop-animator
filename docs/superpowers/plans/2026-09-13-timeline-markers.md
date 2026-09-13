# Timeline Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add labelled, per-frame timeline markers. They live in their own strip under the ruler,
move with inserted/deleted frames, are undoable and saved with the project, and can be reached by
tap and by the `n` / `<` / `>` keys.

**Architecture:**
- **Model:** `Project.markers?: Marker[]` (`{ frame, label }`, sorted, one per frame).
- **Pure logic:** all marker logic lives in `src/anim/markers.ts`, fully unit-tested.
- **Frame insert/delete:** markers move inside the existing `rippleDocumentFrames`.
- **Shortening the animation:** markers past the end are cut inside `applyAnimationLength`.
- **Undo:** a `markers` field in `StructSnapshot`, plus four store actions that each push one undo
  step through `commitStructural`.
- **Save file:** an optional `markers` field, same version. The loader cleans it.
- **UI:** a new `MarkerStrip.svelte`, mounted in `Timeline.svelte` above `AudioLane` and built the
  way `AudioLane` is. It holds the flags, the tap/drag handling and a fixed-position edit popover.
- **Keys:** added to `App.svelte`'s `onKey` chain.

**Tech Stack:** Svelte 5 (runes) + TypeScript + Vite + Tailwind 4 + Vitest (node env, no DOM) +
`@lucide/svelte` icons.

**Spec:** `docs/superpowers/specs/2026-09-13-timeline-markers-design.md` (read it, including its
"Amendments from planning" section at the end).

## Global Constraints

- `npm run build` (svelte-check + tsc + vite build) ends with **0 errors, 0 warnings** after every
  task. `tsconfig` covers `src/__tests__`, so test fixtures are type-checked too.
- `npm test` is all green after every task. The baseline at branch start is **1308 passing**.
- **One marker per frame. The frame is the identity** (no id field).
- **Gotcha #8:** never mutate `project.markers` or a `Marker` in place. Every write assigns a new
  array and new objects for anything that changed. Undo snapshots hold the array by reference.
- **Gotcha #1:** a component that uses the `$state` rune imports `state as appState`.
- **Gotcha #10:** every draggable surface sets `touch-action: none`.
- **Input modes:** a finger (`e.pointerType === "touch"`) pans the timeline, while Pencil and mouse
  edit. Same split as `AudioLane.svelte`.
- The save format `version` stays **1**. `markers` is written only when non-empty.
- **Label rules:**
  - The input caps typing at `maxlength="40"`.
  - The model never truncates a label.
  - Joined labels use the separator `" · "` (space, U+00B7, space).
- **Colour is neutral only:** `bg-text`, `bg-text-muted`, `text-surface`. Never `warn`, `accent`,
  `loop` or `danger` classes.
- **UI copy, verbatim:**
  - Strip label `Markers`
  - Add button title `Add marker at playhead (N)`
  - Marker title `Marker: <label or "unlabelled"> · tap to jump, tap again to edit, drag to move`
  - Input placeholder `Label`
  - Delete button title `Delete marker`
  - Status hints `Frame N already has a marker` (N 1-based), `No marker before this frame`,
    `No marker after this frame`
- **Branch:** `feat/timeline-markers` (already created; the spec is committed there). One commit per
  task, with this trailer:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011fMH1pC3rKiT9oBpYFB3XG
  ```
- The pre-commit hook runs eslint --fix + prettier on staged files. Reformatting on commit is
  expected.

## File Structure

| File | Responsibility |
|---|---|
| `src/anim/document.ts` (modify) | `Marker` interface; `Project.markers?` field |
| `src/anim/markers.ts` (create) | Pure marker ops: add/remove/rename/move/shift/truncate/next/prev/join/sanitize |
| `src/__tests__/markers.test.ts` (create) | Unit tests for `markers.ts` |
| `src/anim/timeline.ts` (modify) | `rippleDocumentFrames` shifts markers |
| `src/__tests__/timeline.test.ts` (modify) | Ripple carries markers |
| `src/persist/project-file.ts` (modify) | `ProjectJson.markers?`, write in `projectToJson`, sanitize on load |
| `src/__tests__/persist.test.ts` (modify) | Marker save/load tests |
| `src/state/appState.svelte.ts` (modify) | Snapshot/restore `markers`; truncate in `applyAnimationLength`; actions `addMarkerAtPlayhead`, `renameMarkerAt`, `deleteMarkerAt`, `moveMarkerTo`, `jumpToMarker`; `markerActions` ref |
| `src/lib/MarkerStrip.svelte` (create) | The strip row, marker flags, tap/drag, edit popover |
| `src/lib/Timeline.svelte` (modify) | Mount `<MarkerStrip>` before `<AudioLane>` |
| `src/App.svelte` (modify) | `n`, `<`, `>` keys |
| `README.md`, `CLAUDE.md`, `docs/superpowers/CHANGELOG.md`, `../SLOP-TIMELINE-UI.md` (modify) | Docs |

---

### Task 1: Marker model + pure operations

**Files:**
- Modify: `src/anim/document.ts` (the `Project` interface, ~line 504)
- Create: `src/anim/markers.ts`
- Test: `src/__tests__/markers.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (all pure; they never mutate their input, and return the SAME array reference when
  nothing changed):
  - `interface Marker { frame: number; label: string }`, exported from `src/anim/document.ts`
  - `Project.markers?: Marker[]`
  - `markerAt(ms: Marker[], frame: number): Marker | undefined`
  - `joinLabels(a: string, b: string): string`
  - `addMarker(ms: Marker[], frame: number, label?: string): Marker[]`
  - `removeMarker(ms: Marker[], frame: number): Marker[]`
  - `renameMarker(ms: Marker[], frame: number, label: string): Marker[]`
  - `moveMarker(ms: Marker[], from: number, to: number): Marker[]`
  - `shiftMarkers(ms: Marker[], at: number, delta: 1 | -1): Marker[]`
  - `truncateMarkers(ms: Marker[], frameCount: number): Marker[]`
  - `nextMarkerFrame(ms: Marker[], frame: number, frameCount: number): number | null`
  - `prevMarkerFrame(ms: Marker[], frame: number): number | null`
  - `sanitizeMarkers(raw: unknown, frameCount: number): Marker[] | undefined`

- [ ] **Step 1: Add the model to `document.ts`**

In `src/anim/document.ts`, directly above `export interface Project {`, add:

```ts
/** A navigation/note mark on one document frame. Never rendered into an export.
 *  Pure ops live in `markers.ts`; every write replaces the array (undo snapshots share it). */
export interface Marker {
  /** 0-based document frame, integer ≥ 0. Unique within `Project.markers`. */
  frame: number;
  /** One line, trimmed. "" = unlabelled (flag only). Never truncated by the model. */
  label: string;
}
```

Inside `interface Project`, after the `audioUndecoded?: UndecodedAudio | null;` field, add:

```ts
  /** Timeline markers, sorted by `frame`, at most one per frame. Absent = none. */
  markers?: Marker[];
```

- [ ] **Step 2: Write the failing tests**

Create `src/__tests__/markers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Marker } from "../anim/document";
import {
  markerAt,
  joinLabels,
  addMarker,
  removeMarker,
  renameMarker,
  moveMarker,
  shiftMarkers,
  truncateMarkers,
  nextMarkerFrame,
  prevMarkerFrame,
  sanitizeMarkers,
} from "../anim/markers";

const mk = (frame: number, label = ""): Marker => ({ frame, label });

describe("markerAt", () => {
  it("finds the marker on a frame, or undefined", () => {
    expect(markerAt([mk(1, "a")], 1)?.label).toBe("a");
    expect(markerAt([mk(1, "a")], 2)).toBeUndefined();
  });
});

describe("joinLabels", () => {
  it("joins non-empty labels, earlier first", () => {
    expect(joinLabels("a", "b")).toBe("a · b");
  });
  it("skips empty labels", () => {
    expect(joinLabels("", "b")).toBe("b");
    expect(joinLabels("a", "")).toBe("a");
    expect(joinLabels("", "")).toBe("");
  });
});

describe("addMarker", () => {
  it("inserts in frame order with a trimmed label", () => {
    expect(addMarker([mk(1), mk(5)], 3, "  mid ")).toEqual([mk(1), mk(3, "mid"), mk(5)]);
  });
  it("defaults to an empty label", () => {
    expect(addMarker([], 0)).toEqual([mk(0)]);
  });
  it("refuses an occupied frame and returns the same array", () => {
    const ms = [mk(2, "x")];
    expect(addMarker(ms, 2, "y")).toBe(ms);
  });
  it("refuses a negative or fractional frame", () => {
    const ms: Marker[] = [];
    expect(addMarker(ms, -1)).toBe(ms);
    expect(addMarker(ms, 1.5)).toBe(ms);
  });
  it("does not mutate the input", () => {
    const ms = [mk(1)];
    addMarker(ms, 0);
    expect(ms).toEqual([mk(1)]);
  });
});

describe("removeMarker", () => {
  it("removes the marker on a frame", () => {
    expect(removeMarker([mk(1), mk(4)], 1)).toEqual([mk(4)]);
  });
  it("returns the same array when the frame has no marker", () => {
    const ms = [mk(1)];
    expect(removeMarker(ms, 2)).toBe(ms);
  });
});

describe("renameMarker", () => {
  it("trims and replaces the marker object instead of mutating it", () => {
    const m = mk(1, "a");
    const next = renameMarker([m], 1, "  b ");
    expect(next).toEqual([mk(1, "b")]);
    expect(next[0]).not.toBe(m);
    expect(m.label).toBe("a");
  });
  it("returns the same array for an unchanged label or a missing marker", () => {
    const ms = [mk(1, "a")];
    expect(renameMarker(ms, 1, " a ")).toBe(ms);
    expect(renameMarker(ms, 3, "z")).toBe(ms);
  });
});

describe("moveMarker", () => {
  it("moves and re-sorts", () => {
    expect(moveMarker([mk(1, "a"), mk(4, "b")], 1, 6)).toEqual([mk(4, "b"), mk(6, "a")]);
  });
  it("refuses an occupied destination", () => {
    const ms = [mk(1, "a"), mk(4, "b")];
    expect(moveMarker(ms, 1, 4)).toBe(ms);
  });
  it("returns the same array for from === to or a missing source", () => {
    const ms = [mk(1)];
    expect(moveMarker(ms, 1, 1)).toBe(ms);
    expect(moveMarker(ms, 2, 5)).toBe(ms);
  });
  it("clamps a negative destination to frame 0", () => {
    expect(moveMarker([mk(3)], 3, -2)).toEqual([mk(0)]);
  });
});

describe("shiftMarkers", () => {
  it("insert at a marker's frame pushes it later", () => {
    expect(shiftMarkers([mk(2, "a")], 2, 1)).toEqual([mk(3, "a")]);
  });
  it("insert before markers shifts them all", () => {
    expect(shiftMarkers([mk(2), mk(5)], 0, 1)).toEqual([mk(3), mk(6)]);
  });
  it("insert after every marker changes nothing (same array)", () => {
    const ms = [mk(2)];
    expect(shiftMarkers(ms, 3, 1)).toBe(ms);
  });
  it("delete before a marker pulls it earlier", () => {
    expect(shiftMarkers([mk(4)], 1, -1)).toEqual([mk(3)]);
  });
  it("delete ON a marker's frame leaves it on that frame (same array)", () => {
    const ms = [mk(2, "a")];
    expect(shiftMarkers(ms, 2, -1)).toBe(ms);
  });
  it("delete that lands two markers on one frame joins their labels, earlier first", () => {
    expect(shiftMarkers([mk(2, "a"), mk(3, "b"), mk(7, "c")], 2, -1)).toEqual([
      mk(2, "a · b"),
      mk(6, "c"),
    ]);
  });
  it("a collision with an unlabelled marker keeps the other label alone", () => {
    expect(shiftMarkers([mk(2), mk(3, "b")], 2, -1)).toEqual([mk(2, "b")]);
  });
  it("an empty list stays the same array", () => {
    const ms: Marker[] = [];
    expect(shiftMarkers(ms, 0, 1)).toBe(ms);
  });
});

describe("truncateMarkers", () => {
  it("drops markers at or past the frame count", () => {
    expect(truncateMarkers([mk(0), mk(4), mk(5)], 5)).toEqual([mk(0), mk(4)]);
  });
  it("returns the same array when nothing is cut", () => {
    const ms = [mk(0), mk(4)];
    expect(truncateMarkers(ms, 5)).toBe(ms);
  });
});

describe("nextMarkerFrame / prevMarkerFrame", () => {
  const ms = [mk(2), mk(6), mk(9)];
  it("finds the nearest marker strictly after, within the frame count", () => {
    expect(nextMarkerFrame(ms, 0, 10)).toBe(2);
    expect(nextMarkerFrame(ms, 2, 10)).toBe(6);
    expect(nextMarkerFrame(ms, 9, 10)).toBeNull();
    expect(nextMarkerFrame(ms, 6, 9)).toBeNull(); // frame 9 is past a 9-frame document
  });
  it("finds the nearest marker strictly before", () => {
    expect(prevMarkerFrame(ms, 7)).toBe(6);
    expect(prevMarkerFrame(ms, 6)).toBe(2);
    expect(prevMarkerFrame(ms, 2)).toBeNull();
  });
});

describe("sanitizeMarkers", () => {
  it("returns undefined for anything that is not an array", () => {
    expect(sanitizeMarkers(undefined, 10)).toBeUndefined();
    expect(sanitizeMarkers({}, 10)).toBeUndefined();
    expect(sanitizeMarkers("x", 10)).toBeUndefined();
  });
  it("drops entries with a bad or out-of-range frame", () => {
    const raw = [
      { frame: -1 },
      { frame: 1.5 },
      { frame: "2" },
      { frame: 10 },
      null,
      7,
      { frame: 3, label: " ok " },
    ];
    expect(sanitizeMarkers(raw, 10)).toEqual([mk(3, "ok")]);
  });
  it("turns a non-string label into an empty one", () => {
    expect(sanitizeMarkers([{ frame: 1, label: 5 }], 10)).toEqual([mk(1)]);
  });
  it("sorts by frame", () => {
    expect(sanitizeMarkers([{ frame: 5 }, { frame: 1 }], 10)).toEqual([mk(1), mk(5)]);
  });
  it("joins duplicate frames in file order", () => {
    const raw = [
      { frame: 2, label: "x" },
      { frame: 2, label: "y" },
    ];
    expect(sanitizeMarkers(raw, 10)).toEqual([mk(2, "x · y")]);
  });
  it("keeps labels longer than the 40-character input cap", () => {
    const long = "a".repeat(60);
    expect(sanitizeMarkers([{ frame: 0, label: long }], 1)).toEqual([mk(0, long)]);
  });
  it("returns undefined when nothing survives", () => {
    expect(sanitizeMarkers([{ frame: 99 }], 10)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/markers.test.ts`
Expected: FAIL. The suite cannot resolve `../anim/markers`.

- [ ] **Step 4: Write the implementation**

Create `src/anim/markers.ts`:

```ts
import type { Marker } from "./document";

/**
 * Timeline markers: pure operations over a SORTED, one-per-frame `Marker[]`.
 *
 * Every function returns a NEW array when something changed and the SAME reference when nothing
 * did, so a store action can skip a no-op undo entry with `next !== ms`. Nothing here mutates its
 * input — undo snapshots hold the array by reference (gotcha #8).
 */

const byFrame = (a: Marker, b: Marker) => a.frame - b.frame;

/** The marker on `frame`, if any. */
export function markerAt(ms: Marker[], frame: number): Marker | undefined {
  return ms.find((m) => m.frame === frame);
}

/** Two labels as one, earlier frame's first; empty labels are skipped so no stray separator shows. */
export function joinLabels(a: string, b: string): string {
  return [a, b].filter((s) => s !== "").join(" · ");
}

/** Append a marker to a sorted list, merging into the previous entry when frames collide. */
function pushJoining(out: Marker[], m: Marker): boolean {
  const prev = out[out.length - 1];
  if (prev && prev.frame === m.frame) {
    out[out.length - 1] = { frame: m.frame, label: joinLabels(prev.label, m.label) };
    return true;
  }
  out.push(m);
  return false;
}

/** Add a marker on `frame`. An occupied, negative or fractional frame changes nothing. */
export function addMarker(ms: Marker[], frame: number, label = ""): Marker[] {
  if (!Number.isInteger(frame) || frame < 0 || markerAt(ms, frame)) return ms;
  return [...ms, { frame, label: label.trim() }].sort(byFrame);
}

export function removeMarker(ms: Marker[], frame: number): Marker[] {
  if (!markerAt(ms, frame)) return ms;
  return ms.filter((m) => m.frame !== frame);
}

export function renameMarker(ms: Marker[], frame: number, label: string): Marker[] {
  const trimmed = label.trim();
  const m = markerAt(ms, frame);
  if (!m || m.label === trimmed) return ms;
  return ms.map((x) => (x.frame === frame ? { frame, label: trimmed } : x));
}

/** Move the marker on `from` to `to` (clamped ≥ 0). Refused — same array — when `to` is occupied,
 *  so a drop can never silently join or overwrite a label. */
export function moveMarker(ms: Marker[], from: number, to: number): Marker[] {
  const dest = Math.max(0, to);
  const m = markerAt(ms, from);
  if (!m || from === dest || markerAt(ms, dest)) return ms;
  return ms.map((x) => (x.frame === from ? { frame: dest, label: x.label } : x)).sort(byFrame);
}

/**
 * Ripple for ONE frame inserted at / deleted from `at`. Same rule as `shiftStartFrame` in
 * `timeline.ts` (repeated here rather than imported: `timeline.ts` imports this module):
 * insert moves `frame >= at` by +1; delete moves `frame > at` by −1 and leaves a marker ON `at`
 * where it is. On a delete, the markers on `at` and `at + 1` both land on `at` — their labels are
 * JOINED rather than one being dropped.
 */
export function shiftMarkers(ms: Marker[], at: number, delta: 1 | -1): Marker[] {
  const out: Marker[] = [];
  let changed = false;
  for (const m of ms) {
    const frame =
      delta === 1 ? (m.frame >= at ? m.frame + 1 : m.frame) : m.frame > at ? m.frame - 1 : m.frame;
    if (frame !== m.frame) changed = true;
    if (pushJoining(out, frame === m.frame ? m : { frame, label: m.label })) changed = true;
  }
  return changed ? out : ms;
}

/** Drop markers at or past `frameCount` (the animation was shortened). */
export function truncateMarkers(ms: Marker[], frameCount: number): Marker[] {
  if (ms.every((m) => m.frame < frameCount)) return ms;
  return ms.filter((m) => m.frame < frameCount);
}

/** Nearest marker frame strictly after `frame` that is still inside the document, else null. */
export function nextMarkerFrame(ms: Marker[], frame: number, frameCount: number): number | null {
  const m = ms.find((x) => x.frame > frame && x.frame < frameCount);
  return m ? m.frame : null;
}

/** Nearest marker frame strictly before `frame`, else null. */
export function prevMarkerFrame(ms: Marker[], frame: number): number | null {
  for (let i = ms.length - 1; i >= 0; i--) if (ms[i].frame < frame) return ms[i].frame;
  return null;
}

/**
 * Markers read back from a file. Anything that is not an array → undefined. Entries whose frame is
 * not an integer in `0 … frameCount − 1` are dropped; a non-string label becomes "". Labels are
 * trimmed but NOT length-capped (a joined label may exceed the input's 40). Duplicate frames are
 * joined in file order. Nothing left → undefined, so an empty list is never carried.
 */
export function sanitizeMarkers(raw: unknown, frameCount: number): Marker[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const valid: Marker[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    const f = r.frame;
    if (typeof f !== "number" || !Number.isInteger(f) || f < 0 || f >= frameCount) continue;
    valid.push({ frame: f, label: typeof r.label === "string" ? r.label.trim() : "" });
  }
  valid.sort(byFrame); // stable: equal frames keep file order for the join below
  const out: Marker[] = [];
  for (const m of valid) pushJoining(out, m);
  return out.length > 0 ? out : undefined;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/markers.test.ts`
Expected: PASS, all tests.

- [ ] **Step 6: Full suite and build**

Run: `npm test && npm run build`
Expected: all tests pass (1308 + the new ones); build reports 0 errors and 0 warnings.

- [ ] **Step 7: Commit**

```bash
git add src/anim/document.ts src/anim/markers.ts src/__tests__/markers.test.ts
git commit -m "feat(markers): marker model and pure operations

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011fMH1pC3rKiT9oBpYFB3XG"
```

---

### Task 2: Markers ripple with inserted/deleted frames

**Files:**
- Modify: `src/anim/timeline.ts` (imports at top; `rippleDocumentFrames`, ~line 350-404)
- Test: `src/__tests__/timeline.test.ts`

**Interfaces:**
- Consumes: `shiftMarkers(ms, at, delta)` from Task 1; `Marker` type.
- Produces: `insertFrameAllLayers(project, at)` / `deleteFrameAllLayers(project, at)` (signatures
  unchanged) now also replace `project.markers` with the shifted array.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/timeline.test.ts`, change the first type import line from
`import type { Cell, DrawingLayer } from "../anim/document";` to:

```ts
import type { Cell, DrawingLayer, Marker } from "../anim/document";
```

Append at the end of the file:

```ts
describe("document ripple carries markers", () => {
  function proj(frames: number, markers?: Marker[]) {
    const p = createProject();
    p.layers = [dl(Array.from({ length: frames }, () => h()))];
    p.frameCount = frames;
    p.markers = markers;
    return p;
  }

  it("insertFrameAllLayers moves markers at and after the new frame", () => {
    const p = proj(6, [
      { frame: 1, label: "a" },
      { frame: 3, label: "b" },
    ]);
    insertFrameAllLayers(p, 3);
    expect(p.markers).toEqual([
      { frame: 1, label: "a" },
      { frame: 4, label: "b" },
    ]);
  });

  it("deleteFrameAllLayers joins a marker on the deleted frame with the next one", () => {
    const p = proj(6, [
      { frame: 2, label: "a" },
      { frame: 3, label: "b" },
      { frame: 5, label: "c" },
    ]);
    deleteFrameAllLayers(p, 2);
    expect(p.markers).toEqual([
      { frame: 2, label: "a · b" },
      { frame: 4, label: "c" },
    ]);
  });

  it("replaces the markers array rather than mutating it (undo snapshots hold it by reference)", () => {
    const before: Marker[] = [{ frame: 4, label: "x" }];
    const p = proj(6, before);
    insertFrameAllLayers(p, 0);
    expect(before).toEqual([{ frame: 4, label: "x" }]);
    expect(p.markers).not.toBe(before);
  });

  it("a project without markers stays without them", () => {
    const p = proj(3);
    insertFrameAllLayers(p, 0);
    deleteFrameAllLayers(p, 0);
    expect(p.markers).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/timeline.test.ts -t "document ripple carries markers"`
Expected: FAIL. The first three tests fail because markers don't move. The fourth passes already;
that's fine, it guards against a regression.

- [ ] **Step 3: Implement**

In `src/anim/timeline.ts`, below the existing `import { videoClipLayout, offsetAfterClipDrag } from "./clip-layout";` line, add:

```ts
import { shiftMarkers } from "./markers";
```

In `rippleDocumentFrames`, find the block at the end of the function:

```ts
  if (project.audio) {
    const next = shiftStartFrame(project.audio.offsetFrames, at, delta);
    if (next !== project.audio.offsetFrames) project.audio.offsetFrames = next;
  }
}
```

and replace it with:

```ts
  if (project.audio) {
    const next = shiftStartFrame(project.audio.offsetFrames, at, delta);
    if (next !== project.audio.offsetFrames) project.audio.offsetFrames = next;
  }
  // Markers are document-frame space like the audio clip: they point at a moment, so they move
  // with the frames around them. `shiftMarkers` returns a NEW array (undo holds the old one by
  // reference) and joins the two labels a delete lands on one frame.
  if (project.markers) project.markers = shiftMarkers(project.markers, at, delta);
}
```

Also update the doc comment right above `function rippleDocumentFrames`, changing its first
sentence to:

```ts
/** Shift everything that lives in DOCUMENT-FRAME space by one frame at `at`: layer transform-track
 *  keys, image reference ranges, video clip offsets, the audio track, and timeline markers.
 *  Drawing-layer cells are handled by the callers, which splice them directly. */
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/timeline.test.ts`
Expected: PASS, the whole file.

- [ ] **Step 5: Full suite and build**

Run: `npm test && npm run build`
Expected: all tests pass; 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/anim/timeline.ts src/__tests__/timeline.test.ts
git commit -m "feat(markers): markers ripple with inserted and deleted frames

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011fMH1pC3rKiT9oBpYFB3XG"
```

---

### Task 3: Save and load markers

**Files:**
- Modify: `src/persist/project-file.ts` (`ProjectJson` ~line 146; `projectToJson` ~line 198-289; the
  loader `loadProjectBlob`, after `refreshLength(project);` ~line 741)
- Test: `src/__tests__/persist.test.ts`

**Interfaces:**
- Consumes: `sanitizeMarkers(raw, frameCount)` from Task 1; `Marker` type.
- Produces: `ProjectJson.markers?: { frame: number; label: string }[]`. `projectToJson` writes it
  only when non-empty; `loadProjectBlob` fills `project.markers` (or leaves it `undefined`).

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/persist.test.ts`, change
`import type { Project, Cell, DrawingLayer, ReferenceLayer } from "../anim/document";` to:

```ts
import type { Project, Cell, DrawingLayer, ReferenceLayer, Marker } from "../anim/document";
```

Append at the end of the file:

```ts
describe("marker persistence", () => {
  // Holds only (createDrawingLayer) — no canvases, so save/load runs in node.
  function projectWith(frames: number, markers?: Marker[]): Project {
    const project = createProject();
    project.layers = [createDrawingLayer(frames, "L")];
    project.frameCount = frames;
    project.markers = markers;
    return project;
  }

  it("projectToJson writes markers, and nothing when there are none", () => {
    expect(projectToJson(projectWith(4, [{ frame: 2, label: "beat" }])).markers).toEqual([
      { frame: 2, label: "beat" },
    ]);
    expect(projectToJson(projectWith(4, [])).markers).toBeUndefined();
    expect(projectToJson(projectWith(4)).markers).toBeUndefined();
  });

  it("round-trips markers through save/load, a long joined label intact", async () => {
    const long = "fix hand · " + "x".repeat(50);
    const markers = [
      { frame: 0, label: "start" },
      { frame: 7, label: long },
    ];
    const loaded = await loadProjectBlob(await saveProjectBlob(projectWith(10, markers)), 1);
    expect(loaded.markers).toEqual(markers);
  });

  it("a save without markers loads with none", async () => {
    const loaded = await loadProjectBlob(await saveProjectBlob(projectWith(3)), 1);
    expect(loaded.markers).toBeUndefined();
  });

  it("drops markers past the loaded document length", async () => {
    const markers = [
      { frame: 1, label: "in" },
      { frame: 9, label: "out" },
    ];
    const loaded = await loadProjectBlob(await saveProjectBlob(projectWith(5, markers)), 1);
    expect(loaded.markers).toEqual([{ frame: 1, label: "in" }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/persist.test.ts -t "marker persistence"`
Expected: FAIL on three tests. Vitest doesn't typecheck, so they fail on assertions:
- `projectToJson(...).markers` is `undefined` where an array is expected.
- The round-trip test loads `markers` as `undefined`.
- The out-of-range test loads `markers` as `undefined`.

"A save without markers loads with none" already passes; it guards against a regression.

- [ ] **Step 3: Implement the type and the writer**

In `src/persist/project-file.ts`:

1. Add `sanitizeMarkers` import next to the other imports (below the `fflate` import line):

```ts
import { sanitizeMarkers } from "../anim/markers";
```

2. In `export interface ProjectJson`, after the `audio: { … } | null;` member (the last member),
   add:

```ts
  /** Timeline markers, sorted, one per frame. Absent = none (and in every pre-2026-09-13 save). */
  markers?: { frame: number; label: string }[];
```

3. In `projectToJson`, the returned object ends with:

```ts
    audio: audioJson(project),
  };
}
```

Replace that with:

```ts
    audio: audioJson(project),
    // Written only when there is something to write. Copied field by field so a future Marker field
    // is an explicit save-format decision, not an accident of the in-memory shape.
    markers: project.markers?.length
      ? project.markers.map((m) => ({ frame: m.frame, label: m.label }))
      : undefined,
  };
}
```

- [ ] **Step 4: Implement the loader**

In `loadProjectBlob`, find:

```ts
  refreshLength(project); // independent per-layer lengths → derive document length from the layers
```

and add directly below it:

```ts
  // After refreshLength, so markers are validated against the REAL length, not the stored field.
  project.markers = sanitizeMarkers(json.markers, project.frameCount);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/persist.test.ts`
Expected: PASS, the whole file. The existing `projectToJson` `toEqual` tests still pass, because
`toEqual` ignores `markers: undefined`.

- [ ] **Step 6: Full suite and build**

Run: `npm test && npm run build`
Expected: all tests pass; 0 errors, 0 warnings.

- [ ] **Step 7: Commit**

```bash
git add src/persist/project-file.ts src/__tests__/persist.test.ts
git commit -m "feat(markers): save and load markers with the project

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011fMH1pC3rKiT9oBpYFB3XG"
```

---

### Task 4: Store: undo snapshot, length truncation, marker actions

`appState.svelte.ts` can't be imported in node (it touches window/audio when the module loads), so
this task is verified by the build, the existing tests, and review. There is no new unit test. Keep
the actions thin: all the logic is already tested in `markers.ts`.

**Files:**
- Modify: `src/state/appState.svelte.ts`:
  - the `../anim/document` type import (~line 40-60)
  - `StructSnapshot` (~398-429)
  - `snapshotStructure` (~455)
  - `restoreStructure` (~479-590)
  - `applyAnimationLength` (~2001)
  - new actions near `seekPlayhead` (~1683)
  - new `markerActions` next to `liftGuard` (~2322)

**Interfaces:**
- Consumes from Task 1: `Marker` and `addMarker`, `renameMarker`, `removeMarker`, `moveMarker`,
  `markerAt`, `truncateMarkers`, `nextMarkerFrame`, `prevMarkerFrame`.
- Produces (used by Tasks 5 and 6):
  - `addMarkerAtPlayhead(): void`: adds an empty marker on `state.playhead` unless one is there.
    One undo step, or nothing.
  - `renameMarkerAt(frame: number, label: string): void`: one undo step, or nothing if unchanged
    or missing.
  - `deleteMarkerAt(frame: number): void`: one undo step, or nothing if missing.
  - `moveMarkerTo(from: number, to: number): boolean`: `false` only when `to` already has a
    marker. `true` otherwise (moved, or nothing to do).
  - `jumpToMarker(dir: -1 | 1): void`: seeks to the previous/next marker, or sets `statusHint`.
  - `markerActions: { openEditor: ((frame: number) => void) | null }`: registered by
    `MarkerStrip`, called by `App.svelte`'s `n` key.

- [ ] **Step 1: Imports**

In the `import { … } from "../anim/document";` block of `appState.svelte.ts` (it contains
`type Project,`), add `type Marker,` next to `type Project,`.

Below the last existing `import` statement of the file, add:

```ts
import {
  addMarker,
  renameMarker,
  removeMarker,
  moveMarker,
  markerAt,
  truncateMarkers,
  nextMarkerFrame,
  prevMarkerFrame,
} from "../anim/markers";
```

- [ ] **Step 2: Snapshot field**

In `export interface StructSnapshot`, after the `audioUndecoded: UndecodedAudio | null;` member,
add:

```ts
  /** Timeline markers, by REFERENCE. Safe without a copy because nothing writes markers in place:
   *  every writer (the actions below, the ripple, the length cut) assigns a new array. Undefined =
   *  the project had none, and restoring that has to CLEAR a later add. */
  markers: Marker[] | undefined;
```

In `snapshotStructure()`, after `audioUndecoded: state.project.audioUndecoded ?? null,` add:

```ts
    markers: state.project.markers,
```

In `restoreStructure(s)`, directly after the line `state.project.frameCount = s.frameCount;` add:

```ts
  state.project.markers = s.markers; // unconditional: undefined must clear markers added since
```

- [ ] **Step 3: Cut markers when the animation is shortened**

In `applyAnimationLength`, find:

```ts
  for (const layer of state.project.layers) {
    if (layer.kind === "draw") layer.cells = resizeCells(layer.cells, target);
  }
  bump(); // refreshes document length and clamps the playhead
```

and replace it with:

```ts
  for (const layer of state.project.layers) {
    if (layer.kind === "draw") layer.cells = resizeCells(layer.cells, target);
  }
  // Markers past the new end go with the cells they pointed at. Same undo story as the cells: the
  // Length field's commitStructural and the ruler drag's begin/commit bracket both captured them.
  if (state.project.markers) state.project.markers = truncateMarkers(state.project.markers, target);
  bump(); // refreshes document length and clamps the playhead
```

- [ ] **Step 4: Marker actions**

Directly after the `seekPlayhead` function (which ends with the
`else audioEngine.scrub(clamped, state.project.fps);` line and its closing `}`), add:

```ts
/**
 * Timeline markers. Each writer is ONE undo step through commitStructural, and every one checks for
 * a no-op BEFORE committing — commitStructural always pushes, so a check inside the callback would
 * leave a ⌘Z that visibly does nothing (see setAnimationLength). The pure ops return the same array
 * when nothing changed, which is the check.
 */
function commitMarkers(next: Marker[]): void {
  commitStructural(() => {
    state.project.markers = next.length > 0 ? next : undefined;
  });
}

/** Add an unlabelled marker on the playhead's frame. An occupied frame changes nothing — the caller
 *  opens that marker's editor either way. */
export function addMarkerAtPlayhead(): void {
  const ms = state.project.markers ?? [];
  const next = addMarker(ms, state.playhead);
  if (next !== ms) commitMarkers(next);
}

export function renameMarkerAt(frame: number, label: string): void {
  const ms = state.project.markers ?? [];
  const next = renameMarker(ms, frame, label);
  if (next !== ms) commitMarkers(next);
}

export function deleteMarkerAt(frame: number): void {
  const ms = state.project.markers ?? [];
  const next = removeMarker(ms, frame);
  if (next !== ms) commitMarkers(next);
}

/** Move a marker. `false` means the destination already has one (the strip says so); a missing
 *  source or `from === to` is simply nothing to do. */
export function moveMarkerTo(from: number, to: number): boolean {
  const ms = state.project.markers ?? [];
  if (from !== to && markerAt(ms, to)) return false;
  const next = moveMarker(ms, from, to);
  if (next !== ms) commitMarkers(next);
  return true;
}

/** Seek to the previous (−1) or next (+1) marker inside the document. */
export function jumpToMarker(dir: -1 | 1): void {
  const ms = state.project.markers ?? [];
  const f =
    dir === 1
      ? nextMarkerFrame(ms, state.playhead, state.project.frameCount)
      : prevMarkerFrame(ms, state.playhead);
  if (f === null) {
    state.statusHint = dir === 1 ? "No marker after this frame" : "No marker before this frame";
    return;
  }
  seekPlayhead(f);
}
```

`commitStructural` is declared earlier in the file as a hoisted `function`, so calling it from
here is fine.

- [ ] **Step 5: The editor hook**

Directly after `export const liftGuard: { discard: (() => void) | null } = { discard: null };` add:

```ts
/** MarkerStrip registers its editor here, so App's `n` key can open it after adding a marker. */
export const markerActions: { openEditor: ((frame: number) => void) | null } = {
  openEditor: null,
};
```

- [ ] **Step 6: Build and full suite**

Run: `npm run build && npm test`
Expected: 0 errors, 0 warnings, all tests pass. There are no callers yet; exported functions don't
trigger unused warnings.

- [ ] **Step 7: Self-check before committing** (read the diff: `git diff`)

- Every write to `state.project.markers` assigns a new array. Nothing calls `.push`, `.splice` or
  `.sort` on `state.project.markers` directly.
- `restoreStructure` assigns `s.markers` even when it is `undefined`.
- No action calls `commitStructural` when the pure op returned the same array.

- [ ] **Step 8: Commit**

```bash
git add src/state/appState.svelte.ts
git commit -m "feat(markers): undoable marker actions and length truncation in the store

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011fMH1pC3rKiT9oBpYFB3XG"
```

---

### Task 5: The marker strip (UI)

**Files:**
- Create: `src/lib/MarkerStrip.svelte`
- Modify: `src/lib/Timeline.svelte` (import block ~line 157; mount before `<AudioLane` ~line 2785)
- Modify: `docs/superpowers/specs/2026-09-13-timeline-markers-design.md`, but only if this task
  finds a further deviation. The known ones are already recorded in its amendments section.

**Interfaces:**
- Consumes (Task 4): `state` (as `appState`), `addMarkerAtPlayhead`, `renameMarkerAt`,
  `deleteMarkerAt`, `moveMarkerTo`, `seekPlayhead`, `markerActions`.
- Consumes (Task 1): `markerAt`.
- Consumes (existing):
  - `moveCancelPx(cellW)` from `src/lib/timeline-grid.ts`
  - `clickOutside` from `src/lib/click-outside.ts`
  - Timeline's `touchPanDown(e)`, `touchPanMove(e): boolean`, `touchPanUp(e?)`
  - `startEdgeScroll(apply, owner)`, `stopEdgeScroll(owner)`
  - the `edgePointerX` setter
  - `CELL_W`, `LABEL_W`, `MARKER_W`, `stripMinW`
- Produces: `<MarkerStrip cellW labelW markerW minWidth onTouchDown onTouchMove onTouchUp
  onEdgeScrollStart onEdgeScrollStop onEdgePointerX />`; it registers `markerActions.openEditor`.

- [ ] **Step 1: Create `src/lib/MarkerStrip.svelte`**

```svelte
<script lang="ts">
  import { Flag, Plus, Trash2 } from "@lucide/svelte";
  import { untrack } from "svelte";
  import {
    state as appState,
    addMarkerAtPlayhead,
    renameMarkerAt,
    deleteMarkerAt,
    moveMarkerTo,
    seekPlayhead,
    markerActions,
  } from "../state/appState.svelte";
  import { markerAt } from "../anim/markers";
  import { moveCancelPx } from "./timeline-grid";
  import { clickOutside } from "./click-outside";

  // Grid metrics and gestures passed from Timeline, exactly as AudioLane takes them, so the strip's
  // columns line up with the rows and a finger pans the same scroller.
  let {
    cellW,
    labelW,
    markerW,
    minWidth = 0,
    onTouchDown,
    onTouchMove,
    onTouchUp,
    onEdgeScrollStart,
    onEdgeScrollStop,
    onEdgePointerX,
  }: {
    cellW: number;
    labelW: number;
    markerW: number;
    minWidth?: number;
    onTouchDown: (e: PointerEvent) => void;
    onTouchMove: (e: PointerEvent) => boolean;
    /** Takes the event so a `pointercancel` does not fling (see Timeline's touchPanUp). */
    onTouchUp: (e?: PointerEvent) => void;
    onEdgeScrollStart: (apply: (clientX: number) => void, owner: string) => void;
    onEdgeScrollStop: (owner: string) => void;
    onEdgePointerX: (clientX: number) => void;
  } = $props();

  const DRAG_OWNER = "marker-drag";

  /** Markers inside the document. `frameCount` can drop below a marker outside the length tools
   *  (it is re-derived from the cells), and those are hidden here rather than deleted — deleting
   *  outside an undoable edit would be a silent data change. */
  const shown = $derived(
    (appState.project.markers ?? []).filter((m) => m.frame < appState.project.frameCount),
  );

  let frameAreaEl: HTMLDivElement | undefined = $state();

  // ── Tap / drag ───────────────────────────────────────────────────────────────────────────────
  // The document is NOT touched during a drag: `dragFrame` is a preview, and one moveMarkerTo on
  // release is the whole gesture — one undo entry, and nothing to revert on a cancel.
  let press: {
    pointerId: number;
    from: number;
    x: number;
    /** Pointer offset from the marker's column edge at grab, so the flag does not jump. */
    grab: number;
    /** Was the playhead already on this marker at press? Decides tap = jump vs tap = edit. */
    onPlayhead: boolean;
    dragging: boolean;
  } | null = null;
  let dragFrom: number | null = $state(null);
  let dragFrame: number | null = $state(null);

  function markerDown(e: PointerEvent, frame: number) {
    // A finger bubbles to the frame area, which pans; only Pencil/mouse edit markers.
    if (e.pointerType === "touch" || e.button > 0 || !frameAreaEl) return;
    e.preventDefault();
    const rect = frameAreaEl.getBoundingClientRect();
    press = {
      pointerId: e.pointerId,
      from: frame,
      x: e.clientX,
      grab: e.clientX - rect.left - frame * cellW,
      onPlayhead: appState.playhead === frame,
      dragging: false,
    };
    onEdgePointerX(e.clientX);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  /** The column the dragged flag sits over. Measured from the frame area's CURRENT rect, which moves
   *  with the scroller, so edge auto-scroll needs no scroll-offset bookkeeping. */
  function dragAt(clientX: number) {
    if (!press || !frameAreaEl) return;
    const rect = frameAreaEl.getBoundingClientRect();
    const f = Math.round((clientX - rect.left - press.grab) / cellW);
    dragFrame = Math.max(0, Math.min(appState.project.frameCount - 1, f));
  }

  function onMove(e: PointerEvent) {
    if (!press || e.pointerId !== press.pointerId) return;
    onEdgePointerX(e.clientX);
    if (!press.dragging && Math.abs(e.clientX - press.x) > moveCancelPx(cellW)) {
      press.dragging = true;
      dragFrom = press.from;
      onEdgeScrollStart(dragAt, DRAG_OWNER);
    }
    if (press.dragging) dragAt(e.clientX);
  }

  function endPress() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    onEdgeScrollStop(DRAG_OWNER);
    press = null;
    dragFrom = null;
    dragFrame = null;
  }

  function onUp(e: PointerEvent) {
    if (!press || e.pointerId !== press.pointerId) return;
    const { from, dragging, onPlayhead } = press;
    const to = dragFrame;
    endPress();
    if (dragging) {
      if (to !== null && to !== from && !moveMarkerTo(from, to))
        appState.statusHint = `Frame ${to + 1} already has a marker`;
    } else if (onPlayhead) {
      openEditor(from);
    } else {
      seekPlayhead(from);
    }
  }

  /** An OS-cancelled stream (iPad palm rejection) drops the preview. Nothing was written, so there
   *  is nothing to settle. */
  function onCancel(e: PointerEvent) {
    if (!press || e.pointerId !== press.pointerId) return;
    endPress();
  }

  $effect(() => () => {
    if (press) endPress(); // unmounted mid-gesture: release the window listeners
  });

  // ── Finger pan (label column and empty strip) ────────────────────────────────────────────────
  function touchDown(e: PointerEvent) {
    if (e.pointerType !== "touch") return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onTouchDown(e);
  }
  function touchMove(e: PointerEvent) {
    if (e.pointerType === "touch") onTouchMove(e);
  }
  /** Same as AudioLane's buttons: a finger on a control is a pan, never a press. */
  function ignoreTouchClick(e: PointerEvent) {
    if (e.pointerType === "touch") e.preventDefault();
  }

  // ── Editor popover ───────────────────────────────────────────────────────────────────────────
  // `position: fixed`, because the timeline's scroll box clips anything `absolute` (the
  // `.curve-popup` trap). It does NOT close on scroll: on iPad the on-screen keyboard can scroll the
  // page as it opens, which would close the popover the instant it appeared.
  const EDITOR_W = 220;
  let editing: { frame: number; left: number; top: number } | null = $state(null);
  let draft = $state("");

  function openEditor(frame: number) {
    if (!frameAreaEl) return;
    const r = frameAreaEl.getBoundingClientRect();
    editing = {
      frame,
      left: Math.max(8, Math.min(window.innerWidth - EDITOR_W - 8, r.left + frame * cellW - 4)),
      top: Math.max(8, Math.min(window.innerHeight - 48, r.bottom + 4)),
    };
    draft = markerAt(appState.project.markers ?? [], frame)?.label ?? "";
  }

  function commitEdit() {
    if (!editing) return;
    const { frame } = editing;
    editing = null;
    renameMarkerAt(frame, draft); // no-op (no undo entry) when unchanged or the marker is gone
  }

  function deleteEdit() {
    if (!editing) return;
    const { frame } = editing;
    editing = null;
    deleteMarkerAt(frame);
  }

  function editorKey(e: KeyboardEvent) {
    e.stopPropagation(); // typing n / < / > must not reach App's shortcuts
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      editing = null;
    }
  }

  function focusSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  function addAtPlayhead() {
    addMarkerAtPlayhead(); // no-op when the frame already has one — the editor opens on it either way
    openEditor(appState.playhead);
  }

  // The playhead moving away closes the editor, saving — same as pressing outside.
  $effect(() => {
    const ph = appState.playhead;
    untrack(() => {
      if (editing && editing.frame !== ph) commitEdit();
    });
  });

  $effect(() => {
    markerActions.openEditor = openEditor;
    return () => {
      if (markerActions.openEditor === openEditor) markerActions.openEditor = null;
    };
  });
</script>

<div class="flex w-max items-stretch border-b border-border" style="min-width: {minWidth}px">
  <!-- Name column: same box and padding as AudioLane's label, so the text sits in the column. -->
  <div
    class="shrink-0 sticky left-0 z-20 flex h-6 items-center gap-1 bg-surface pr-1 pl-[5px] text-text-secondary"
    role="presentation"
    style="width: {labelW}px; touch-action: none"
    onpointerdown={touchDown}
    onpointermove={touchMove}
    onpointerup={onTouchUp}
    onpointercancel={onTouchUp}
  >
    <Flag size={13} class="shrink-0" />
    <span class="truncate flex-1">Markers</span>
    <button
      type="button"
      class="shrink-0 text-text-secondary hover:text-text"
      title="Add marker at playhead (N)"
      onpointerdown={ignoreTouchClick}
      onclick={addAtPlayhead}><Plus size={13} /></button
    >
  </div>
  <!-- The rows' lock/hidden glyph column: empty here, reserved so the frame columns line up. -->
  <div
    class="shrink-0 sticky z-20 h-6 bg-surface border-r border-text-muted"
    style="left: {labelW}px; width: {markerW}px"
  ></div>
  <div
    bind:this={frameAreaEl}
    class="relative h-6 flex-1"
    role="presentation"
    style="touch-action: none"
    onpointerdown={touchDown}
    onpointermove={touchMove}
    onpointerup={onTouchUp}
    onpointercancel={onTouchUp}
  >
    {#each shown as m (m.frame)}
      {@const col = dragFrom === m.frame && dragFrame !== null ? dragFrame : m.frame}
      <button
        type="button"
        tabindex="-1"
        class="absolute inset-y-0 flex min-w-6 cursor-grab items-start"
        class:z-10={dragFrom === m.frame}
        style="left: {col * cellW}px; touch-action: none"
        title="Marker: {m.label || 'unlabelled'} · tap to jump, tap again to edit, drag to move"
        onpointerdown={(e) => markerDown(e, m.frame)}
      >
        <!-- stem: full-strength on the playhead's frame, muted elsewhere -->
        <span
          class="pointer-events-none absolute inset-y-0 left-0 w-px {appState.playhead === m.frame
            ? 'bg-text'
            : 'bg-text-muted'}"
        ></span>
        <!-- 8×4 downward flag, tip on the column edge -->
        <span
          class="pointer-events-none absolute top-0 left-[-4px] h-1 w-2 bg-text"
          style="clip-path: polygon(0 0, 100% 0, 50% 100%)"
        ></span>
        {#if m.label}
          <span
            class="pointer-events-none mt-[5px] ml-1 max-w-20 truncate rounded-sm bg-text px-1 text-[10px]/[14px] font-semibold text-surface"
            >{m.label}</span
          >
        {/if}
      </button>
    {/each}
  </div>
</div>

{#if editing}
  <div
    class="fixed z-50 flex items-center gap-1 rounded border border-border bg-surface p-1 shadow-lg"
    style="left: {editing.left}px; top: {editing.top}px; width: {EDITOR_W}px"
    use:clickOutside={commitEdit}
  >
    <input
      class="min-w-0 flex-1 rounded-sm border border-border bg-surface px-1 text-xs text-text"
      maxlength="40"
      placeholder="Label"
      bind:value={draft}
      use:focusSelect
      onkeydown={editorKey}
    />
    <button
      type="button"
      class="shrink-0 rounded-sm p-1 text-text-secondary hover:text-text"
      title="Delete marker"
      onclick={deleteEdit}><Trash2 size={14} /></button
    >
  </div>
{/if}
```

- [ ] **Step 2: Mount it in `Timeline.svelte`**

In the import block, directly below `import AudioLane from "./AudioLane.svelte";`, add:

```ts
  import MarkerStrip from "./MarkerStrip.svelte";
```

Find:

```svelte
      <!-- audio waveform lane (scrolls with the ruler + rows; only when an audio track is set) -->
      <AudioLane
```

and insert directly ABOVE that comment:

```svelte
      <!-- marker strip: labelled per-frame markers (MarkerStrip.svelte). Not vertically sticky —
           it scrolls with the rows like the audio lane; a pinned strip would be another sticky
           layer, which is what gotcha #14 is about. -->
      <MarkerStrip
        cellW={CELL_W}
        labelW={LABEL_W}
        markerW={MARKER_W}
        minWidth={stripMinW}
        onTouchDown={touchPanDown}
        onTouchMove={touchPanMove}
        onTouchUp={touchPanUp}
        onEdgeScrollStart={startEdgeScroll}
        onEdgeScrollStop={stopEdgeScroll}
        onEdgePointerX={(x) => (edgePointerX = x)}
      />

```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: 0 errors, 0 warnings. If svelte-check raises an a11y warning on the `role="presentation"`
divs or on the input, match the fix `AudioLane.svelte` uses for the same element type. Don't add
`svelte-ignore` comments unless AudioLane already does so for that exact warning.

- [ ] **Step 4: Tests and lint**

Run: `npm test && npm run lint`
Expected: all tests pass; lint clean.

- [ ] **Step 5: Browser check (desktop)**

Run `npm run dev` and open the app, driving it with the `run` skill or claude-in-chrome. Check each
item and write down any that fail:

1. A "Markers" row with a ＋ appears between the ruler and the audio lane (or the first layer row
   if there's no audio), aligned with the columns.
2. ＋ adds a flag on the playhead frame, and the popover opens with the input focused. Typing
   "fix hand" and pressing Enter shows the label pill.
3. ＋ again on the same frame opens the popover with "fix hand". Escape closes it unchanged.
4. Step to another frame, then click the flag: the playhead jumps to it. Click again: the popover
   opens.
5. Drag the flag 3 columns: it previews while dragging and lands on release. ⌘Z moves it back in one
   step; ⌘⇧Z moves it again.
6. Drag onto another marker's frame: it springs back, and the status bar reads "Frame N already has
   a marker".
7. Drag past the right edge of the timeline: it edge-scrolls, and the flag follows.
8. Delete in the popover removes the marker. ⌘Z restores it.
9. Put markers on frames 2 and 3 (1-based 3 and 4). "Delete frame" on frame 2 leaves one marker
   labelled "a · b". ⌘Z restores two. "Add frame" before a marker moves it right.
10. Reduce Length below a marker: it disappears. ⌘Z brings it back.
11. Save the project, reload, and open it: markers are intact. Autosave restore after a reload: intact.
12. The popover near the right edge of the window stays fully on screen.
13. Rename a marker while a timeline cell selection is active: the selection clears (a known effect
    of commitStructural, see spec §4). Note whether it feels wrong. If it does, report it; don't
    change it in this task.

- [ ] **Step 6: Commit**

```bash
git add src/lib/MarkerStrip.svelte src/lib/Timeline.svelte
git commit -m "feat(markers): marker strip under the ruler — tap to jump, tap again to edit, drag to move

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011fMH1pC3rKiT9oBpYFB3XG"
```

---

### Task 6: Keyboard shortcuts

**Files:**
- Modify: `src/App.svelte` (the `appState.svelte` import block ~line 12-32; `onKey` ~line 62-203)

**Interfaces:**
- Consumes (Task 4): `addMarkerAtPlayhead`, `jumpToMarker`, `markerActions`.
- Produces: `n` adds a marker at the playhead and opens its editor; `<` / `>` jump to the previous /
  next marker.

- [ ] **Step 1: Imports**

In `App.svelte`'s `import { … } from "./state/appState.svelte";` block, after
`deleteTimelineSelection,` add:

```ts
    addMarkerAtPlayhead,
    jumpToMarker,
    markerActions,
```

- [ ] **Step 2: Key branches**

In `onKey`, find:

```ts
    } else if (e.key === "o") {
      state.onion.enabled = !state.onion.enabled;
      repaint();
    } else if (e.key === ",") seekPlayhead(state.playhead - 1);
```

and replace it with:

```ts
    } else if (e.key === "o") {
      state.onion.enabled = !state.onion.enabled;
      repaint();
    } else if (e.key === "n" && !meta) {
      // preventDefault: the editor's input takes focus during this keystroke, and the "n" must not
      // be typed into it.
      e.preventDefault();
      addMarkerAtPlayhead();
      markerActions.openEditor?.(state.playhead);
    } else if (e.key === "<" || e.key === ">") {
      // Shift+, / Shift+. on most layouts — the marker-sized step next to , / . (one frame).
      e.preventDefault();
      jumpToMarker(e.key === "<" ? -1 : 1);
    } else if (e.key === ",") seekPlayhead(state.playhead - 1);
```

- [ ] **Step 3: Build, tests, lint**

Run: `npm run build && npm test && npm run lint`
Expected: 0 errors, 0 warnings; all tests pass; lint clean.

- [ ] **Step 4: Browser check**

In `npm run dev`:
1. `n` adds a marker and focuses the input, and no "n" appears in it. Type a label, press Enter.
2. `n` on a frame that has a marker opens it.
3. With markers on frames 2 and 8 and the playhead on 5: `>` jumps to 8, `>` again shows "No marker
   after this frame", `<` jumps to 2.
4. Typing `n`, `<` and `>` inside the popover input types those characters and does nothing else.
5. ⌘N still does whatever the browser does (it isn't captured).

- [ ] **Step 5: Commit**

```bash
git add src/App.svelte
git commit -m "feat(markers): n adds a marker, < and > jump between markers

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011fMH1pC3rKiT9oBpYFB3XG"
```

---

### Task 7: Docs

**Files:**
- Modify: `README.md` (Features timeline bullets ~line 28-40; Keyboard ~line 84-90; test count in
  the scripts block ~line 101)
- Modify: `CLAUDE.md` (the `npm test` baseline line in Commands; "Current state" section)
- Modify: `docs/superpowers/CHANGELOG.md` (append an entry at the end)
- Modify: `/Users/meigo/Projects/slop/SLOP-TIMELINE-UI.md` (line ~338, "Named markers (compositor
  only)"). This file is outside the repo and the parent folder isn't a git repo; edit it, don't
  commit it.

**Interfaces:** none.

- [ ] **Step 1: Get the real test count**

Run: `npm test 2>&1 | tail -4`
Record the `Tests  N passed` number. Use it below; don't guess.

- [ ] **Step 2: README**

1. In **Features**, directly after the bullet that starts `- Frame-by-frame timeline with keyframes
   and holds`, add:

```markdown
- **Timeline markers** in their own strip under the ruler — a short label on any frame for
  navigation or a to-do note. Tap to jump, tap again to rename or delete, drag to move; markers
  follow inserted and deleted frames and are saved with the project
```

2. In **Keyboard**, change the line
   `` - `1` — actual size (100%) `` to:

```markdown
- `1` — actual size (100%) · `n` add marker · `<`/`>` previous/next marker
```

3. In the scripts block, replace `(1308)` with the count from Step 1.

- [ ] **Step 3: CLAUDE.md**

1. In **Commands**, change `Baseline **1288 passing**` to `Baseline **N passing**` with the count
   from Step 1.
2. In **Current state**, after the paragraph starting `Transforms are per-axis (scaleX/scaleY;`,
   add:

```markdown
Shipped 2026-09-13: **Timeline markers** — `Project.markers?` (`{frame, label}`, sorted, one per
frame, pure ops in `src/anim/markers.ts`) in a `MarkerStrip.svelte` row under the ruler. They ripple
in `rippleDocumentFrames` (a delete joins two labels onto one frame), are cut by
`applyAnimationLength`, sit in `StructSnapshot` by reference (never mutate the array), and save as an
optional `markers` field. `n` adds, `<`/`>` jump. See the 2026-09-13 changelog entry.
```

- [ ] **Step 4: CHANGELOG**

Append to the end of `docs/superpowers/CHANGELOG.md`, after a blank line. Replace every
`<bracketed placeholder>` with what the browser passes in Tasks 5 and 6 actually found, before
committing:

```markdown
**Timeline markers (2026-09-13).** Asked as *"what do you think about adding timeline markers feature
(slop-compositor has it)"* — for "anything that needs navigational help or maybe even short todo
notes". Spec `docs/superpowers/specs/2026-09-13-timeline-markers-design.md`, plan
`docs/superpowers/plans/2026-09-13-timeline-markers.md`.
- **Model:** `Project.markers?: Marker[]`, `{ frame, label }`, sorted, **one per frame, frame is the
  identity** (no id). Pure ops in `src/anim/markers.ts`; every one returns the SAME array when nothing
  changed, which is how the store actions skip no-op undo entries.
- **Own strip, not the ruler.** The 29px ruler has no free space — the playhead badge covers its full
  height and a pen there scrubs. `MarkerStrip.svelte` sits between the ruler and the audio lane and,
  like the lane, is NOT vertically sticky (gotcha #14).
- **Not the compositor's gestures.** Its rename is double-click and delete is Alt+click — neither
  reachable with a Pencil. Here: tap = jump, tap again (playhead already on it) = popover with label
  + Delete, drag = move. A drag only PREVIEWS; one `moveMarkerTo` on release is the gesture, so there
  is no begin/revert bracket and `pointercancel` just drops the preview.
- **Ripple:** in `rippleDocumentFrames`, same rule as `shiftStartFrame`. A delete that lands the
  markers of `at` and `at+1` on one frame **joins their labels** ("a · b") rather than dropping one.
  Per-layer frame edits do not move markers (same as audio/reference ranges).
- **Length cut:** `applyAnimationLength` drops markers past the new end, inside both undo brackets.
  Markers past `frameCount` reached any other way are hidden in the strip, never deleted silently.
- **Undo:** `StructSnapshot.markers` by reference — safe only because nothing writes the array in
  place. `restoreStructure` assigns it unconditionally so undoing the first add clears the field.
- **Save:** optional `markers`, version stays 1, written only when non-empty; the loader drops
  non-integer/out-of-range frames after `refreshLength`, and does NOT cap label length (joined
  labels can exceed the input's 40).
- **Keys:** `n` add + open editor, `<`/`>` previous/next marker.
- **Verified in the browser (desktop):** <list what the Task 5/6 browser checks confirmed>.
  **Owed an iPad pass:** Pencil tap/drag on flags, finger pan on the strip, the on-screen keyboard
  appearing when ＋ focuses the input, popover placement with the keyboard up.
```

- [ ] **Step 5: SLOP-TIMELINE-UI.md**

In `/Users/meigo/Projects/slop/SLOP-TIMELINE-UI.md`, find the bullet beginning
`- **Named markers** (compositor only):` and replace `(compositor only)` with
`(compositor; slop-animator since 2026-09-13)`. At the end of that bullet, add this sentence:

```markdown
  slop-animator draws them NEUTRAL (text colour, not amber — its `warn` means "why this won't land")
  in a strip of their own under the ruler, since its ruler has no free height.
```

- [ ] **Step 6: Commit** (repo files only)

```bash
git add README.md CLAUDE.md docs/superpowers/CHANGELOG.md
git commit -m "docs: timeline markers in README, CLAUDE.md and the changelog

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011fMH1pC3rKiT9oBpYFB3XG"
```

---

## After all tasks

Use superpowers:finishing-a-development-branch. Don't merge until the user says so
(`git merge --no-ff`). Tell the user what's still owed on iPad (see the CHANGELOG entry). Don't
claim it's confirmed working there.
