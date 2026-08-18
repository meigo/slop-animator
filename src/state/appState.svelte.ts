import {
  createProject,
  createCellCanvas,
  cloneCanvas,
  isDrawingLayer,
  canRemoveLayer,
  rasterizeKeyframePlan,
  refVisibleSpan,
  whyNotMergeDown,
  createDrawingLayer,
  createReferenceLayer,
  resolveLayerName,
  refreshLength,
  resizeCells,
  nextId,
  nonEmptyGroups,
  mediaIntrinsicSize,
  isIdentityTransform,
  isSameTransform,
  groupHasLockedLayer,
  isLayerEditable,
  isLayerLocked,
  isLayerVisible,
  IDENTITY_TRANSFORM,
  resolvedKeyCell,
  transformAt,
  opacityAt,
  createTransformTrack,
  copyTracks,
  normalizedTracks,
  layerTransformTrack,
  isLayerAnimated,
  groupTransform,
  groupTransformAt,
  withKey,
  withoutKey,
  hasKeyAt,
  withKeyInterp,
  withTrackKeys,
  copyKeyframe,
  copyTransformKey,
  withPastedTransformKey,
  type KeyInterp,
  type TransformKey,
  type TransformTrack,
  type Track,
  type Keyframe,
  type TrackRef,
  MAX_SAMPLE_EVERY,
  type RefTransform,
  type Project,
  type Layer,
  type DrawingLayer,
  type Cell,
  type AudioTrack,
  type UndecodedAudio,
  type ReferenceLayer,
  type ReferenceMedia,
  type LayerGroup,
} from "../anim/document";
import {
  copyBlock,
  pasteBlockOverwrite,
  pasteBlockInsert,
  deleteBlock,
  moveBlockFrames,
  anyEditableLayer,
  anyEditablePasteTarget,
  type CellBlock,
} from "../anim/timeline-block";
import {
  resolveSelectionRect,
  type SelectionEndpoint,
  type TimelineSelection,
} from "../anim/timeline-selection";
import {
  layerRowSelected,
  trackRowSelected,
  audioRowSelected,
  resolveStaleTrackFocus,
  type ActiveRow,
} from "../anim/active-row";
import { loadImageMedia, releaseReferenceMedia } from "../anim/reference";
import { putMedia } from "../persist/media-store";
import { bumpPersistGeneration } from "../persist/generation";
import { drawReferenceMedia, drawCellComposed } from "../anim/render";
// A state→lib import, which nothing else here does — but the group's base rect lives with the
// content-bounds caches it is built from, and appState is browser-only by construction anyway
// (it touches window/audio at module load, so it is not node-importable either way).
import { groupBoxLogical } from "../lib/cell-ink";
import { audioEngine } from "../audio/engine";
import { History } from "../anim/history";
import type { BrushSettings } from "../core/brush";
import type { BrushType } from "../core/brush-textures";
import { PressureCurve } from "../core/pressure-curve";

/** Brush selection: smooth (perfect-freehand), ink (incremental marker), or a textured stamp type. */
export type BrushKind = "smooth" | "ink" | BrushType;

/** Per-tool stroke settings (brush and eraser each hold one). `isEraser` is NOT stored — it's
 *  derived from the active tool at draw time. */
export type ToolSettings = Omit<BrushSettings, "isEraser"> & {
  sizeRange: number;
  streamline: number;
  brushType: BrushKind;
};
import { planMergeDown, type CanvasOps } from "../anim/timeline";
import { placeContent, type ResizeMode, type Anchor } from "../anim/resize";
import type { Selection } from "../core/selection";
import type { OnionConfig } from "../anim/onion";
import { Playback, effectiveRange, withRangeIn, withRangeOut } from "../anim/playback";
import type { Preferences } from "../persist/preferences";
import { clampTimelineHeight, DEFAULT_TIMELINE_HEIGHT } from "../anim/timeline-layout";
import {
  clampPanelWidth,
  DEFAULT_PANEL_WIDTH,
  clampGutterLabelWidth,
  DEFAULT_GUTTER_LABEL_WIDTH,
} from "../anim/panel-layout";
import { trimHead, trimTail } from "../audio/trim";
import { audioFrameSpan } from "../audio/peaks";
import { trimDeltaToPlayhead, rangeAfterTrim } from "../anim/clip-layout";

export type Tool =
  | "brush"
  | "eraser"
  | "fill"
  | "select"
  | "lasso"
  | "transform"
  | "eyedropper"
  | "deform"
  | "pose";

interface AnimState {
  project: Project;
  playhead: number; // current frame index
  activeLayerId: number;
  tool: Tool;
  transformScope: "frame" | "layer" | "group";
  brush: ToolSettings;
  eraser: ToolSettings;
  fill: { tolerance: number; expand: number; gap: number };
  /** Bumped whenever the display must recomposite (document edits AND view-only ticks). */
  version: number;
  /** Bumped only when the saved project would change. Autosave keys off this, not version. */
  persistTick: number;
  /** Bumped when the pressure curve is edited (it's an imperative widget, not reactive state). */
  curveVersion: number;
  exportOpen: boolean;
  /** An export render is in flight. The frame loop `await`s per frame and `renderFrame` re-reads the
   *  LIVE project each iteration, so a keystroke landing between frames (⌘Z, or Space/Enter/k
   *  restarting playback onto the shared boil GL surface) splices two different documents into one
   *  file. The dialog's backdrop stops pointers only, so the global key handler reads this instead. */
  exportBusy: boolean;
  settingsOpen: boolean;
  sizeDialog: { open: boolean; mode: "new" | "resize" };
  theme: "dark" | "light";
  onion: OnionConfig;
  /** Pose-mesh construction. Session-only, like `onion` — a working preference, not document data. */
  pose: { fillHoles: boolean; gap: number };
  playback: { isPlaying: boolean; loop: boolean; range: { in: number; out: number } | null };
  statusHint: string; // description of the hovered/pressed control (from its title=); "" when idle
  /** STICKY data-safety warning: the startup restore failed (so autosave is disarmed), an autosave
   *  write failed, or an explicit save didn't produce a file. Deliberately NOT `statusHint` — that
   *  field is the hovered control's `title=` and a window-level `pointerdown`/`pointerover` writer
   *  overwrites it on the next pointer move, which is no way to carry a condition that lasts the
   *  session. Same carve-out, same reason, as `poseFillWarning`. Set by App.svelte/Toolbar; cleared
   *  only by a subsequent success. */
  /** While a transform drag is held, the frame it will key — frozen at grab. The playhead can move
   *  under a held drag (playback, or the global arrow keys), and the status hint promising "a drag
   *  keys frame N" has to name the frame that will ACTUALLY be written, or the one mitigation for
   *  auto-key's silence is itself misleading. Null when no drag is in flight. */
  transformDragFrame: number | null;
  /** A copied transform key. A WHOLE `TransformKey`, copied through `copyTransformKey` — not a
   *  hand-listed subset. A field added to `TransformKey` later would be silently dropped by a
   *  field list (exactly how `interp` was lost once), and no type error can catch a missing
   *  OPTIONAL. Its `frame` is carried but deliberately IGNORED on paste — the destination is the
   *  playhead, so a key can be pasted anywhere. Session-only, like the cell and pixel clipboards. */
  transformKeyClipboard: TransformKey | null;
  persistAlert: string;
  /** The startup restore failed, so autosave stayed disarmed for the whole session. A manual save
   *  puts the CURRENT work on disk but does not re-arm it, so it must not retire the warning —
   *  clearing on a save is how the "worked for hours believing they were saved" failure gets back
   *  in through the side door. Written once, by App.svelte's restore catch. */
  autosaveOff: boolean;
  timelineHeight: number; // px height of the resizable timeline panel
  layerPanelWidth: number; // px width of the resizable layer panel
  timelineLabelWidth: number; // px width of the timeline gutter's NAME column (excl. marker column)
  /** WHICH TIMELINE ROW IS SELECTED — the single value every selection highlight reads.
   *
   *  This is deliberately separate from `activeLayerId`, which answers a DIFFERENT question ("what
   *  am I drawing on") and must survive selecting the audio lane, a group track, or a sibling's
   *  track. The rule that keeps them from contradicting each other: no view ever COMBINES them.
   *  Ask `isRowSelected(id)` / `isTrackSelected(...)` / `isAudioRowSelected()` for selection, or
   *  read `activeLayerId` for the draw target — never `id === activeLayerId && !somethingElse`. An
   *  earlier version had each view spell that conjunction out by hand, and forgetting the second
   *  term produced a double highlight and a panel that disagreed with the gutter. */
  activeRow: ActiveRow;
  timelineSelection: TimelineSelection | null;
  cellClipboard: CellBlock | null;
  selectionActive: boolean; // a committed canvas marquee exists (drives ToolOptions Copy/Cut/Delete)
  selectionFloating: boolean; // pixels are lifted/moved (Copy/Cut are off, but Deselect still applies)
  poseActive: boolean; // the pose mesh is built (drives the contextual status hint)
  /** "Fill outlines" found nothing to enclose; "" when it worked or there was nothing to fill.
   *  Deliberately NOT `statusHint`: that field is the hovered/pressed control's `title=` and has a
   *  window-level writer, so the same pointerdown that builds the mesh overwrites it microseconds
   *  later. Rendered in the pose bar, next to the Gap control that remedies it. */
  poseFillWarning: string;
  hasPixelClipboard: boolean; // the pixel selection clipboard has content (drives ToolOptions Paste)
  /** A live gizmo target carries a NON-identity transform, i.e. Reset to fit would do something.
   *  Mirrored from RefTransformGizmo's rAF tick because the scope dispatch it derives from is
   *  gizmo-local — same reason poseActive mirrors meshPose rather than exposing a function. */
  canResetTransform: boolean;
  /** Mirrors `history.canUndo`/`canRedo`. History is a plain class, so its getters are not $state
   *  dependencies — the toolbar buttons would never grey out without this. Kept in sync by the
   *  `history.onChange` hook below, so there is one writer rather than one per push site. */
  canUndo: boolean;
  canRedo: boolean;
}

const project = createProject();

export const state: AnimState = $state({
  project,
  playhead: 0,
  activeLayerId: project.layers[0].id,
  tool: "brush",
  transformScope: "frame",
  brush: {
    size: 4,
    color: "#1a1a1a",
    opacity: 100,
    smoothing: 50,
    drawBehind: false,
    alphaLock: false,
    taper: false,
    sizeRange: 3.0, // full pen pressure → 3× the base width (light pressure → base)
    streamline: 50,
    brushType: "smooth",
  },
  eraser: {
    size: 8,
    color: "#000000", // unused (eraser composites destination-out)
    opacity: 100,
    smoothing: 50,
    drawBehind: false,
    alphaLock: false,
    taper: false,
    sizeRange: 3.0,
    streamline: 50,
    brushType: "smooth",
  },
  fill: { tolerance: 32, expand: 2, gap: 0 },
  version: 0,
  persistTick: 0,
  curveVersion: 0,
  exportOpen: false,
  exportBusy: false,
  settingsOpen: false,
  sizeDialog: { open: false, mode: "new" },
  theme: "dark",
  onion: {
    enabled: false,
    prev: 1,
    next: 1,
    allLayers: false,
    tintPrev: "#e0526a", // warm red
    tintNext: "#3f7fd0", // cool blue
  },
  pose: { fillHoles: true, gap: 0 },
  playback: { isPlaying: false, loop: true, range: null },
  statusHint: "",
  transformDragFrame: null,
  transformKeyClipboard: null,
  persistAlert: "",
  autosaveOff: false,
  timelineHeight: DEFAULT_TIMELINE_HEIGHT,
  layerPanelWidth: DEFAULT_PANEL_WIDTH,
  timelineLabelWidth: DEFAULT_GUTTER_LABEL_WIDTH,
  activeRow: { kind: "layer", id: project.layers[0].id },
  timelineSelection: null,
  cellClipboard: null,
  selectionActive: false,
  selectionFloating: false,
  poseActive: false,
  poseFillWarning: "",
  hasPixelClipboard: false,
  canResetTransform: false,
  canUndo: false,
  canRedo: false,
});

