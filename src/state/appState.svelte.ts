import { createProject, createCellCanvas, cloneCanvas, type Project } from "../anim/document";
import { History } from "../anim/history";
import type { BrushSettings } from "../core/brush";
import type { CanvasOps } from "../anim/timeline";
import type { OnionConfig } from "../anim/onion";
import { Playback } from "../anim/playback";

export type Tool = "brush" | "eraser" | "fill";

interface AnimState {
  project: Project;
  playhead: number;       // current frame index
  activeLayerId: number;
  tool: Tool;
  brush: BrushSettings;
  sizeRange: number;
  streamline: number;
  fill: { tolerance: number; expand: number };
  /** Bumped whenever the document changes so the canvas recomposites. */
  version: number;
  onion: OnionConfig;
  playback: { isPlaying: boolean; loop: boolean };
}

const project = createProject();

export const state: AnimState = $state({
  project,
  playhead: 0,
  activeLayerId: project.layers[0].id,
  tool: "brush",
  brush: {
    size: 4,
    color: "#1a1a1a",
    opacity: 100,
    smoothing: 50,
    isEraser: false,
    drawBehind: false,
    alphaLock: false,
  },
  sizeRange: 1.0,
  streamline: 50,
  fill: { tolerance: 32, expand: 2 },
  version: 0,
  onion: {
    enabled: false,
    prev: 1,
    next: 1,
    allLayers: false,
    tintPrev: "#e0526a", // warm red
    tintNext: "#3f7fd0", // cool blue
  },
  playback: { isPlaying: false, loop: true },
});

export const history = new History();

/** Device pixel ratio captured once at startup; cell canvases are sized to it. */
export const DPR = Math.max(1, Math.floor(window.devicePixelRatio || 1));

/** Real canvas operations for timeline.ts, sized to the active document. */
export const canvasOps: CanvasOps = {
  create: () => createCellCanvas(state.project.width, state.project.height, DPR),
  clone: (src) => cloneCanvas(src),
};

export function activeLayer() {
  return state.project.layers.find((l) => l.id === state.activeLayerId) ?? state.project.layers[0];
}

export function bump() {
  state.version++;
}

/**
 * The single playback driver. It mutates `state.playhead` each tick (the Canvas rAF poll
 * then recomposites) and reflects its running state into `state.playback.isPlaying`,
 * bumping the version so the onion overlay (hidden while playing) repaints on stop.
 */
export const playbackController = new Playback({
  getFps: () => state.project.fps,
  getFrameCount: () => state.project.frameCount,
  getLoop: () => state.playback.loop,
  getCurrent: () => state.playhead,
  setFrame: (f) => { state.playhead = f; },
  onPlayingChange: (p) => { state.playback.isPlaying = p; state.version++; },
});
