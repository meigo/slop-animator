# Timeline Animation Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Animate / Ease / Step / Delete key / Stop (and transform Copy/Paste key) onto the existing timeline tool bar, context-swapped by a new `activeRow` track case, and remove them from ToolOptions and the layer list.

**Architecture:** Extract the selection predicates and the bar's visible-set into pure functions (`src/anim/active-row.ts`, `src/anim/animation-bar.ts`) so they can be unit-tested without importing the store. `appState` keeps the writers (`setActiveLayer`, `selectTrack`, `selectAudioLane`). The timeline bar is the only host of `TrackKeyControls`. Gizmo drag and the opacity slider stay as value authors.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest (node env, no DOM).

**Spec:** `docs/superpowers/specs/2026-08-18-timeline-animation-tools-design.md`

## Global Constraints

- **One timeline.** Property rows stay. No inspector panel, no second track view.
- **Extend `activeRow`, do not add a parallel field.** Views ask `isRowSelected` / `isTrackSelected` / `isAudioRowSelected`. No view writes `id === activeLayerId && !…`.
- **`activeLayerId` is the draw target** and survives selecting audio, a group track, or a sibling's track.
- **Do not switch the tool** on Animate or on focusing a track.
- **Value authors stay** (gizmo drag, opacity slider). Only the tools move.
- **`aria-disabled` + title**, never `disabled`, on every refused animation control.
- **Group-derived lock/hidden.** `isLayerLocked(layer, groups)` / `isLayerVisible(layer, groups)`. Group animate is lock-only (`groupHasLockedLayer`).
- **No empty undo entries.** Animate/Stop no-op guards stay above `commitStructural`.
- **Never mutate a track in place.** Writers replace the bag.
- **The build bar is 0 errors, 0 warnings** (`npm run build`), lint clean, all tests green before each commit.
- **Commit trailer:** `Co-Authored-By: Grok <noreply@x.ai>`.

## File map

| File | Responsibility |
|---|---|
| `src/anim/active-row.ts` | `ActiveRow` type, `layerRowSelected`, `trackRowSelected`, `audioRowSelected`, `resolveStaleTrackFocus` |
| `src/anim/animation-bar.ts` | `animationBar(...)` — the visible-set of the animation group |
| `src/__tests__/active-row.test.ts` | Selection + stale-focus |
| `src/__tests__/animation-bar.test.ts` | Every bar state in the spec table |
| `src/state/appState.svelte.ts` | `activeRow` type, wrappers, `selectTrack`, Animate/Stop call `selectTrack` / fall back |
| `src/lib/Timeline.svelte` | Property-row `select` / highlight; render the animation group |
| `src/lib/TrackKeyControls.svelte` | One host; restyle to `toolBtn` icons |
| `src/lib/ToolOptions.svelte` | Delete Animate / Stop / TrackKeyControls |
| `src/lib/LayerList.svelte` | Delete opacity Animate / Stop / TrackKeyControls |
| `README.md`, `CLAUDE.md`, the spec | Where the tools live; spec status |

---

### Task 1: Track-focused `activeRow`

**Files:**

- Create: `src/anim/active-row.ts`
- Create: `src/__tests__/active-row.test.ts`
- Modify: `src/state/appState.svelte.ts` (`activeRow` type ~191, `restoreStructure` ~464–468, `isRowSelected` / `selectAudioLane` ~1368–1382, `setActiveLayer` ~1761–1770)
- Modify: `src/lib/Timeline.svelte` (`layerTrackSpec` / `groupTrackSpec` `selected` + `select`, ~1001–1084)

**Interfaces:**

- Consumes: `Project`, `Layer`, `TrackRef` from `src/anim/document.ts`.
- Produces:
  - `export type ActiveRow = { kind: "layer"; id: number } \| { kind: "audio" } \| { kind: "track"; owner: "layer"; id: number; prop: "transform" \| "opacity" } \| { kind: "track"; owner: "group"; id: number; prop: "transform" }`
  - `layerRowSelected(row, layerId, activeLayerId, layers): boolean`
  - `trackRowSelected(row, owner, id, prop): boolean`
  - `audioRowSelected(row): boolean`
  - `resolveStaleTrackFocus(row, project, activeLayerId): ActiveRow`
  - `selectTrack(ref: TrackRef): void` in appState
  - `isTrackSelected(owner, id, prop): boolean` in appState

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/active-row.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  audioRowSelected,
  layerRowSelected,
  resolveStaleTrackFocus,
  trackRowSelected,
  type ActiveRow,
} from "../anim/active-row";
import type { Layer } from "../anim/document";

const layer = (id: number, groupId: number | null = null): Layer =>
  ({
    kind: "draw",
    id,
    name: `L${id}`,
    visible: true,
    cells: [],
    groupId,
  }) as Layer;

const layers: Layer[] = [layer(1, 10), layer(2, 10), layer(3)];

