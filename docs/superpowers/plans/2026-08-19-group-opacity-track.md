# Group Opacity Track Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a group fade as one thing — optional static opacity, a scalar track, multiply at the draw list, a Group slider on the header, Animate from a member layer.

**Architecture:** Same scalar `Track<number>` as layer opacity. `GROUP_TRACK_PROPS` is the group bag's list so copy / sanitise / ripple / timeline rows cannot hardcode `transform`. Render is one multiply in `buildFrameDrawList`. Authoring copies the layer-opacity slider bracket and the existing key bar.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest (node env, no DOM).

**Spec:** `docs/superpowers/specs/2026-08-19-group-opacity-track-design.md`

## Global Constraints

- Absent `group.opacity` means 100. Absent `tracks.opacity` means static. Format version stays 1.
- Multiply: `opacityAt(layer) * groupOpacityAt(group) / 100`. Ungrouped group term is 100.
- `TRACK_PROPS` stays the layer list. Groups loop `GROUP_TRACK_PROPS`.
- Per-layer frame tools never shift group keys. Only `rippleDocumentFrames` does.
- Group header is not an `activeRow`. Animate from a member layer.
- Lock-only for group keys (`groupHasLockedLayer`). Static slider stays writable when locked.
- Restore static `group.opacity` only when `!!snap.tracks?.opacity !== !!live.tracks?.opacity`.
- Never mutate a track in place. No empty undo entries (guards above `commitStructural`).
- Build bar 0 errors, 0 warnings. Commit trailer: `Co-Authored-By: Grok <noreply@x.ai>`.

## File map

| File | Role |
|---|---|
| `src/anim/document.ts` | `opacity?` on group, `GROUP_TRACK_PROPS`, `groupOpacityAt`, draw-list multiply, `trackForRef` |
| `src/anim/active-row.ts` | group-track `prop` includes `"opacity"`; stale focus checks that prop |
| `src/anim/row-layout.ts` | `timelineRows` loops `GROUP_TRACK_PROPS` |
| `src/anim/timeline.ts` | ripple shifts group opacity keys |
| `src/anim/animation-bar.ts` | Animate group opacity start item; `trackExists` by prop |
| `src/persist/project-file.ts` | load/save `group.opacity`; sanitise static |
| `src/state/appState.svelte.ts` | animate/stop/apply; restore; `trackTarget` / `resolvedTrackValue` |
| `src/lib/LayerList.svelte` | Group header slider |
| `src/lib/Timeline.svelte` | `groupTrackSpec(group, prop)` |
| tests + README + CLAUDE.md + spec status | |

---

### Task 1: Model, resolver, rows, stale focus

**Files:**

- Modify: `src/anim/document.ts` (`LayerGroup`, `GroupTracks`, after `TRACK_PROPS`, `opacityAt`, `trackForRef`, `buildFrameDrawList` left for Task 2)
- Modify: `src/anim/active-row.ts`
- Modify: `src/anim/row-layout.ts`
- Modify: `src/__tests__/transform-track.test.ts` (or `document.test.ts`) for `groupOpacityAt`
- Modify: `src/__tests__/row-layout.test.ts` if group rows are asserted
- Modify: `src/__tests__/active-row.test.ts` stale group-opacity case

**Interfaces:**

- Consumes: `resolveTrack`, `Track<number>`, existing `GroupTracks.transform`.
- Produces:
  - `LayerGroup.opacity?: number`
  - `GroupTracks.opacity?: Track<number>`
  - `export type GroupTrackProp = keyof GroupTracks`
  - `export const GROUP_TRACK_PROPS: GroupTrackProp[] = ["transform", "opacity"]`
  - `export function groupOpacityAt(group: LayerGroup | null | undefined, frame: number): number`
  - `ActiveRow` group track: `prop: "transform" | "opacity"`
  - `trackForRef` group switch includes `case "opacity"`
  - `timelineRows` emits `{ kind: "grouptrack"; group; prop }` for each present group track

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/transform-track.test.ts` (it already has `groupTransformAt`):

```ts
import { groupOpacityAt, type LayerGroup } from "../anim/document";