export const history = new History();
history.onChange = () => {
  state.canUndo = history.canUndo;
  state.canRedo = history.canRedo;
};

/**
 * Document raster scale: device pixels per logical pixel, for cell canvases, the display and
 * scratch canvases, hit-testing, and export. Deliberately FIXED AT 1 — it is not read from
 * `devicePixelRatio` — because this app is low-framerate monochrome ink where hi-res is a non-goal,
 * and the constant sets three costs at once: per-cell RAM (at 1920×1080, 8.3 MB here vs 33.2 MB at
 * 2×), the PNG encode work autosave repeats over every key cell, and export dimensions. At 2× on
 * iPad a "1920×1080" project also exported 4K, so output size depended on which device rendered it.
 * Trade: lines are softer past 100% zoom on a Retina display. See
 * docs/superpowers/specs/2026-07-28-ipad-memory-and-pwa-design.md.
 */
export const DPR = 1;

/** Real canvas operations for timeline.ts, sized to the active document. */
export const canvasOps: CanvasOps = {
  create: () => createCellCanvas(state.project.width, state.project.height, DPR),
  clone: (src) => cloneCanvas(src),
};

export function activeLayer() {
  return state.project.layers.find((l) => l.id === state.activeLayerId) ?? state.project.layers[0];
}

/** The stroke settings for the active drawing tool (eraser has its own; everything else uses brush). */
export function activeStroke(): ToolSettings {
  return state.tool === "eraser" ? state.eraser : state.brush;
}

/**
 * Snapshot of the document STRUCTURE (not pixels): the layer stack, each drawing layer's
 * cell track, plus frame count and cursor. Canvas references are SHARED — structural edits
 * never touch pixels, so undo only needs to restore which cells/layers exist where.
 */
export interface StructSnapshot {
  layers: Layer[];
  groups: LayerGroup[];
  frameCount: number;
  width: number;
  height: number;
  activeLayerId: number;
  playhead: number;
  /** The audio track itself, by REFERENCE — never a copy. A copy would clone the decoded PCM into
   *  every snapshot; a reference costs one pointer, exactly as `layers` already references canvases.
   *  Keeping it alive after a remove is the point: undo has to be able to hand the buffer back. */
  audio: AudioTrack | null;
  /** The track's start frame, captured SEPARATELY as a number even though `audio` is above — and
   *  that duplication is load-bearing. The lane drag writes `audio.offsetFrames` IN PLACE on the
   *  shared object, so `snap.audio.offsetFrames` tracks the live value and cannot serve as a
   *  before-state (gotcha #8). This immutable copy is what actually restores. */
  audioOffsetFrames: number | null;
  /** Same story as the offset: `muted` is written in place by the toggle, so the shared `audio`
   *  object cannot carry its before-state. Captured separately for the same reason. */
  audioMuted: boolean | null;
  /** Trim, captured as scalars for the same reason the offset is: both are written in place on the
   *  shared `audio` object, so the reference cannot carry their before-state. */
  audioTrimInFrames: number | null;
  audioTrimLenFrames: number | null;
  /** Audio whose bytes this device could not decode, held by REFERENCE for the same reason `audio`
   *  is: it carries the only copy of those bytes, and the save path writes them back verbatim so a
   *  device that cannot decode never destroys them. It MUST be captured, because both writers that
   *  clear it (`setAudioTrack`/`removeAudioTrack`) run inside `commitStructural` — without it,
   *  import-then-undo left `audio` null AND `audioUndecoded` null, and the next autosave wrote a
   *  project with no audio at all. Nothing writes its fields in place (it has no UI), so unlike the
   *  decoded track it needs no separate scalars. */
  audioUndecoded: UndecodedAudio | null;
}
function cloneLayers(layers: Layer[]): Layer[] {
  // Shallow per-layer clone with a fresh cells array (same cell + canvas refs), so later
  // in-place mutations (splice/replace) can't corrupt a stored snapshot. Deep-copy transform
  // so a future in-place field write cannot corrupt in-flight snapshots (groups already do this).
  // The track BAG is deep-copied for the same reason, down to each key's value: a snapshot that
  // shared the keys array would be rewritten by the next key the artist drags in. `copyTracks` is
  // the single copy site (shared with restoreStructure/duplicateLayer), and it copies at BOTH
  // levels — the bag object and every track in it.
  return layers.map((l) =>
    l.kind === "draw"
      ? {
          ...l,
          cells: l.cells.slice(),
          transform: { ...l.transform },
          tracks: l.tracks ? copyTracks(l.tracks) : undefined,
        }
      : {
          ...l,
          transform: { ...l.transform },
          range: l.range ? { ...l.range } : undefined,
          tracks: l.tracks ? copyTracks(l.tracks) : undefined,
        },
  );
}
function snapshotStructure(): StructSnapshot {
  return {
    layers: cloneLayers(state.project.layers),
    groups: state.project.groups.map((g) => ({
      ...g,
      transform: g.transform ? { ...g.transform } : undefined,
      transformBox: g.transformBox ? { ...g.transformBox } : g.transformBox,
      // A bare spread would SHARE the bag with the live group — the same hazard the layer path
      // has always guarded against, reaching groups for the first time now that they can carry a track.
      tracks: g.tracks ? copyTracks(g.tracks) : undefined,
    })),
    frameCount: state.project.frameCount,
    width: state.project.width,
    height: state.project.height,
    activeLayerId: state.activeLayerId,
    playhead: state.playhead,
    audio: state.project.audio,
    audioOffsetFrames: state.project.audio?.offsetFrames ?? null,
    audioMuted: state.project.audio?.muted ?? null,
    audioTrimInFrames: state.project.audio?.trimInFrames ?? null,
    audioTrimLenFrames: state.project.audio?.trimLenFrames ?? null,
    audioUndecoded: state.project.audioUndecoded ?? null,
  };
}
function restoreStructure(s: StructSnapshot) {
  // Restore the layer set/order and each drawing layer's cells, but keep view-props
  // (visible/opacity/locked/name) from the LIVE layer when it still exists — those are
  // deliberately not part of undo, so an unrelated structural undo must not revert them.
  const liveById = new Map(state.project.layers.map((l) => [l.id, l]));
  state.project.layers = s.layers.map((snap) => {
    const live = liveById.get(snap.id);
    if (live && live.kind === snap.kind) {
      live.groupId = snap.groupId; // group membership is structural (reorder/regroup), undoable — not a view-prop
      if (live.kind === "draw" && snap.kind === "draw") {
        live.cells = snap.cells.slice();
      }
      live.transform = { ...snap.transform }; // undoable for draw AND ref layers (drag undo); visibility/opacity/name stay live
      // Structural: they decide what renders at every frame, exactly like `range` does for a ref.
      // `opacity` stays a view-prop above (an unrelated undo must not revert a slider nudge) —
      // EXCEPT when the animation state itself is what is being restored. "Stop animating opacity"
      // bakes the resolved value into the static field inside commitStructural, and the static
      // slider path pushes no command, so nothing else could ever put that number back: undoing the
      // bake left the track correctly gone and the layer sitting at whatever frame it stopped on.
      // The transform twin needs no such term only because `transform` is restored unconditionally.
      if (!!snap.tracks?.opacity !== !!live.tracks?.opacity) live.opacity = snap.opacity;
      live.tracks = snap.tracks ? copyTracks(snap.tracks) : undefined;
      if (live.kind === "ref" && snap.kind === "ref") {
        // A ref's visible span is structural (it decides what renders), so trim/slide is undoable.
        live.range = snap.range ? { ...snap.range } : undefined;
        // …and so is WHERE the clip starts: `rippleDocumentFrames` shifts `offsetFrames` inside
        // commitStructural, so leaving it out let a ripple-insert + undo drift an aligned video one
        // frame later every time, silently. Third member of the range/audioOffsetFrames trio.
        live.offsetFrames = snap.offsetFrames;
      }
      return live;
    }
    // Layer was removed, OR its kind changed since the snapshot (e.g. rasterize ref→draw, same id) →
    // bring back the snapshot's clone wholesale so undo restores the original layer.
    return snap.kind === "draw" ? { ...snap, cells: snap.cells.slice() } : { ...snap };
  });
  const liveGroupsById = new Map(state.project.groups.map((g) => [g.id, g]));
  state.project.groups = s.groups.map((snap) => {
    const live = liveGroupsById.get(snap.id);
    if (live) {
      live.transform = snap.transform ? { ...snap.transform } : undefined;
      live.transformBox = snap.transformBox ? { ...snap.transformBox } : snap.transformBox;
      live.tracks = snap.tracks ? copyTracks(snap.tracks) : undefined;
      // name/collapsed/visible are view-props — keep `live` values (mirror layer pattern).
      return live;
    }
    return {
      ...snap,
      transform: snap.transform ? { ...snap.transform } : undefined,
      transformBox: snap.transformBox ? { ...snap.transformBox } : snap.transformBox,
      tracks: snap.tracks ? copyTracks(snap.tracks) : undefined,
    };
  });
  state.project.frameCount = s.frameCount;
  if (s.width !== state.project.width || s.height !== state.project.height)
    state.cellClipboard = null; // clipboard canvases belong to the old document size; drop on a size-changing undo/redo
  state.project.width = s.width;
  state.project.height = s.height;
  state.activeLayerId = s.activeLayerId;
  // The selected ROW follows the restored layer — but only when a LAYER row is selected. Row
  // selection is session state, and undo must not move it BETWEEN rows: resetting it
  // unconditionally silently dropped an audio-lane selection on any unrelated undo, so the next
  // "trim to playhead" retargeted from the audio clip to a layer. A track focus whose owner
  // survived this undo stays; a track the undo just removed falls back to the draw target.
  if (state.activeRow.kind === "layer") {
    state.activeRow = { kind: "layer", id: s.activeLayerId };
  } else {
    state.activeRow = resolveStaleTrackFocus(state.activeRow, state.project, state.activeLayerId);
  }
  state.playhead = s.playhead;
  // Restore the track itself (import/remove are undoable), then its offset from the immutable
  // number — `s.audio.offsetFrames` is the LIVE value, since the lane drag writes it in place on
  // this same shared object. Re-point the engine only when the track identity actually changed:
  // setTrack() stops playback, so calling it on every undo would kill playback on unrelated edits.
  const audioChanged = state.project.audio !== s.audio;
  const wasMuted = state.project.audio?.muted ?? null;
  state.project.audio = s.audio;
  // Undecodable bytes are restored alongside the track, never left behind: an import or a remove
  // clears them INSIDE commitStructural, so undoing one has to hand them back or the only copy is
  // gone at the next autosave. `audio` and `audioUndecoded` are never both set, and restoring both
  // from the same snapshot preserves that.
  state.project.audioUndecoded = s.audioUndecoded;
  if (state.project.audio) {
    if (s.audioOffsetFrames !== null) state.project.audio.offsetFrames = s.audioOffsetFrames;
    if (s.audioMuted !== null) state.project.audio.muted = s.audioMuted;
    state.project.audio.trimInFrames = s.audioTrimInFrames ?? undefined;
    state.project.audio.trimLenFrames = s.audioTrimLenFrames ?? undefined;
  }
  // The $state PROXY read back after assignment, never `s.audio` raw — a raw ref left the engine
  // reading offsetFrames 0 forever (gotcha #11).
  if (audioChanged) audioEngine.setTrack(state.project.audio);
  // Mute is not just a flag, it gates the OUTPUT — mirror toggleAudioMute here or an undo restores
  // the icon while the sound carries on. `syncTo` cannot help: it only acts when a source already
  // exists, so an un-mute has to explicitly restart playback.
  const nowMuted = state.project.audio?.muted ?? null;
  if (nowMuted !== wasMuted) {
    if (nowMuted) audioEngine.stop();
    else if (state.playback.isPlaying) audioEngine.play(state.playhead, state.project.fps);
  }
  state.version++;
}