describe("layerRowSelected", () => {
  it("matches a layer row", () => {
    const row: ActiveRow = { kind: "layer", id: 1 };
    expect(layerRowSelected(row, 1, 1, layers)).toBe(true);
    expect(layerRowSelected(row, 2, 1, layers)).toBe(false);
  });

  it("a layer-owned track keeps its OWNER layer selected", () => {
    const row: ActiveRow = { kind: "track", owner: "layer", id: 1, prop: "opacity" };
    expect(layerRowSelected(row, 1, 1, layers)).toBe(true);
    expect(layerRowSelected(row, 2, 1, layers)).toBe(false);
  });

  it("a group-owned track selects only the draw target that is a member of that group", () => {
    const row: ActiveRow = { kind: "track", owner: "group", id: 10, prop: "transform" };
    expect(layerRowSelected(row, 1, 1, layers)).toBe(true);
    expect(layerRowSelected(row, 2, 1, layers)).toBe(false);
    // A layer that is the draw target but not in this group must not light.
    expect(layerRowSelected(row, 3, 3, layers)).toBe(false);
  });

  it("audio selects no layer", () => {
    expect(layerRowSelected({ kind: "audio" }, 1, 1, layers)).toBe(false);
  });
});

describe("trackRowSelected", () => {
  it("matches only the focused track", () => {
    const row: ActiveRow = { kind: "track", owner: "layer", id: 1, prop: "opacity" };
    expect(trackRowSelected(row, "layer", 1, "opacity")).toBe(true);
    expect(trackRowSelected(row, "layer", 1, "transform")).toBe(false);
    expect(trackRowSelected({ kind: "layer", id: 1 }, "layer", 1, "opacity")).toBe(false);
  });
});

describe("audioRowSelected", () => {
  it("is true only for the audio case", () => {
    expect(audioRowSelected({ kind: "audio" })).toBe(true);
    expect(audioRowSelected({ kind: "layer", id: 1 })).toBe(false);
  });
});

describe("resolveStaleTrackFocus", () => {
  const project = {
    layers: [
      { ...layer(1), tracks: { opacity: { keys: [{ frame: 0, v: 100 }] } } },
      layer(2),
    ],
    groups: [{ id: 10, name: "G", collapsed: false, tracks: { transform: { keys: [], box: null } } }],
  } as Parameters<typeof resolveStaleTrackFocus>[1];

  it("keeps a live layer track", () => {
    const row: ActiveRow = { kind: "track", owner: "layer", id: 1, prop: "opacity" };
    expect(resolveStaleTrackFocus(row, project, 1)).toEqual(row);
  });

  it("falls back when the layer track is gone", () => {
    const row: ActiveRow = { kind: "track", owner: "layer", id: 1, prop: "transform" };
    expect(resolveStaleTrackFocus(row, project, 1)).toEqual({ kind: "layer", id: 1 });
  });

  it("falls back when the layer itself is gone, using the draw target", () => {
    const row: ActiveRow = { kind: "track", owner: "layer", id: 99, prop: "opacity" };
    expect(resolveStaleTrackFocus(row, project, 2)).toEqual({ kind: "layer", id: 2 });
  });

  it("keeps a live group track", () => {
    const row: ActiveRow = { kind: "track", owner: "group", id: 10, prop: "transform" };
    expect(resolveStaleTrackFocus(row, project, 1)).toEqual(row);
  });

  it("falls back when the group track is gone", () => {
    const row: ActiveRow = { kind: "track", owner: "group", id: 10, prop: "transform" };
    const gone = { ...project, groups: [{ id: 10, name: "G", collapsed: false }] };
    expect(resolveStaleTrackFocus(row, gone as typeof project, 1)).toEqual({
      kind: "layer",
      id: 1,
    });
  });

  it("leaves layer and audio rows alone", () => {
    expect(resolveStaleTrackFocus({ kind: "layer", id: 1 }, project, 2)).toEqual({
      kind: "layer",
      id: 1,
    });
    expect(resolveStaleTrackFocus({ kind: "audio" }, project, 1)).toEqual({ kind: "audio" });
  });
});
```

The `project` cast is only so the helper can take a structural slice (`layers` + `groups`) rather than a full `Project`. Implement `resolveStaleTrackFocus` against `{ layers: Layer[]; groups: LayerGroup[] }`, not `Project`, so the test does not have to build a document.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/active-row.test.ts`

Expected: FAIL — `src/anim/active-row.ts` does not exist.

- [ ] **Step 3: Implement `src/anim/active-row.ts`**

