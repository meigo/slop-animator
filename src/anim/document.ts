import { videoClipLayout } from "./clip-layout";

export type Cell =
  | {
      kind: "key";
      canvas: HTMLCanvasElement;
      transform?: RefTransform;
      transformBox?: { x: number; y: number; w: number; h: number } | null;
    }
  | { kind: "hold" };

/** Line-boil settings, persisted per project. */
export interface BoilConfig {
  enabled: boolean;
  amount: number; // displacement px
  cols: number; // noise detail (frequency across the canvas)
  rate: number; // cycle length (on twos/threes)
  weight: number; // line-weight breathing (0..1, in-shader alpha dilate/erode)
  holdsOnly: boolean;
}
export function defaultBoilConfig(): BoilConfig {
  return { enabled: false, amount: 1, cols: 20, rate: 3, weight: 0.4, holdsOnly: true };
}

export interface LayerGroup {
  id: number;
  name: string;
  collapsed: boolean;
  visible: boolean;
  /** Locks every member. DERIVED like `visible` — children's own flags are never touched, so
   *  unlocking the group restores each member's individual state with nothing to snapshot. */
  locked?: boolean;
  transform?: RefTransform;
  transformBox?: { x: number; y: number; w: number; h: number } | null;
}

export interface DrawingLayer {
  kind: "draw";
  id: number;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..100
  boilStrength: number; // per-layer multiplier on boil amount/weight (1 = full, 0 = none)
  groupId: number | null;
  cells: Cell[]; // independent per-layer length; document length = the longest layer
  transform: RefTransform;
  transformTrack?: TransformTrack;
}

export type ReferenceMedia =
  | { type: "image"; el: HTMLImageElement }
  | { type: "video"; el: HTMLVideoElement }
  | { type: "missing"; was: "image" | "video"; name: string };

export interface RefTransform {
  dx: number; // translate from fit-center, document logical px
  dy: number;
  scale: number; // uniform multiplier on the fit size (1 = fit)
  rotation: number; // radians, clockwise, about the center
}

/** How the value travels from one key to the NEXT one. */
export type KeyInterp = "linear" | "hold" | "ease-in" | "ease-out" | "ease-in-out";

export interface TransformKey {
  /** Project frame, >= 0. Unique within a track. */
  frame: number;
  t: RefTransform;
  /**
   * The interpolation of the segment that STARTS at this key — so it describes the curve between
   * this key and the next, which is how an artist thinks about easing ("this move eases out"), and
   * how every animation tool models it. Absent = `linear`.
   *
   * On the KEY rather than the track because a track routinely wants different segments to behave
   * differently: a camera that eases out of rest, holds, then eases into a stop is three segments
   * and one track. The last key's value is unused — nothing follows it.
   *
   * `hold` gives pose-to-pose blocking (no interpolation at all). The eases are quadratic and
   * CLOSED-FORM on purpose: an editable bezier needs a solve or a cached lookup per curve, and
   * `transformAt` is a pure function called once per layer per frame. A custom curve can arrive
   * later as one more member plus a stored control pair — additive, and an unknown value read from
   * a newer file degrades to linear rather than breaking.
   */
  interp?: KeyInterp;
}

export interface TransformTrack {
  /** Sorted by `frame`, never empty. */
  keys: TransformKey[];
  /** Quantise the sampled frame to a multiple of this, so a move updates on 2s/3s like the drawings
   *  do. 1 (or absent) = every frame. Track-wide, unlike `interp`: it is a property of the RHYTHM
   *  the whole move is cut to, not of one segment. */
  sampleEvery?: number;
  /** The pivot box, captured ONCE at track creation and shared by every key. A per-key box would
   *  make the pivot interpolate and warp the motion path between keys, invisibly. */
  box: { x: number; y: number; w: number; h: number } | null;
}

/** Largest `sampleEvery` the transform track UI/store accepts. The Step input's `max` mirrors this
 *  constant rather than being a second number that could drift from it (same shape as
 *  `MAX_GAP`/`clampGap` in `fill-holes.ts` for the Fill tool's gap: a browser accepts a typed value
 *  beyond a number input's `max`, so the clamp must live in the logic, not just the widget). */
export const MAX_SAMPLE_EVERY = 12;

