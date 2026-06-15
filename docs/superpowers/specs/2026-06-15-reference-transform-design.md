# Reference Image Transform — Design

**Status:** Approved (design phase)
**Date:** 2026-06-15

## Goal

Let the artist move, scale, and rotate a reference image on the canvas instead of it being locked to
a fixed centered contain-fit. The reference stays a live, non-exporting backdrop; the transform is set
by selecting the reference layer and dragging an on-canvas gizmo.

## Context

`ReferenceLayer` (`src/anim/document.ts`) holds `media` (image/video) and is composited with a fixed
aspect-fit centered rect via `containRect` (`render.ts:38-42` boil path, `:68-71` 2D path). Reference
layers are **session-only** — `projectToJson`/`saveProjectBlob` exclude them. Drawing tools target the
active layer only when it is a drawing layer (`Canvas.svelte` returns early when
`layer.kind !== "draw"`), which is why all tools appear available but do nothing on a selected
reference layer — a confusing dead end this feature also resolves.

The app already has a destructive transform system (`src/core/selection.ts`: move/scale/rotate +
distort + mesh, baked into pixels on commit) and a `Viewport` (`src/core/viewport.ts`:
`screenToCanvas`/`canvasToScreen`) for screen↔document mapping. This feature reuses the `Viewport`
mapping but **not** `Selection` — a reference transform is live and non-destructive, not a pixel bake.

## Scope

In scope:
- A `RefTransform` (dx, dy, scale, rotation) on `ReferenceLayer`, default = identity = today's fit.
- Pure transform/geometry helpers in `src/core/ref-transform.ts` (Node-unit-tested).
- Compositing applies the transform (identity renders pixel-identically to now).
- An on-canvas gizmo (bounding box + corner scale handles + rotate handle + draggable body) active
  when the selected layer is a reference layer, editing the transform live.
- A "Reset to fit" action and a one-line hint; selecting a reference layer now means "transform mode".

Out of scope (not planned here):
- Distort / corner-pin (non-affine). Per-frame / keyframed reference transforms.
- Persisting reference layers (they remain session-only; the transform is session-only too).
- Changing video handling beyond applying the same transform to its frames.

## Decisions

1. **Transform is a delta on the contain-fit, not an absolute placement.** Storing
   `{ dx, dy, scale, rotation }` with default `{0,0,1,0}` means an untouched reference renders exactly
   as today, and "reset" is just identity. Backwards-compatible by construction.
