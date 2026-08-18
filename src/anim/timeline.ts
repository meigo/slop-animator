import {
  resolveKeyframeIndex,
  refreshLength,
  copyKeyframe,
  withTrackKeys,
  TRACK_PROPS,
  GROUP_TRACK_PROPS,
  type Cell,
  type DrawingLayer,
  type Keyframe,
  type Layer,
  type LayerTracks,
  type Project,
  type RefTransform,
  type Track,
  type TransformKey,
  type TransformTrack,
} from "./document";
import { videoClipLayout, offsetAfterClipDrag } from "./clip-layout";

/** The per-property value copiers the shifter needs. `document.ts` keeps its own copies private, and
 *  a transform is a flat object / an opacity a number, so both are one line here. */
const copyRefTransform = (t: RefTransform): RefTransform => ({ ...t });
const copyNumber = (n: number): number => n;

/** Canvas creation/cloning, injected so timeline logic is testable without the DOM. */
export interface CanvasOps {
  create(): HTMLCanvasElement;
  clone(src: HTMLCanvasElement): HTMLCanvasElement;
}

/** Insert a hold AFTER `after` on this layer, extending the current held span by one frame. */
export function addFrame(layer: DrawingLayer, after: number): void {
  const at = clampIndex(layer, after);
  layer.cells.splice(at + 1, 0, { kind: "hold" });
}

/** Clamp a target index to the last existing cell so "after current" always lands inside the track. */
function clampIndex(layer: DrawingLayer, frame: number): number {
  return Math.max(0, Math.min(frame, layer.cells.length - 1));
}

/**
 * Insert a new keyframe AFTER `after`, cloning the drawing currently shown at `after`
 * (the resolved keyframe, or blank if none). Shifts later cells right. ("Insert keyframe" / F6.)
 */
export function insertKeyframe(layer: DrawingLayer, after: number, ops: CanvasOps): void {
  const at = clampIndex(layer, after);
  const ki = resolveKeyframeIndex(layer.cells, at);
  const src = ki === null ? null : layer.cells[ki];
  const canvas = src && src.kind === "key" ? ops.clone(src.canvas) : ops.create();
  layer.cells.splice(at + 1, 0, { kind: "key", canvas });
}

/** Insert an empty keyframe AFTER `after`, shifting later cells right. ("Insert blank keyframe" / F7.) */
export function insertBlankKeyframe(layer: DrawingLayer, after: number, ops: CanvasOps): void {
  const at = clampIndex(layer, after);
  layer.cells.splice(at + 1, 0, { kind: "key", canvas: ops.create() });
}

/** Make the cell at `frame` a hold. */
export function setHold(layer: DrawingLayer, frame: number): void {
  layer.cells[frame] = { kind: "hold" };
}

/** Duplicate the keyframe shown at `frame` into a new keyframe right after it. */
export function duplicateKeyframe(layer: DrawingLayer, frame: number, ops: CanvasOps): void {
  insertKeyframe(layer, frame, ops);
}

/** Remove the cell at `frame` on this layer, shifting later cells left. Keeps at least one cell. */
export function deleteFrame(layer: DrawingLayer, frame: number): void {
  if (layer.cells.length <= 1) return;
  if (frame < 0 || frame >= layer.cells.length) return;
  layer.cells.splice(frame, 1);
}

/** The cell track on either side of a materialisation, so a caller's undo can put it back.
 *  Whole-track copies rather than a per-shape diff: both shapes (hold→key, and extend-past-the-end)
 *  collapse into one, and an array of a few hundred REFERENCES costs nothing beside the two
 *  ImageDatas the same command already retains. */
export interface CellTrackChange {
  before: Cell[];
  after: Cell[];
}

/** Install one side of a `CellTrackChange`. Copies, so a later in-place edit of the live track
 *  (a splice from an unrelated op) cannot reach back and corrupt the stored record. */
export function restoreCellTrack(layer: DrawingLayer, cells: Cell[]): void {
  layer.cells = cells.slice();
}