export interface ReferenceLayer {
  kind: "ref";
  id: number;
  name: string;
  visible: boolean;
  opacity: number; // 0..100
  offsetFrames: number; // video time offset in frames; ignored for images
  speed: number; // video playback speed multiplier (1 = real-time; 2 = 2× faster, 0.5 = half); video-only
  audioEnabled: boolean; // video plays its own soundtrack when true (unmuted during playback); video-only, ignored for images
  locked?: boolean; // pins the TRANSFORM (the ref gizmo is live under any tool, so a stray canvas
  //                   drag can nudge an aligned reference); management ops stay allowed
  /** Inclusive project-frame span this ref draws over. ABSENT = always visible (follows the
   *  project's length, so lengthening the animation cannot strand it). Images only — a video's
   *  span is DERIVED from its footage, see refVisibleSpan. */
  range?: { start: number; end: number };
  mediaId?: string; // key into the ref-media IndexedDB store / media/<id> zip entry; absent = not persisted
  mediaMime?: string; // original file MIME (rebuilds the Blob type on restore)
  embedMedia?: boolean; // video-only opt-in: persist/embed the (potentially huge) video bytes
  groupId: number | null;
  media: ReferenceMedia;
  transform: RefTransform;
  transformTrack?: TransformTrack;
}

export type Layer = DrawingLayer | ReferenceLayer;

export const IDENTITY_TRANSFORM: RefTransform = { dx: 0, dy: 0, scale: 1, rotation: 0 };

export function isIdentityTransform(t: RefTransform): boolean {
  return t.dx === 0 && t.dy === 0 && t.scale === 1 && t.rotation === 0;
}

/** Can this layer's CONTENT be edited right now? Drawing layer, unlocked, and visible. Hidden is
 *  read-only for the same reason lock is: edits you cannot see are edits you silently lose (the
 *  pre-2026-08-11 behavior let strokes land invisibly in a hidden layer). Reference layers have no
 *  editable content, so they are never "editable" in this sense. */
export function isLayerEditable(layer: Layer, groups: LayerGroup[]): layer is DrawingLayer {
  return layer.kind === "draw" && !isLayerLocked(layer, groups) && isLayerVisible(layer, groups);
}

/** Why `isLayerEditable` is false — lock wins over hidden (same precedence as the status hint). */
export type LayerEditBlock = "locked" | "hidden" | "not-draw";

export function whyNotEditable(layer: Layer, groups: LayerGroup[]): LayerEditBlock | null {
  if (layer.kind !== "draw") return "not-draw";
  if (isLayerLocked(layer, groups)) return "locked";
  if (!isLayerVisible(layer, groups)) return "hidden";
  return null;
}

/** Where a rasterized reference's keyframes go, so the drawing layer reproduces the ref's visibility
 *  instead of showing on every frame. Returns the frame to put the IMAGE key on (null = the range
 *  starts past the end of the project, so the ref was never visible and the layer stays blank), and
 *  the frame to put a BLANK key on to end it (null = the range runs to the end, nothing to blank).
 *
 *  Every other cell stays a `hold`: a hold with no key at or before it resolves to null and draws
 *  nothing (`resolveKeyframeIndex`), which is what blanks the frames BEFORE the range. */
export function rasterizeKeyframePlan(
  range: { start: number; end: number } | null,
  frameCount: number,
): { imageFrame: number | null; blankFrame: number | null } {
  if (!range) return { imageFrame: 0, blankFrame: null }; // untrimmed: show on every frame (unchanged)
  const start = Math.max(0, range.start);
  if (start >= frameCount) return { imageFrame: null, blankFrame: null };
  const after = range.end + 1;
  return { imageFrame: start, blankFrame: after < frameCount ? after : null };
}

/** Whether `removeLayer` will act. A project must keep at least one drawing layer; reference layers
 *  are always removable, even as the last layer left. */
export function canRemoveLayer(layers: Layer[], id: number): boolean {
  const layer = layers.find((l) => l.id === id);
  if (!layer) return false;
  if (!isDrawingLayer(layer)) return true;
  return layers.filter(isDrawingLayer).length > 1;
}

/** Whether `duplicateLayer` will act — it clones pixels, so only drawing layers duplicate. */
export function canDuplicateLayer(layers: Layer[], id: number): boolean {
  const layer = layers.find((l) => l.id === id);
  return !!layer && isDrawingLayer(layer);
}