/** Begin a multi-event structural edit (e.g. a drag): capture the before-state. */
export function beginStructuralEdit(): StructSnapshot {
  return snapshotStructure();
}

/** Finish a structural edit started with beginStructuralEdit: push one undo command. */
export function commitStructuralEdit(before: StructSnapshot): void {
  const after = snapshotStructure();
  history.push({
    undo: () => restoreStructure(before),
    redo: () => restoreStructure(after),
  });
}

/**
 * Run a synchronous structural mutation and make it undoable by snapshotting the document
 * structure before and after. Use for layer- and frame-level edits; pixel edits keep their
 * own getImageData/putImageData commands. Structural and pixel commands share the same undo
 * stack and interleave correctly because snapshots keep the same canvas references.
 */
export function commitStructural(mutate: () => void): void {
  const before = beginStructuralEdit();
  mutate();
  bump(); // refresh document length + clamp playhead, then bump version
  state.timelineSelection = null; // any structural edit can invalidate stored endpoints
  commitStructuralEdit(before);
}

/** Append a layer (drawing or reference) on top and make it active. */
export function addLayerToProject(layer: Layer) {
  commitStructural(() => {
    const active = state.project.layers.find((l) => l.id === state.activeLayerId);
    if (active && active.groupId != null) {
      // Active layer is in a group → the new layer joins that group, inserted just above the active
      // one (keeps the group's contiguous run intact).
      layer.groupId = active.groupId;
      state.project.layers.splice(state.project.layers.indexOf(active) + 1, 0, layer);
    } else {
      state.project.layers.push(layer); // ungrouped → top of the stack (existing behavior)
    }
    setActiveLayer(layer.id);
  });
}

/** Mint a mediaId and store the bytes (write-once). On failure (e.g. iPad quota) the layer keeps
 *  the id — a dangling id is benign on restore (getMedia → undefined → placeholder), and keeping
 *  it lets an explicit zip save still embed the media from the live element. So the reference
 *  won't survive a reload, but explicit saves still embed it. */
export function persistReferenceMedia(layer: ReferenceLayer, blob: Blob, name?: string): void {
  const id = crypto.randomUUID();
  layer.mediaId = id;
  layer.mediaMime = blob.type || (layer.media.type === "video" ? "video/mp4" : "image/png");
  void putMedia(id, { blob, mime: layer.mediaMime, name: name ?? layer.name }).catch(() => {
    state.statusHint = "Storage full — this reference won't survive a reload";
  });
}

/** Paste a clipboard image blob as a new, fully-opaque image reference layer (auto-selected). */
export async function pasteImageReference(blob: Blob): Promise<void> {
  // loadImageMedia reads file.name only for its error message — wrap the blob in a File.
  const file = new File([blob], "Pasted image", { type: blob.type || "image/png" });
  const media = await loadImageMedia(file);
  const layer = createReferenceLayer(media, "Pasted image");
  persistReferenceMedia(layer, blob, "Pasted image");
  layer.opacity = 100; // content, not a dimmed trace underlay (ref default is 60)
  addLayerToProject(layer);
}

/** Replace an image reference layer in place with a drawing layer baked at its current transform. */
export function rasterizeReference(layerId: number): void {
  // Guards ABOVE the commit — returning from the mutate callback still leaves commitStructural
  // pushing a before/after pair that are identical, i.e. a dead undo step.
  const layers = state.project.layers;
  const idx = layers.findIndex((l) => l.id === layerId);
  const ref = layers[idx];
  if (!ref || ref.kind !== "ref" || ref.media.type !== "image") return; // image refs only
  if (mediaIntrinsicSize(ref.media).w === 0) return; // media not loaded
  // Rasterizing bakes ONE placement into pixels, which only means something for a transform that
  // does not vary — same refusal as Apply/Reset. `drawReferenceMedia` below is deliberately called
  // without a frame (it omits the group transform on purpose), so on an animated ref it would bake
  // the retained-but-ignored static transform: pixels at a position the layer never rendered at.
  // ANY property, through the shared predicate rather than a hand-written list of them:
  // `animateLayerOpacity` has no `kind` guard and the panel offers Animate on reference rows, so a
  // ref can carry an opacity track — and `buildFrameDrawList` resolves it. Keeping only
  // `ref.opacity` below would bake in the seed value the layer may render at on no frame, and hand
  // the new drawing layer no track at all.
  if (isLayerAnimated(ref)) {
    state.statusHint = "Layer is animated — Stop animating first";
    return;
  }
  commitStructural(() => {
    const cell = createCellCanvas(state.project.width, state.project.height, DPR);
    const ctx = cell.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0); // helper draws in device pixels
    drawReferenceMedia(ctx, ref, state.project.width, state.project.height, DPR);

    // Replace in place: keep id/name/group/opacity/visibility. Off-canvas pixels are clipped (the
    // accepted commit trade). The keyframes reproduce the ref's VISIBILITY rather than showing on
    // every frame: a trimmed ref used to reappear on the frames it had been trimmed away from,
    // because a lone key at frame 0 resolves forward forever.
    const dl = createDrawingLayer(state.project.frameCount, ref.name);
    dl.id = ref.id;
    dl.groupId = ref.groupId;
    dl.opacity = ref.opacity;
    dl.visible = ref.visible;
    const plan = rasterizeKeyframePlan(
      refVisibleSpan(ref, state.project.fps),
      state.project.frameCount,
    );
    if (plan.imageFrame !== null) dl.cells[plan.imageFrame] = { kind: "key", canvas: cell };
    // A BLANK keyframe ends the run; frames before the range stay leading holds, which resolve to
    // nothing on their own.
    if (plan.blankFrame !== null)
      dl.cells[plan.blankFrame] = {
        kind: "key",
        canvas: createCellCanvas(state.project.width, state.project.height, DPR),
      };
    layers[idx] = dl;
    setActiveLayer(dl.id);
  });
}

/** Remove a layer by id, keeping at least one drawing layer. */
export function removeLayer(id: number) {
  const layers = state.project.layers;
  const idx = layers.findIndex((l) => l.id === id);
  if (idx === -1) return;
  if (!canRemoveLayer(layers, id)) return; // keep one drawing layer
  // `setActiveLayer` below banks a live lift AFTER the layer is gone, i.e. into the removed layer's
  // canvas — so undoing twice brought the layer back with the lifted region still punched out.
  liftGuard.discard?.();
  commitStructural(() => {
    const removed = layers[idx];
    layers.splice(idx, 1);
    if (removed.kind === "ref" && removed.media.type === "video") removed.media.el.pause();
    if (state.activeLayerId === id) {
      const firstDrawing = layers.find(isDrawingLayer);
      if (firstDrawing) setActiveLayer(firstDrawing.id);
    }
  });
  // A focused track on the removed layer (or left pointing at a now-missing owner) must fall back.
  state.activeRow = resolveStaleTrackFocus(state.activeRow, state.project, state.activeLayerId);
}

/** Reorder the layer stack to exactly `ordered` (bottom→top) and repaint. */
export function reorderLayers(ordered: Layer[]) {
  commitStructural(() => {
    state.project.layers = ordered;
  });
}

/** Duplicate a drawing layer (cloning every key cell's canvas) above it, and make it active. */
export function duplicateLayer(id: number) {
  const layers = state.project.layers;
  const idx = layers.findIndex((l) => l.id === id);
  if (idx === -1) return;
  const src = layers[idx];
  if (!isDrawingLayer(src)) return; // only drawing layers duplicate (clone pixels); see canDuplicateLayer
  // Every key canvas is cloned below, and `setActiveLayer(dup.id)` then banks any live lift back
  // into the SOURCE — so the copy would be missing exactly the pixels that were floating.
  liftGuard.discard?.();
  commitStructural(() => {
    const dup = createDrawingLayer(state.project.frameCount, `${src.name} copy`);
    dup.visible = src.visible;
    dup.locked = src.locked;
    dup.opacity = src.opacity;
    dup.boilStrength = src.boilStrength; // match the source's line-boil strength
    dup.groupId = src.groupId; // keep the copy in the source's group (inserted adjacent → run stays contiguous)
    dup.transform = { ...src.transform }; // copy renders at the same placement as the source
    // …and the same MOTION: without this the copy of an animated layer came back static, parked at
    // the ignored static transform (a position it may never have rendered at). Same deep copy the
    // undo snapshot uses — one helper, so the two cannot drift.
    dup.tracks = src.tracks ? copyTracks(src.tracks) : undefined;
    dup.cells = src.cells.map(
      (c): Cell =>
        c.kind === "key"
          ? {
              kind: "key",
              canvas: cloneCanvas(c.canvas),
              transform: c.transform ? { ...c.transform } : undefined, // keep per-cell transforms
              transformBox: c.transformBox ? { ...c.transformBox } : c.transformBox,
            }
          : { kind: "hold" },
    );
    layers.splice(idx + 1, 0, dup);
    setActiveLayer(dup.id);
  });
}

/** Flatten a key cell through (layerT ∘ its own cellT) into fresh pixels at identity. */
function bakeCell(
  cell: Extract<Cell, { kind: "key" }>,
  layerT: RefTransform,
): Extract<Cell, { kind: "key" }> {
  const W = state.project.width,
    H = state.project.height;
  const cellT = cell.transform ?? IDENTITY_TRANSFORM;
  if (isIdentityTransform(layerT) && isIdentityTransform(cellT)) return cell;
  const canvas = createCellCanvas(W, H, DPR);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const boxDev = isIdentityTransform(cellT)
    ? { x: 0, y: 0, w: W * DPR, h: H * DPR }
    : {
        x: cell.transformBox!.x * DPR,
        y: cell.transformBox!.y * DPR,
        w: cell.transformBox!.w * DPR,
        h: cell.transformBox!.h * DPR,
      };
  drawCellComposed(ctx, cell.canvas, W * DPR, H * DPR, layerT, cellT, boxDev, DPR);
  return { kind: "key", canvas };
}

