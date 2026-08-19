import { describe, expect, it } from "vitest";
import { layerPanelActions } from "../anim/layer-panel-actions";
import type { Layer, LayerGroup } from "../anim/document";

const draw = (id: number, extra: Partial<Layer> = {}): Layer =>
  ({
    kind: "draw",
    id,
    name: `L${id}`,
    visible: true,
    locked: false,
    opacity: 100,
    boilStrength: 1,
    groupId: null,
    cells: [],
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
    ...extra,
  }) as Layer;

const ref = (id: number): Layer =>
  ({
    kind: "ref",
    id,
    name: `R${id}`,
    visible: true,
    opacity: 60,
    offsetFrames: 0,
    speed: 1,
    audioEnabled: false,
    groupId: null,
    media: { type: "missing", was: "image", name: "x" },
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
  }) as Layer;

const group = (id: number): LayerGroup => ({
  id,
  name: `G${id}`,
  collapsed: false,
  visible: true,
});

function actions(
  over: Partial<Parameters<typeof layerPanelActions>[0]> = {},
): ReturnType<typeof layerPanelActions> {
  return layerPanelActions({
    activeRow: { kind: "layer", id: 2 },
    layers: [draw(1), draw(2)],
    groups: [],
    ...over,
  });
}

describe("layerPanelActions — selected layer", () => {
  it("acts on the selected drawing layer, not merely the top of the stack", () => {
    const r = actions();
    expect(r.layerId).toBe(2);
    expect(r.duplicate.enabled).toBe(true);
    expect(r.merge.enabled).toBe(true);
    expect(r.group.enabled).toBe(true);
    expect(r.remove.enabled).toBe(true);
  });

  it("a layer-owned track is the same target as its owner", () => {
    const r = actions({
      activeRow: { kind: "track", owner: "layer", id: 2, prop: "opacity" },
    });
    expect(r.layerId).toBe(2);
    expect(r.duplicate.enabled).toBe(true);
    expect(r.group.enabled).toBe(true);
  });

  it("refuses to duplicate a reference and names why", () => {
    const r = actions({ activeRow: { kind: "layer", id: 3 }, layers: [draw(1), draw(2), ref(3)] });
    expect(r.layerId).toBe(3);
    expect(r.duplicate.enabled).toBe(false);
    expect(r.duplicate.title).toMatch(/drawing layers/i);
    expect(r.group.enabled).toBe(true);
    expect(r.remove.enabled).toBe(true);
  });

  it("refuses to delete the last drawing layer", () => {
    const r = actions({ activeRow: { kind: "layer", id: 1 }, layers: [draw(1)] });
    expect(r.remove.enabled).toBe(false);
    expect(r.remove.title).toMatch(/at least one drawing layer/i);
  });

  it("keeps the existing merge refusals (nothing below, not-drawing)", () => {
    expect(actions({ activeRow: { kind: "layer", id: 1 } }).merge.enabled).toBe(false);
    expect(
      actions({ activeRow: { kind: "layer", id: 3 }, layers: [draw(1), draw(2), ref(3)] }).merge
        .enabled,
    ).toBe(false);
  });
});

describe("layerPanelActions — non-layer working row", () => {
  it("audio does not act on a leftover drawing layer", () => {
    const r = actions({ activeRow: { kind: "audio" }, layers: [draw(1), draw(2)] });
    expect(r.layerId).toBeNull();
    expect(r.duplicate.enabled).toBe(false);
    expect(r.merge.enabled).toBe(false);
    expect(r.group.enabled).toBe(false);
    expect(r.remove.enabled).toBe(false);
    expect(r.duplicate.title).toMatch(/select a layer/i);
    expect(r.merge.title).toMatch(/select a layer/i);
    expect(r.group.title).toMatch(/select a layer/i);
    expect(r.remove.title).toMatch(/select a layer/i);
  });

  it("a selected group does not act on a leftover member", () => {
    const r = actions({
      activeRow: { kind: "group", id: 10 },
      layers: [draw(1, { groupId: 10 }), draw(2, { groupId: 10 })],
      groups: [group(10)],
    });
    expect(r.layerId).toBeNull();
    expect(r.duplicate.enabled).toBe(false);
    expect(r.merge.enabled).toBe(false);
    expect(r.group.enabled).toBe(false);
    expect(r.remove.enabled).toBe(false);
  });

  it("a group-owned track is the group, not its draw-target member", () => {
    const r = actions({
      activeRow: { kind: "track", owner: "group", id: 10, prop: "transform" },
      layers: [draw(1, { groupId: 10 }), draw(2, { groupId: 10 })],
      groups: [group(10)],
    });
    expect(r.layerId).toBeNull();
    expect(r.duplicate.enabled).toBe(false);
    expect(r.group.enabled).toBe(false);
    expect(r.remove.enabled).toBe(false);
  });
});