/** Why `mergeDown` would refuse, in the order it checks. */
export type MergeDownBlock = "no-layer-below" | "not-drawing" | "read-only" | "animated";

export function whyNotMergeDown(
  layers: Layer[],
  groups: LayerGroup[],
  id: number,
): MergeDownBlock | null {
  const idx = layers.findIndex((l) => l.id === id);
  if (idx <= 0) return "no-layer-below"; // also covers "not found"
  const upper = layers[idx];
  const below = layers[idx - 1];
  if (!isDrawingLayer(upper) || !isDrawingLayer(below)) return "not-drawing";
  // Merging replaces the lower layer's whole cell track, so it is a content edit on both.
  if (!isLayerEditable(upper, groups) || !isLayerEditable(below, groups)) return "read-only";
  // Merging BAKES each layer's transform into its pixels, and a bake only means something for a
  // transform that does not vary — the same reason Apply/Reset refuse. On an animated layer the
  // static `transform` is retained but IGNORED, so baking it would place the pixels where the layer
  // renders at no frame at all, and the track would then vanish with the merged layer.
  if (upper.transformTrack || below.transformTrack) return "animated";
  return null;
}

/** Effective lock: the layer's own flag OR its group's. Derived (never cascaded) — same contract as
 *  `isLayerVisible`, so toggling a group's lock needs no per-child state to save and restore. */
export function isLayerLocked(layer: Layer, groups: LayerGroup[]): boolean {
  if (layer.locked) return true;
  const g = groupOf(layer, groups);
  return !!g?.locked;
}

/** Whether any drawing-layer member of `group` is locked. Group transforms move every member's
 *  rendered content, so a locked member blocks the whole group op (lock = content is immovable). */
export function groupHasLockedLayer(
  group: { id: number; locked?: boolean },
  layers: { kind: string; groupId?: number | null; locked?: boolean }[],
): boolean {
  if (group.locked) return true; // the group itself is pinned
  // Any member, ref included: render.ts applies the group transform to reference layers too, so a
  // locked ref would otherwise be dragged along by a group transform.
  return layers.some((l) => l.groupId === group.id && l.locked === true);
}

/** Exact equality — drag deltas recompute from the grab-time transform, so an untouched drag
 *  ends bit-identical; no epsilon. Used to skip history pushes for no-op drags. */
export function isSameTransform(a: RefTransform, b: RefTransform): boolean {
  return a.dx === b.dx && a.dy === b.dy && a.scale === b.scale && a.rotation === b.rotation;
}

/** Logical base rect for a layer's transform: the full document for a draw layer; the media
 *  contain-fit rect for a ref (null when the ref's media isn't loaded). */
export function transformBaseRect(
  layer: Layer,
  docW: number,
  docH: number,
): { x: number; y: number; w: number; h: number } | null {
  if (layer.kind === "draw") return { x: 0, y: 0, w: docW, h: docH };
  const size = mediaIntrinsicSize(layer.media);
  if (size.w === 0 || size.h === 0) return null;
  return containRect(size.w, size.h, docW, docH);
}

export interface AudioTrack {
  name: string; // file name (display)
  bytes: Uint8Array; // original encoded file -> persisted
  buffer: AudioBuffer; // decoded PCM -> session-only, rebuilt on load
  offsetFrames: number; // start frame (Phase 1: always 0)
  muted: boolean; // Phase 1: always false
  /** Frames of the SOURCE skipped at the head. Absent/0 = from the start. Non-destructive: `bytes`
   *  and `buffer` are never modified, so widening a handle recovers the audio. */
  trimInFrames?: number;
  /** Frames of the SOURCE kept from `trimInFrames`. Absent = to the end of the buffer. */
  trimLenFrames?: number;
}

/** An audio track that was loaded from a save but could NOT be decoded on this device (e.g. a
 *  desktop-Chrome m4a opened in WebKit). Everything `AudioTrack` has except `buffer` — which is
 *  exactly what playback and export need, so this cannot BE a track. It exists only so the encoded
 *  bytes survive the round-trip instead of being destroyed by the first re-save. */
export interface UndecodedAudio {
  name: string;
  bytes: Uint8Array;
  offsetFrames: number;
  muted: boolean;
  trimInFrames?: number;
  trimLenFrames?: number;
}

export function isDrawingLayer(l: Layer): l is DrawingLayer {
  return l.kind === "draw";
}

