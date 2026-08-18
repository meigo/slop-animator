import { describe, it, expect } from "vitest";
import { animateTargetGroup, animateTargetLayer } from "../lib/transform-target";
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

describe("animateTargetGroup", () => {
  const grouped = draw({ groupId: 9 });
  const g = (over: Record<string, unknown> = {}) =>
    [{ id: 9, name: "G", collapsed: false, visible: true, ...over }] as LayerGroup[];

  it("is null with no layer", () => {
    expect(animateTargetGroup(null, g(), [], "transform", "group")).toBeNull();
  });

  // The exact complement of animateTargetLayer: it declines at group scope because the drag writes
  // the GROUP's transform, and this is who that key belongs to. Without the pair, Task 5's
  // animateGroup/removeGroupAnimation would have no caller and a group track could never exist.
  it("takes the group only under the Transform tool at group scope", () => {
    expect(animateTargetGroup(grouped, g(), [grouped], "transform", "group")).not.toBeNull();
    expect(animateTargetGroup(grouped, g(), [grouped], "transform", "layer")).toBeNull();
    expect(animateTargetGroup(grouped, g(), [grouped], "transform", "frame")).toBeNull();
    expect(animateTargetGroup(grouped, g(), [grouped], "brush", "group")).toBeNull();
  });

  it("is null for a layer that is in no group", () => {
    expect(animateTargetGroup(draw(), g(), [draw()], "transform", "group")).toBeNull();
  });

  // A locked MEMBER pins the whole group's transform (Photoshop-style), and groupHasLockedLayer
  // already reports a locked group itself — so this needs no separate `group.locked` check.
  it("refuses a locked group, and a group with a locked member", () => {
    expect(
      animateTargetGroup(grouped, g({ locked: true }), [grouped], "transform", "group"),
    ).toBeNull();
    const lockedMember = draw({ id: 3, groupId: 9, locked: true });
    expect(
      animateTargetGroup(grouped, g(), [grouped, lockedMember], "transform", "group"),
    ).toBeNull();
  });

  // Deliberately NOT symmetric with animateTargetLayer, which refuses a hidden layer: the gizmo
  // returns its layer unconditionally at group scope so a hidden anchor cannot veto a group drag,
  // so a hidden group IS draggable today — refusing to animate what you may still drag would be
  // the inconsistency, and Task 5's actions guard on lock alone for the same reason.
  it("allows a hidden group and a hidden anchor layer", () => {
    expect(
      animateTargetGroup(grouped, g({ visible: false }), [grouped], "transform", "group"),
    ).not.toBeNull();
    const hiddenLayer = draw({ groupId: 9, visible: false });
    expect(
      animateTargetGroup(hiddenLayer, g(), [hiddenLayer], "transform", "group"),
    ).not.toBeNull();
  });
});