/**
 * Guarantee the cell at `frame` is a keyframe and return its canvas, so a tool can draw on it.
 * - Past the layer's end → extend with holds up to `frame`, then a fresh blank keyframe.
 * - Already a keyframe → returns its canvas unchanged.
 * - A hold over an earlier keyframe → clones that drawing (draw-on-hold = clone & edit on top).
 * - A hold with nothing held → a fresh blank keyframe.
 *
 * Returns the change it made to the cell track (`null` when the frame was already a keyframe).
 * **Every caller must carry that into its undo command.** Materialising a keyframe is a structural
 * mutation, and for years it was captured by nothing: the stroke that caused it was recorded as a
 * pixel command, so undo reverted the pixels and left a blank ◆ behind — and undoing an EARLIER
 * structural entry silently deleted the cell out from under that pixel command, taking the drawing
 * with it. Returning the change (rather than performing the bookkeeping here) keeps the pixels and
 * the cell in ONE undo entry, which is also what the artist expects: one stroke, one ⌘Z.
 */
export function ensureDrawableKeyframe(
  layer: DrawingLayer,
  frame: number,
  ops: CanvasOps,
): { canvas: HTMLCanvasElement; materialized: CellTrackChange | null } {
  if (frame >= layer.cells.length) {
    const before = layer.cells.slice();
    while (layer.cells.length < frame) layer.cells.push({ kind: "hold" });
    const canvas = ops.create();
    layer.cells.push({ kind: "key", canvas });
    return { canvas, materialized: { before, after: layer.cells.slice() } };
  }

  const current = layer.cells[frame];
  if (current.kind === "key") return { canvas: current.canvas, materialized: null };

  const before = layer.cells.slice();
  const ki = resolveKeyframeIndex(layer.cells, frame);
  const held = ki === null ? null : layer.cells[ki];
  const canvas = held && held.kind === "key" ? ops.clone(held.canvas) : ops.create();
  const neu: Cell = { kind: "key", canvas };
  // Draw-on-hold must keep the placement the user is looking at (group ∘ layer ∘ heldCellT).
  // New objects — snapshots share cell refs (gotcha #8).
  if (held && held.kind === "key") {
    if (held.transform) neu.transform = { ...held.transform };
    if (held.transformBox !== undefined)
      neu.transformBox = held.transformBox ? { ...held.transformBox } : held.transformBox;
  }
  layer.cells[frame] = neu;
  return { canvas, materialized: { before, after: layer.cells.slice() } };
}

/**
 * How an inclusive `{start,end}` span reacts to a frame being inserted at / deleted from `at`.
 *
 * A span that STRADDLES `at` grows (insert) or shrinks (delete) rather than moving: the frame lands
 * inside the shot, which is what rotoscoping wants — insert a breakdown mid-action and the reference
 * should cover it, not slide off it. A span entirely after `at` moves; one entirely before is
 * untouched. Deleting never inverts a span: it floors at a single frame.
 */
export function shiftSpan(
  span: { start: number; end: number },
  at: number,
  delta: 1 | -1,
): { start: number; end: number } {
  if (delta === 1) {
    if (span.start >= at) return { start: span.start + 1, end: span.end + 1 };
    if (at <= span.end) return { start: span.start, end: span.end + 1 }; // straddles → grows
    return span;
  }
  if (span.start > at) return { start: span.start - 1, end: span.end - 1 };
  if (at <= span.end) return { start: span.start, end: Math.max(span.start, span.end - 1) };
  return span;
}

/** Where a clip pinned to a single START frame lands. Used for audio and video, which have no `end`
 *  to grow — a video's length is its footage, so a clip straddling `at` simply cannot absorb the
 *  frame and is left alone rather than faked. */
export function shiftStartFrame(startFrame: number, at: number, delta: 1 | -1): number {
  if (delta === 1) return startFrame >= at ? startFrame + 1 : startFrame;
  return startFrame > at ? startFrame - 1 : startFrame;
}