/** Bake a draw layer's transform into its cells and reset to identity. No commit (caller wraps it). */
function bakeLayerTransform(layer: DrawingLayer): void {
  layer.cells = layer.cells.map((c) => (c.kind === "key" ? bakeCell(c, layer.transform) : c));
  layer.transform = { ...IDENTITY_TRANSFORM };
}

export function applyLayerTransform(layerId: number): void {
  const layer = state.project.layers.find((l) => l.id === layerId);
  // Baking pixels, or resetting to fit, only means something for a transform that does not vary.
  // Silent refusal matches the locked-layer convention; the status hint explains it.
  if (layer && layerTransformTrack(layer)) {
    state.statusHint = "Layer is animated — Stop animating first";
    return;
  }
  if (layer?.kind === "draw" && !isLayerEditable(layer, state.project.groups)) return; // locked/hidden = content is immutable
  if (!layer || layer.kind !== "draw" || isIdentityTransform(layer.transform)) return;
  liftGuard.discard?.(); // bake replaces every key canvas
  commitStructural(() => bakeLayerTransform(layer));
}

export function resetLayerTransform(layerId: number): void {
  const layer = state.project.layers.find((l) => l.id === layerId);
  // Baking pixels, or resetting to fit, only means something for a transform that does not vary.
  // Silent refusal matches the locked-layer convention; the status hint explains it.
  if (layer && layerTransformTrack(layer)) {
    state.statusHint = "Layer is animated — Stop animating first";
    return;
  }
  if (!layer || isIdentityTransform(layer.transform)) return;
  if (layer.kind === "draw" && !isLayerEditable(layer, state.project.groups)) return; // locked/hidden = content is immutable
  commitStructural(() => {
    layer.transform = { ...IDENTITY_TRANSFORM };
  });
}

export function applyCellTransform(layerId: number, frame: number): void {
  const layer = state.project.layers.find((l) => l.id === layerId);
  if (layer?.kind === "draw" && !isLayerEditable(layer, state.project.groups)) return; // locked/hidden = content is immutable
  if (!layer || layer.kind !== "draw") return;
  const rk = resolvedKeyCell(layer, frame);
  if (!rk || !rk.cell.transform || isIdentityTransform(rk.cell.transform)) return;
  liftGuard.discard?.(); // bake replaces the cell canvas — a live lift would write to the detached one
  commitStructural(() => {
    layer.cells[rk.index] = bakeCell(rk.cell, { ...IDENTITY_TRANSFORM });
  });
}

export function resetCellTransform(layerId: number, frame: number): void {
  const layer = state.project.layers.find((l) => l.id === layerId);
  if (!layer || !isLayerEditable(layer, state.project.groups)) return; // locked/hidden = content is immutable
  const rk = resolvedKeyCell(layer, frame);
  if (!rk) return;
  const t = rk.cell.transform;
  if ((!t || isIdentityTransform(t)) && !rk.cell.transformBox) return;
  commitStructural(() => {
    // Replace the cell (don't mutate it in place): snapshots share cell object refs, so an in-place
    // edit would corrupt the before-snapshot and make undo a no-op. Drop the transform, keep the canvas.
    layer.cells[rk.index] = { kind: "key", canvas: rk.cell.canvas };
  });
}

export function resetGroupTransform(groupId: number): void {
  const g = state.project.groups.find((x) => x.id === groupId);
  if (!g) return;
  // Resetting to fit only means something for a transform that does not vary — on an animated
  // group the static field is retained but IGNORED, so clearing it would change nothing on screen.
  // Silent-with-a-hint, exactly as `resetLayerTransform` refuses an animated layer.
  if (g.tracks?.transform) {
    state.statusHint = "Group is animated — Stop animating first";
    return;
  }
  if (groupHasLockedLayer(g, state.project.layers)) return; // a locked member pins the whole group
  if ((!g.transform || isIdentityTransform(g.transform)) && !g.transformBox) return;
  commitStructural(() => {
    g.transform = { ...IDENTITY_TRANSFORM };
    g.transformBox = null;
  });
}

/** Show a layer's property rows. Both LAYER Animate entry points call this, because `Stop
 *  animating` leaves `tracksCollapsed` behind: without it a later Animate creates a track whose row
 *  never appears — only the collapsed chevron comes back, and the artist is looking for a row that
 *  is there but folded. A view-prop, so `restoreStructure` keeps it live and undo does not re-fold.
 *  `animateGroup` unfolds too, but writes `collapsed` directly — see the reasoning at that line. */
function unfoldTracks(layer: Layer): void {
  layer.tracksCollapsed = false;
}

/** Start animating a layer: its current static transform becomes the key at frame 0. */
export function animateLayer(layerId: number): void {
  const l = state.project.layers.find((x) => x.id === layerId);
  if (!l || layerTransformTrack(l) || isLayerLocked(l, state.project.groups)) return;
  if (!isLayerVisible(l, state.project.groups)) return;
  commitStructural(() => {
    // `box: null`, not a frozen `transformBaseRect` — the freeze-the-pivot rule is for
    // CONTENT-DERIVED boxes (a cell's/group's, built from content bounds, which drift as you draw).
    // A layer's base rect (doc rect / media contain-fit) never drifts from drawing more — the gizmo
    // already recomputes it live for the static case, so freezing here would be a second convention
    // for the same quantity — and `resizeProject` never updates a frozen box, so one would silently
    // describe the OLD document size after a resize. `box` stays on `TransformTrack` for a future
    // group-level track, where it genuinely is content-derived.
    // Replaces the BAG as well as the track — gotcha #8 now applies at two levels, and the
    // spread keeps any sibling track this layer already carries.
    l.tracks = { ...l.tracks, transform: createTransformTrack(l.transform, null) };
    unfoldTracks(l);
  });
  // Session focus, not undoable — after the commit, never inside it.
  selectTrack({ owner: "layer", id: layerId, prop: "transform" });
}

/** Stop animating: bake what is on screen NOW into the static transform, then drop the track.
 *  WYSIWYG — the alternative (restoring the pre-animation value) would undo work invisibly. */
export function removeLayerAnimation(layerId: number): void {
  const l = state.project.layers.find((x) => x.id === layerId);
  if (!l || !layerTransformTrack(l) || isLayerLocked(l, state.project.groups)) return;
  if (!isLayerVisible(l, state.project.groups)) return;
  const resolved = transformAt(l, state.playhead);
  commitStructural(() => {
    l.transform = { ...resolved };
    l.tracks = normalizedTracks({ ...l.tracks, transform: undefined });
  });
  // Do not call setActiveLayer — that would also reset transformScope when the layer is ungrouped.
  state.activeRow = resolveStaleTrackFocus(state.activeRow, state.project, state.activeLayerId);
}

/** Start animating a layer's opacity: its current static value becomes the key at frame 0. Same
 *  shape as `animateLayer` above, one property over. */
export function animateLayerOpacity(layerId: number): void {
  const l = state.project.layers.find((x) => x.id === layerId);
  if (!l || l.tracks?.opacity || isLayerLocked(l, state.project.groups)) return;
  if (!isLayerVisible(l, state.project.groups)) return;
  commitStructural(() => {
    // Replaces the BAG as well as the track (gotcha #8), keeping any sibling track this layer
    // already carries — same convention `animateLayer` uses for the transform track.
    l.tracks = { ...l.tracks, opacity: { keys: [{ frame: 0, v: l.opacity }] } };
    unfoldTracks(l);
  });
  selectTrack({ owner: "layer", id: layerId, prop: "opacity" });
}

/** Stop animating: bake what is on screen NOW into the static opacity, then drop the track.
 *  WYSIWYG, mirroring `removeLayerAnimation` for the transform. */
export function removeLayerOpacityAnimation(layerId: number): void {
  const l = state.project.layers.find((x) => x.id === layerId);
  if (!l || !l.tracks?.opacity || isLayerLocked(l, state.project.groups)) return;
  if (!isLayerVisible(l, state.project.groups)) return;
  const resolved = opacityAt(l, state.playhead);
  commitStructural(() => {
    l.opacity = resolved;
    l.tracks = normalizedTracks({ ...l.tracks, opacity: undefined });
  });
  state.activeRow = resolveStaleTrackFocus(state.activeRow, state.project, state.activeLayerId);
}

/** Start animating a GROUP's transform: its current static transform becomes the key at frame 0.
 *  The group-level twin of `animateLayer` — a rig moved as one thing over time. */
export function animateGroup(groupId: number): void {
  const g = state.project.groups.find((x) => x.id === groupId);
  if (!g || g.tracks?.transform) return;
  if (groupHasLockedLayer(g, state.project.layers)) return; // a locked member pins the whole group
  // Captured BEFORE the commit so the read cannot be mistaken for part of the mutation.
  const box = groupBoxLogical(g, state.project, state.playhead, DPR, state.version);
  commitStructural(() => {
    // The box is FROZEN here, where `animateLayer` deliberately stores `null` — the asymmetry is
    // the point, not an inconsistency. A GROUP's base rect is the union of its members' content
    // bounds at a frame (`groupContentBoxLogical`), so it genuinely drifts as the drawings change;
    // left live, the pivot would interpolate between keys and warp the motion path invisibly. A
    // LAYER's base is the document rect or a media contain-fit, which does not drift from drawing,
    // so freezing one there would only risk describing the OLD document size after a resize.
    // Replaces the BAG as well as the track — gotcha #8 reaches groups too, and the spread keeps
    // any sibling track a group may gain later.
    g.tracks = { ...g.tracks, transform: createTransformTrack(groupTransform(g), box) };
    // …and unfold, exactly as `animateLayer`/`animateLayerOpacity` do. A group's `collapsed` also
    // hides its MEMBER rows, so this reveals more than the new track — but pressing Animate on a
    // collapsed group otherwise produced no visible change whatsoever (the row is suppressed and
    // the header carried nothing), and a button that appears to do nothing is worse than one that
    // shows you rows you can fold away again.
    g.collapsed = false;
  });
  selectTrack({ owner: "group", id: groupId, prop: "transform" });
}

/** Stop animating a group: bake what is on screen NOW into the static transform, then drop the
 *  track. WYSIWYG, mirroring `removeLayerAnimation`. */
export function removeGroupAnimation(groupId: number): void {
  const g = state.project.groups.find((x) => x.id === groupId);
  if (!g || !g.tracks?.transform) return;
  if (groupHasLockedLayer(g, state.project.layers)) return;
  const resolved = groupTransformAt(g, state.playhead);
  const box = g.tracks.transform.box;
  commitStructural(() => {
    g.transform = { ...resolved };
    // Carry the track's frozen pivot onto the group so the baked value keeps rendering where it
    // rendered a moment ago: the static path resolves its box through `groupBoxLogical`, which
    // falls back to the LIVE content union — a different pivot for the same numbers is a visible
    // jump. Only when the group has no freeze of its own; that one is the more recent choice.
    if (box && !g.transformBox) g.transformBox = { ...box };
    g.tracks = normalizedTracks({ ...g.tracks, transform: undefined });
  });
  state.activeRow = resolveStaleTrackFocus(state.activeRow, state.project, state.activeLayerId);
}

