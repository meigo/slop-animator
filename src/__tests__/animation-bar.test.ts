import { describe, expect, it } from "vitest";
import { animationBar } from "../anim/animation-bar";
import type { Layer, LayerGroup } from "../anim/document";

const draw = (id: number, extra: Partial<Layer> = {}): Layer =>
  ({
    kind: "draw",
    id,
    name: `L${id}`,
    visible: true,
    locked: false,
    groupId: null,
    cells: [],
    ...extra,
  }) as Layer;

const group = (id: number, extra: Partial<LayerGroup> = {}): LayerGroup =>
  ({ id, name: `G${id}`, collapsed: false, ...extra }) as LayerGroup;

const args = (over: Partial<Parameters<typeof animationBar>[0]> = {}) =>
  animationBar({
    activeRow: { kind: "layer", id: 1 },
    layers: [draw(1)],
    groups: [],
    playhead: 0,
    fps: 12,
    ...over,
  });

describe("animationBar — start", () => {
  it("offers transform and opacity on a still layer", () => {
    const bar = args();
    expect(bar.kind).toBe("start");
    if (bar.kind !== "start") return;
    expect(bar.items.map((i) => i.action)).toEqual(["animate-transform", "animate-opacity"]);
    expect(bar.items.every((i) => i.blocked === null)).toBe(true);
  });

  it("omits a property that already has a track", () => {
    const bar = args({
      layers: [
        draw(1, {
          tracks: {
            transform: {
              keys: [{ frame: 0, v: { dx: 0, dy: 0, scale: 1, rotation: 0 } }],
              box: null,
            },
          },
        }),
      ],
    });
    expect(bar.kind).toBe("start");
    if (bar.kind !== "start") return;
    expect(bar.items.map((i) => i.action)).toEqual(["animate-opacity"]);
  });

  it("is empty when every applicable property is already animated", () => {
    const bar = args({
      layers: [
        draw(1, {
          tracks: {
            transform: {
              keys: [{ frame: 0, v: { dx: 0, dy: 0, scale: 1, rotation: 0 } }],
              box: null,
            },
            opacity: { keys: [{ frame: 0, v: 100 }] },
          },
        }),
      ],
    });
    expect(bar).toEqual({ kind: "empty" });
  });

  it("offers Animate group only when the layer is in a group that is not yet animated", () => {
    const g = group(10);
    const bar = args({
      layers: [draw(1, { groupId: 10 })],
      groups: [g],
    });
    expect(bar.kind).toBe("start");
    if (bar.kind !== "start") return;
    expect(bar.items.map((i) => i.action)).toEqual([
      "animate-transform",
      "animate-opacity",
      "animate-group",
      "animate-group-opacity",
    ]);
  });

  it("omits Animate group when the group already has a track", () => {
    const bar = args({
      layers: [draw(1, { groupId: 10 })],
      groups: [
        group(10, {
          tracks: {
            transform: {
              keys: [{ frame: 0, v: { dx: 0, dy: 0, scale: 1, rotation: 0 } }],
              box: null,
            },
          },
        }),
      ],
    });
    expect(bar.kind).toBe("start");
    if (bar.kind !== "start") return;
    expect(bar.items.map((i) => i.action)).not.toContain("animate-group");
  });

  it("offers Animate group opacity when the member's group has no opacity track", () => {
    const bar = args({
      layers: [draw(1, { groupId: 10 })],
      groups: [group(10)],
    });
    expect(bar.kind).toBe("start");
    if (bar.kind !== "start") return;
    expect(bar.items.map((i) => i.action)).toContain("animate-group-opacity");
  });

  it("omits Animate group opacity once the group track exists", () => {
    const bar = args({
      layers: [draw(1, { groupId: 10 })],
      groups: [group(10, { tracks: { opacity: { keys: [{ frame: 0, v: 100 }] } } })],
    });
    expect(bar.kind).toBe("start");
    if (bar.kind !== "start") return;
    expect(bar.items.map((i) => i.action)).not.toContain("animate-group-opacity");
  });

  it("dims transform/opacity when the layer is locked, and says locked not hidden", () => {
    const bar = args({ layers: [draw(1, { locked: true, visible: false })] });
    expect(bar.kind).toBe("start");
    if (bar.kind !== "start") return;
    expect(
      bar.items.every((i) => i.action !== "animate-group" && i.blocked === "the layer is locked"),
    ).toBe(true);
  });

  it("dims transform/opacity when the layer is hidden", () => {
    const bar = args({ layers: [draw(1, { visible: false })] });
    expect(bar.kind).toBe("start");
    if (bar.kind !== "start") return;
    expect(bar.items.find((i) => i.action === "animate-transform")?.blocked).toBe(
      "the layer is hidden",
    );
  });

  it("dims Animate group when a member is locked", () => {
    const bar = args({
      layers: [draw(1, { groupId: 10, locked: true })],
      groups: [group(10)],
    });
    expect(bar.kind).toBe("start");
    if (bar.kind !== "start") return;
    expect(bar.items.find((i) => i.action === "animate-group")?.blocked).toBe(
      "a locked member pins the group",
    );
  });

  it("dims Animate transform when an image ref is outside its range, and still offers opacity", () => {
    const ref = {
      kind: "ref",
      id: 1,
      name: "R",
      visible: true,
      locked: false,
      groupId: null,
      opacity: 60,
      offsetFrames: 0,
      speed: 1,
      media: { type: "image", el: {} as HTMLImageElement },
      range: { start: 0, end: 5 },
      transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
    } as Layer;
    const bar = args({ layers: [ref], playhead: 10 });
    expect(bar.kind).toBe("start");
    if (bar.kind !== "start") return;
    expect(bar.items.find((i) => i.action === "animate-transform")?.blocked).toBe(
      "the reference is outside its visible range",
    );
    expect(bar.items.find((i) => i.action === "animate-opacity")?.blocked).toBeNull();
  });
});