/** Every key of a track, moved through the same `shiftStartFrame` rule the audio and video clips
 *  use — a key is pinned to a single document frame and has no `end` to grow.
 *
 *  Generic over the value for the same reason `withKey` (writing) and `resolveTrack` (reading) are:
 *  a per-property copy of this is exactly how the transform came to ripple while opacity stood
 *  still. `copyKeyframe` (never a hand-written literal) so a field added to `Keyframe` later cannot
 *  be silently dropped here — that is how `interp` was lost once.
 *
 *  The DEDUPE is not optional: on a DELETE a key at `at` and one at `at + 1` both land on `at`, and
 *  `Keyframe.frame` is documented unique within a track. Keys arrive sorted, so writing them in
 *  order into a map keeps the LATER key's value on a collision — it is the one that survives the
 *  deleted frame.
 *
 *  Returns a NEW track (gotcha #8: undo snapshots share layer objects). A property-specific track
 *  (like `TransformTrack`'s `box`) re-attaches these keys at its own depth; see
 *  `shiftTransformTrackFrames`. */
export function shiftTrackFrames<V>(
  track: Track<V>,
  at: number,
  delta: 1 | -1,
  copyValue: (v: V) => V,
): Track<V> {
  const byFrame = new Map<number, Keyframe<V>>();
  for (const k of track.keys) {
    const frame = shiftStartFrame(k.frame, at, delta);
    byFrame.set(frame, copyKeyframe({ ...k, frame }, copyValue));
  }
  return { ...track, keys: [...byFrame.values()].sort((a, b) => a.frame - b.frame) };
}

/** `shiftTrackFrames` for a transform track. The generic shifter knows nothing about `box`, so its
 *  keys are re-attached through `withTrackKeys` — same split, and same reason, as
 *  `withKey`/`withTransformKey` in `document.ts`. */
export function shiftTransformTrackFrames(
  track: TransformTrack,
  at: number,
  delta: 1 | -1,
): TransformTrack {
  const next = shiftTrackFrames(track, at, delta, copyRefTransform);
  return withTrackKeys(track, next.keys as TransformKey[]);
}

/**
 * Shift one layer's OWN track keys — EVERY property, not just the transform — for a frame inserted
 * at / deleted from `at`. The per-layer counterpart of the document-wide ripple.
 *
 * The per-layer frame tools resplice a single layer's cells, so its drawings and its animation would
 * otherwise drift one frame apart per insert, compounding silently. Unlike a reference RANGE (which
 * is document-space and shared with every layer, so a per-layer op has no single correct shift), a
 * track belongs to exactly the layer whose cells just moved, so there IS one — and that argument
 * never had anything to do with WHICH property, which is why this loops `TRACK_PROPS`.
 *
 * Replaces the BAG as well as each track, never mutates either (gotcha #8: the no-mutation rule
 * reaches both levels). Does nothing when the layer has no track, so every call site can call it
 * unconditionally.
 */
export function shiftLayerTrackKeys(layer: Layer, at: number, delta: 1 | -1): void {
  if (!layer.tracks) return;
  const next: LayerTracks = { ...layer.tracks };
  let changed = false;
  for (const prop of TRACK_PROPS) {
    switch (prop) {
      case "transform":
        if (next.transform) {
          next.transform = shiftTransformTrackFrames(next.transform, at, delta);
          changed = true;
        }
        break;
      case "opacity":
        if (next.opacity) {
          next.opacity = shiftTrackFrames(next.opacity, at, delta, copyNumber);
          changed = true;
        }
        break;
      default: {
        // A third property must not be able to arrive here silently: the same gap this function was
        // widened to close (opacity standing still while the transform rippled) would simply reopen.
        const exhaustive: never = prop;
        void exhaustive;
      }
    }
  }
  if (changed) layer.tracks = next;
}

/** Shift everything that lives in DOCUMENT-FRAME space by one frame at `at`: layer transform-track
 *  keys, image reference ranges, video clip offsets, and the audio track. Drawing-layer cells are
 *  handled by the callers, which splice them directly. */