export interface Project {
  /** User-visible project name; becomes the save/export filename (sanitized). "" = unknown
   *  (old file being opened) — callers fill a fallback before the project goes live. */
  name: string;
  width: number;
  height: number;
  fps: number;
  bgColor: string;
  /** When true, the document has NO opaque background: the editor shows a checkerboard and PNG export
   *  carries alpha. Video export still flattens onto `bgColor`. Absent/undefined = opaque (default). */
  transparentBg?: boolean;
  frameCount: number;
  boil: BoilConfig;
  groups: LayerGroup[];
  layers: Layer[]; // layers[0] = bottom of the stack
  audio: AudioTrack | null;
  /** Set INSTEAD of `audio` when the saved bytes wouldn't decode here. Carried through save so the
   *  only copy of the audio isn't destroyed by opening the project on a device that can't play it;
   *  never both — an `audio` import always clears it. */
  audioUndecoded?: UndecodedAudio | null;
}

/**
 * Index of the keyframe shown at `frame` on this cell track: the nearest "key" cell at
 * or before `frame`. Returns null when `frame` is past this track's end (blank after end)
 * or no key precedes it.
 */
export function resolveKeyframeIndex(cells: Cell[], frame: number): number | null {
  if (frame < 0 || frame >= cells.length) return null;
  for (let i = frame; i >= 0; i--) {
    if (cells[i].kind === "key") return i;
  }
  return null;
}

/** A key cell's own transform (identity when absent / not a key). */
export function cellTransform(cell: Cell): RefTransform {
  return cell.kind === "key" && cell.transform ? cell.transform : IDENTITY_TRANSFORM;
}

/** Quantise `frame` onto a grid anchored at `origin`. Never rounds up: the value shown is always
 *  one the animation actually passed through. */
function quantiseFrame(frame: number, origin: number, every: number): number {
  // A non-finite `every` (a hand-edited or corrupt file) would make EVERY sampled frame NaN, and an
  // all-NaN transform makes the layer vanish rather than degrade. Fall back to "every frame".
  const n = Math.max(1, Math.floor(Number.isFinite(every) ? every : 1));
  return origin + Math.floor((frame - origin) / n) * n;
}

/** Curve the normalised time `u` (0..1). Quadratic: gentle enough to read as easing at the low
 *  frame rates this app works at, without the overshoot a cubic can imply. */
function easeU(u: number, interp: KeyInterp | undefined): number {
  if (interp === "ease-in") return u * u;
  if (interp === "ease-out") return 1 - (1 - u) * (1 - u);
  if (interp === "ease-in-out") return u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
  return u;
}

function lerpTransform(a: RefTransform, b: RefTransform, u: number): RefTransform {
  return {
    dx: a.dx + (b.dx - a.dx) * u,
    dy: a.dy + (b.dy - a.dy) * u,
    scale: a.scale + (b.scale - a.scale) * u,
    // Absolute, NOT shortest-path: the gizmo stores accumulated rotation, so a 720° spin is 4π and
    // has to render as two turns.
    rotation: a.rotation + (b.rotation - a.rotation) * u,
  };
}

/** The layer's transform at `frame`: its static value when there is no track, otherwise the track
 *  resolved (and held outside its key range — a track never extrapolates). */
export function transformAt(layer: Layer, frame: number): RefTransform {
  const track = layer.transformTrack;
  if (!track || track.keys.length === 0) return layer.transform;
  const keys = track.keys;
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (keys.length === 1 || frame <= first.frame) return first.t;
  if (frame >= last.frame) return last.t;

  // `q` is inside [first.frame, last.frame) — quantising only ever moves it earlier, and the
  // out-of-range cases already returned. Quantise BEFORE picking the segment, so the sampled time
  // and the segment it lands in always agree.
  const q = quantiseFrame(frame, first.frame, track.sampleEvery ?? 1);
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].frame <= q) i++;
  const a = keys[i];
  const b = keys[i + 1];
  // The segment's own interpolation — `a` starts it, so `a.interp` describes it.
  if (a.interp === "hold" || q <= a.frame) return a.t;
  if (q >= b.frame) return b.t;
  // Ease the TIME, not the value: `sampleEvery` has already quantised `q`, so a stepped move still
  // steps — it just steps along a curved timing instead of an even one.
  return lerpTransform(a.t, b.t, easeU((q - a.frame) / (b.frame - a.frame), a.interp));
}

