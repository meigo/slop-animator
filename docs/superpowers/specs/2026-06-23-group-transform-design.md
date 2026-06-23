# Group Transform — Design

**Status:** Approved (design phase)
**Date:** 2026-06-23

## Goal

A non-destructive transform that sits **above** the layer in the compose chain, so a multi-layer
asset (character rig, vehicle, prop assembly) can be moved/scaled/rotated about one shared pivot.
Its gizmo box hugs the **group's content** at the current frame (frozen on grab), mirroring the
cell pattern shipped in Phase A.

This is **Phase B** of the transform roadmap. Phase A (per-cell) is shipped; animated/keyframed
transforms are a later, separate spec.

## Why all three levels exist (cell / layer / group)

Each level expresses something the others can't, with only one cell of redundancy:

| Level | Unique role | Can the others substitute? |
|---|---|---|
| **Cell** | Reposition just this drawing without redrawing | No — layer/group carry across frames |
| **Layer** | Move one artwork across all frames | Group could (via one-member group) but at extra UI cost for the simple case |
| **Group** | Move N coordinated layers about a shared pivot | No — independent per-layer transforms rotate about each layer's own base center |

The only overlap is the single-layer character (group of one ≈ layer transform). That redundancy
is fine — same kind as "margin or translate." No level is overkill.

## Tween fit (the shape constraint)

Future animated/keyframed transforms will turn `Layer.transform` and `LayerGroup.transform` into
sparse keyframed tracks (`{ [frame]: RefTransform }`). Cells **stay static-only** — cells are
already the frame-level keyframe; animating a cell transform between frames is just drawing.

Phase B does NOT pre-build tween infrastructure. It only requires that `LayerGroup.transform`
mirror `Layer.transform`'s shape exactly so the same one-line migration applies later (today's
value becomes a single keyframe at frame 0).

## Decisions

- **Group base rect = union of member draw-layer content bounds** at the current frame, frozen on
  gizmo grab. Refs ride along but don't contribute to the bbox (otherwise a single video ref blows
  the bbox to the full media). Empty group → full-doc fallback.
- **Compose order:** `group ∘ layer ∘ cell` (group is outermost).
- **Scope toggle becomes 3-way:** Frame / Layer / Group. Default stays Frame. Group is **disabled**
  when the active layer has no `groupId`.
- **No Apply for groups in Phase B** — Reset only (see *Apply / Reset / merge*).
- **One level of grouping only** (matches today; no nested groups).
- **Persist the group transform** sparsely (same back-compat pattern as `cellTransforms`).

## Data model (`src/anim/document.ts`)

Extend `LayerGroup`:
```ts
export interface LayerGroup {
  id: number;
  name: string;
  collapsed: boolean;
  visible: boolean;
  transform?: RefTransform;
  transformBox?: { x: number; y: number; w: number; h: number } | null;
}
```
Absent/identity `transform` ⇒ no group transform. `transformBox` (logical doc coords) is the frozen
gizmo/pivot box, set when the group transform becomes non-identity; `null`/absent ⇒ derive live.

Add to `AnimState` (`src/state/appState.svelte.ts`): widen
`transformScope: "frame" | "layer"` → `"frame" | "layer" | "group"` (default `"frame"`).

Helpers in `document.ts`:
- `groupTransform(group: LayerGroup): RefTransform` →
  `group.transform ?? IDENTITY_TRANSFORM`.
- `groupOfLayer(layer, groups)` already exists as `groupOf` — reuse.

## Group content bounds (`src/lib/cell-ink.ts`)

Add a group-bbox helper next to `contentBoxLogical`:
```ts
/** Logical bbox of a group's drawable content at `frame`: union of resolved key cells'
 *  contentBounds (device px → logical). Refs excluded. Empty group → full-doc rect. */
export function groupContentBoxLogical(
  group: LayerGroup,
  project: Project,
  frame: number,
  dpr: number,
  version: number,
): { x: number; y: number; w: number; h: number }
```
Implementation: iterate `project.layers` filtered to `groupId === group.id && kind === "draw"`,
resolve each layer's key cell at `frame`, accumulate the union of `contentBounds(cell.canvas, version)`
in device px, convert to logical by `/dpr`. If no draw layer in the group has content, return
`{ x: 0, y: 0, w: project.width, h: project.height }`.

**Active-group box resolver** (Canvas/gizmo, logical coords) — used by gizmo target resolution and
render branches:
```
groupBox(group, project, frame, dpr, version):
  if group.transformBox != null: return group.transformBox          // frozen
  return groupContentBoxLogical(group, project, frame, dpr, version) // live
```

## Render composition (`src/anim/render.ts`)

Extend `drawCellComposed` to accept an outer group transform:
```ts
export function drawCellComposed(
  ctx: CanvasRenderingContext2D,
  cell: CanvasImageSource,
  wDev: number,
  hDev: number,
  groupT: RefTransform,
  groupBoxDev: { x: number; y: number; w: number; h: number },
  layerT: RefTransform,
  cellT: RefTransform,
  cellBoxDev: { x: number; y: number; w: number; h: number },
  dpr: number,
): void
```
Order of operations on `ctx`: group wrap → layer wrap → cell wrap → `drawImage(cell, 0, 0)`. Each
wrap is **skipped entirely** when that level is identity (`isIdentityTransform`), so the cost for
ungrouped/identity-group layers is one identity check.