```ts
import type { Layer, LayerGroup } from "./document";

export type ActiveRow =
  | { kind: "layer"; id: number }
  | { kind: "audio" }
  | { kind: "track"; owner: "layer"; id: number; prop: "transform" | "opacity" }
  | { kind: "track"; owner: "group"; id: number; prop: "transform" };

export function layerRowSelected(
  row: ActiveRow,
  layerId: number,
  activeLayerId: number,
  layers: Layer[],
): boolean {
  if (row.kind === "layer") return row.id === layerId;
  if (row.kind === "track" && row.owner === "layer") return row.id === layerId;
  if (row.kind === "track" && row.owner === "group") {
    return (
      layerId === activeLayerId &&
      layers.some((l) => l.id === layerId && l.groupId === row.id)
    );
  }
  return false;
}

export function trackRowSelected(
  row: ActiveRow,
  owner: "layer" | "group",
  id: number,
  prop: string,
): boolean {
  return row.kind === "track" && row.owner === owner && row.id === id && row.prop === prop;
}

export function audioRowSelected(row: ActiveRow): boolean {
  return row.kind === "audio";
}

export function resolveStaleTrackFocus(
  row: ActiveRow,
  doc: { layers: Layer[]; groups: LayerGroup[] },
  activeLayerId: number,
): ActiveRow {
  if (row.kind !== "track") return row;
  if (row.owner === "layer") {
    const l = doc.layers.find((x) => x.id === row.id);
    if (l?.tracks?.[row.prop]) return row;
    return { kind: "layer", id: activeLayerId };
  }
  const g = doc.groups.find((x) => x.id === row.id);
  if (g?.tracks?.transform) return row;
  return { kind: "layer", id: activeLayerId };
}
```

- [ ] **Step 4: Wire the store and the timeline**

In `src/state/appState.svelte.ts`:

- Import `ActiveRow`, `layerRowSelected`, `trackRowSelected`, `audioRowSelected`, `resolveStaleTrackFocus` from `../anim/active-row`.
- Change `state.activeRow`'s type to `ActiveRow`.
- Replace the two accessors:

```ts
export function isRowSelected(layerId: number): boolean {
  return layerRowSelected(
    state.activeRow,
    layerId,
    state.activeLayerId,
    state.project.layers,
  );
}

export function isTrackSelected(
  owner: "layer" | "group",
  id: number,
  prop: "transform" | "opacity",
): boolean {
  return trackRowSelected(state.activeRow, owner, id, prop);
}

export function isAudioRowSelected(): boolean {
  return audioRowSelected(state.activeRow);
}
```

Use `prop: "transform" | "opacity"` (group only ever passes `"transform"`).

- Add `selectTrack`. Do **not** call `setActiveLayer` from it (that would clear the track case):

```ts
export function selectTrack(ref: TrackRef): void {
  if (ref.owner === "layer") {
    const layerChanged = state.activeLayerId !== ref.id;
    state.activeLayerId = ref.id;
    state.activeRow = { kind: "track", owner: "layer", id: ref.id, prop: ref.prop };
    if (ref.prop === "transform") state.transformScope = "layer";
    const l = state.project.layers.find((x) => x.id === ref.id);
    if (state.transformScope === "group" && (!l || l.groupId == null)) {
      state.transformScope = "frame";
    }
    if (layerChanged && state.onion.enabled && !state.onion.allLayers) repaint();
    return;
  }
  state.activeRow = { kind: "track", owner: "group", id: ref.id, prop: "transform" };
  state.transformScope = "group";
  const member = [...state.project.layers]
    .reverse()
    .find((l) => l.groupId === ref.id && l.kind === "draw");
  if (member && state.activeLayerId !== member.id) {
    state.activeLayerId = member.id;
    if (state.onion.enabled && !state.onion.allLayers) repaint();
  }
}
```

`setActiveLayer` already assigns `{ kind: "layer", id }` — that is what clears track focus. Leave it.

- In `restoreStructure`, after `state.activeLayerId = s.activeLayerId`:

```ts
if (state.activeRow.kind === "layer") {
  state.activeRow = { kind: "layer", id: s.activeLayerId };
} else {
  state.activeRow = resolveStaleTrackFocus(
    state.activeRow,
    state.project,
    state.activeLayerId,
  );
}
```

Audio is unchanged by `resolveStaleTrackFocus`. A track whose owner survived stays. A track that this undo just removed falls back.

In `src/lib/Timeline.svelte`:

- Import `selectTrack`, `isTrackSelected`.
- `layerTrackSpec.select` becomes `() => selectTrack({ owner: "layer", id: layer.id, prop })`.
- `layerTrackSpec.selected` becomes `isTrackSelected("layer", layer.id, prop)`.
- `groupTrackSpec.select` becomes `() => selectTrack({ owner: "group", id: group.id, prop: "transform" })`.
- `groupTrackSpec.selected` becomes `isTrackSelected("group", group.id, "transform")`.

Layer **name** rows keep `isRowSelected(layer.id)` — that now stays true when a track of that layer is focused, so the owner stays lit and sibling tracks stay quiet.

- [ ] **Step 5: Run the tests and the suite**