describe("animationBar — keys", () => {
  it("shows key tools for a focused layer track", () => {
    const bar = args({
      activeRow: { kind: "track", owner: "layer", id: 1, prop: "transform" },
      layers: [
        draw(1, {
          tracks: {
            transform: {
              keys: [{ frame: 0, v: { dx: 0, dy: 0, scale: 1, rotation: 0 } }],
              box: null,
            },
          },
        }),
      ],
    });
    expect(bar).toMatchObject({
      kind: "keys",
      track: { owner: "layer", id: 1, prop: "transform" },
      blocked: null,
    });
  });

  it("shows key tools on opacity and group tracks too", () => {
    const opacity = args({
      activeRow: { kind: "track", owner: "layer", id: 1, prop: "opacity" },
      layers: [draw(1, { tracks: { opacity: { keys: [{ frame: 0, v: 100 }] } } })],
    });
    expect(opacity).toMatchObject({
      kind: "keys",
      track: { owner: "layer", id: 1, prop: "opacity" },
    });

    const grp = args({
      activeRow: { kind: "track", owner: "group", id: 10, prop: "transform" },
      layers: [draw(1, { groupId: 10 })],
      groups: [
        group(10, {
          tracks: {
            transform: {
              keys: [{ frame: 0, v: { dx: 0, dy: 0, scale: 1, rotation: 0 } }],
              box: null,
            },
          },
        }),
      ],
    });
    expect(grp).toMatchObject({
      kind: "keys",
      track: { owner: "group", id: 10, prop: "transform" },
      blocked: null,
    });
  });

  it("shows key tools for a focused group opacity row", () => {
    const bar = args({
      activeRow: { kind: "track", owner: "group", id: 10, prop: "opacity" },
      layers: [draw(1, { groupId: 10 })],
      groups: [group(10, { tracks: { opacity: { keys: [{ frame: 0, v: 40 }] } } })],
    });
    expect(bar).toMatchObject({
      kind: "keys",
      track: { owner: "group", id: 10, prop: "opacity" },
    });
  });

  it("dims key tools when the owner is locked; a hidden group stays allowed", () => {
    const locked = args({
      activeRow: { kind: "track", owner: "layer", id: 1, prop: "opacity" },
      layers: [draw(1, { locked: true, tracks: { opacity: { keys: [{ frame: 0, v: 100 }] } } })],
    });
    expect(locked).toMatchObject({ kind: "keys", blocked: "the layer is locked" });

    const hiddenGroup = args({
      activeRow: { kind: "track", owner: "group", id: 10, prop: "transform" },
      layers: [draw(1, { groupId: 10, visible: false })],
      groups: [
        group(10, {
          visible: false,
          tracks: {
            transform: {
              keys: [{ frame: 0, v: { dx: 0, dy: 0, scale: 1, rotation: 0 } }],
              box: null,
            },
          },
        }),
      ],
    });
    expect(hiddenGroup).toMatchObject({ kind: "keys", blocked: null });
  });
});

describe("animationBar — empty / audio / missing", () => {
  it("is empty on the audio lane", () => {
    expect(args({ activeRow: { kind: "audio" } })).toEqual({ kind: "empty" });
  });

  it("is empty when the focused track no longer exists", () => {
    expect(args({ activeRow: { kind: "track", owner: "layer", id: 1, prop: "opacity" } })).toEqual({
      kind: "empty",
    });
  });
});