function rippleDocumentFrames(project: Project, at: number, delta: 1 | -1): void {
  for (const layer of project.layers) {
    // Track keys are document-frame space for BOTH layer kinds — without this, everything else
    // shifted while an animated layer's move stayed put, finishing a frame early and compounding
    // with each ripple. Replace, never mutate in place.
    shiftLayerTrackKeys(layer, at, delta);
    if (layer.kind !== "ref") continue;
    if (layer.range) layer.range = shiftSpan(layer.range, at, delta); // replace, never mutate in place
    if (layer.media.type === "video") {
      const dur = layer.media.el.duration;
      if (!Number.isFinite(dur) || dur <= 0) continue;
      const { startFrame } = videoClipLayout(layer.offsetFrames, layer.speed, dur, project.fps);
      const next = shiftStartFrame(startFrame, at, delta);
      if (next !== startFrame)
        layer.offsetFrames = offsetAfterClipDrag(startFrame, next - startFrame, layer.speed);
    }
  }
  // GROUP tracks shift HERE and nowhere else, and that asymmetry with `shiftLayerTrackKeys` is
  // deliberate: a group's transform/opacity is shared by every member, so a PER-LAYER frame tool
  // (which resplices one layer's cells) has no single correct shift for it — the same reason those
  // tools leave a reference RANGE alone. Only a document-wide ripple, which moves every layer at
  // once, has one. Replace the bag and each track, never mutate either (gotcha #8).
  for (const group of project.groups) {
    if (!group.tracks) continue;
    let next = { ...group.tracks };
    let wrote = false;
    for (const prop of GROUP_TRACK_PROPS) {
      switch (prop) {
        case "transform":
          if (next.transform) {
            next = { ...next, transform: shiftTransformTrackFrames(next.transform, at, delta) };
            wrote = true;
          }
          break;
        case "opacity":
          if (next.opacity) {
            next = { ...next, opacity: shiftTrackFrames(next.opacity, at, delta, copyNumber) };
            wrote = true;
          }
          break;
        default: {
          const exhaustive: never = prop;
          void exhaustive;
        }
      }
    }
    if (wrote) group.tracks = next;
  }
  if (project.audio) {
    const next = shiftStartFrame(project.audio.offsetFrames, at, delta);
    if (next !== project.audio.offsetFrames) project.audio.offsetFrames = next;
  }
}

/** Insert a hold at index `at` in EVERY drawing layer, ripple document-space clips, refresh length. */
export function insertFrameAllLayers(project: Project, at: number): void {
  for (const layer of project.layers) {
    if (layer.kind !== "draw") continue;
    const idx = Math.max(0, Math.min(at, layer.cells.length));
    layer.cells.splice(idx, 0, { kind: "hold" });
  }
  rippleDocumentFrames(project, at, 1);
  refreshLength(project);
}

/** Remove index `at` from every drawing layer that has it, ripple document-space clips, keeping ≥1
 *  cell each. */
export function deleteFrameAllLayers(project: Project, at: number): void {
  for (const layer of project.layers) {
    if (layer.kind !== "draw") continue;
    if (layer.cells.length <= 1) continue;
    if (at < 0 || at >= layer.cells.length) continue;
    layer.cells.splice(at, 1);
  }
  rippleDocumentFrames(project, at, -1);
  refreshLength(project);
}

/** The index just past the trailing holds of the key at `keyFrame` — i.e. where `setHoldSpan`
 *  splices. Exported because the timeline needs the SAME boundary to shift a layer's transform keys
 *  around that splice; a second copy of this scan would be free to drift from this one. */
export function holdSpanEnd(layer: DrawingLayer, keyFrame: number): number {
  let next = keyFrame + 1;
  while (next < layer.cells.length && layer.cells[next].kind === "hold") next++;
  return next;
}

/**
 * Set how many frames the keyframe at `keyFrame` occupies before the next key (its hold span).
 * `span` is the total cell count owned by this key (key + trailing holds), floored at 1.
 * Growing inserts holds at the span boundary (pushing following keys right); shrinking removes
 * trailing holds of this span only (pulling following keys left) — it never deletes another key.
 * No-op if `keyFrame` is not a key.
 */