2. **All transforms pivot on the (translated) center.** Scaling and rotation are around the image's
   center point (`fit-center + (dx,dy)`); corners move symmetrically, the center stays put. This keeps
   the drag math simple and independent (scale doesn't change dx/dy), and is predictable to use.
3. **Uniform scale only** (single `scale`), **rotation in radians**. No non-uniform/distort.
4. **Live, non-destructive.** The gizmo edits `layer.transform` and the compositor applies it every
   frame; nothing is baked. Distinct from `Selection`, which is not reused.
5. **Selecting a reference layer = transform mode.** Drawing tools are already inert on reference
   layers; now that state shows the gizmo instead of being a dead end. No tool-palette changes needed.
6. **Session-only**, matching current reference behavior (references aren't persisted).

## Data model

```ts
// src/anim/document.ts
export interface RefTransform {
  dx: number;        // translate from fit-center, document logical px
  dy: number;
  scale: number;     // uniform multiplier on the fit size (1 = fit)
  rotation: number;  // radians, clockwise, about the center
}
```
Add `transform: RefTransform;` to `ReferenceLayer`. `createReferenceLayer` defaults it to
`{ dx: 0, dy: 0, scale: 1, rotation: 0 }`. (Required-field ripple: add the default to the
`ReferenceLayer` literals in `document.test.ts` (×2: the `rlayer` helper + the explicit literal),
`persist.test.ts` (`rlayer` helper), and `timeline.test.ts` (its ref helper) — find them via tsc.)

## Compositing — `render.ts`

Both reference draws (boil path ~`:38-42`, 2D path ~`:68-71`) change from a single `drawImage(el,
r.x, r.y, r.w, r.h)` to a transformed draw. With `base = containRect(imgW, imgH, docW*dpr, docH*dpr)`
and `t = layer.transform`:

```ts
const cx = base.x + base.w / 2 + t.dx * dpr;
const cy = base.y + base.h / 2 + t.dy * dpr;
ctx.save();
ctx.translate(cx, cy);
ctx.rotate(t.rotation);
ctx.scale(t.scale, t.scale);
ctx.drawImage(layer.media.el, -base.w / 2, -base.h / 2, base.w, base.h);
ctx.restore();
```

`dx/dy` are stored in logical px (the gizmo works in logical coords) and multiplied by `dpr` here
(compositing is in device px). Identity `{0,0,1,0}` reduces to the current centered fit. `globalAlpha`
(opacity) handling is unchanged.

## Transform & geometry — `src/core/ref-transform.ts` (pure, Node-testable)

All functions are pure (no DOM); coordinates are logical document px unless noted.

```ts
export interface Pt { x: number; y: number; }
export type Handle = "nw" | "ne" | "se" | "sw" | "rotate" | "body" | null;

/** Image center in document coords (fit-center + translate). `base` is the contain-fit rect in
 *  LOGICAL px (device rect / dpr). */
export function transformCenter(base: Rect, t: RefTransform): Pt;

/** The four corners of the transformed image (for the gizmo box, scale handles, and hit-testing). */
export function transformedCorners(base: Rect, t: RefTransform): [Pt, Pt, Pt, Pt];

/** Position of the rotate handle (a fixed gizmo-space offset above the top edge). */
export function rotateHandlePos(base: Rect, t: RefTransform, gap: number): Pt;

/** Which handle (if any) a document-space point hits, given a screen-space tolerance in doc units. */
export function hitTestHandle(base: Rect, t: RefTransform, p: Pt, tolDoc: number, gap: number): Handle;

/** New transform after dragging the body by (ddx, ddy) document px. */
export function applyMove(t: RefTransform, ddx: number, ddy: number): RefTransform;

/** New uniform scale: startScale * |p-center| / |start-center|, clamped to a small min. */
export function applyScale(t: RefTransform, center: Pt, start: Pt, p: Pt): RefTransform;

/** New rotation: startRotation + angle(p-center) - angle(start-center). */
export function applyRotate(t: RefTransform, center: Pt, start: Pt, p: Pt): RefTransform;
```
`Rect` is `{ x, y, w, h }` (reuse the `containRect` return shape). Scaling is clamped to a small
minimum (e.g. 0.05) so the image can't collapse to zero.

## Interaction — `Canvas.svelte` + `RefTransformGizmo.svelte`

- **Pointer routing:** `Canvas.svelte` already owns the canvas pointer. When `activeLayer().kind ===
  "ref"`, pointer events route to the ref-transform handler instead of drawing: on pointerdown,
  `hitTestHandle` (converting screen→doc via `viewport.screenToCanvas`, and the fit `base` from the
  layer's media) picks a handle; pointermove applies the matching `apply*` helper to `layer.transform`
  and `bump()`s; pointerup ends the drag. Body drag = move, corners = scale, rotate handle = rotate.
- **Gizmo rendering:** a `RefTransformGizmo.svelte` overlay (same polled-rAF pattern as
  `SelectionActions.svelte`) reads the active ref layer's transform + the `Viewport`, maps
  `transformedCorners`/`rotateHandlePos` through `viewport.canvasToScreen`, and draws the box, four
  corner squares, the rotate handle, and a small "Reset to fit" button + a one-line hint
  ("Reference: drag to move, corners to scale, top handle to rotate"). It shows only while a reference
  layer is the active layer.
- **Reset to fit:** sets `layer.transform = { dx:0, dy:0, scale:1, rotation:0 }` and `bump()`s.

## Persistence & export

No changes. Reference layers (and their transforms) are session-only; export already excludes
reference layers. Identity default means existing in-session references look unchanged until moved.

## Testing

Vitest runs in **Node**. Unit-test the pure `ref-transform.ts` helpers; the gizmo, pointer routing,
and compositing visuals are manual-verified.

**Unit (`src/__tests__/ref-transform.test.ts`):**
- `transformCenter`: identity → fit-center; translate shifts it by (dx,dy).
- `transformedCorners`: identity → the fit rect's corners; `scale=2` → corners twice as far from
  center; `rotation=π/2` → corners rotated a quarter turn about center.
- `hitTestHandle`: returns the right corner near a corner; `"rotate"` near the rotate handle; `"body"`
  inside; `null` outside + tolerance; respects the tolerance.
- `applyMove`: adds to dx/dy, leaves scale/rotation.
- `applyScale`: doubling the pointer distance from center doubles `scale`; clamps at the minimum;
  leaves dx/dy/rotation.
- `applyRotate`: a 90° pointer sweep about center adds π/2 to rotation; leaves scale/translation.

**Manual (browser):**
- Import an image; select its layer → the gizmo appears over the fit-placed image.
- Drag body = move; drag a corner = uniform scale about center; drag the rotate handle = rotate.
- The ink you draw on a drawing layer stays put while the reference moves under it (live, traceable).
- "Reset to fit" returns the image to the centered fit.
- A reference layer no longer leaves the drawing tools doing nothing — selecting it shows the gizmo.
- Untouched references look identical to before this change.
- Pan/zoom the viewport: the gizmo tracks the image; handles stay grabbable.

## Self-review notes

- The only non-trivial logic (drag→transform, hit-testing, corner geometry) is pure and unit-tested in
  `ref-transform.ts`; the DOM-coupled gizmo and pointer routing are thin and manual-verified.
- Center-pivot scaling/rotation keeps the four helpers independent (no cross-coupling of dx/dy and
  scale), which is why each is testable in isolation.
- Identity-default + delta-on-fit guarantees zero visual change for untouched references and a trivial
  "reset".
- Reusing `Viewport` (not `Selection`) keeps this live and non-destructive, matching the "stays a
  backdrop" decision.