Run: `npx vitest run src/__tests__/active-row.test.ts && npm test`

Expected: all passing, including the new file. `isRowSelected` callers (LayerList, Timeline gutter, AudioLane) keep compiling because the wrapper signature did not change.

- [ ] **Step 6: Commit**

```bash
git add src/anim/active-row.ts src/__tests__/active-row.test.ts \
  src/state/appState.svelte.ts src/lib/Timeline.svelte
git commit -m "$(cat <<'EOF'
feat: a property row has its own selection

activeRow grows a track case so the timeline bar can tell a layer click
from an Opacity click. Owner rows stay lit; sibling tracks do not.

Co-Authored-By: Grok <noreply@x.ai>
EOF
)"
```

---

### Task 2: Pure `animationBar`

**Files:**

- Create: `src/anim/animation-bar.ts`
- Create: `src/__tests__/animation-bar.test.ts`

**Interfaces:**

- Consumes: `ActiveRow` from `./active-row`; `Layer`, `LayerGroup`, `groupOf`, `groupHasLockedLayer`, `isLayerLocked`, `isLayerVisible`, `isRefVisibleAtFrame` from `./document`.
- Produces:

```ts
export type AnimationStartItem =
  | { action: "animate-transform"; layerId: number; blocked: string | null }
  | { action: "animate-opacity"; layerId: number; blocked: string | null }
  | { action: "animate-group"; groupId: number; blocked: string | null };

export type AnimationBar =
  | { kind: "start"; items: AnimationStartItem[] }
  | {
      kind: "keys";
      track: TrackRef;
      showCopyPaste: boolean;
      blocked: string | null;
    }
  | { kind: "empty" };

export function animationBar(args: {
  activeRow: ActiveRow;
  layers: Layer[];
  groups: LayerGroup[];
  playhead: number;
  fps: number;
}): AnimationBar;
```

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/animation-bar.test.ts`. Build layers with the same `as Layer` slice as Task 1; only the fields the function reads matter (`id`, `kind`, `groupId`, `locked`, `visible`, `tracks`, and for refs `range` / `media`).

```ts
import { describe, expect, it } from "vitest";
import { animationBar } from "../anim/animation-bar";
import type { Layer, LayerGroup } from "../anim/document";

const draw = (id: number, extra: Partial<Layer> = {}): Layer =>
  ({
    kind: "draw",
    id,
    name: `L${id}`,
    visible: true,
    locked: false,
    groupId: null,
    cells: [],
    ...extra,
  }) as Layer;

const group = (id: number, extra: Partial<LayerGroup> = {}): LayerGroup =>
  ({ id, name: `G${id}`, collapsed: false, ...extra }) as LayerGroup;

const args = (over: Partial<Parameters<typeof animationBar>[0]> = {}) =>
  animationBar({
    activeRow: { kind: "layer", id: 1 },
    layers: [draw(1)],
    groups: [],
    playhead: 0,
    fps: 12,
    ...over,
  });

describe("animationBar — start", () => {
  it("offers transform and opacity on a still layer", () => {
    const bar = args();
    expect(bar.kind).toBe("start");
    if (bar.kind !== "start") return;
    expect(bar.items.map((i) => i.action)).toEqual([
      "animate-transform",
      "animate-opacity",
    ]);
    expect(bar.items.every((i) => i.blocked === null)).toBe(true);
  });

  it("omits a property that already has a track", () => {
    const bar = args({
      layers: [draw(1, { tracks: { transform: { keys: [{ frame: 0, v: { dx: 0, dy: 0, scale: 1, rotation: 0 } }], box: null } } })],
    });
    expect(bar.kind).toBe("start");
    if (bar.kind !== "start") return;
    expect(bar.items.map((i) => i.action)).toEqual(["animate-opacity"]);
  });

  it("is empty when every applicable property is already animated", () => {
    const bar = args({
      layers: [
        draw(1, {
          tracks: {
            transform: { keys: [{ frame: 0, v: { dx: 0, dy: 0, scale: 1, rotation: 0 } }], box: null },
            opacity: { keys: [{ frame: 0, v: 100 }] },
          },
        }),
      ],
    });
    expect(bar).toEqual({ kind: "empty" });
  });

  it("offers Animate group only when the layer is in a group that is not yet animated", () => {
    const g = group(10);
    const bar = args({
      layers: [draw(1, { groupId: 10 })],
      groups: [g],
    });
    expect(bar.kind).toBe("start");
    if (bar.kind !== "start") return;
    expect(bar.items.map((i) => i.action)).toEqual([
      "animate-transform",
      "animate-opacity",
      "animate-group",
    ]);
  });

  it("omits Animate group when the group already has a track", () => {
    const bar = args({
      layers: [draw(1, { groupId: 10 })],
      groups: [
        group(10, {
          tracks: { transform: { keys: [{ frame: 0, v: { dx: 0, dy: 0, scale: 1, rotation: 0 } }], box: null } },
        }),
      ],
    });
    expect(bar.kind).toBe("start");
    if (bar.kind !== "start") return;
    expect(bar.items.map((i) => i.action)).not.toContain("animate-group");
  });

  it("dims transform/opacity when the layer is locked, and says locked not hidden", () => {
    const bar = args({ layers: [draw(1, { locked: true, visible: false })] });
    expect(bar.kind).toBe("start");
    if (bar.kind !== "start") return;
    expect(bar.items.every((i) => i.action !== "animate-group" && i.blocked === "the layer is locked")).toBe(
      true,
    );
  });

  it("dims transform/opacity when the layer is hidden", () => {
    const bar = args({ layers: [draw(1, { visible: false })] });
    expect(bar.kind).toBe("start");
    if (bar.kind !== "start") return;
    expect(bar.items.find((i) => i.action === "animate-transform")?.blocked).toBe(
      "the layer is hidden",
    );
  });

  it("dims Animate group when a member is locked", () => {
    const bar = args({
      layers: [draw(1, { groupId: 10, locked: true })],
      groups: [group(10)],
    });
    expect(bar.kind).toBe("start");
    if (bar.kind !== "start") return;
    expect(bar.items.find((i) => i.action === "animate-group")?.blocked).toBe(
      "a locked member pins the group",
    );
  });
});

