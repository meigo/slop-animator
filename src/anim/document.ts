export type Cell =
  | { kind: "key"; canvas: HTMLCanvasElement }
  | { kind: "hold" };

export interface DrawingLayer {
  kind: "draw";
  id: number;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..100
  cells: Cell[];    // length === project.frameCount
}

export type Layer = DrawingLayer; // reference layers arrive in a later plan

export interface Project {
  width: number;
  height: number;
  fps: number;
  bgColor: string;
  frameCount: number;
  layers: Layer[]; // layers[0] = bottom of the stack
}

/**
 * Index of the keyframe that is shown at `frame` on this cell track:
 * the nearest "key" cell at or before `frame`. Returns null if none precedes it.
 * A frame index past the end clamps to the last cell.
 */
export function resolveKeyframeIndex(cells: Cell[], frame: number): number | null {
  const start = Math.min(frame, cells.length - 1);
  for (let i = start; i >= 0; i--) {
    if (cells[i].kind === "key") return i;
  }
  return null;
}

export interface DrawOp {
  layerId: number;
  keyframeIndex: number;
  opacity: number;
}

/** Ordered list (bottom→top) of which keyframe each visible layer contributes at `frame`. */
export function buildFrameDrawList(project: Project, frame: number): DrawOp[] {
  const ops: DrawOp[] = [];
  for (const layer of project.layers) {
    if (!layer.visible) continue;
    const ki = resolveKeyframeIndex(layer.cells, frame);
    if (ki === null) continue;
    ops.push({ layerId: layer.id, keyframeIndex: ki, opacity: layer.opacity });
  }
  return ops;
}
