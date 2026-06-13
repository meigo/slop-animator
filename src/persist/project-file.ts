import { isDrawingLayer, type Project } from "../anim/document";

export interface DrawingLayerJson {
  id: number;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  cells: ("key" | "hold")[];
}

export interface ProjectJson {
  version: 1;
  width: number;
  height: number;
  fps: number;
  bgColor: string;
  frameCount: number;
  layers: DrawingLayerJson[];
}

/** Serialize the project structure (drawing layers only) — no pixel data, no reference layers. */
export function projectToJson(project: Project): ProjectJson {
  return {
    version: 1,
    width: project.width,
    height: project.height,
    fps: project.fps,
    bgColor: project.bgColor,
    frameCount: project.frameCount,
    layers: project.layers.filter(isDrawingLayer).map((l) => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      locked: l.locked,
      opacity: l.opacity,
      cells: l.cells.map((c) => c.kind),
    })),
  };
}

/** Path inside the zip for a key cell's PNG. */
export function frameAssetPath(layerId: number, frameIndex: number): string {
  return `frames/${layerId}/${frameIndex}.png`;
}