describe("animationBar — keys", () => {
  it("shows key tools for a focused layer track, with Copy/Paste only on layer transform", () => {
    const bar = args({
      activeRow: { kind: "track", owner: "layer", id: 1, prop: "transform" },
      layers: [
        draw(1, {
          tracks: { transform: { keys: [{ frame: 0, v: { dx: 0, dy: 0, scale: 1, rotation: 0 } }], box: null } },
        }),
      ],
    });
    expect(bar).toMatchObject({
      kind: "keys",
      track: { owner: "layer", id: 1, prop: "transform" },
      showCopyPaste: true,
      blocked: null,
    });
  });

  it("does not offer Copy/Paste on opacity or on a group track", () => {
    const opacity = args({
      activeRow: { kind: "track", owner: "layer", id: 1, prop: "opacity" },
      layers: [draw(1, { tracks: { opacity: { keys: [{ frame: 0, v: 100 }] } } })],
    });
    expect(opacity).toMatchObject({ kind: "keys", showCopyPaste: false });

    const grp = args({
      activeRow: { kind: "track", owner: "group", id: 10, prop: "transform" },
      layers: [draw(1, { groupId: 10 })],
      groups: [
        group(10, {
          tracks: { transform: { keys: [{ frame: 0, v: { dx: 0, dy: 0, scale: 1, rotation: 0 } }], box: null } },
        }),
      ],
    });
    expect(grp).toMatchObject({ kind: "keys", showCopyPaste: false, blocked: null });
  });

  it("dims key tools when the owner is locked; a hidden group stays allowed", () => {
    const locked = args({
      activeRow: { kind: "track", owner: "layer", id: 1, prop: "opacity" },
      layers: [draw(1, { locked: true, tracks: { opacity: { keys: [{ frame: 0, v: 100 }] } } })],
    });
    expect(locked).toMatchObject({ kind: "keys", blocked: "the layer is locked" });

    const hiddenGroup = args({
      activeRow: { kind: "track", owner: "group", id: 10, prop: "transform" },
      layers: [draw(1, { groupId: 10, visible: false })],
      groups: [
        group(10, {
          visible: false,
          tracks: { transform: { keys: [{ frame: 0, v: { dx: 0, dy: 0, scale: 1, rotation: 0 } }], box: null } },
        }),
      ],
    });
    expect(hiddenGroup).toMatchObject({ kind: "keys", blocked: null });
  });
});