/** The mutation an opacity-key write would perform, or null when it would change nothing (no track,
 *  a locked or hidden layer, or the value already sitting on `frame`). Split from its one caller so
 *  the guard stays ABOVE the write: a re-write of the value already there must not reach history.
 *  A one-shot COMMITTING writer is deliberately absent — the only authoring path is the layer
 *  panel's slider, which brackets its own gesture; `commitStructural(write)` is a four-line re-add
 *  if one is ever wanted, and an exported function with no callers is how this codebase has twice
 *  ended up re-deriving why something existed. */
function opacityKeyWrite(layerId: number, frame: number, value: number): (() => void) | null {
  const l = state.project.layers.find((x) => x.id === layerId);
  const track = l?.tracks?.opacity;
  if (!l || !track || isLayerLocked(l, state.project.groups)) return null;
  if (!isLayerVisible(l, state.project.groups)) return null;
  const existing = track.keys.find((k) => k.frame === frame);
  if (existing && existing.v === value) return null;
  return () => {
    // Through `withKey`, the single key-WRITING site — this was hand-rolled here and had already
    // drifted from `withTransformKey`: it only preserved a curve when a key already sat on `frame`,
    // so a key created INSIDE a `hold` segment silently became a fade where the same gesture on a
    // transform track kept the hard cut.
    l.tracks = { ...l.tracks, opacity: withKey(track, frame, value, (n) => n) };
  };
}

/** Auto-key with NO history entry, for the gesture that brackets its own undo (the layer panel's
 *  opacity slider). Writes/replaces the key at `frame`, preserving that key's segment interpolation
 *  when one is already there — a value write must not silently reset a segment's curve, the same
 *  rule `withTransformKey` follows for the transform track.
 *
 *  Non-committing on purpose, the `applyAnimationLength` half of that split: a range input fires
 *  `input` per pixel of travel, so a self-committing writer would push ~100 entries for one drag and
 *  evict the whole 50-command history — a slider that quietly destroys your undo stack. */
export function applyLayerOpacityAt(layerId: number, frame: number, value: number): void {
  const write = opacityKeyWrite(layerId, frame, value);
  if (!write) return;
  write();
  bump();
}

/**
 * Everything a key action needs about ONE track, resolved from its `TrackRef` — or null when the
 * track does not exist or its owner refuses edits.
 *
 * The generic key writers in `document.ts` know nothing about the two things that differ per
 * property, so both live here: how deep to copy a value (identity for a scalar, a spread for a
 * transform), and how to re-attach keys at the property's own copy depth (a `TransformTrack` must
 * also copy its `box`, which is what `withTrackKeys` is for).
 *
 * The lock/visibility asymmetry is the ruling settled when group tracks landed, not an oversight: a
 * LAYER is group-aware (`isLayerLocked`/`isLayerVisible`), while a GROUP is locked-only, because
 * `activeTransformLayer` returns its layer unconditionally at group scope — a hidden group is still
 * draggable, so refusing to edit its keys would be the inconsistency. `groupHasLockedLayer` already
 * returns true for a locked group itself.
 */
interface TrackTarget {
  /** The track as it stands, for the guards that must sit ABOVE `commitStructural`. */
  track: Track<unknown>;
  copyValue: (v: unknown) => unknown;
  /** Assign a whole NEW track into a whole NEW bag — gotcha #8 reaches both levels, so no writer
   *  may mutate either the bag or the track a snapshot shares. */
  write: (keys: Keyframe<unknown>[], sampleEvery?: number) => void;
}

function trackTarget(ref: TrackRef): TrackTarget | null {
  // The two casts are the whole cost of one address for every track, and they are confined here.
  // Both are sound by construction: the transform branch only ever hands `withTrackKeys` keys that
  // came out of this same `TransformTrack`, so the value type it erases is the one it restores.
  const copyTransformValue = (v: unknown) => ({ ...(v as RefTransform) });
  if (ref.owner === "group") {
    const g = state.project.groups.find((x) => x.id === ref.id);
    const track = g?.tracks?.transform;
    if (!g || !track) return null;
    if (groupHasLockedLayer(g, state.project.layers)) return null; // a locked member pins the group
    return {
      track,
      copyValue: copyTransformValue,
      write: (keys, sampleEvery) => {
        const next = withTrackKeys(track, keys as TransformKey[]);
        g.tracks = {
          ...g.tracks,
          transform: sampleEvery === undefined ? next : { ...next, sampleEvery },
        };
      },
    };
  }
  const l = state.project.layers.find((x) => x.id === ref.id);
  if (!l || isLayerLocked(l, state.project.groups)) return null;
  if (!isLayerVisible(l, state.project.groups)) return null;
  if (ref.prop === "opacity") {
    const track = l.tracks?.opacity;
    if (!track) return null;
    return {
      track,
      copyValue: (v) => v,
      write: (keys, sampleEvery) => {
        const next = { ...track, keys: keys as Keyframe<number>[] };
        l.tracks = {
          ...l.tracks,
          opacity: sampleEvery === undefined ? next : { ...next, sampleEvery },
        };
      },
    };
  }
  const track = layerTransformTrack(l);
  if (!track) return null;
  return {
    track,
    copyValue: copyTransformValue,
    write: (keys, sampleEvery) => {
      const next: TransformTrack = withTrackKeys(track, keys as TransformKey[]);
      l.tracks = {
        ...l.tracks,
        transform: sampleEvery === undefined ? next : { ...next, sampleEvery },
      };
    },
  };
}

/** Plant a key at `frame` with the value showing now. No-op when one is already there, or the
 *  owner refuses writes — the button that would be a no-op must not push an empty undo entry. */
export function addTrackKey(ref: TrackRef, frame: number): void {
  const t = trackTarget(ref);
  if (!t || hasKeyAt(t.track, frame)) return;
  const v = resolvedTrackValue(ref, frame);
  if (v === undefined) return;
  const next = withKey(t.track, frame, v, t.copyValue);
  commitStructural(() => t.write(next.keys));
}

/** The on-screen value of `ref` at `frame` — what Add key freezes. Undefined only when the owner
 *  is gone (trackTarget already refused a missing track). */
function resolvedTrackValue(ref: TrackRef, frame: number): unknown {
  if (ref.owner === "group") {
    const g = state.project.groups.find((x) => x.id === ref.id);
    return g ? groupTransformAt(g, frame) : undefined;
  }
  const l = state.project.layers.find((x) => x.id === ref.id);
  if (!l) return undefined;
  return ref.prop === "opacity" ? opacityAt(l, frame) : transformAt(l, frame);
}

/** Remove the key at `frame`. No-op (and no undo entry) when there is none, or when it is the
 *  last key — a track is never empty; Stop animating is the way out. */
export function deleteTrackKey(ref: TrackRef, frame: number): void {
  const t = trackTarget(ref);
  if (!t) return;
  const next = withoutKey(t.track, frame);
  if (next === t.track) return; // guard ABOVE the commit: a no-op must not push an empty entry
  commitStructural(() => t.write(next.keys));
}

/** The track's step setting — how often the value updates, in frames. Track-wide, because it is the
 *  rhythm the whole move is cut to. Replaces the track object (gotcha #8). */
export function setTrackSampleEvery(ref: TrackRef, sampleEvery: number): void {
  const t = trackTarget(ref);
  if (!t) return;
  // Clamped HERE, not at the widget: an input's `max` is advisory and a browser accepts a typed
  // value beyond it — the same reason the Fill tool clamps its gap in the logic.
  const next = Math.min(MAX_SAMPLE_EVERY, Math.max(1, Math.floor(sampleEvery)));
  if (next === (t.track.sampleEvery ?? 1)) return; // guard above the commit: no empty undo entry
  commitStructural(() =>
    // Keys deep-copied, matching the depth every other track writer uses: the new track must share
    // no mutable object with the one a snapshot still holds.
    t.write(
      t.track.keys.map((k) => copyKeyframe(k, t.copyValue)),
      next,
    ),
  );
}

/** Copy the key under the playhead. Reading is allowed on a locked or hidden layer — the lock
 *  protects content from being CHANGED, and copying changes nothing. Not undoable: no document edit. */
export function copyTransformKeyAtPlayhead(layerId: number): void {
  const l = state.project.layers.find((x) => x.id === layerId);
  const key = l && layerTransformTrack(l)?.keys.find((k) => k.frame === state.playhead);
  if (!key) return;
  // Through `copyTransformKey`, the single key-copy site — a spread, so a field added to
  // `TransformKey` later travels rather than being dropped here.
  state.transformKeyClipboard = copyTransformKey(key);
}

/** Paste the copied key at the playhead, replacing whatever is there. Refuses a layer with no track:
 *  a paste should not silently start animating something (press Animate for that). */
export function pasteTransformKeyAtPlayhead(layerId: number): void {
  const l = state.project.layers.find((x) => x.id === layerId);
  const track = l && layerTransformTrack(l);
  const clip = state.transformKeyClipboard;
  if (!l || !track || !clip || isLayerLocked(l, state.project.groups)) return;
  if (!isLayerVisible(l, state.project.groups)) return;
  // The clipboard's own `frame` is deliberately ignored: the destination is the PLAYHEAD, which is
  // what makes a key pasteable anywhere (`withPastedTransformKey` overrides it).
  // Guard ABOVE the commit, like every sibling action: pasting a key identical to the one already
  // there (value AND curve) changes nothing, and an empty undo entry reads as a dead ⌘Z.
  // `withPastedTransformKey` stays always-new — the sameness is a property of THIS caller's data.
  const at = state.playhead;
  const existing = track.keys.find((k) => k.frame === at);
  if (
    existing &&
    isSameTransform(existing.v, clip.v) &&
    (existing.interp ?? "linear") === (clip.interp ?? "linear")
  )
    return;
  commitStructural(() => {
    l.tracks = { ...l.tracks, transform: withPastedTransformKey(track, at, clip) };
  });
}

/** The interpolation of the segment starting at `frame` — i.e. the curve from that key to the next.
 *  Per-key, because a track routinely wants different segments to behave differently. Generic over
 *  the property because `hold` on an opacity track is how the spec says you get a hard cut rather
 *  than a fade — easing is not a transform-only idea. */
export function setTrackKeyInterp(ref: TrackRef, frame: number, interp: KeyInterp): void {
  const t = trackTarget(ref);
  if (!t) return;
  const next = withKeyInterp(t.track, frame, interp, t.copyValue);
  if (next === t.track) return; // same object = nothing changed; do not push an empty entry
  commitStructural(() => t.write(next.keys));
}

/** Merge the drawing layer `id` down onto the drawing layer directly below it, then remove it. */
export function mergeDown(id: number) {
  const layers = state.project.layers;
  // Single authority for "can this merge happen" — the LayerList button reads the same predicate to
  // decide whether to dim itself and what reason to show.
  if (whyNotMergeDown(layers, state.project.groups, id)) return;
  const idx = layers.findIndex((l) => l.id === id);
  const upper = layers[idx];
  const below = layers[idx - 1];
  if (!isDrawingLayer(upper) || !isDrawingLayer(below)) return; // unreachable; narrows for TS

  liftGuard.discard?.(); // merge replaces both cell tracks; a live lift would bake into a detached canvas
  commitStructural(() => {
    // Merge into a fresh cell track: keyframes only at the union of both layers' keyframes
    // (holds stay holds), compositing each layer's resolved drawing. Reads the original cells,
    // so the result is independent of mutation order.
    bakeLayerTransform(upper);
    bakeLayerTransform(below);
    below.cells = planMergeDown(below.cells, upper.cells).map((p): Cell => {
      if (p.kind === "hold") return { kind: "hold" };
      const canvas = canvasOps.create();
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (p.below) ctx.drawImage(p.below, 0, 0);
      if (p.upper) {
        ctx.globalAlpha = upper.opacity / 100;
        ctx.drawImage(p.upper, 0, 0);
      }
      return { kind: "key", canvas };
    });
    layers.splice(idx, 1);
    setActiveLayer(below.id);
  });
}