describe("groupOpacityAt", () => {
  const g = (over: Partial<LayerGroup> = {}): LayerGroup =>
    ({ id: 1, name: "G", collapsed: false, visible: true, ...over }) as LayerGroup;

  it("is 100 when the group is missing or has no opacity", () => {
    expect(groupOpacityAt(null, 0)).toBe(100);
    expect(groupOpacityAt(undefined, 0)).toBe(100);
    expect(groupOpacityAt(g(), 0)).toBe(100);
  });

  it("reads the static field when there is no track", () => {
    expect(groupOpacityAt(g({ opacity: 40 }), 7)).toBe(40);
  });

  it("resolves the track, holding outside the key range", () => {
    const track = {
      keys: [
        { frame: 0, v: 100 },
        { frame: 10, v: 0 },
      ],
    };
    const grp = g({ opacity: 80, tracks: { opacity: track } });
    expect(groupOpacityAt(grp, -1)).toBe(100);
    expect(groupOpacityAt(grp, 5)).toBeCloseTo(50, 10);
    expect(groupOpacityAt(grp, 99)).toBe(0);
  });
});
```

In `src/__tests__/active-row.test.ts`, add: a group-track focus on `prop: "opacity"` stays live when `g.tracks.opacity` exists, and falls back when only `transform` remains.

In `src/__tests__/row-layout.test.ts`, if there is a group-with-transform-row case, add a sibling: a group with only `tracks.opacity` emits a `grouptrack` with `prop: "opacity"` under the header, above members.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/transform-track.test.ts src/__tests__/active-row.test.ts src/__tests__/row-layout.test.ts`

Expected: FAIL — `groupOpacityAt` is not exported; stale focus treats any group track as live if `transform` exists; no opacity group row.

- [ ] **Step 3: Implement**

`groupOpacityAt`:

```ts
export function groupOpacityAt(
  group: LayerGroup | null | undefined,
  frame: number,
): number {
  if (!group) return 100;
  const track = group.tracks?.opacity;
  if (!track || track.keys.length === 0) return group.opacity ?? 100;
  return resolveTrack(track, frame, (a, b, u) => a + (b - a) * u);
}
```

`trackForRef` group switch: add `case "opacity": return g?.tracks?.opacity;` before `default`.

`resolveStaleTrackFocus` group arm:

```ts
if (row.prop === "opacity" ? g?.tracks?.opacity : g?.tracks?.transform) return row;
```

`timelineRows` group block — replace the hardcoded transform row with:

```ts
for (const prop of GROUP_TRACK_PROPS)
  if (seg.group.tracks?.[prop])
    rows.push({ kind: "grouptrack", group: seg.group, prop });
```

Widen `TimelineRow` grouptrack `prop` to `GroupTrackProp`.

`copyTracks` already copies `opacity` when `"opacity" in tracks`. No change required once the field exists on `GroupTracks`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/__tests__/transform-track.test.ts src/__tests__/active-row.test.ts src/__tests__/row-layout.test.ts`

Expected: PASS. `npx tsc --noEmit` may still fail on `groupTrackSpec` / `animation-bar` `trackExists` until later tasks — if it does, widen those sites in **this** task just enough to compile: `groupTrackSpec(group, prop)` with `group.tracks?.[prop]`, and `trackExists` reading `g.tracks?.[ref.prop]`. Do not add Animate or the slider yet.

- [ ] **Step 5: Commit**

```bash
git add src/anim/document.ts src/anim/active-row.ts src/anim/row-layout.ts \
  src/anim/animation-bar.ts src/lib/Timeline.svelte \
  src/__tests__/transform-track.test.ts src/__tests__/active-row.test.ts \
  src/__tests__/row-layout.test.ts
git commit -m "$(cat <<'EOF'
feat: groups can hold an opacity track

groupOpacityAt, GROUP_TRACK_PROPS, and a timeline row under the group
header. Absent opacity is 100. Render still ignores it.