/**
 * Copy one key to the depth a track copy needs — the key itself and its nested transform.
 *
 * THE single key-construction site, and that is the point: `interp` was added to `TransformKey`
 * after the first writers were written, and the two that enumerated fields by hand silently dropped
 * it, so one undo flattened every authored curve. A spread cannot drop a field added later, and
 * routing every writer through here means the next field costs nothing.
 */
export function copyTransformKey(k: TransformKey): TransformKey {
  return { ...k, t: { ...k.t } };
}

/** A track carrying `keys`, with every OTHER nested object copied — the returned track must share
 *  no mutable object with the one it was derived from (gotcha #8: undo snapshots share layers, so a
 *  later in-place write anywhere would corrupt the snapshot). Every writer returns through here so
 *  they cannot disagree about that depth. */
export function withTrackKeys(track: TransformTrack, keys: TransformKey[]): TransformTrack {
  return { ...track, box: track.box ? { ...track.box } : null, keys };
}

/** A fresh track holding `t` at frame 0 — that value has been true for every frame, so frame 0 is
 *  its honest home and the first drag at frame N then produces a clean 0→N tween. */
export function createTransformTrack(
  t: RefTransform,
  box: { x: number; y: number; w: number; h: number } | null,
): TransformTrack {
  return { keys: [{ frame: 0, t: { ...t } }], box: box ? { ...box } : null };
}

/** Write a key at `frame`, replacing any key already there. Returns a NEW track: snapshots share
 *  layer objects, so no writer may mutate the one it was given (gotcha #8). */
export function withTransformKey(
  track: TransformTrack,
  frame: number,
  t: RefTransform,
): TransformTrack {
  // A drag rewrites a key's VALUE; its segment easing is a separate choice and must survive, or
  // every nudge would silently reset the curve back to linear. A key CREATED inside an existing
  // segment inherits that segment's curve for exactly the same reason: defaulting to linear would
  // turn a `hold` segment into a tween as a side effect of a value drag. Only a genuinely ENCLOSING
  // segment is inherited — past the last key nothing is being split, so the new segment is linear.
  const existing = track.keys.find((k) => k.frame === frame);
  const last = track.keys[track.keys.length - 1];
  const interp = existing
    ? existing.interp
    : last && frame < last.frame
      ? segmentKeyAt(track, frame)?.interp
      : undefined;
  const keys = track.keys.filter((k) => k.frame !== frame);
  keys.push(copyTransformKey({ frame, t, ...(interp ? { interp } : {}) }));
  keys.sort((a, b) => a.frame - b.frame);
  return withTrackKeys(track, keys);
}

/** Drop the key at `frame`. Returns the SAME object when nothing changes — including the attempt to
 *  remove the last key, since a track is never empty — so callers can skip an empty undo entry. */
export function withoutTransformKey(track: TransformTrack, frame: number): TransformTrack {
  if (track.keys.length <= 1) return track;
  const keys = track.keys.filter((k) => k.frame !== frame);
  return keys.length === track.keys.length ? track : withTrackKeys(track, keys);
}

/**
 * Move the key at `from` to `to`, replacing any key already there.
 *
 * Overwrite rather than refuse, matching how a timeline block move treats the cells it lands on —
 * and it is one undo step away. Returns the SAME object when nothing changes (no key at `from`, or
 * `from === to`), so a caller can skip pushing an empty undo entry.
 */
export function withMovedTransformKey(
  track: TransformTrack,
  from: number,
  to: number,
): TransformTrack {
  if (from === to) return track;
  const moved = track.keys.find((k) => k.frame === from);
  if (!moved) return track;
  const keys = track.keys
    .filter((k) => k.frame !== from && k.frame !== to)
    .concat(copyTransformKey({ ...moved, frame: to }))
    .sort((a, b) => a.frame - b.frame);
  return withTrackKeys(track, keys);
}

/**
 * Write a COPIED key at `frame` — both its value and its segment interpolation.
 *
 * Distinct from `withTransformKey`, which deliberately preserves whatever interpolation the
 * destination already had (a drag rewrites a value, not a curve). A paste is the opposite: the whole
 * key travelled, curve included, so it replaces both.
 */