/** Rename a layer in place. Not undoable (name is a view-prop, like visible/opacity). */
export function renameLayer(id: number, input: string) {
  const layer = state.project.layers.find((l) => l.id === id);
  if (!layer) return;
  layer.name = resolveLayerName(layer.name, input);
  bump();
}

/** Create a group from the active layer (a run of one); removes it from any prior group. */
export function groupActiveLayer() {
  const layer = state.project.layers.find((l) => l.id === state.activeLayerId);
  if (!layer) return;
  commitStructural(() => {
    const g: LayerGroup = {
      id: nextId(),
      name: `Group ${state.project.groups.length + 1}`,
      collapsed: false,
      visible: true,
    };
    state.project.groups.push(g);
    layer.groupId = g.id;
    state.project.groups = nonEmptyGroups(state.project.groups, state.project.layers); // drop the layer's prior group if now empty
  });
}
/** Ungroup: clear members' groupId, remove the group. */
export function ungroup(groupId: number) {
  commitStructural(() => {
    for (const l of state.project.layers) if (l.groupId === groupId) l.groupId = null;
    state.project.groups = state.project.groups.filter((g) => g.id !== groupId);
    // Don't leave the Transform tool in Group scope with no group (mirror setActiveLayer's guard).
    const al = state.project.layers.find((l) => l.id === state.activeLayerId);
    if (state.transformScope === "group" && (!al || al.groupId == null)) {
      state.transformScope = "frame";
    }
  });
  // Destroying the group also destroys its transform track — fall focus back if it was selected.
  state.activeRow = resolveStaleTrackFocus(state.activeRow, state.project, state.activeLayerId);
}
/** Fold a layer's property rows away in the timeline, or unfold them. A VIEW-prop, exactly like a
 *  group's `collapsed` directly below: mutated in place with a `bump()` and NOT undoable — the
 *  contents did not change, only how much of them is on screen. `bump()` rather than `repaint()`
 *  because it IS persisted, so the autosave debounce has to see it. */
export function toggleTracksCollapsed(layerId: number) {
  const l = state.project.layers.find((x) => x.id === layerId);
  if (l) {
    l.tracksCollapsed = !l.tracksCollapsed;
    bump();
  }
}
export function toggleGroupCollapsed(groupId: number) {
  const g = state.project.groups.find((x) => x.id === groupId);
  if (g) {
    g.collapsed = !g.collapsed;
    bump();
  }
}
/** Lock/unlock a whole group. DERIVED onto members (see isLayerLocked) — members' own `locked`
 *  flags are untouched, so unlocking restores each one's individual state with nothing stored. */
export function toggleGroupLocked(groupId: number) {
  const g = state.project.groups.find((x) => x.id === groupId);
  if (g) {
    g.locked = !g.locked;
    bump();
  }
}

export function toggleGroupVisible(groupId: number) {
  const g = state.project.groups.find((x) => x.id === groupId);
  if (g) {
    g.visible = !g.visible;
    bump();
  }
}
export function renameGroup(groupId: number, name: string) {
  const g = state.project.groups.find((x) => x.id === groupId);
  const n = name.trim();
  if (g && n) {
    g.name = n;
    bump();
  }
}
/** Apply a dragged display→data order with per-layer groupId, as one undoable step; prune empty groups. */
export function reorderLayersWithGroups(order: { id: number; groupId: number | null }[]) {
  // No-op guard: a cross-list drag fires SortableJS onEnd on both source and destination, so the
  // rebuild can run twice with the same final order — skip when nothing actually changed (also
  // avoids a redundant undo step).
  const cur = state.project.layers;
  if (
    order.length === cur.length &&
    order.every((e, i) => cur[i].id === e.id && cur[i].groupId === e.groupId)
  )
    return;
  const before = beginStructuralEdit();
  const byId = new Map(state.project.layers.map((l) => [l.id, l]));
  const next: Layer[] = [];
  for (const e of order) {
    const l = byId.get(e.id);
    if (l) {
      l.groupId = e.groupId;
      next.push(l);
    }
  }
  state.project.layers = next;
  state.project.groups = nonEmptyGroups(state.project.groups, state.project.layers);
  bump();
  commitStructuralEdit(before);
}

/** Replace a reference layer's media (e.g. re-linking a persisted placeholder), keeping its
 *  name/opacity/visibility/offset/transform. Not undoable. */
export function relinkReference(id: number, media: ReferenceMedia, blob?: Blob) {
  const layer = state.project.layers.find((l) => l.id === id);
  if (layer && layer.kind === "ref") {
    releaseReferenceMedia(layer.media); // free the old media (this is not undoable)
    layer.media = media;
    if (blob && (media.type === "image" || (media.type === "video" && layer.embedMedia)))
      persistReferenceMedia(layer, blob, blob instanceof File ? blob.name : layer.name);
    else {
      // The new media isn't persisted — a leftover mediaId would describe the OLD bytes.
      layer.mediaId = undefined;
      layer.mediaMime = undefined;
    }
    bump();
  }
}

/** Video-only opt-in to persist/embed the media bytes. Toggle-on stores the bytes now (from the
 *  live element's blob URL); toggle-off just clears the flag — the record is pruned at the next
 *  load boundary (never mid-session: undo snapshots may still reference it). */
export async function toggleEmbedMedia(id: number): Promise<void> {
  const layer = state.project.layers.find((l) => l.id === id);
  if (!layer || layer.kind !== "ref") return;
  layer.embedMedia = !layer.embedMedia;
  if (layer.embedMedia && layer.media.type === "video" && !layer.mediaId) {
    try {
      const blob = await fetch(layer.media.el.src).then((r) => r.blob());
      persistReferenceMedia(layer, blob);
    } catch {
      layer.embedMedia = false; // couldn't read the bytes — don't claim it's stored
      state.statusHint = "Couldn't read the video — not stored";
    }
  } else if (!layer.embedMedia) {
    // Bounds storage: the orphaned record gets pruned at the next load boundary instead of
    // being retained forever, and clears Fix 1's remaining precondition.
    layer.mediaId = undefined;
    layer.mediaMime = undefined;
  }
  bump(); // repaint + mark autosave dirty
}

/** Set/replace the project audio track (not undoable; persisted with the project). */
/** Import a track. Undoable — `audio` is in `StructSnapshot`, and once a field is in the snapshot
 *  every writer of it must push a command, or an unrelated undo silently reverts this import. */
export function setAudioTrack(track: AudioTrack) {
  commitStructural(() => {
    state.project.audio = track;
    state.project.audioUndecoded = null; // an import replaces an undecodable track; never keep both
    // Hand the engine the $state PROXY (read back after assignment), never the raw object: UI writes
    // (offset drag, mute) go through the proxy, and the raw target does not see them — a raw ref
    // left the engine reading offsetFrames 0 forever. Same fix in replaceProject.
    audioEngine.setTrack(state.project.audio);
  });
}
/** Move the playhead (clamped); when paused, plays a short audio scrub window at the new frame.
 *  All paused playhead-move UI routes through this (ruler, prev/next, keyboard stepping). */
export function seekPlayhead(f: number): void {
  const clamped = Math.max(0, Math.min(state.project.frameCount - 1, f));
  if (clamped === state.playhead) return; // unchanged → no re-scrub spam from pointer jitter
  state.playhead = clamped;
  if (state.playback.isPlaying) audioEngine.syncTo(clamped, state.project.fps);
  else audioEngine.scrub(clamped, state.project.fps);
}

/** Mute/unmute the audio track (not undoable — matches set/removeAudioTrack). */
/** Undoable, like every other writer of a field `StructSnapshot` captures — otherwise an unrelated
 *  undo would silently flip the mute back. */
export function toggleAudioMute(): void {
  const t = state.project.audio;
  if (!t) return;
  commitStructural(() => {
    t.muted = !t.muted;
    if (t.muted) {
      audioEngine.stop(); // also kills an in-flight scrub window — muted must mean silent NOW
    } else if (state.playback.isPlaying) {
      audioEngine.play(state.playhead, state.project.fps); // rejoin in sync mid-playback
    }
  });
}

/** Remove the audio track. */
/** Remove the track. Undoable: the snapshot holds the track by reference, so undo hands the same
 *  decoded buffer back — no re-decode, and no need to keep the bytes anywhere else. */
export function removeAudioTrack() {
  commitStructural(() => {
    state.project.audio = null;
    state.project.audioUndecoded = null; // "Remove" means remove — including bytes we couldn't decode
    audioEngine.setTrack(null);
  });
}

/** Write a completed trim gesture. Takes `offsetFrames` too because a HEAD trim moves it and
 *  `trimInFrames` by the same delta — the two must land in one undo entry, or undoing would leave
 *  the clip trimmed but re-synced. Not wrapped in `commitStructural`: the lane brackets the whole
 *  drag itself, so one gesture is one entry. */
export function setAudioTrim(
  trimInFrames: number,
  trimLenFrames: number,
  offsetFrames: number,
): void {
  const t = state.project.audio;
  if (!t) return;
  t.trimInFrames = trimInFrames;
  t.trimLenFrames = trimLenFrames;
  t.offsetFrames = offsetFrames;
  bump();
}

/** Which clip a "trim to playhead" command would act on, and its label for the button's title.
 *  Exported so the UI can name the target BEFORE the press — the precedence is only acceptable
 *  because it is visible, not guessed at. */
export function trimToPlayheadInfo(): { target: "ref" | "audio"; label: string } | null {
  // Follows the SELECTED row, with no precedence or fallback. An earlier version picked the audio
  // track whenever the active layer was not an image ref, which meant the buttons acted on audio
  // while a drawing layer was selected — the same control doing different things for reasons that
  // were invisible on screen.
  if (state.activeRow.kind === "audio")
    return state.project.audio ? { target: "audio", label: "the audio clip" } : null;
  const l = state.project.layers.find((x) => x.id === state.activeLayerId);
  if (l?.kind === "ref" && l.media.type === "image")
    return { target: "ref", label: `${l.name}'s range` };
  return null;
}

/** Is this layer's row the selected one? Also true when a track OWNED by that layer (or a group
 *  track whose draw target is a member) is focused — see `activeRow` for why no view may combine
 *  this with `activeLayerId`. */
export function isRowSelected(layerId: number): boolean {
  return layerRowSelected(state.activeRow, layerId, state.activeLayerId, state.project.layers);
}

/** Is this exact property track the focused row? */
export function isTrackSelected(
  owner: "layer" | "group",
  id: number,
  prop: "transform" | "opacity",
): boolean {
  return trackRowSelected(state.activeRow, owner, id, prop);
}

/** Is the audio lane the selected row? */
export function isAudioRowSelected(): boolean {
  return audioRowSelected(state.activeRow);
}

