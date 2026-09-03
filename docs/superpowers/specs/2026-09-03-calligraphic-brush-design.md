# Calligraphic brush — design

**Date:** 2026-09-03
**Status:** Draft — awaiting review
**Builds on:** the stamp brush engine (`src/core/stamp-brush.ts`, `src/core/brush-textures.ts`), the
shared pressure→size model (`widthRange`/`stampFootprint` in `src/core/brush.ts` /
`src/core/stamp-brush.ts`), the `BrushType`/`BrushKind` tool-settings model
(`src/state/appState.svelte.ts`), and `BrushCursor.svelte` / `Viewport.rotation`.

## Goal

Add a calligraphic (broad-nib) brush: a stamped tip that is **non-uniformly scaled** (elliptical, not
circular) and held at a **fixed rotation**, so the visible stroke is thin along the nib's long axis and
thick across its face — purely from the geometry of dragging a fixed-angle nib, the way a physical
italic/chisel pen behaves. No pen-tilt input is involved; this app captures no tilt data today
(`InputPoint` is `{x, y, pressure, hasPressure, timestamp}`), and direction-driven width needs none.

## Requirements (user-confirmed)

1. It's "basically non-uniform scale of a brush tip and rotation" — not a per-point angle-of-travel
   calculation, not pen-tilt.
2. Slots in as a brush-type option (like Smooth/Ink/Pencil/Charcoal/Airbrush today), not a new tool.

## Non-goals

- **Pencil tilt / azimuth-driven width.** No tilt capture exists in `input.ts`; adding it is a
  separate, larger change (new fields on `InputPoint`, new capture in every input path: pointer,
  touch, gizmo) with no clear win once direction+fixed-angle already gives the calligraphic look.
- **Per-point rotation that follows stroke direction.** That is a different, non-calligraphic brush
  (it would always draw at max width, like a rotated round brush) — the whole calligraphic effect
  depends on the nib angle staying fixed while the stroke direction varies.
- **A rotation gizmo / on-canvas angle drag.** Angle and flatness are two more sliders in ToolOptions,
  matching every other brush parameter (Size, Press, Opacity, Smooth, Stream, Taper) — no new
  interaction pattern.
- **A vector/quill (nib-sweep polygon) engine.** Considered and rejected — see below.

## Approaches considered

1. **Extend the stamp engine with a non-uniformly-scaled, fixed-rotation tip (chosen).** Reuses the
   entire incremental-stamping loop, spacing math, pressure→size model, and eraser/blend-mode
   handling already in `drawStampStrokeIncremental`. The calligraphic thick/thin falls out of stamping
   an elongated shape repeatedly at a constant angle — no new geometry algorithm.
2. **A dedicated nib-sweep ("quill") engine**: per segment, compute the nib's two fixed-angle corner
   offsets and fill the swept quad between consecutive positions. Geometrically the "purest" way to
   draw a calligraphy pen, but it is an entirely new engine (own math, own edge cases at joins/caps,
   no shared code with anything else) for a result approach 1 already produces correctly. Rejected —
   not worth the surface area.
3. **Feed a direction-derived width into perfect-freehand ("smooth") brush's pressure channel.**
   Rejected: pf's outline is one scalar radius per point (radially symmetric); it has no notion of an
   anisotropic/elliptical nib, so this would fight the library rather than use it (see `brush.ts`'s own
   documented reasoning about `size` being a radius basis).

## Data model

- `BrushType` (`src/core/brush-textures.ts`) gains `"calligraphy"`:
  ```ts
  export type BrushType = "smooth" | "pencil" | "charcoal" | "airbrush" | "calligraphy";
  ```
  `BrushKind = "smooth" | "ink" | BrushType` picks it up with no further change — the existing
  `brushType` dropdown, eraser reuse (`appState.eraser.brushType`), and `Canvas.svelte`'s
  `kind !== "smooth" && kind !== "ink" → stamp engine` dispatch all cover it automatically.
- Two new fields on `ToolSettings` (`src/state/appState.svelte.ts`), alongside `smoothing`/`taper`:
  - `nibAngle: number` — degrees, default **45**. Fixed rotation of the nib's long axis. Measured in
    the same coordinate frame `InputPoint`s already arrive in (document/cell space), so no special
    casing is needed for it to compose correctly with layer/group transforms — the stamp is drawn
    into the cell canvas exactly like every other stamp.
  - `nibFlatness: number` — 0–1, default **0.35**. `0` = circle (no calligraphic effect, matches every
    other stamp type); approaches 1 = a very thin line. Clamp the practical UI range short of 1 (e.g.
    max 0.9) so the nib's short axis never rounds to zero width.
  - Both are declared on `ToolSettings` (not a `calligraphy`-only sub-object) so they ride the existing
    `gatherPreferences`/`applyPreferences` spread-merge for free — an old stored preferences blob
    simply lacks them and the two defaults set at both `ToolSettings` initializations
    (`appState.svelte.ts`, brush + eraser) apply, the established "absent means default" convention
    used throughout this codebase.
  - Both are inert for every other `brushType`, the same relationship `smoothing`/`taper` already have
    to non-smooth types — no enforcement needed beyond the UI not offering them (see UI section).

## Rendering (`src/core/brush-textures.ts`, `src/core/stamp-brush.ts`)

**Tip shape.** New `calligraphyTip()` generator alongside `hardRoundTip()`/`pencilTip()`/etc.: a
**crisp, non-textured filled circle** (same antialiased-edge treatment as `hardRoundTip`, no grain
subtraction like pencil/charcoal) — stretching it non-uniformly must stay clean-edged, or the "grain"
would stretch into visibly elongated speckles. Cached via the existing `getCachedTip` keyed pattern.