describe("animationBar — empty / audio / missing", () => {
  it("is empty on the audio lane", () => {
    expect(args({ activeRow: { kind: "audio" } })).toEqual({ kind: "empty" });
  });

  it("is empty when the focused track no longer exists", () => {
    expect(
      args({ activeRow: { kind: "track", owner: "layer", id: 1, prop: "opacity" } }),
    ).toEqual({ kind: "empty" });
  });
});
```

Add one more case for a reference outside its span. `refVisibleSpan` treats `media.type === "missing"` as always-visible, so the fixture must be an **image** ref with a stored range:

```ts
it("dims Animate transform when an image ref is outside its range, and still offers opacity", () => {
  const ref = {
    kind: "ref",
    id: 1,
    name: "R",
    visible: true,
    locked: false,
    groupId: null,
    opacity: 60,
    offsetFrames: 0,
    speed: 1,
    media: { type: "image", el: {} as HTMLImageElement },
    range: { start: 0, end: 5 },
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
  } as Layer;
  const bar = args({ layers: [ref], playhead: 10 });
  expect(bar.kind).toBe("start");
  if (bar.kind !== "start") return;
  expect(bar.items.find((i) => i.action === "animate-transform")?.blocked).toBe(
    "the reference is outside its visible range",
  );
  expect(bar.items.find((i) => i.action === "animate-opacity")?.blocked).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/animation-bar.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/anim/animation-bar.ts`**

Follow the spec table exactly:

- `activeRow.kind === "audio"` → `{ kind: "empty" }`.
- `activeRow.kind === "track"` → `{ kind: "keys", ... }` if `trackForRef`-equivalent still exists (read `layers`/`groups` the same way `trackForRef` does), else `{ kind: "empty" }`. `showCopyPaste` is true only for `{ owner: "layer", prop: "transform" }`. `blocked` is `"the layer is locked"` / `"a locked member pins the group"` when the owner is locked; hidden is **not** a block on a group track; a hidden **layer** track is `"the layer is hidden"` (lock wins).
- `activeRow.kind === "layer"` → build `items`:
  1. If `!layer.tracks?.transform`: `animate-transform`. Blocked: locked, else hidden, else (ref and `!isRefVisibleAtFrame(...)`) `"the reference is outside its visible range"`.
  2. If `!layer.tracks?.opacity`: `animate-opacity`. Blocked: locked, else hidden. Do **not** apply the span gate.
  3. If `groupOf(layer, groups)` and `!group.tracks?.transform`: `animate-group`. Blocked only when `groupHasLockedLayer`. Omit (do not dim) when the layer is not in a group.
  - If `items` is empty → `{ kind: "empty" }`, else `{ kind: "start", items }`.
  - Missing layer id → `{ kind: "empty" }`.

Blocked-reason helpers live in this file as private functions so the strings have one spelling the tests pin.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/__tests__/animation-bar.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/anim/animation-bar.ts src/__tests__/animation-bar.test.ts
git commit -m "$(cat <<'EOF'
feat: the timeline animation bar is a pure function of the selected row

Start buttons on a layer, key tools on a focused track, nothing on
audio. Locked/hidden/span refusals are data, not markup.

Co-Authored-By: Grok <noreply@x.ai>
EOF
)"
```

---

### Task 3: Put the tools on the timeline bar

**Files:**

- Modify: `src/lib/Timeline.svelte` (imports; the tool-bar `div` at ~1696; Animate/Stop handlers)
- Modify: `src/lib/TrackKeyControls.svelte` (default styles → `toolBtn` icons; drop `compact` if nothing else passes it after Task 4, but keep the prop until Task 4 removes the layer-list host)
- Modify: `src/state/appState.svelte.ts` (`animateLayer`, `animateLayerOpacity`, `animateGroup`, `removeLayerAnimation`, `removeLayerOpacityAnimation`, `removeGroupAnimation`)

**Interfaces:**

- Consumes: `animationBar` from Task 2; `selectTrack` from Task 1; existing `animateLayer` / `animateLayerOpacity` / `animateGroup` / `remove*` actions.
- Produces: the animation group in the timeline bar; Animate/Stop focus the new/owner row.

- [ ] **Step 1: Focus after Animate / Stop**

In each `animate*` function, **after** `commitStructural` (not inside — `selectTrack` is session state, not undoable):

```ts
selectTrack({ owner: "layer", id: layerId, prop: "transform" }); // animateLayer
selectTrack({ owner: "layer", id: layerId, prop: "opacity" });   // animateLayerOpacity
selectTrack({ owner: "group", id: groupId, prop: "transform" }); // animateGroup
```

Do not call `setActiveLayer` first. Do not change `state.tool`.

In each `remove*` function, after `commitStructural`:

```ts
state.activeRow = resolveStaleTrackFocus(
  state.activeRow,
  state.project,
  state.activeLayerId,
);
```

After Stop the track is gone, so this becomes `{ kind: "layer", id: activeLayerId }`. Do not call `setActiveLayer` (it would also reset `transformScope` when the layer is ungrouped, which Stop must not do).

- [ ] **Step 2: Restyle `TrackKeyControls` for the bar**

Keep the existing `compact` prop working (LayerList still hosts it until Task 4). Add a `bar` look used when `compact` is false — that is the ToolOptions look today, and it becomes the timeline look:

Replace the `BTN` constant with the timeline `toolBtn` classes:

```
w-7 h-7 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover border border-border aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent
```

Buttons: icon + `title` (the existing title strings stay — they are the status-bar copy).

| Button | Icon (`@lucide/svelte`) |
|---|---|
| Delete key | `DiamondMinus` size 16 |
| Copy key | `ClipboardCopy` size 16 |
| Paste key | `ClipboardPaste` size 16 |

Ease and Step stay labeled fields (`Ease` `<select>`, `Step` `<input type="number">`). They cannot be icons. Keep them `h-7` so they line up with `toolBtn`.

Update the file-header comment: the one host will be the timeline bar (Task 4 finishes that). Do not mention ToolOptions or the layer list as current hosts after Task 4; after this task the comment can say "timeline bar (and, until the old hosts are removed, ToolOptions / LayerList)".

If `DiamondMinus` is not exported by the installed `@lucide/svelte`, use `CircleMinus` and note it in the commit body. Do **not** use `Trash2` — that icon is Delete frame.

- [ ] **Step 3: Render the animation group on the timeline bar**

In `Timeline.svelte`, after the drawing-tool group (after the first `w-px` divider at ~1714, **before** the ripple pair — animation tools sit with the other per-row tools, not with document-wide ripple):

```svelte
{@const bar = animationBar({
  activeRow: appState.activeRow,
  layers: appState.project.layers,
  groups: appState.project.groups,
  playhead: appState.playhead,
  fps: appState.project.fps,
})}
{#if bar.kind !== "empty"}
  <span class="w-px h-5 bg-border mx-1"></span>
{/if}
{#if bar.kind === "start"}
  {#each bar.items as item (item.action)}
    <button
      class={`${toolBtn} aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent`}
      aria-disabled={item.blocked !== null}
      title={item.action === "animate-transform"
        ? item.blocked
          ? `Animate transform — ${item.blocked}`
          : "Animate this layer's transform — its current position becomes a key at frame 0"
        : item.action === "animate-opacity"
          ? item.blocked
            ? `Animate opacity — ${item.blocked}`
            : "Animate opacity — the current value becomes a key at frame 0"
          : item.blocked
            ? `Animate group — ${item.blocked}`
            : "Animate this group's transform — its current position becomes a key at frame 0"}
      onclick={() => {
        if (item.blocked) return;
        if (item.action === "animate-transform") animateLayer(item.layerId);
        else if (item.action === "animate-opacity") animateLayerOpacity(item.layerId);
        else animateGroup(item.groupId);
      }}
    >
      {#if item.action === "animate-transform"}<Spline size={16} />
      {:else if item.action === "animate-opacity"}<Blend size={16} />
      {:else}<Group size={16} />{/if}
    </button>
  {/each}
{:else if bar.kind === "keys"}
  <TrackKeyControls
    trackRef={bar.track}
    showCopyPaste={bar.showCopyPaste}
    blocked={bar.blocked}
  />
  <button
    class={`${toolBtn} aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent`}
    aria-disabled={bar.blocked !== null}
    title={bar.blocked
      ? `Stop animating — ${bar.blocked}`
      : "Stop animating — keeps the value you can see now"}
    onclick={() => {
      if (bar.blocked) return;
      const t = bar.track;
      if (t.owner === "group") removeGroupAnimation(t.id);
      else if (t.prop === "opacity") removeLayerOpacityAnimation(t.id);
      else removeLayerAnimation(t.id);
    }}><CircleStop size={16} /></button
  >
{/if}
```

Import `animationBar`, the three `animate*` / three `remove*` actions, `TrackKeyControls`, and the icons. `onclick`, never `onpointerdown` (status-hint listener). `aria-disabled`, never `disabled`.

`appState.activeRow` is already `$state` — reading it here is the dependency that re-renders the group.

- [ ] **Step 4: Typecheck and test**

Run: `npx vitest run src/__tests__/active-row.test.ts src/__tests__/animation-bar.test.ts && npx svelte-check --threshold warning && npx tsc --noEmit`

Expected: 0 errors, 0 warnings. Fix any unused imports in Timeline.

Manual check you cannot automate (note in the commit, do not claim it): click a layer → Animate icons; click a property row → key tools; Animate then the bar swaps; Stop then Animate returns.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Timeline.svelte src/lib/TrackKeyControls.svelte src/state/appState.svelte.ts
git commit -m "$(cat <<'EOF'
feat: animation tools live on the timeline bar

Animate / Ease / Step / Delete / Stop follow the selected row, next to
the drawing key tools. Animate focuses the new track; Stop falls back
to the layer. The old hosts are still up and come out next.

Co-Authored-By: Grok <noreply@x.ai>
EOF
)"
```

---

### Task 4: Take the tools off ToolOptions and the layer list

**Files:**

- Modify: `src/lib/ToolOptions.svelte` (drop `TrackKeyControls` import and the `animTarget` / `animGroup` Animate/Stop blocks ~311–360; keep Frame/Layer/Group and Reset to fit; keep the `animateTargetLayer` / `animateTargetGroup` derived values **if** StatusBar is the only remaining user — they are used in ToolOptions only to gate those blocks, so delete the deriveds too once the blocks are gone)
- Modify: `src/lib/LayerList.svelte` (drop `TrackKeyControls`, `animateLayerOpacity`, `removeLayerOpacityAnimation` imports; delete the Animate / TrackKeyControls / Stop markup ~578–618; keep the opacity slider and its titles)
- Modify: `src/lib/TrackKeyControls.svelte` (delete the `compact` prop and `BTN_COMPACT` / `SELECT_COMPACT`; the timeline is the only host. Rewrite the file-header comment: hosts = the timeline bar; value authors stay on the gizmo and the slider)
- Modify: `README.md` Animation / Transform bullets — say the tools live on the timeline bar next to Insert keyframe, not under the Transform tool
- Modify: `CLAUDE.md` — a dated entry for this feature; strike any "Animate lives in ToolOptions / LayerList" wording in the multi-property section
- Modify: `docs/superpowers/specs/2026-08-18-timeline-animation-tools-design.md` — Status: Approved

**Interfaces:**

- Consumes: nothing new.
- Produces: one host for `TrackKeyControls`; StatusBar idle hint unchanged (still uses `animateTargetLayer` / `animateTargetGroup` for “a drag keys frame N”).

- [ ] **Step 1: Remove the old hosts**

ToolOptions: delete the two `{#if animTarget}` / `{#if animGroup}` blocks and the `animTarget` / `animGroup` `$derived`s. Delete unused imports (`animateLayer`, `removeLayerAnimation`, `animateGroup`, `removeGroupAnimation`, `TrackKeyControls`, `layerTransformTrack` if nothing else needs it). Leave `animateTargetLayer` **unimported** here — `StatusBar.svelte` still imports it from `./transform-target`.

LayerList: delete the `{#if !opacityTrack}` / `{:else}` branch that renders Animate / TrackKeyControls / Stop. The slider block stays. Delete the now-unused `opacityTrack` const only if nothing else reads it — the slider titles still branch on `opacityTrack`, so keep it.

- [ ] **Step 2: Drop `compact` from `TrackKeyControls`**

One set of classes. Grep for `compact` on `TrackKeyControls` and confirm zero call sites before deleting the prop.

- [ ] **Step 3: Docs**

README, under **Animation** (after the opacity bullet):

```
- Animate, easing, step, delete-key and stop live on the timeline bar next to the
  drawing key tools, and follow the selected row (the layer to start a track, the
  property row to edit one)
```

Under **Transform & deform**, keep the “a layer's transform can be animated” sentence; add that starting the track is on the timeline bar, not the Transform tool.

CLAUDE.md: add a 2026-08-18 entry describing the move, the `activeRow` track case, and that `animationBar` is the one visible-set. Do not paste the whole spec.

Spec status line → `Approved`.

- [ ] **Step 4: Verify**

Run: `npm test && npm run build`

Expected: 0 test failures, 0 `svelte-check` / `tsc` errors or warnings.

Grep for leftover hosts:

```
rg -n "TrackKeyControls|animateLayer\(|animateLayerOpacity\(|animateGroup\(" src/lib
```

Expected: `Timeline.svelte` (render + onclick) and `TrackKeyControls.svelte` itself. Not ToolOptions. Not LayerList. `StatusBar.svelte` still mentions `animateTargetLayer` only.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ToolOptions.svelte src/lib/LayerList.svelte \
  src/lib/TrackKeyControls.svelte README.md CLAUDE.md \
  docs/superpowers/specs/2026-08-18-timeline-animation-tools-design.md
git commit -m "$(cat <<'EOF'
feat: animation tools leave ToolOptions and the layer list

One host — the timeline bar. The Transform tool is a manipulator
again; the opacity slider still keys, without a wrapping control
strip.

Co-Authored-By: Grok <noreply@x.ai>
EOF
)"
```

---

## Self-review (spec coverage)

| Spec section | Task |
|---|---|
| Extend `activeRow` with track cases | 1 |
| Owner lit, focused track lit, siblings quiet | 1 (`isRowSelected` / `isTrackSelected`) |
| Group header stays a collapse toggle | 1 (no new case, no select on the header) |
| `setActiveLayer` clears track focus | 1 (already assigns `{ kind: "layer" }`) |
| Bar table (start / keys / empty / audio) | 2 + 3 |
| Animate before a row exists | 2 (start items) + 3 (buttons) |
| After Animate: focus track, do not switch tool, aim gizmo | 3 |
| After Stop: fall back to layer | 3 (`resolveStaleTrackFocus`) |
| Stale track focus on undo | 1 (`restoreStructure`) |
| ToolOptions keeps scope + Reset | 4 |
| Layer list keeps the slider | 4 |
| `aria-disabled` + titles | 2 (blocked strings) + 3 (markup) |
| Ref outside span: no transform animate, opacity still offered | 2 |
| Copy/Paste layer-transform only | 2 `showCopyPaste` |
| Status hint “a drag keys frame N” stays | 4 (StatusBar untouched) |
| Non-goals (no inspector, no group-header selection, no tool switch) | honored throughout |