**Call sites to update:**
- **2D draw branch:** resolve the layer's group via `groupOf(layer, project.groups)`; pass
  `groupT = groupTransform(group ?? identity)` and `groupBoxDev = scaleRect(groupBox(...), dpr)`
  (full-doc rect ×dpr when group is identity / layer ungrouped).
- **Boil path:** `transformedCell` scratch passes group + layer + cell transforms to
  `drawCellComposed` (instead of the 2-transform version).
- **Onion** active-layer branch: same compose.
- **Reference layers** (`drawTransformed`): refs are full group members; the existing per-ref
  transform must compose **under** the group transform. Add a `groupT` + `groupBoxDev` parameter to
  `drawTransformed` (or a wrapper) and apply the group wrap around the existing ref draw. Refs
  outside a group / identity group → existing fast path.

All call signatures grow by one transform; existing tests update by passing `IDENTITY_TRANSFORM`
+ full-doc rect for the group args.

## Drawing through the transform (`src/lib/Canvas.svelte`)

`paintStroke`/`doFill` already compose `cell⁻¹ ∘ layer⁻¹`. Extend to three-deep:
```
local = inverseTransformPoint(cellBoxLogical, cellT,
          inverseTransformPoint(fullDoc, layerT,
            inverseTransformPoint(groupBoxLogical, groupT, p)))
```
Each step is skipped when its transform is identity (the common case — no extra cost). The group
inverse step uses `groupBox(group, project, frame, dpr, state.version)` for its base rect.

Eraser, fill, and brush-cursor mapping all use the same composed inverse point.

## Gizmo + tool (`src/lib/RefTransformGizmo.svelte`, `src/lib/Canvas.svelte`)

The gizmo's `target` choice now keys off `appState.transformScope` × active layer:

- **scope = "group"** + active layer is in a group:
  - Target = `group.transform`; base = `groupBox(group, project, frame, dpr, version)`.
  - No outer compose (group is top of chain), so corner/rotate-handle display reduces to
    `viewport.canvasToScreen(corner)` directly.
  - Drag math: pointer → `viewport.screenToCanvas` → fed to `applyMove/Scale/Rotate` (center =
    group bbox center). No layer/cell inverse needed on the pointer side.
- **scope = "layer"** + active layer is in a group with non-identity `group.transform`:
  - Same as today **plus** corner display pushes through `forwardTransformPoint(fullDoc, groupT, ·)`
    after the existing forward chain, and the pointer maps through `groupT` inverse first.
- **scope = "frame"** + active layer is in a group with non-identity `group.transform`:
  - Same as today **plus** corner display pushes through `forwardTransformPoint(fullDoc, groupT, ·)`
    after the existing layer-forward; pointer maps through `groupT` inverse first, then layer inverse.
- **All other combinations** (no group, identity group, ref scope, etc.): unchanged from Phase A.

**Frozen box on grab (group):** on first drag delta when scope=Group and `group.transform` is
identity, set `group.transformBox = groupBox(...)` before applying the first delta. Same pattern
as the cell/layer freeze.

**Undo:** group drags don't push undo (matches layer/cell — only Reset does). See next section.

**Active-layer fallback:** if the user has scope=Group selected and switches the active layer to
an ungrouped layer, fall back to scope=Frame automatically.

**Toolbar** (`src/lib/Toolbar.svelte`): when `appState.tool === "transform"`, the Frame/Layer
segmented control becomes Frame/Layer/Group. The Group button is rendered disabled (visually
greyed, tooltip "Active layer is not in a group") when the active layer's `groupId` is null.

## Apply / Reset / merge (`src/state/appState.svelte.ts`)

**No Apply for groups in Phase B.** Mathematical reason: a "fold group into each layer's transform"
operation can't produce a clean `RefTransform` per layer — the group rotates about the group bbox
center; per-layer transforms rotate about the doc center. Producing a per-layer transform that
visually matches `group(layer(...))` requires changing the layer's base center, which `RefTransform`
doesn't support. The only mathematically clean Apply is a full pixel flatten of every key cell of
every member layer, which is heavyweight and discards the rig handle the user explicitly created.
Apply can be added later (full-flatten variant) without breaking changes; defer until there's demand.

**`resetGroupTransform(groupId)`** — clears `group.transform`/`transformBox`. One undoable
structural step. Mirrors `resetLayerTransform`/`resetCellTransform`.

**Apply/Reset wiring** in the toolbar / layer-list buttons (extension of `d7105b8`):
- scope = Frame → `applyCellTransform` / `resetCellTransform` (existing).
- scope = Layer → `applyLayerTransform` / `resetLayerTransform` (existing).
- scope = Group → **no Apply** (button hidden); `resetGroupTransform`.
- "Tiebreak when nothing non-identity at active scope" stays today's behavior.