export function setHoldSpan(layer: DrawingLayer, keyFrame: number, span: number): void {
  if (keyFrame < 0 || keyFrame >= layer.cells.length) return;
  if (layer.cells[keyFrame].kind !== "key") return;

  const desired = Math.max(1, Math.floor(span));
  const next = holdSpanEnd(layer, keyFrame);
  const current = next - keyFrame; // cells owned: the key plus its trailing holds
  if (desired === current) return;

  if (desired > current) {
    const holds: Cell[] = Array.from(
      { length: desired - current },
      () => ({ kind: "hold" }) as Cell,
    );
    layer.cells.splice(keyFrame + current, 0, ...holds);
  } else {
    layer.cells.splice(keyFrame + desired, current - desired);
  }
}

/**
 * Move the keyframe at `from` to `to` on the same layer.
 * - Source cell becomes a hold.
 * - If `to` is a hold cell → the key lands there.
 * - If `to` is itself a key → the two keyframes swap.
 * - If `to` is past the end → the layer extends (padding holds) and the key is appended.
 * No-op if `from` is not a key or `to === from`.
 */
export function moveKeyframe(layer: DrawingLayer, from: number, to: number): void {
  if (to === from) return;
  if (from < 0 || from >= layer.cells.length) return;
  const moving = layer.cells[from];
  if (moving.kind !== "key") return;

  if (to >= layer.cells.length) {
    layer.cells[from] = { kind: "hold" };
    while (layer.cells.length < to) layer.cells.push({ kind: "hold" });
    layer.cells.push(moving);
    return;
  }
  if (to < 0) return;

  const target = layer.cells[to];
  if (target.kind === "key") {
    layer.cells[to] = moving;
    layer.cells[from] = target; // swap
  } else {
    layer.cells[to] = moving;
    layer.cells[from] = { kind: "hold" };
  }
}

/** One merged cell: a hold, or a keyframe carrying the resolved below+upper canvases to composite. */
export type MergePlan =
  | { kind: "hold" }
  | { kind: "key"; below: HTMLCanvasElement | null; upper: HTMLCanvasElement | null };

/**
 * Plan merging `upperCells` down onto `belowCells` without touching pixels.
 * A keyframe is produced wherever the *composite the two layers show* changes — i.e. whenever
 * either layer's resolved keyframe changes, which also covers a layer's content STARTING (its
 * first key) and ENDING (past its last cell). The end transition yields a blank keyframe so the
 * merged track goes blank there instead of holding the previous drawing past the layer's end.
 * Each keyframe carries the canvas each layer shows there (or null if blank) to composite.
 * Length = the longer layer; leading all-blank frames stay holds.
 */
export function planMergeDown(belowCells: Cell[], upperCells: Cell[]): MergePlan[] {
  const len = Math.max(belowCells.length, upperCells.length);
  const plan: MergePlan[] = [];
  // Previous frame's (below, upper) resolved keyframe indices. Start at (null, null) = "blank",
  // so a leading blank frame is an unchanged hold and the first content frame becomes a key.
  let prevB: number | null = null;
  let prevU: number | null = null;
  for (let f = 0; f < len; f++) {
    const bki = resolveKeyframeIndex(belowCells, f);
    const uki = resolveKeyframeIndex(upperCells, f);
    const changed = bki !== prevB || uki !== prevU;
    prevB = bki;
    prevU = uki;
    if (!changed) {
      plan.push({ kind: "hold" });
      continue;
    }
    const bResolved = bki === null ? null : belowCells[bki];
    const uResolved = uki === null ? null : upperCells[uki];
    plan.push({
      kind: "key",
      below: bResolved && bResolved.kind === "key" ? bResolved.canvas : null,
      upper: uResolved && uResolved.kind === "key" ? uResolved.canvas : null,
    });
  }
  return plan;
}