export function withPastedTransformKey(
  track: TransformTrack,
  frame: number,
  key: { t: RefTransform; interp?: KeyInterp },
): TransformTrack {
  const keys = track.keys
    .filter((k) => k.frame !== frame)
    .concat(copyTransformKey({ ...key, frame }))
    .sort((a, b) => a.frame - b.frame);
  return withTrackKeys(track, keys);
}

/** Set the interpolation of the segment starting at `frame`. Returns the SAME object when there is
 *  no key there or the value is unchanged, so a caller can skip an empty undo entry. */
export function withKeyInterp(
  track: TransformTrack,
  frame: number,
  interp: KeyInterp,
): TransformTrack {
  const k = track.keys.find((x) => x.frame === frame);
  if (!k || (k.interp ?? "linear") === interp) return track;
  return withTrackKeys(
    track,
    track.keys.map((x) => (x.frame === frame ? copyTransformKey({ ...x, interp }) : x)),
  );
}

/** The key whose segment contains `frame` — the latest key at or before it, or null when the
 *  playhead sits before the track starts. This is what an easing control edits. */
export function segmentKeyAt(track: TransformTrack, frame: number): TransformKey | null {
  let found: TransformKey | null = null;
  for (const k of track.keys) {
    if (k.frame <= frame) found = k;
    else break;
  }
  return found;
}

export function hasKeyAt(track: TransformTrack, frame: number): boolean {
  return track.keys.some((k) => k.frame === frame);
}

/** Deep-copy a track (or pass `undefined` through) — keys array, each key's transform, and the box.
 *  THE single copy site: undo snapshots share layer objects, so `cloneLayers`, `restoreStructure`
 *  and `duplicateLayer` all need exactly this depth, and three hand-written copies would drift the
 *  moment a field is added to `TransformTrack`. */
export function cloneTransformTrack(track: TransformTrack | undefined): TransformTrack | undefined {
  return track ? withTrackKeys(track, track.keys.map(copyTransformKey)) : undefined;
}

/** A group's own transform (identity when absent / undefined group). */
export function groupTransform(group: LayerGroup | null | undefined): RefTransform {
  return group && group.transform ? group.transform : IDENTITY_TRANSFORM;
}

/** The resolved key cell shown at `frame` (follows holds), or null. */
export function resolvedKeyCell(
  layer: DrawingLayer,
  frame: number,
): { cell: Extract<Cell, { kind: "key" }>; index: number } | null {
  const ki = resolveKeyframeIndex(layer.cells, frame);
  if (ki === null) return null;
  const cell = layer.cells[ki];
  return cell.kind === "key" ? { cell, index: ki } : null;
}

/** With holds-only boil, a frame that IS its own keyframe renders crisp (un-boiled). */
export function isCrispFrame(cells: Cell[], frame: number, holdsOnly: boolean): boolean {
  return holdsOnly && cells[frame]?.kind === "key";
}

export type FrameOp =
  | { kind: "draw"; layerId: number; keyframeIndex: number; opacity: number }
  | { kind: "ref"; layerId: number; opacity: number };

/**
 * Ordered (bottom→top) list of what each visible layer contributes at `frame`.
 * Reference layers are omitted when `includeReference` is false (used by export and onion).
 */
export function buildFrameDrawList(
  project: Project,
  frame: number,
  includeReference = true,
): FrameOp[] {
  const ops: FrameOp[] = [];
  for (const layer of project.layers) {
    if (!isLayerVisible(layer, project.groups)) continue;
    if (layer.kind === "draw") {
      const ki = resolveKeyframeIndex(layer.cells, frame);
      if (ki === null) continue;
      ops.push({ kind: "draw", layerId: layer.id, keyframeIndex: ki, opacity: layer.opacity });
    } else {
      if (!includeReference) continue;
      if (!isRefVisibleAtFrame(layer, frame, project.fps)) continue;
      ops.push({ kind: "ref", layerId: layer.id, opacity: layer.opacity });
    }
  }
  return ops;
}

/** The group a layer belongs to, or null when ungrouped or its groupId is dangling. */
export function groupOf(layer: Layer, groups: LayerGroup[]): LayerGroup | null {
  if (layer.groupId == null) return null;
  return groups.find((g) => g.id === layer.groupId) ?? null;
}

