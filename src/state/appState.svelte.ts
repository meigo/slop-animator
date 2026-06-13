import { createProject, createCellCanvas, cloneCanvas, type Project } from "../anim/document";
import { History } from "../anim/history";
import type { BrushSettings } from "../core/brush";
import type { CanvasOps } from "../anim/timeline";

export type Tool = "brush" | "eraser";

interface AnimState {
  project: Project;
  playhead: number;       // current frame index
  activeLayerId: number;
  tool: Tool;
  brush: BrushSettings;
  sizeRange: number;
  streamline: number;
  /** Bumped whenever the document changes so the canvas recomposites. */
  version: number;
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
  version: 0,
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