Co-Authored-By: Grok <noreply@x.ai>
EOF
)"
```

---

### Task 2: Draw-list multiply + persist + ripple

**Files:**

- Modify: `src/anim/document.ts` `buildFrameDrawList`
- Modify: `src/__tests__/document.test.ts`
- Modify: `src/persist/project-file.ts` (group JSON `opacity?`; load clamps bad values to omit / 100)
- Modify: `src/__tests__/persist.test.ts` or `transform-track.test.ts` group round-trip
- Modify: `src/anim/timeline.ts` `rippleDocumentFrames` group loop
- Modify: `src/__tests__/timeline-block.test.ts` or `timeline.test.ts` — ripple moves group opacity keys; per-layer insert does not

**Interfaces:**

- Consumes: `groupOpacityAt`, `groupOf`, `GROUP_TRACK_PROPS`.
- Produces: draw ops whose `opacity` is the product; zip round-trip of `group.opacity` + `tracks.opacity`; ripple shifts both group tracks.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/document.test.ts` inside `describe("buildFrameDrawList")`:

```ts
it("multiplies member opacity by group opacity", () => {
  const member = layer(1, [makeKey()], { opacity: 50, groupId: 1 });
  const p = proj([member], 1);
  p.groups = [{ id: 1, name: "G", collapsed: false, visible: true, opacity: 50 }];
  expect(buildFrameDrawList(p, 0)[0].opacity).toBe(25);
});

it("uses 100 for an ungrouped layer and for a group with no opacity", () => {
  const p = proj([layer(1, [makeKey()], { opacity: 50 })], 1);
  expect(buildFrameDrawList(p, 0)[0].opacity).toBe(50);
});

it("resolves an animated group opacity at the frame", () => {
  const member = layer(1, [makeKey(), makeKey()], { opacity: 100, groupId: 1 });
  const p = proj([member], 2);
  p.groups = [
    {
      id: 1,
      name: "G",
      collapsed: false,
      visible: true,
      tracks: {
        opacity: {
          keys: [
            { frame: 0, v: 100 },
            { frame: 1, v: 0 },
          ],
        },
      },
    },
  ];
  expect(buildFrameDrawList(p, 0)[0].opacity).toBe(100);
  expect(buildFrameDrawList(p, 1)[0].opacity).toBe(0);
});
```

Match the real `layer` / `proj` helpers in that file (field names, `groups: []` default). Adjust the fixture if `LayerGroup` construction in tests needs extra fields.

Add a persist test: save a project whose group has `opacity: 40` and `tracks.opacity` with two keys; load; assert both survive. A group JSON with `opacity: 999` loads as 100 (or omitted).

Add a ripple test: group opacity keys at `[0, 4]`; `insertFrameAllLayers` at 2; keys become `[0, 5]`. `insertKeyframe` on one member leaves the group keys at `[0, 4]`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/document.test.ts src/__tests__/persist.test.ts src/__tests__/timeline.test.ts src/__tests__/timeline-block.test.ts`

Expected: FAIL — draw list still emits raw layer opacity; persist drops `group.opacity`; ripple only shifts `group.tracks.transform`.

- [ ] **Step 3: Implement**

`buildFrameDrawList` — for each visible layer:

```ts
const g = groupOf(layer, project.groups);
const opacity = (opacityAt(layer, frame) * groupOpacityAt(g, frame)) / 100;
```

Use that `opacity` on both the draw op and the ref op.

Persist: add `opacity?: number` to the group object in `ProjectJson`. Writer emits `g.opacity` when it is a finite number in 0–100. Loader:

```ts
const o = g.opacity;
opacity: typeof o === "number" && Number.isFinite(o) && o >= 0 && o <= 100 ? o : undefined,
tracks: sanitiseTracks(g.tracks),
```

`sanitiseTracks` already sanitises `opacity` when present on the bag.

Ripple group loop — replace the transform-only body with a loop over `GROUP_TRACK_PROPS`:

```ts
for (const group of project.groups) {
  if (!group.tracks) continue;
  let next = { ...group.tracks };
  let wrote = false;
  for (const prop of GROUP_TRACK_PROPS) {
    if (prop === "transform" && next.transform) {
      next = { ...next, transform: shiftTransformTrackFrames(next.transform, at, delta) };
      wrote = true;
    } else if (prop === "opacity" && next.opacity) {
      next = { ...next, opacity: shiftTrackFrames(next.opacity, at, delta, copyNumber) };
      wrote = true;
    }
  }
  if (wrote) group.tracks = next;
}
```

Keep the `never` arm if you switch on `prop`. Import `GROUP_TRACK_PROPS` and `shiftTrackFrames` (already in file).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/__tests__/document.test.ts src/__tests__/persist.test.ts src/__tests__/timeline.test.ts src/__tests__/timeline-block.test.ts src/__tests__/transform-track.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/anim/document.ts src/anim/timeline.ts src/persist/project-file.ts \
  src/__tests__/document.test.ts src/__tests__/persist.test.ts \
  src/__tests__/timeline.test.ts src/__tests__/timeline-block.test.ts
git commit -m "$(cat <<'EOF'
feat: group opacity multiplies at the draw list and survives save

Member × group / 100. Ripple shifts the group fade with the document.
A bad stored number falls back to fully opaque.

Co-Authored-By: Grok <noreply@x.ai>
EOF
)"
```