/** A layer renders only when itself visible and its group (if any) is visible. */
export function isLayerVisible(layer: Layer, groups: LayerGroup[]): boolean {
  if (!layer.visible) return false;
  const g = groupOf(layer, groups);
  return !g || g.visible;
}

/** The inclusive project-frame span a reference draws over, or null for "always visible".
 *  A video's span IS its footage (derived, so there is only ever one span to reason about);
 *  an image has no footage, so its span is whatever the artist trimmed. */
export function refVisibleSpan(
  layer: ReferenceLayer,
  fps: number,
): { start: number; end: number } | null {
  if (layer.media.type === "video") {
    const dur = layer.media.el.duration;
    // Metadata loads lazily (preload="metadata"). With no duration there is no span to derive,
    // and blinking the layer out on first paint would read as a bug, so treat it as always.
    if (!Number.isFinite(dur) || dur <= 0) return null;
    const { startFrame, spanFrames } = videoClipLayout(layer.offsetFrames, layer.speed, dur, fps);
    return { start: startFrame, end: startFrame + spanFrames - 1 };
  }
  // Missing media draws nothing either way; a stored range on a video is ignored rather than an
  // error, so a range survives a re-link to video and comes back on a re-link to an image.
  if (layer.media.type === "missing") return null;
  return layer.range ?? null;
}

export function isRefVisibleAtFrame(layer: ReferenceLayer, frame: number, fps: number): boolean {
  const span = refVisibleSpan(layer, fps);
  return span === null || (frame >= span.start && frame <= span.end);
}

/** Groups that have at least one member layer (drops empties for the panel). */
export function nonEmptyGroups(groups: LayerGroup[], layers: Layer[]): LayerGroup[] {
  const used = new Set(layers.map((l) => l.groupId).filter((id): id is number => id != null));
  return groups.filter((g) => used.has(g.id));
}

/** Document length = the longest drawing layer's cell count (reference layers ignored), floor 1. */
export function documentLength(project: Project): number {
  let max = 1;
  for (const layer of project.layers) {
    if (layer.kind === "draw") max = Math.max(max, layer.cells.length);
  }
  return max;
}

/** Recompute and store the document length into `project.frameCount`. */
export function refreshLength(project: Project): void {
  project.frameCount = documentLength(project);
}

/** Resize a cells array to exactly `n`: pad with holds when growing, slice when shrinking. */
export function resizeCells(cells: Cell[], n: number): Cell[] {
  if (n <= cells.length) return cells.slice(0, n);
  const pad: Cell[] = Array.from({ length: n - cells.length }, () => ({ kind: "hold" }));
  return cells.concat(pad);
}

/** Count keyframes at index >= n across all drawing layers (those a shorten-to-n would drop). */
export function countKeyframesPastLength(project: Project, n: number): number {
  return countKeyframesPastLengthIn(project.layers, n);
}

/** Same count against a bare layer list. A LIVE drag has already truncated the cells by the time it
 *  wants to ask "how many would this drop?", so it must count against the grab-time SNAPSHOT
 *  instead — which is a layer array, not a Project. */
export function countKeyframesPastLengthIn(layers: Layer[], n: number): number {
  let count = 0;
  for (const layer of layers) {
    if (layer.kind !== "draw") continue;
    for (let i = n; i < layer.cells.length; i++) {
      if (layer.cells[i].kind === "key") count++;
    }
  }
  return count;
}

