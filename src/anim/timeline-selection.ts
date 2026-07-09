import { isDrawingLayer, type Layer } from "./document";

export interface SelectionEndpoint {
  layerId: number;
  frame: number;
}
export interface TimelineSelection {
  anchor: SelectionEndpoint;
  focus: SelectionEndpoint;
}
export interface SelectionRect {
  layerIds: number[]; // drawing layers only, top-first display order
  startFrame: number;
  endFrame: number;
}

/** Derive the selection rectangle from two endpoints. Layer axis spans the two endpoint layers
 *  inclusive in display order (top-first = layers reversed), drawing layers only. Returns null if
 *  either endpoint is missing or the span holds no drawing layer. */
export function resolveSelectionRect(
  layers: Layer[],
  anchor: SelectionEndpoint,
  focus: SelectionEndpoint,
): SelectionRect | null {
  const display = [...layers].reverse(); // top-first
  const ai = display.findIndex((l) => l.id === anchor.layerId);
  const fi = display.findIndex((l) => l.id === focus.layerId);
  if (ai < 0 || fi < 0) return null;
  const lo = Math.min(ai, fi);
  const hi = Math.max(ai, fi);
  const layerIds: number[] = [];
  for (let i = lo; i <= hi; i++) if (isDrawingLayer(display[i])) layerIds.push(display[i].id);
  if (layerIds.length === 0) return null;
  return {
    layerIds,
    startFrame: Math.min(anchor.frame, focus.frame),
    endFrame: Math.max(anchor.frame, focus.frame),
  };
}
