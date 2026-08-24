import { describe, it, expect } from "vitest";
import { opacityByte, planPsdFrame } from "../export/psd-plan";
import {
  createDrawingLayer,
  createReferenceLayer,
  defaultBoilConfig,
  type DrawingLayer,
  type Layer,
  type LayerGroup,
  type Project,
} from "../anim/document";
import type { PsdNode } from "../export/psd";

function project(layers: Layer[], groups: LayerGroup[] = []): Project {
  return {
    name: "t",
    width: 100,
    height: 100,
    fps: 12,
    bgColor: "#fff",
    frameCount: 4,
    boil: defaultBoilConfig(),
    groups,
    layers,
    audio: null,
  };
}

function draw(name: string, over: Partial<DrawingLayer> = {}): DrawingLayer {
  return Object.assign(createDrawingLayer(4, name), over);
}

function group(id: number, name: string, over: Partial<LayerGroup> = {}): LayerGroup {
  return { id, name, collapsed: false, visible: true, ...over };
}

/** A `renderLayer` that keeps every layer, recording the order it was asked in. */
function keepAll(seen: string[] = []) {
  const fn = (layer: DrawingLayer, opacity: number): PsdNode => {
    seen.push(layer.name);
    return { kind: "layer", name: layer.name, opacity, rect: ZERO, pixels: NONE };
  };
  return Object.assign(fn, { seen });
}

const ZERO = { top: 0, left: 0, bottom: 0, right: 0 };
const NONE = () => new Uint8ClampedArray(0);

/** Flatten to `name@opacity`, with a group's children in parentheses. */
function shape(nodes: PsdNode[]): string {
  return nodes
    .map((n) =>
      n.kind === "layer"
        ? `${n.name}@${n.opacity}`
        : `${n.name}@${n.opacity}(${shape(n.children)})`,
    )
    .join(",");
}

describe("opacityByte", () => {
  it("maps 0..100 onto 0..255", () => {
    expect(opacityByte(0)).toBe(0);
    expect(opacityByte(100)).toBe(255);
    expect(opacityByte(50)).toBe(128); // 127.5 rounds up
  });

  it("clamps out-of-range values instead of letting u8 wrap them", () => {
    // Bytes.u8 masks with 0xff, so an unclamped 300 would arrive as 44 — a layer at 17% opacity
    // with nothing reporting a problem.
    expect(opacityByte(300)).toBe(255);
    expect(opacityByte(-20)).toBe(0);
  });

  it("degrades a non-finite value to fully opaque, not to invisible", () => {
    expect(opacityByte(NaN)).toBe(255);
  });
});

describe("planPsdFrame", () => {
  it("keeps project.layers' bottom-first order and drops reference layers", () => {
    const p = project([
      draw("bottom"),
      createReferenceLayer({ type: "missing", was: "image", name: "r" }, "ref"),
      draw("top"),
    ]);
    const render = keepAll();
    expect(shape(planPsdFrame(p, 0, render))).toBe("bottom@255,top@255");
    expect(render.seen).toEqual(["bottom", "top"]); // never asked about the reference layer
  });

  it("drops a hidden layer without rendering it", () => {
    const p = project([draw("shown"), draw("hidden", { visible: false })]);
    const render = keepAll();
    expect(shape(planPsdFrame(p, 0, render))).toBe("shown@255");
    expect(render.seen).toEqual(["shown"]);
  });

  it("nests a group's members bottom-first under a folder carrying the group's opacity", () => {
    const g = group(7, "arm", { opacity: 40 });
    const p = project(
      [draw("under"), draw("lo", { groupId: 7 }), draw("hi", { groupId: 7 }), draw("over")],
      [g],
    );
    expect(shape(planPsdFrame(p, 0, keepAll()))).toBe("under@255,arm@102(lo@255,hi@255),over@255");
  });

  it("does NOT multiply the group's opacity into its members", () => {
    // buildFrameDrawList does exactly that, correctly, for a FLAT export. Sourcing it here would
    // double-apply once the folder carries the group's opacity too: 50% of 50% renders at 25%.
    const g = group(1, "g", { opacity: 50 });
    const p = project([draw("member", { groupId: 1, opacity: 50 })], [g]);
    expect(shape(planPsdFrame(p, 0, keepAll()))).toBe("g@128(member@128)");
  });

  it("drops a hidden group and every layer inside it", () => {
    const g = group(1, "g", { visible: false });
    const p = project([draw("inside", { groupId: 1 }), draw("outside")], [g]);
    const render = keepAll();
    expect(shape(planPsdFrame(p, 0, render))).toBe("outside@255");
    expect(render.seen).toEqual(["outside"]); // isLayerVisible is group-aware; never the raw flag
  });

  it("drops a layer with no ink, and the folder it empties", () => {
    const g = group(1, "g");
    const p = project([draw("blank", { groupId: 1 }), draw("inked")], [g]);
    const nodes = planPsdFrame(p, 0, (layer, opacity) =>
      layer.name === "blank"
        ? null
        : { kind: "layer", name: layer.name, opacity, rect: ZERO, pixels: NONE },
    );
    expect(shape(nodes)).toBe("inked@255");
  });

  it("keeps a folder that still has one surviving member", () => {
    const g = group(1, "g");
    const p = project([draw("blank", { groupId: 1 }), draw("inked", { groupId: 1 })], [g]);
    const nodes = planPsdFrame(p, 0, (layer, opacity) =>
      layer.name === "blank"
        ? null
        : { kind: "layer", name: layer.name, opacity, rect: ZERO, pixels: NONE },
    );
    expect(shape(nodes)).toBe("g@255(inked@255)");
  });

  it("resolves an animated opacity at the exported frame, layer and group alike", () => {
    const g = group(1, "g", {
      opacity: 100,
      tracks: {
        opacity: {
          keys: [
            { frame: 0, v: 100 },
            { frame: 4, v: 0 },
          ],
        },
      },
    });
    const p = project(
      [
        draw("m", {
          groupId: 1,
          tracks: {
            opacity: {
              keys: [
                { frame: 0, v: 0 },
                { frame: 4, v: 100 },
              ],
            },
          },
        }),
      ],
      [g],
    );
    expect(shape(planPsdFrame(p, 1, keepAll()))).toBe("g@191(m@64)"); // 75% and 25%
  });

  it("emits an empty tree when every layer is hidden or blank", () => {
    const p = project([draw("a", { visible: false }), draw("b")]);
    expect(planPsdFrame(p, 0, () => null)).toEqual([]);
  });

  it("renders a group split by an ungrouped layer as two folders, matching the panel", () => {
    // buildSegments assumes contiguity and blocks what it finds; the PSD says the same thing the
    // layer panel does rather than silently re-gathering the members.
    const g = group(1, "g");
    const p = project([draw("a", { groupId: 1 }), draw("mid"), draw("b", { groupId: 1 })], [g]);
    expect(shape(planPsdFrame(p, 0, keepAll()))).toBe("g@255(a@255),mid@255,g@255(b@255)");
  });
});