/** Aspect-preserving "contain" fit of a `srcW×srcH` source centred in a `boxW×boxH` box. */
export function containRect(
  srcW: number,
  srcH: number,
  boxW: number,
  boxH: number,
): { x: number; y: number; w: number; h: number } {
  if (srcW <= 0 || srcH <= 0) return { x: 0, y: 0, w: boxW, h: boxH };
  const scale = Math.min(boxW / srcW, boxH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

/** Intrinsic pixel size of reference media (0 until loaded). */
export function mediaIntrinsicSize(media: ReferenceMedia): { w: number; h: number } {
  if (media.type === "image") return { w: media.el.naturalWidth, h: media.el.naturalHeight };
  if (media.type === "video") return { w: media.el.videoWidth, h: media.el.videoHeight };
  return { w: 0, h: 0 }; // missing placeholder — skipped by every zero-size guard
}

/** Devicepixel-ratio-aware blank canvas sized to the document, with a dpr-scaled 2D context. */
export function createCellCanvas(width: number, height: number, dpr: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return canvas;
}

/**
 * Pixel-for-pixel copy of a cell canvas. NOTE: the returned canvas's 2D context is
 * left at the identity transform (not dpr-scaled like createCellCanvas). Callers that
 * draw onto it in logical coordinates must `setTransform(dpr,0,0,dpr,0,0)` first — the
 * editor's stroke path (Canvas.svelte) already does this before every drawStroke.
 */
export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const dst = document.createElement("canvas");
  dst.width = src.width;
  dst.height = src.height;
  dst.getContext("2d")!.drawImage(src, 0, 0);
  return dst;
}

// Monotonic id source for the in-memory session. NOTE: when project save/load
// arrives (a later plan), this will need seeding from the loaded max id to avoid
// colliding with persisted layer ids.
let nextLayerId = 1;

/** Raise the layer-id counter so future ids don't collide with a loaded project's ids. */
export function setMinLayerId(n: number): void {
  if (n > nextLayerId) nextLayerId = n;
}

export function nextId(): number {
  return nextLayerId++;
}

/**
 * Create a drawing layer whose cells all start as `hold`. This is intentional:
 * a new layer is empty until the first stroke, at which point the editor promotes
 * the touched cell to a `key` (see timeline.ensureDrawableKeyframe). So a freshly
 * created project contributes nothing to `buildFrameDrawList` until something is drawn.
 */
export function createDrawingLayer(frameCount: number, name: string): DrawingLayer {
  const id = nextLayerId++;
  return {
    kind: "draw",
    id,
    // REQUIRED, with no id-derived fallback: this function cannot know a good name (it sees no
    // project), and the old default silently leaked the session-wide id into the UI. Callers use
    // `nextLayerName(project.layers)`.
    name,
    visible: true,
    locked: false,
    opacity: 100,
    boilStrength: 1,
    groupId: null,
    cells: Array.from({ length: frameCount }, () => ({ kind: "hold" }) as Cell),
    transform: { ...IDENTITY_TRANSFORM },
  };
}

/** A reference layer defaults to faint (60%) so the artist's ink reads over it. */
export function createReferenceLayer(media: ReferenceMedia, name: string): ReferenceLayer {
  const id = nextLayerId++;
  return {
    kind: "ref",
    id,
    name, // required for the same reason as above — see createDrawingLayer
    visible: true,
    opacity: 60,
    offsetFrames: 0,
    speed: 1,
    audioEnabled: false,
    locked: false,
    groupId: null,
    media,
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
  };
}

/**
 * The next display name in a `<prefix> N` series, scoped to THIS project's layers.
 *
 * Deliberately not derived from the layer id. `nextLayerId` is a session-wide monotonic counter that
 * `setMinLayerId` also advances past every id in a LOADED project — correct for identity, which must
 * never collide with an undo snapshot's or a saved file's — but naming from it meant the number the
 * artist sees kept climbing forever, so a brand-new project's second layer could be "Layer 23".
 * Identity and label are different concerns; only the label belongs to the project.
 *
 * MAX + 1 rather than lowest-unused: deleting "Layer 2" of three and adding one gives "Layer 4", so
 * a name that was just in use is never immediately recycled onto different content. Renamed layers
 * simply drop out of the series, since they no longer match the pattern.
 */
export function nextLayerName(layers: Layer[], prefix = "Layer"): string {
  const pattern = new RegExp(`^${prefix} (\\d+)$`);
  let max = 0;
  for (const l of layers) {
    const m = pattern.exec(l.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix} ${max + 1}`;
}

/** The name to apply when renaming to `input`; falls back to `current` for empty/whitespace input. */
export function resolveLayerName(current: string, input: string): string {
  return input.trim() || current;
}

export function createProject(
  opts?: Partial<Pick<Project, "width" | "height" | "fps" | "bgColor">>,
): Project {
  const frameCount = 1;
  const layer = createDrawingLayer(frameCount, "Layer 1");
  return {
    name: "untitled",
    width: opts?.width ?? 1280,
    height: opts?.height ?? 720,
    fps: opts?.fps ?? 12,
    bgColor: opts?.bgColor ?? "#f4efe2",
    transparentBg: false,
    frameCount,
    boil: defaultBoilConfig(),
    groups: [],
    layers: [layer],
    audio: null,
  };
}