**Merge-down:** existing `bakeLayerTransform` flattens (layer ∘ cell). Group is the rig handle and
stays on the group. A merge-down within a non-identity group inherits the group transform on the
merged target because the target stays in the same group — **correct as long as the target stays
in the group**, which merge-down preserves. No spec change to merge-down. Documented constraint:
moving the merged target *out* of the group post-merge will visually jump (acceptable Phase B
behavior; future "Apply Group = full flatten" resolves it).

## Persistence (`src/persist/project-file.ts`)

Extend `LayerGroupJson` with two optional fields:
```ts
transform?: RefTransform;
transformBox?: { x: number; y: number; w: number; h: number } | null;
```
**Serialize** only when `group.transform` is defined and non-identity (parallel to
`cellTransforms`'s sparse-map pattern):
```ts
const isId = (t: RefTransform) =>
  t.dx === 0 && t.dy === 0 && t.scale === 1 && t.rotation === 0;
const groupJson = {
  id: g.id, name: g.name, collapsed: g.collapsed, visible: g.visible,
  ...(g.transform && !isId(g.transform)
    ? { transform: g.transform, transformBox: g.transformBox ?? null }
    : {}),
};
```
**Deserialize:** if present, assign onto the loaded group; absent → identity/null. **Back-compat:**
every existing save loads unchanged (groups without these fields render as today).

## Testing

**Automated (node):**
- `groupContentBoxLogical`:
  - empty group → full-doc rect;
  - one draw layer with a known opaque rect → that rect (logical, `/dpr`);
  - two draw layers → union;
  - ref in group + draw layer → bbox = draw-layer bbox only (refs excluded);
  - group with refs only (no draw layers) → full-doc rect.
- `render.test.ts`:
  - identity group + identity layer + identity cell → plain `drawImage` (existing fast path stays
    green);
  - non-identity group transform → composed `translate/rotate/scale` + 2-arg `drawImage` at natural
    size (recordingCtx);
  - non-identity group around a transformed ref → ref render runs through group wrap;
  - triple-stack (group + layer + cell all non-identity) → all three wraps emit (or the mock's
    proxy for that — fall back to build+manual if recordingCtx can't distinguish).
- `resetGroupTransform`: clears `transform`+`transformBox`; undo restores.
- `persist.test.ts`: round-trip a group with non-identity transform + frozen box; legacy save
  without `transform`/`transformBox` loads as identity.

Existing **219** stay green; build **0/0**; lint clean.

**Manual (browser) — verification debt:**
- Transform tool, scope **Group**: gizmo hugs the bbox of grouped draw layers at the current frame;
  rotate/scale about that bbox center; refs in the group ride along.
- Scope **Frame** and **Layer** with a non-identity group transform applied: gizmos still track the
  pointer correctly (corners push through `groupT` forward, pointer maps through `groupT` inverse).
- Triple-stack draw-through: paint on a layer in a transformed group with a transformed layer
  transform and a transformed cell transform — stroke lands at the cursor; fill seeds the right
  region; brush cursor positions correctly.
- Group + Frame both engaged: frame transforms compose under group (drawing on the cell stays
  pinned to its own bbox; the group bbox moves the whole rig).
- Onion / playback-boil / export show the group transform.
- Save → reload round-trips group transform + frozen box.
- Old projects (no group transform fields) load with identity.
- Toolbar Group button disabled when active layer is ungrouped, with tooltip.
- Switching active layer from a grouped one to an ungrouped one while scope=Group → falls back to
  Frame.
- Merge-down within a group with a non-identity group transform: result stays visually correct
  while in the group; moving the merged target out shows the documented jump (acceptable).

## Out of scope

- **Apply for groups** (math constraint; full-flatten variant deferred).
- **User-pickable pivot** (draggable transformation point — additive future feature, non-breaking).
- **Animated/keyframed transforms** at any level — Phase B keeps the shape tween-ready but builds
  no tween infrastructure.
- **Nested groups** (one level of grouping only, matching today).
- **Per-cell transforms on reference layers** (already out of scope from Phase A).

## Self-review notes

- Reuses the entire Phase A machinery (`RefTransform`, gizmo math, `drawCellComposed`,
  `forwardTransformPoint`, `inverseTransformPoint`, Reset, sparse persistence). New surface: a
  third transform on `LayerGroup`, a group-bbox resolver, an extra wrap layer in render/compose
  helpers, a 3-way scope toggle.
- The compose order `group ∘ layer ∘ cell` is consistent across render, inverse (group inverse
  outermost on the pointer side), and the absence of bake (no math conversion needed in Phase B
  because there's no Apply).
- The "Apply doesn't work cleanly" finding is a constraint to land in the code review, not a TBD —
  Reset-only is the explicit decision.
- Units are unchanged: render/bake = DEVICE px; gizmo/inverse/`*BoxLogical` = LOGICAL. Group bbox
  is computed in device px (from cell `contentBounds`) and converted to logical at the boundary,
  mirroring the cell case.
- Tween-readiness is a shape constraint (mirror `Layer.transform`), not a feature — the spec
  explicitly defers the tween system.
- The "moving the merged target out of the group" jump is a known Phase B limitation, documented in
  both spec text and the manual-verification list, with a forward fix path.