---

### Task 3: Animate, Stop, bar, key value, restore

**Files:**

- Modify: `src/state/appState.svelte.ts` (`animateGroupOpacity`, `removeGroupOpacityAnimation`, `applyGroupOpacityAt`, `trackTarget` group opacity, `resolvedTrackValue`, `restoreStructure` group opacity flip)
- Modify: `src/anim/animation-bar.ts` (`AnimationStartItem` + start-group offer)
- Modify: `src/__tests__/animation-bar.test.ts`
- Modify: `src/lib/Timeline.svelte` (wire Animate group opacity; `groupTrackSpec(group, prop)`)

**Interfaces:**

- Consumes: `groupOpacityAt`, `normalizedTracks`, `selectTrack`, `commitStructural`.
- Produces:
  - `export function animateGroupOpacity(groupId: number): void`
  - `export function removeGroupOpacityAnimation(groupId: number): void`
  - `export function applyGroupOpacityAt(groupId: number, frame: number, value: number): void`
  - `animationBar` start item `{ action: "animate-group-opacity"; groupId: number; blocked: string | null }`

- [ ] **Step 1: Write the failing `animationBar` tests**

```ts
it("offers Animate group opacity when the member's group has no opacity track", () => {
  const bar = args({
    layers: [draw(1, { groupId: 10 })],
    groups: [group(10)],
  });
  expect(bar.kind).toBe("start");
  if (bar.kind !== "start") return;
  expect(bar.items.map((i) => i.action)).toContain("animate-group-opacity");
});

it("omits Animate group opacity once the group track exists", () => {
  const bar = args({
    layers: [draw(1, { groupId: 10 })],
    groups: [group(10, { tracks: { opacity: { keys: [{ frame: 0, v: 100 }] } } })],
  });
  expect(bar.kind).toBe("start");
  if (bar.kind !== "start") return;
  expect(bar.items.map((i) => i.action)).not.toContain("animate-group-opacity");
});

it("shows key tools for a focused group opacity row", () => {
  const bar = args({
    activeRow: { kind: "track", owner: "group", id: 10, prop: "opacity" },
    layers: [draw(1, { groupId: 10 })],
    groups: [group(10, { tracks: { opacity: { keys: [{ frame: 0, v: 40 }] } } })],
  });
  expect(bar).toMatchObject({
    kind: "keys",
    track: { owner: "group", id: 10, prop: "opacity" },
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/__tests__/animation-bar.test.ts`

Expected: FAIL — no `animate-group-opacity`; focused `prop: "opacity"` on a group may miss `trackExists`.

- [ ] **Step 3: Implement actions and bar**

`animation-bar.ts`: extend `AnimationStartItem` with `animate-group-opacity`. After the existing Animate-group-transform block:

```ts
if (g && !g.tracks?.opacity) {
  items.push({
    action: "animate-group-opacity",
    groupId: g.id,
    blocked: groupAnimateBlocked(g, layers),
  });
}
```

`trackExists` for a group: `return !!g?.tracks?.[ref.prop];`

`animateGroupOpacity` (mirror `animateGroup`, no box):