**Baking the shape (flatness only — angle stays per-stamp).** `calligraphyTip()` draws an ellipse
**unrotated**, semi-major axis = the tip's normal full radius (`TIP_SIZE/2`, so at `flatness = 0` it
is pixel-identical to `hardRoundTip`) and semi-minor axis = `radius * (1 - flatness)`. Because the
long axis never exceeds the original radius, the ellipse always fits inside the existing
`TIP_SIZE × TIP_SIZE` canvas with no extra padding — rotating it later can't push it outside that
square (the rotated AABB of an ellipse is bounded by its semi-major axis in every direction). `
getTintedTip` (`stamp-brush.ts`) extends its existing color-tint cache to also key on `flatness` when
`brushType === "calligraphy"` — **not** on angle, since the bitmap itself is never rotated.

**Rotation is a per-stamp canvas transform, not a baked pixel.** `drawStampStrokeIncremental`'s draw
call becomes, for calligraphy only:

```ts
ctx.save();
ctx.translate(x, y);
ctx.rotate((nibAngle * Math.PI) / 180);
ctx.drawImage(tip, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
ctx.restore();
```

in place of the plain `ctx.drawImage(tip, x - drawSize/2, y - drawSize/2, drawSize, drawSize)` every
other stamp type uses. This is why angle needs no cache entry at all: dragging the Angle slider costs
nothing extra (no rebake, just a different `rotate()` argument already computed per stroke), and only
a Flatness or color change triggers a rebake — identical cost to today's existing color re-tint.

**Footprint math unchanged.** `stampFootprint(width)` (the pressure→size mapping, the
`MIN_STAMP_PX`/`alphaScale` thin-stroke fade fixed 2026-08-29) keeps governing the nib's *overall*
size from pressure — it operates on the same scalar `width` as every other brush and feeds the same
`drawSize` used above. Flatness only reshapes the cached bitmap; it does not change the
pressure/spacing pipeline, and the spacing loop itself is untouched.

## UI (`ToolOptions.svelte`)

- `<option value="calligraphy">Calligraphy</option>` added to the existing brush-type `<select>` (the
  one bound to `stroke.brushType`, shared by the Brush and Eraser tools — see Eraser below).
- Two new sliders, **shown only when `stroke.brushType === "calligraphy"`** (not dimmed — they are
  genuinely inapplicable to other brush types, not merely inert, so hiding rather than disabling
  matches how `Behind` is already scoped to `tool !== "eraser"`):
  - **Angle** — range input, 0–180°, bound to `stroke.nibAngle`.
  - **Flatness** — range input, 0–100%, mapped to `stroke.nibFlatness` (0–0.9 internal).
- `smoothOnly` (which dims Smooth/Taper) needs no change — calligraphy is a stamp-family engine like
  pencil/charcoal/airbrush, and the existing `stroke.brushType === "smooth"` check already excludes it.

## Cursor (`BrushCursor.svelte`)

The cursor is currently a plain CSS circle (`border-radius: 50%`, `width/height: {diameter}px`) sized
from `activeStroke().size * zoom`. For calligraphy it must show the nib's actual shape and orientation
— without this the artist has no way to predict which direction lays down a thick line versus thin,
which is core usability, not polish:

- `width = diameter`, `height = diameter * (1 - nibFlatness)` (short axis shrinks as flatness rises).
- Add a CSS `rotate()` to the existing `translate(...)` transform.
- **The rotation must be `nibAngle + viewport.rotation`, not `nibAngle` alone.** The cursor is drawn in
  screen space (`x`/`y` come from `clientX`/`clientY`), but the canvas can be twisted via two-finger
  rotate (`Viewport.rotation`, radians). Compensating is the same class of fix as the marquee's
  screen-constant chrome (`px = 1/screenScale`) — without it, the cursor would show the wrong nib
  orientation whenever the canvas is rotated, even though the actual painted stroke (computed in
  document space, unaffected by the view transform) would be correct.

## Eraser reuse

`ToolOptions.svelte` renders one `brushType` `<select>` for whichever of `brush`/`eraser` is active, so
`"calligraphy"` becomes selectable as an eraser shape automatically, matching the existing
pencil/charcoal/airbrush eraser precedent. No special-casing planned — flag during implementation if a
calligraphic eraser turns out to look wrong (e.g. compositing artifacts under `destination-out`) rather
than pre-emptively excluding it.

## Testing plan

- **Unit-testable (pure):** the tip-stretch/rotation math if it's factored as a pure function (compute
  the rotated bounding box size for a given angle/flatness, or similar); `nibFlatness` clamping.
  Vitest is node-only, so anything touching `HTMLCanvasElement`/`OffscreenCanvas` is not.
- **Build+review-verified only, per project convention:** the actual stamped stroke look, the cursor
  ellipse+rotation, eraser behavior, cache invalidation on slider drag. Flagged for an iPad browser
  pass: does the nib look right at both size extremes (near `MIN_STAMP_PX` and large), does dragging
  along/across the nib axis produce the expected thin/thick, does the cursor orientation match the
  painted result including under canvas rotation, does the Angle/Flatness UI read clearly at the
  toolbar's usual density.

## Open questions / risks

- **Per-stamp `save()`/`rotate()`/`restore()` cost.** Every calligraphy stamp now pays for a context
  transform push/pop that other brush types don't. Expected to be negligible (cheap relative to the
  `drawImage` rasterization itself, and this app already accepts per-stamp `ctx.save`/`restore` for
  blend-mode handling in the existing loop) but worth a quick profile on iPad if a long, dense stroke
  feels slower than pencil/charcoal at the same size.
- **Flatness slider drag thrash.** Only `flatness` (not angle) triggers a tinted-tip rebake now, same
  cost class as the existing color re-tint — expected to be fine, flag only if it feels laggy in
  practice.
