import { describe, it, expect } from "vitest";
import { animateTargetLayer } from "../lib/transform-target";
import type { Layer, LayerGroup } from "../anim/document";

const FPS = 12;
const draw = (over: Partial<Layer> = {}) =>
  ({
    kind: "draw",
    id: 1,
    name: "L",
    visible: true,
    locked: false,
    groupId: null,
    ...over,
  }) as Layer;
const ref = (over: Record<string, unknown> = {}) =>
  ({
    kind: "ref",
    id: 2,
    name: "R",
    visible: true,
    locked: false,
    groupId: null,
    // An IMAGE, not `missing`: a missing-media ref deliberately resolves to "always visible"
    // (there is nothing to draw either way), so it cannot exercise the span at all.
    media: { type: "image", el: {} },
    ...over,
  }) as Layer;

describe("animateTargetLayer", () => {
  it("is null with no layer", () => {
    expect(animateTargetLayer(null, [], "transform", "layer", 0, FPS)).toBeNull();
  });

  // A draw layer is only animatable where a drag actually writes a KEY. At frame scope the drag
  // writes the cell's transform and at group scope the group's — neither touches the track.
  it("takes a drawing layer only under the Transform tool at layer scope", () => {
    expect(animateTargetLayer(draw(), [], "transform", "layer", 0, FPS)).not.toBeNull();
    expect(animateTargetLayer(draw(), [], "transform", "frame", 0, FPS)).toBeNull();
    expect(animateTargetLayer(draw(), [], "transform", "group", 0, FPS)).toBeNull();
    expect(animateTargetLayer(draw(), [], "brush", "layer", 0, FPS)).toBeNull();
  });

  // A ref's gizmo is live under every tool, which is why Reset-to-fit sits outside the per-tool
  // branches too — so the Animate controls must follow the gizmo, not the tool.
  it("takes a reference layer under any tool", () => {
    expect(animateTargetLayer(ref(), [], "brush", "frame", 0, FPS)).not.toBeNull();
  });

  it("refuses a locked or hidden layer", () => {
    expect(animateTargetLayer(draw({ locked: true }), [], "transform", "layer", 0, FPS)).toBeNull();
    expect(
      animateTargetLayer(draw({ visible: false }), [], "transform", "layer", 0, FPS),
    ).toBeNull();
  });

  // Group state is DERIVED, never cascaded onto members — reading the raw flag is a documented
  // recurring bug here, so pin that the group's own state refuses too.
  it("refuses via the layer's GROUP, not just its own flags", () => {
    const groups = [
      { id: 9, name: "G", collapsed: false, visible: true, locked: true },
    ] as LayerGroup[];
    expect(
      animateTargetLayer(draw({ groupId: 9 }), groups, "transform", "layer", 0, FPS),
    ).toBeNull();
    const hidden = [{ id: 9, name: "G", collapsed: false, visible: false }] as LayerGroup[];
    expect(
      animateTargetLayer(draw({ groupId: 9 }), hidden, "transform", "layer", 0, FPS),
    ).toBeNull();
  });

  // The gizmo hides its handles and the canvas refuses the drag outside a ref's span; this is the
  // third site offering the same affordance and must agree with both.
  it("refuses a reference layer outside its visible span", () => {
    const trimmed = ref({ range: { start: 0, end: 10 } });
    expect(animateTargetLayer(trimmed, [], "brush", "frame", 5, FPS)).not.toBeNull();
    expect(animateTargetLayer(trimmed, [], "brush", "frame", 30, FPS)).toBeNull();
  });
});