/** Make the audio lane the active timeline row (it holds no layer id, so it needs its own flag). */
export function selectAudioLane(): void {
  if (state.project.audio) state.activeRow = { kind: "audio" };
}

/** Focus a property track. Does NOT call `setActiveLayer` — that would clear the track case.
 *  Still updates `activeLayerId` when the draw target should follow (layer-owned track → that
 *  layer; group-owned → a draw member), and aims Transform scope for transform tracks. */
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
  // DRAW member, or NONE — never a ref. Group scope resolves through the active layer's
  // `groupId`, and `activeTransformLayer` only returns a draw layer at group scope; aiming a
  // ref member would silently key that REF's own transform. An all-ref group is reachable, so
  // leaving the draw target alone when there is no draw member is the honest outcome.
  const member = [...state.project.layers]
    .reverse()
    .find((l) => l.groupId === ref.id && l.kind === "draw");
  if (member && state.activeLayerId !== member.id) {
    state.activeLayerId = member.id;
    if (state.onion.enabled && !state.onion.allLayers) repaint();
  }
}

/** Move the resolved clip's start or end onto the playhead. One undo entry; the underlying
 *  trim helpers already clamp, so a playhead outside the clip degrades to the 1-frame minimum or
 *  the source's extent rather than needing a guard here. */
export function trimToPlayhead(edge: "start" | "end"): void {
  const info = trimToPlayheadInfo();
  if (!info) return;
  const fps = state.project.fps;
  // Decide FIRST, write only if it changes anything. `trimDeltaToPlayhead` legitimately returns 0
  // when the edge is already on the playhead, and an unconditional write then did two invisible
  // things: pushed an EMPTY undo command (so the next ⌘Z looked dead), and MATERIALISED the implicit
  // state — an untrimmed ref's "always visible, follows the project length" became a fixed range,
  // an untrimmed clip's trim fields became explicit numbers — with no visible cause. The comparison
  // is against the current EFFECTIVE values, mirroring AudioLane.trimMoveAt for the same reason:
  // the raw optional fields are undefined on an untouched clip while `next` holds resolved numbers,
  // so a raw compare always reads as changed.
  if (info.target === "ref") {
    const l = state.project.layers.find((x) => x.id === state.activeLayerId);
    if (!l || l.kind !== "ref") return;
    // An untrimmed ref means "always visible": the implicit whole-project range is the baseline an
    // edge drag would materialise, so trimming from it gives the same answer.
    const cur = l.range ?? { start: 0, end: Math.max(0, state.project.frameCount - 1) };
    const delta = trimDeltaToPlayhead(edge, state.playhead, {
      startFrame: cur.start,
      lengthFrames: cur.end - cur.start + 1,
    });
    const next = rangeAfterTrim(cur, edge, delta);
    if (next.start === cur.start && next.end === cur.end) return; // no-op (and would materialise)
    commitStructural(() => {
      l.range = next; // REPLACE, never mutate (shared snapshot refs)
    });
    return;
  }
  const t = state.project.audio;
  if (!t) return;
  const extent = audioFrameSpan(t.buffer.duration, fps);
  const tin = Math.max(0, t.trimInFrames ?? 0);
  const len = t.trimLenFrames ?? extent - tin;
  const delta = trimDeltaToPlayhead(edge, state.playhead, {
    startFrame: t.offsetFrames,
    lengthFrames: len,
  });
  const next =
    edge === "start"
      ? trimHead(t.offsetFrames, tin, len, delta, extent)
      : { offsetFrames: t.offsetFrames, ...trimTail(tin, len, delta, extent) };
  if (
    next.offsetFrames === t.offsetFrames &&
    next.trimInFrames === tin &&
    next.trimLenFrames === len
  )
    return; // no-op (and would materialise the implicit trim)
  commitStructural(() => {
    t.trimInFrames = next.trimInFrames;
    t.trimLenFrames = next.trimLenFrames;
    t.offsetFrames = next.offsetFrames;
  });
}

/** Set the animation's total length to `n` frames (clamped 1..9999). Extends layers by holding the
 *  last frame; shortens by trimming trailing cells. Undoable. */
export function setAnimationLength(n: number) {
  // The no-op guard has to sit ABOVE the commit: inside `applyAnimationLength` it returns from the
  // mutate callback, but commitStructural has already snapshotted and still pushes — an undo entry
  // that restores the state it was taken in, i.e. a ⌘Z that visibly does nothing.
  const target = Math.max(1, Math.min(9999, Math.floor(n)));
  if (target === state.project.frameCount) return;
  commitStructural(() => applyAnimationLength(target));
}

/** The length mutation WITHOUT an undo entry, for a drag that brackets the whole gesture itself.
 *  `setAnimationLength` used to be the only entry point, and a drag calling it pushed one undo
 *  command per pointermove — a 30-frame drag left 30 entries in the history. */
export function applyAnimationLength(n: number): void {
  const target = Math.max(1, Math.min(9999, Math.floor(n)));
  if (target === state.project.frameCount) return;
  // Every layer's cell array is respliced (and a shrink DELETES cells), so a live selection/deform/
  // pose lift would be banked into a canvas that is no longer in the document — the same reason
  // rippleInsert/rippleDelete/deleteTool/resizeProject discard here. Guarded here rather than at the
  // two call sites (ruler drag, playbar field) so no future caller can miss it.
  liftGuard.discard?.();
  for (const layer of state.project.layers) {
    if (layer.kind === "draw") layer.cells = resizeCells(layer.cells, target);
  }
  bump(); // refreshes document length and clamps the playhead
}

/** Restore a structural snapshot WITHOUT pushing an undo entry — for abandoning a gesture. Shrinking
 *  truncates cells immediately (`resizeCells` slices), so re-applying the old LENGTH would only pad
 *  holds back; the keyframes are already gone and only the snapshot still has them. */
export function revertStructural(snap: StructSnapshot): void {
  restoreStructure(snap);
  // bump(), not just restoreStructure's version++: the gesture being abandoned already bumped
  // persistTick on every live step, so the ~3s autosave debounce may well have fired and written the
  // MUTATED document. Without marking dirty again the revert lives only in memory and a reload
  // restores the truncated project. undo()/redo() bump after a pop for exactly this reason.
  bump();
}

/**
 * Resize the document to `newW×newH`. Re-creates every keyframe canvas: `scale` fits the old art
 * (aspect-preserving), `crop` keeps its pixel size; the anchor positions it. One undo step.
 */
export function resizeProject(newW: number, newH: number, mode: ResizeMode, anchor: Anchor) {
  const w = Math.max(16, Math.min(8192, Math.round(newW)));
  const h = Math.max(16, Math.min(8192, Math.round(newH)));
  if (w === state.project.width && h === state.project.height) return;
  state.timelineSelection = null;
  state.cellClipboard = null; // clipboard canvases belong to the old document size
  liftGuard.discard?.(); // a live lift's captured cell canvas is about to be replaced
  const rect = placeContent(
    state.project.width * DPR,
    state.project.height * DPR,
    w * DPR,
    h * DPR,
    mode,
    anchor,
  );
  commitStructural(() => {
    for (const layer of state.project.layers) {
      if (layer.kind !== "draw") continue;
      // Replace cells (don't mutate cell.canvas) so the undo before-snapshot keeps the old canvases.
      layer.cells = layer.cells.map((c): Cell => {
        if (c.kind !== "key") return c;
        // Bake any per-cell transform into pixels first (at the current dims) so resize preserves the
        // transformed look instead of silently dropping it. bakeCell returns c unchanged if identity.
        const src = bakeCell(c, IDENTITY_TRANSFORM).canvas;
        const nc = createCellCanvas(w, h, DPR);
        const ctx = nc.getContext("2d")!;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h);
        return { kind: "key", canvas: nc };
      });
    }
    state.project.width = w;
    state.project.height = h;
  });
}

/** Toggle the eraser on/off, restoring the tool that was active before (for a quick gesture toggle). */
let toolBeforeEraser: Tool = "brush";
export function toggleEraser() {
  if (state.tool === "eraser") {
    state.tool = toolBeforeEraser === "eraser" ? "brush" : toolBeforeEraser;
  } else {
    toolBeforeEraser = state.tool;
    state.tool = "eraser";
  }
}

let toolBeforeEyedropper: Tool = "brush";
export function selectEyedropper() {
  if (state.tool === "eyedropper") return; // already active → no-op
  toolBeforeEyedropper = state.tool;
  state.tool = "eyedropper";
}
/** Set the brush color from a sampled pixel, then return to the pre-eyedropper tool. */
export function applyEyedropper(hex: string) {
  state.brush.color = hex;
  state.tool = toolBeforeEyedropper === "eyedropper" ? "brush" : toolBeforeEyedropper;
}

/** Signal that the (imperative) pressure curve changed, so the preferences save effect re-runs. */
export function bumpCurve() {
  state.curveVersion++;
}

/** Snapshot the persisted-preference fields from live state. */
export function gatherPreferences(): Preferences {
  void state.curveVersion; // track: the curve is imperative, so re-run the save effect on edits
  return {
    tool: state.tool,
    brush: { ...state.brush },
    eraser: { ...state.eraser },
    fill: { ...state.fill },
    theme: state.theme,
    loop: state.playback.loop,
    timelineHeight: state.timelineHeight,
    layerPanelWidth: state.layerPanelWidth,
    timelineLabelWidth: state.timelineLabelWidth,
    pressureCurve: { cp1: { ...pressureCurve.cp1 }, cp2: { ...pressureCurve.cp2 } },
  };
}

/** Apply stored preferences over the current state, field-by-field with type guards. */
export function applyPreferences(p: Partial<Preferences>): void {
  if (p.tool) state.tool = p.tool;
  if (p.brush && typeof p.brush === "object") state.brush = { ...state.brush, ...p.brush };
  if (p.eraser && typeof p.eraser === "object") state.eraser = { ...state.eraser, ...p.eraser };
  // Back-compat: older saves wrote brushType/sizeRange/streamline at the top level → onto the brush.
  if (p.brushType) state.brush.brushType = p.brushType;
  if (typeof p.sizeRange === "number") state.brush.sizeRange = p.sizeRange;
  if (typeof p.streamline === "number") state.brush.streamline = p.streamline;
  if (p.fill && typeof p.fill === "object") state.fill = { ...state.fill, ...p.fill };
  if (p.theme === "dark" || p.theme === "light") state.theme = p.theme;
  if (typeof p.loop === "boolean") state.playback.loop = p.loop;
  if (typeof p.timelineHeight === "number")
    state.timelineHeight = clampTimelineHeight(p.timelineHeight, window.innerHeight);
  if (typeof p.layerPanelWidth === "number")
    state.layerPanelWidth = clampPanelWidth(p.layerPanelWidth, window.innerWidth);
  if (typeof p.timelineLabelWidth === "number")
    state.timelineLabelWidth = clampGutterLabelWidth(p.timelineLabelWidth, window.innerWidth);
  if (p.pressureCurve && typeof p.pressureCurve === "object") {
    const { cp1, cp2 } = p.pressureCurve;
    if (cp1 && typeof cp1.x === "number" && typeof cp1.y === "number")
      pressureCurve.cp1 = { x: cp1.x, y: cp1.y };
    if (cp2 && typeof cp2.x === "number" && typeof cp2.y === "number")
      pressureCurve.cp2 = { x: cp2.x, y: cp2.y };
    pressureCurve.buildLUT();
  }
}