```ts
export function animateGroupOpacity(groupId: number): void {
  const g = state.project.groups.find((x) => x.id === groupId);
  if (!g || g.tracks?.opacity) return;
  if (groupHasLockedLayer(g, state.project.layers)) return;
  commitStructural(() => {
    g.tracks = {
      ...g.tracks,
      opacity: { keys: [{ frame: 0, v: groupOpacityAt(g, 0) }] },
    };
    g.collapsed = false;
  });
  selectTrack({ owner: "group", id: groupId, prop: "opacity" });
}
```

Use `groupOpacityAt(g, 0)` not the playhead: Animate seeds frame 0, like layer opacity uses `l.opacity` (the static value, which equals `groupOpacityAt` at any frame when there is no track).

`removeGroupOpacityAnimation`:

```ts
export function removeGroupOpacityAnimation(groupId: number): void {
  const g = state.project.groups.find((x) => x.id === groupId);
  if (!g || !g.tracks?.opacity) return;
  if (groupHasLockedLayer(g, state.project.layers)) return;
  const resolved = groupOpacityAt(g, state.playhead);
  commitStructural(() => {
    g.opacity = resolved;
    g.tracks = normalizedTracks({ ...g.tracks, opacity: undefined });
  });
  state.activeRow = resolveStaleTrackFocus(
    state.activeRow,
    state.project,
    state.activeLayerId,
  );
}
```

`applyGroupOpacityAt`: if `g.tracks?.opacity`, `withKey` at `frame` (no commit). Else `g.opacity = value` (no commit). Refuse key writes when `groupHasLockedLayer`. Always allow static writes.

`trackTarget` group branch: if `ref.prop === "opacity"`, return the opacity track + `(n) => n` + bag replace. Keep transform as today.

`resolvedTrackValue` group: `ref.prop === "opacity" ? groupOpacityAt(g, frame) : groupTransformAt(g, frame)`.

`restoreStructure` group live-path, after assigning tracks:

```ts
if (!!snap.tracks?.opacity !== !!live.tracks?.opacity) live.opacity = snap.opacity;
```

Assign tracks **after** that compare (read live tracks before overwrite):

```ts
if (!!snap.tracks?.opacity !== !!live.tracks?.opacity) live.opacity = snap.opacity;
live.tracks = snap.tracks ? copyTracks(snap.tracks) : undefined;
```

Timeline start-button `{#each}`: add a branch for `animate-group-opacity` — same `Blend` icon as layer opacity is fine if the **title** is `Animate group opacity — ${group.name}` / blocked reason. Look up the name from `appState.project.groups`. `onclick` → `animateGroupOpacity(item.groupId)`.

Stop on a focused group opacity row already goes through `animBar.track`: extend the Stop handler:

```ts
if (t.owner === "group" && t.prop === "opacity") removeGroupOpacityAnimation(t.id);
else if (t.owner === "group") removeGroupAnimation(t.id);
```

`groupTrackSpec(group, prop)`: use `group.tracks?.[prop]`, `selectTrack({ owner: "group", id, prop })`, `setTrack` writes `[prop]`, `moved` is `withMovedTransformKey` only for `transform`, else `withMovedKey(..., (n) => n)`. Call site: `groupTrackSpec(row.group, row.prop)`.

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run src/__tests__/animation-bar.test.ts && npx svelte-check --threshold warning && npx tsc --noEmit`

Expected: 0 errors, 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add src/state/appState.svelte.ts src/anim/animation-bar.ts \
  src/lib/Timeline.svelte src/__tests__/animation-bar.test.ts
git commit -m "$(cat <<'EOF'
feat: Animate and Stop a group's opacity

A member layer's bar offers Animate group opacity. Stop bakes the
on-screen fade. Undo restores the static number only when the track
itself comes or goes.

Co-Authored-By: Grok <noreply@x.ai>
EOF
)"
```

---

### Task 4: Group header slider + docs

**Files:**

- Modify: `src/lib/LayerList.svelte` (second row on the group header)
- Modify: `README.md`, `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-08-19-group-opacity-track-design.md` — Status: Approved

**Interfaces:**

