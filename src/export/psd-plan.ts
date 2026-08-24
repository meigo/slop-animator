/**
 * What goes into a PSD, and in what order — the decisions, with no canvas in them.
 *
 * The driver (`psd-frame.ts`) owns pixels: rendering a layer through its compose chain, measuring
 * its ink, cropping it. Everything ELSE about the tree — which layers survive, how they nest, what
 * opacity byte each one carries, which folders are worth writing — is ordinary data shaping, so it
 * lives here where Vitest can reach it. Canvas code in this project is review-verified only; this
 * split is what keeps the reviewable part small.
 *
 * The one canvas-side decision the shape depends on ("does this layer have ink at this frame?") is
 * injected as `renderLayer`, which returns `null` for a layer with nothing on it.
 */
import {
  groupOpacityAt,
  isDrawingLayer,
  isLayerVisible,
  opacityAt,
  type DrawingLayer,
  type Layer,
  type Project,
} from "../anim/document";
import { buildSegments } from "../anim/row-layout";
import type { PsdNode } from "./psd";

/**
 * A 0..100 opacity as PSD's 0..255 byte.
 *
 * Clamped, and NOT because the app's own values need it: an opacity track lerps between its keys
 * and the eases stay inside [0,1], so nothing here overshoots today. It is a hand-edited or
 * corrupt file that gets you a 300, and `Bytes.u8` masks with 0xff — so 300 would arrive as 44,
 * i.e. a layer at 17% with nothing anywhere reporting a problem. A non-finite value degrades to
 * fully OPAQUE rather than to 0, on the same reasoning `quantiseFrame` uses for a corrupt
 * `sampleEvery`: a layer that is visibly too solid is a bug you can see, one that vanished is not.
 */
export function opacityByte(percent: number): number {
  if (!Number.isFinite(percent)) return 255;
  // `* 255 / 100`, not the shorthand `* 2.55`: 2.55 has no exact binary representation, so
  // `50 * 2.55` is 127.49999999999999 and rounds DOWN to 127 where the linear map wants 127.5 →
  // 128. Same intent, one integer multiply first, and no value that lands a least-significant bit
  // away from where the arithmetic says it should.
  return Math.round((Math.min(100, Math.max(0, percent)) * 255) / 100);
}

/**
 * Build the PSD node tree for `frame`, bottom-first.
 *
 * Ordering comes from `buildSegments`, the same function the layer panel and the timeline use, so
 * the folder structure a colourist opens matches the stack the animator sees — including the
 * split-group case, which `buildSegments` renders as two blocks rather than reordering anything.
 * It returns TOP-first, so both it and each group's members are reversed here: PSD's file order is
 * bottom-up, which is also `project.layers`' own order.
 *
 * Dropped, per the spec: reference layers, layers that are not visible (through
 * `isLayerVisible`, never the raw flag, so a member of a hidden group goes with it), layers with
 * no ink (`renderLayer` returning null), and any group left with no surviving members — an empty
 * folder is clutter in a panel someone has to navigate. A HIDDEN group needs no rule of its own:
 * every member fails `isLayerVisible`, so the folder empties and the last rule takes it.
 *
 * **Opacity is read directly and never via `buildFrameDrawList`.** That function multiplies the
 * group's opacity into each layer's, which is right for a flat export and double-applies the
 * moment the group is also a real folder carrying its own — a silent failure, since the file opens
 * with every layer present and merely darker inside a group than the editor shows.
 */
export function planPsdFrame(
  project: Project,
  frame: number,
  renderLayer: (layer: DrawingLayer, opacity: number) => PsdNode | null,
): PsdNode[] {
  const include = (layer: Layer): PsdNode | null => {
    if (!isDrawingLayer(layer)) return null;
    if (!isLayerVisible(layer, project.groups)) return null;
    return renderLayer(layer, opacityByte(opacityAt(layer, frame)));
  };

  const nodes: PsdNode[] = [];
  for (const seg of [...buildSegments(project.layers, project.groups)].reverse()) {
    if ("layer" in seg) {
      const node = include(seg.layer);
      if (node) nodes.push(node);
      continue;
    }
    const children: PsdNode[] = [];
    for (const layer of [...seg.layers].reverse()) {
      const node = include(layer);
      if (node) children.push(node);
    }
    if (children.length === 0) continue;
    nodes.push({
      kind: "group",
      name: seg.group.name,
      opacity: opacityByte(groupOpacityAt(seg.group, frame)),
      children,
    });
  }
  return nodes;
}