/** Replace the whole document (e.g. after Open or autosave restore). */
export function replaceProject(project: Project) {
  bumpPersistGeneration(); // drop in-flight autosave/prune of the outgoing document
  state.timelineSelection = null;
  state.cellClipboard = null; // clipboard canvases belong to the old document size
  liftGuard.discard?.(); // clear any in-progress lift before the old document is thrown away
  // Settle any in-flight transform/range/hold drag too. Without this its release would push
  // restoreStructure(before) — a snapshot of the OUTGOING document — into the incoming one's
  // history. MUST stay above history.clear(): settling commits, and clearing right after is what
  // makes that commit harmless. Below the clear, it would be the very entry we are trying to avoid.
  transformDragGuard.settle?.();
  playbackController.pause();
  history.clear(); // undo history from the old document can't apply to the new one
  for (const l of state.project.layers) if (l.kind === "ref") releaseReferenceMedia(l.media);
  state.project = project;
  audioEngine.setTrack(state.project.audio); // the PROXY, not raw project.audio — see setAudioTrack
  state.playhead = 0;
  const firstDrawing = project.layers.find(isDrawingLayer) ?? project.layers[0];
  setActiveLayer(firstDrawing.id);
  bump();
}

/** View-only recomposite (play/stop, onion, layer switch). Does not mark the project dirty. */
export function repaint() {
  state.version++;
}

export function bump() {
  refreshLength(state.project);
  const last = state.project.frameCount - 1;
  if (state.playhead > last) state.playhead = last;
  if (state.playhead < 0) state.playhead = 0;
  state.version++;
  state.persistTick++;
}

/** Video ref elements in the current project. */
function videoRefEls(): HTMLVideoElement[] {
  return state.project.layers
    .filter((l): l is ReferenceLayer => l.kind === "ref" && l.media.type === "video")
    .map((l) => (l.media as { el: HTMLVideoElement }).el);
}

/**
 * The single playback driver. It mutates `state.playhead` each tick (the Canvas rAF poll
 * then recomposites) and reflects its running state into `state.playback.isPlaying`,
 * bumping the version so the onion overlay (hidden while playing) repaints on stop.
 */
export const playbackController = new Playback({
  getFps: () => state.project.fps,
  getRangeStart: () => effectiveRange(state.playback.range, state.project.frameCount).start,
  getRangeEnd: () => effectiveRange(state.playback.range, state.project.frameCount).end,
  getLoop: () => state.playback.loop,
  getCurrent: () => state.playhead,
  setFrame: (f) => {
    if (state.playback.isPlaying && f !== state.playhead && f !== state.playhead + 1)
      audioEngine.syncTo(f, state.project.fps);
    state.playhead = f;
  },
  onPlayingChange: (p) => {
    state.playback.isPlaying = p;
    if (p) {
      audioEngine.play(state.playhead, state.project.fps);
      // Video refs start via the next Canvas tick's syncReferenceVideos (one policy: clamp, mute,
      // ended-freeze). Starting them here duplicated that and play()'d past-end clips from 0.
    } else {
      audioEngine.pause();
      for (const el of videoRefEls()) el.pause(); // next tick exact-seeks onto the paused frame
    }
    repaint();
  },
});

/** Set the play range's in-point to the current playhead (session-only, not undoable). */
export function setPlayRangeIn() {
  state.playback.range = withRangeIn(state.playback.range, state.playhead);
}
/** Set the play range's out-point to the current playhead (session-only, not undoable). */
export function setPlayRangeOut() {
  state.playback.range = withRangeOut(state.playback.range, state.playhead);
}
/** Clear the play range (back to full-timeline playback). */
export function clearPlayRange() {
  state.playback.range = null;
}

/**
 * Holder for the single Selection instance (created by Canvas.svelte on mount).
 * App.svelte reads it to handle Enter (commit) / Escape (cancel) globally.
 */
export const selectionRef: { current: Selection | null } = { current: null };

/** Canvas-owned selection actions reachable from App keyboard shortcuts + the action bar. */
export const selectionActions: {
  enterWarp: ((rows: number, cols: number) => void) | null;
  copy: (() => void) | null;
  cut: (() => void) | null;
  del: (() => void) | null;
  paste: (() => boolean) | null;
  /** Drop the selection, reverting an in-progress move — same as the Escape key (never commits). */
  deselect: (() => void) | null;
} = { enterWarp: null, copy: null, cut: null, del: null, paste: null, deselect: null };

/** Canvas-owned view actions. The Viewport lives inside Canvas, so anything outside it (the View
 *  menu) reaches zoom/pan through here. */
export const viewActions: { fitView: (() => void) | null } = { fitView: null };

/** Canvas-owned fill actions. `ToolOptions` reaches the active cell's pixels through here — the
 *  canvas owns the keyframe, the undo bracket and the selection clip. */
export const fillActions: { allEnclosed: (() => void) | null } = { allEnclosed: null };

/** Gizmo-owned Reset-to-fit, so the ToolOptions bar can offer it without duplicating the gizmo's
 *  scope dispatch. Paired with `state.canResetTransform`, which says whether it would do anything. */
export const transformActions: { reset: (() => void) | null } = { reset: null };

/** Canvas-owned Pose-tool actions for App's Enter (apply) / Escape (cancel) keys. */
export const poseActions: { active: () => boolean; apply: () => void; cancel: () => void } = {
  active: () => false,
  apply: () => {},
  cancel: () => {},
};

/** Canvas registers a discard-the-active-lift callback here. Call it BEFORE any operation that
 *  recreates/removes the active key cell's canvas or replays the history (resize, replaceProject,
 *  set-hold/delete-frame on the active cell, undo/redo) — otherwise a live selection/deform/pose lift
 *  would commit to a detached canvas or corrupt the undo baseline. */
export const liftGuard: { discard: (() => void) | null } = { discard: null };

/** In-flight transform-drag settle hook: undo/redo must not run while a drag bracket is open —
 *  the registered settle commits (or discards) the bracket first. Set at grab, cleared at settle. */
export const transformDragGuard: { settle: (() => void) | null } = { settle: null };

/** Undo/redo, discarding any in-progress lift first (its captured context/baseline would be stale). */
export function undo(): void {
  transformDragGuard.settle?.();
  liftGuard.discard?.();
  if (!history.canUndo) return;
  history.undo();
  state.timelineSelection = null; // a structural restore can invalidate stored endpoints
  bump(); // pixel commands only recomposite — glyphs, contentBounds, and autosave key off version
  resyncAudioAfterHistory();
}

/** A structural restore can move the audio offset (the lane drag and ripple insert/delete both write
 *  it), and running playback has already scheduled its buffer — without this the number changes but
 *  the sound keeps playing at the old position until the next seek. */
function resyncAudioAfterHistory(): void {
  if (state.playback.isPlaying) audioEngine.syncTo(state.playhead, state.project.fps);
}
export function redo(): void {
  transformDragGuard.settle?.();
  liftGuard.discard?.();
  if (!history.canRedo) return;
  history.redo();
  state.timelineSelection = null;
  bump();
  resyncAudioAfterHistory();
}

/** Shared pressure-response curve, remaps raw pen pressure before drawing. Imperative widget. */
export const pressureCurve = new PressureCurve();

/**
 * Set the active layer. If transformScope is "group" and the new layer is not in a group,
 * fall back to "frame" scope so the disabled Group button can't stay selected silently.
 */
export function setActiveLayer(id: number): void {
  state.activeLayerId = id;
  state.activeRow = { kind: "layer", id }; // selection and draw target coincide when a layer is picked
  const l = state.project.layers.find((x) => x.id === id);
  if (state.transformScope === "group" && (!l || l.groupId == null)) {
    state.transformScope = "frame";
  }
  // In single-layer onion mode the ghosts track the active layer, so the display must recomposite.
  if (state.onion.enabled && !state.onion.allLayers) repaint();
}

export function setTimelineSelection(anchor: SelectionEndpoint, focus: SelectionEndpoint): void {
  state.timelineSelection = { anchor, focus };
}

export function clearTimelineSelection(): void {
  state.timelineSelection = null;
}

function currentSelectionRect() {
  const sel = state.timelineSelection;
  return sel
    ? resolveSelectionRect(state.project.layers, sel.anchor, sel.focus, state.project.groups)
    : null;
}

/** Copy the current timeline selection into the internal cell clipboard (non-undoable). */
export function copyTimelineSelection(): void {
  const rect = currentSelectionRect();
  if (!rect) return;
  state.cellClipboard = copyBlock(
    state.project,
    rect.layerIds,
    rect.startFrame,
    rect.endFrame,
    canvasOps,
  );
}

/** Replace the selected region with holds (undoable). */
export function deleteTimelineSelection(): void {
  const rect = currentSelectionRect();
  if (!rect) return;
  if (!anyEditableLayer(state.project, rect.layerIds)) return; // all locked/hidden → no empty undo
  liftGuard.discard?.(); // may replace the active cell's canvas → discard any live lift first
  commitStructural(() => deleteBlock(state.project, rect.layerIds, rect.startFrame, rect.endFrame));
}

/** Cut = copy then delete. */
export function cutTimelineSelection(): void {
  copyTimelineSelection();
  deleteTimelineSelection();
}

/** Move the current timeline selection by `delta` frames (frames-only, overwrite). Undoable; the
 *  selection follows to the moved range. No-op if there's no selection or the clamped delta is 0. */
export function moveTimelineSelection(delta: number): void {
  const rect = currentSelectionRect();
  if (!rect) return;
  const applied = Math.max(delta, -rect.startFrame); // clamp before committing so a no-op doesn't push undo
  if (applied === 0) return;
  if (!anyEditableLayer(state.project, rect.layerIds)) return;
  liftGuard.discard?.(); // may replace the active cell's canvas → discard any live lift first
  commitStructural(() =>
    moveBlockFrames(
      state.project,
      rect.layerIds,
      rect.startFrame,
      rect.endFrame,
      applied,
      canvasOps,
    ),
  );
  // commitStructural cleared the selection — re-set it to the moved range (same layers).
  state.timelineSelection = {
    anchor: { layerId: rect.layerIds[0], frame: rect.startFrame + applied },
    focus: { layerId: rect.layerIds[rect.layerIds.length - 1], frame: rect.endFrame + applied },
  };
}

/** Paste the clipboard block with its top-left at (active layer, playhead). Overwrite by default;
 *  `insert = true` ripples the pasted layers right. Undoable. */
export function pasteCells(insert = false): void {
  const block = state.cellClipboard;
  if (!block) return;
  if (!anyEditablePasteTarget(state.project, state.activeLayerId)) return;
  const active = state.project.layers.find((l) => l.id === state.activeLayerId);
  if (!active || active.kind !== "draw") return; // paste anchors on a drawing layer only
  liftGuard.discard?.(); // may replace the active cell's canvas → discard any live lift first
  commitStructural(() => {
    if (insert)
      pasteBlockInsert(state.project, block, state.activeLayerId, state.playhead, canvasOps);
    else pasteBlockOverwrite(state.project, block, state.activeLayerId, state.playhead, canvasOps);
  });
}