- Consumes: `groupOpacityAt`, `applyGroupOpacityAt`, `beginStructuralEdit`, `commitStructuralEdit`, `groupHasLockedLayer`.
- Produces: the labeled Group slider.

- [ ] **Step 1: Add the header row**

Under the existing group header `flex` row (still inside `data-group-id`), add a second row that is **not** hidden when the group is collapsed:

```svelte
<div class="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 pb-1 text-text-secondary">
  {@const gOpTrack = seg.group.tracks?.opacity}
  {@const gOpNow = groupOpacityAt(seg.group, appState.playhead)}
  {@const gOpPinned = !!gOpTrack && groupHasLockedLayer(seg.group, appState.project.layers)}
  <span
    class="flex items-center gap-2"
    title={gOpPinned
      ? "Group opacity — animated, and a locked member pins the group"
      : gOpTrack
        ? `Group opacity — animated; a change keys frame ${appState.playhead + 1}`
        : "Group opacity"}
  >
    <span class="text-xs text-text-muted">Group</span>
    <input
      class="w-12 aria-disabled:opacity-40"
      class:pointer-events-none={gOpPinned}
      aria-disabled={gOpPinned}
      type="range"
      min="0"
      max="100"
      value={gOpNow}
      oninput={(e) => onGroupOpacityInput(seg.group.id, Number(e.currentTarget.value))}
      onchange={groupOpacityChange}
      onpointerup={settleGroupOpacityDrag}
      onpointercancel={settleGroupOpacityDrag}
      onkeydown={groupOpacityKeyDown}
      onkeyup={groupOpacityKeyUp}
      onblur={groupOpacityBlur}
      onclick={(e) => e.stopPropagation()}
    />
    <span class="text-xs tabular-nums w-6 text-text-muted">{Math.round(gOpNow)}</span>
  </span>
</div>
```

Copy the layer slider's bracket (`opacityUndo*` → `groupOpacityUndo*`) in the script. Differences:

- Key by `groupId`, not layer id.
- `applyGroupOpacityAt(groupId, frame, value)`.
- Settle no-op: compare start vs end key (or static `group.opacity ?? 100`) on the grab frame.
- `use:settleOnUnmount` on the input if the layer slider has it — groups do not `{#key}`-rebuild on reorder the same way; still attach if the action exists.
- While a gesture is open, the thumb/title must use the grab frame (read `playhead` first, then the bracket — same `$state` dependency rule as `opacityFrameFor`).

Import `groupOpacityAt`, `applyGroupOpacityAt`, `groupHasLockedLayer`.

- [ ] **Step 2: Docs**

README Animation: a group can be faded as one thing; Group slider on the header; Animate from a member.

CLAUDE.md: dated 2026-08-19 entry — multiply at draw list, `GROUP_TRACK_PROPS`, slider lock table, restore-on-flip. Do not paste the spec.

Spec status → `Approved`.

- [ ] **Step 3: Verify**

Run: `npm test && npm run build`

Expected: 0 failures, 0 `svelte-check` / `tsc` errors or warnings.

- [ ] **Step 4: Commit**

```bash
git add src/lib/LayerList.svelte README.md CLAUDE.md \
  docs/superpowers/specs/2026-08-19-group-opacity-track-design.md
git commit -m "$(cat <<'EOF'
feat: a Group opacity slider on the layer-panel header

Labeled so it cannot be mistaken for the member's slider. Keys the
playhead when the group fade is animated; static writes stay
non-undoable.

Co-Authored-By: Grok <noreply@x.ai>
EOF
)"
```

---

## Spec coverage

| Spec | Task |
|---|---|
| `group.opacity?`, `GroupTracks.opacity` | 1 |
| `groupOpacityAt` | 1 |
| `GROUP_TRACK_PROPS` / timeline rows / stale focus / `trackForRef` | 1 |
| Draw-list multiply | 2 |
| Persist + sanitise | 2 |
| Ripple only, not per-layer tools | 2 |
| Animate / Stop / restore-on-flip / bar / key tools | 3 |
| Header slider + labels + lock table | 4 |
| Docs + spec Approved | 4 |
| Non-goals (no group `activeRow`, no bar slider) | honored |
