import { groupOf, isDrawingLayer, type Layer, type LayerGroup } from "./document";

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
 *  inclusive in display order (top-first = layers reversed), drawing layers only. Collapsed-group
 *  members have no timeline row and are skipped (same as refs). Returns null if either endpoint
 *  is missing or the span holds no visible drawing layer. */
export function resolveSelectionRect(
  layers: Layer[],
  anchor: SelectionEndpoint,
  focus: SelectionEndpoint,
  groups: LayerGroup[] = [],
): SelectionRect | null {
  const display = [...layers].reverse(); // top-first
  const ai = display.findIndex((l) => l.id === anchor.layerId);
  const fi = display.findIndex((l) => l.id === focus.layerId);
  if (ai < 0 || fi < 0) return null;
  const lo = Math.min(ai, fi);
  const hi = Math.max(ai, fi);
  const layerIds: number[] = [];
  for (let i = lo; i <= hi; i++) {
    const layer = display[i];
    if (!isDrawingLayer(layer)) continue;
    if (groupOf(layer, groups)?.collapsed) continue;
    layerIds.push(layer.id);
  }
  if (layerIds.length === 0) return null;
  return {
    layerIds,
    startFrame: Math.min(anchor.frame, focus.frame),
    endFrame: Math.max(anchor.frame, focus.frame),
  };
}
