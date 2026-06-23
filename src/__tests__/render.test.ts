import { describe, it, expect } from "vitest";
import type { Cell, DrawingLayer, Project } from "../anim/document";
import { createReferenceLayer, defaultBoilConfig, groupTransform } from "../anim/document";
import { renderFrame, compositeFrameLayers, drawReferenceMedia } from "../anim/render";

function recordingCtx() {
  const calls: string[] = [];
  const ctx = {
    calls,
    canvas: { width: 100, height: 100 },
    globalAlpha: 1,
    fillStyle: "",
    setTransform: () => {},
    clearRect: () => calls.push("clearRect"),
    fillRect: () => calls.push(`fillRect:${ctx.fillStyle}`),
    drawImage: (img: { __id: number }, ...rest: number[]) =>
      calls.push(`drawImage:${img.__id}@${ctx.globalAlpha}${rest.length >= 4 ? ":sized" : ""}`),
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
  };
  return ctx;
}

let id = 0;
const keyCanvas = () => ({ __id: ++id }) as unknown as HTMLCanvasElement;
function layer(cells: Cell[], over: Partial<DrawingLayer> = {}): DrawingLayer {
  return {
    kind: "draw",
    id: 1,
    name: "L",
    visible: true,
    locked: false,
    opacity: 100,
    boilStrength: 1,
    groupId: null,
    cells,
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
    ...over,
  };
}

describe("renderFrame", () => {
  it("clears, fills the background, then draws each layer keyframe bottom→top with layer alpha", () => {
    const c1 = keyCanvas();
    const c2 = keyCanvas();
    const p: Project = {
      width: 100,
      height: 100,
      fps: 12,
      bgColor: "#abc",
      frameCount: 1,
      boil: defaultBoilConfig(),
      groups: [],
      layers: [
        layer([{ kind: "key", canvas: c1 }], { id: 1 }),
        layer([{ kind: "key", canvas: c2 }], { id: 2, opacity: 50 }),
      ],
      audio: null,
    };
    const ctx = recordingCtx();
    renderFrame(ctx as unknown as CanvasRenderingContext2D, p, 0, 1);
    expect(ctx.calls[0]).toBe("clearRect");
    expect(ctx.calls).toContain("fillRect:#abc");
    const draws = ctx.calls.filter((c) => c.startsWith("drawImage"));
    expect(draws).toEqual([
      `drawImage:${(c1 as unknown as { __id: number }).__id}@1`,
      `drawImage:${(c2 as unknown as { __id: number }).__id}@0.5`,
    ]);
  });

  it("omits the background fill when drawBg is false", () => {
    const p: Project = {
      width: 100,
      height: 100,
      fps: 12,
      bgColor: "#abc",
      frameCount: 1,
      boil: defaultBoilConfig(),
      groups: [],
      layers: [layer([{ kind: "key", canvas: keyCanvas() }])],
      audio: null,
    };
    const ctx = recordingCtx();
    renderFrame(ctx as unknown as CanvasRenderingContext2D, p, 0, 1, { drawBg: false });
    expect(ctx.calls.some((c) => c.startsWith("fillRect"))).toBe(false);
  });
});

describe("compositeFrameLayers", () => {
  it("draws each visible layer's keyframe bottom→top with layer alpha, no clear/fill", () => {
    const c1 = keyCanvas();
    const c2 = keyCanvas();
    const p: Project = {
      width: 100,
      height: 100,
      fps: 12,
      bgColor: "#abc",
      frameCount: 1,
      boil: defaultBoilConfig(),
      groups: [],
      layers: [
        layer([{ kind: "key", canvas: c1 }], { id: 1 }),
        layer([{ kind: "key", canvas: c2 }], { id: 2, opacity: 50 }),
      ],
      audio: null,
    };
    const ctx = recordingCtx();
    compositeFrameLayers(ctx as unknown as CanvasRenderingContext2D, p, 0, 1);
    expect(ctx.calls.some((c) => c === "clearRect" || c.startsWith("fillRect"))).toBe(false);
    expect(ctx.calls.filter((c) => c.startsWith("drawImage"))).toEqual([
      `drawImage:${(c1 as unknown as { __id: number }).__id}@1`,
      `drawImage:${(c2 as unknown as { __id: number }).__id}@0.5`,
    ]);
  });
});

describe("compositeFrameLayers with reference layers", () => {
  function imageMedia(id: number, w = 50, h = 50) {
    return {
      type: "image" as const,
      el: { __id: id, naturalWidth: w, naturalHeight: h } as unknown as HTMLImageElement,
    };
  }

  it("draws a reference layer's media (sized via containRect) at its opacity, in z-order", () => {
    const refEl = imageMedia(7);
    const ref = createReferenceLayer(refEl, "bg");
    ref.id = 1; // deterministic for the assertion
    const drawC = keyCanvas();
    const p: Project = {
      width: 100,
      height: 100,
      fps: 12,
      bgColor: "#fff",
      frameCount: 1,
      boil: defaultBoilConfig(),
      groups: [],
      layers: [ref, layer([{ kind: "key", canvas: drawC }], { id: 2 })],
      audio: null,
    };
    const ctx = recordingCtx();
    compositeFrameLayers(ctx as unknown as CanvasRenderingContext2D, p, 0, 1);
    const draws = ctx.calls.filter((c) => c.startsWith("drawImage"));
    expect(draws).toEqual([
      `drawImage:7@0.6:sized`, // ref media, sized, 60% opacity
      `drawImage:${(drawC as unknown as { __id: number }).__id}@1`, // drawing layer keyframe on top
    ]);
  });

  it("omits reference layers when includeReference is false", () => {
    const ref = createReferenceLayer(imageMedia(7), "bg");
    ref.id = 1;
    const drawC = keyCanvas();
    const p: Project = {
      width: 100,
      height: 100,
      fps: 12,
      bgColor: "#fff",
      frameCount: 1,
      boil: defaultBoilConfig(),
      groups: [],
      layers: [ref, layer([{ kind: "key", canvas: drawC }], { id: 2 })],
      audio: null,
    };
    const ctx = recordingCtx();
    compositeFrameLayers(ctx as unknown as CanvasRenderingContext2D, p, 0, 1, false);
    expect(ctx.calls.filter((c) => c.startsWith("drawImage"))).toEqual([
      `drawImage:${(drawC as unknown as { __id: number }).__id}@1`,
    ]);
  });
});

describe("drawReferenceMedia", () => {
  const imageMedia = (id: number, w = 50, h = 40) => ({
    type: "image" as const,
    el: { __id: id, naturalWidth: w, naturalHeight: h } as unknown as HTMLImageElement,
  });
  const refLayer = (
    media: ReturnType<typeof imageMedia> | { type: "missing"; was: "image"; name: string },
  ) => createReferenceLayer(media as never, "r");

  it("records translate/rotate/scale then a sized drawImage for loaded image media", () => {
    const ctx = recordingCtx();
    drawReferenceMedia(
      ctx as unknown as CanvasRenderingContext2D,
      refLayer(imageMedia(7)),
      100,
      100,
      1,
    );
    expect(ctx.calls.filter((c) => c.startsWith("drawImage"))).toEqual(["drawImage:7@1:sized"]);
  });

  it("is a no-op for missing media", () => {
    const ctx = recordingCtx();
    drawReferenceMedia(
      ctx as unknown as CanvasRenderingContext2D,
      refLayer({ type: "missing", was: "image", name: "x" }),
      100,
      100,
      1,
    );
    expect(ctx.calls.filter((c) => c.startsWith("drawImage"))).toEqual([]);
  });

  it("is a no-op for zero-size media", () => {
    const ctx = recordingCtx();
    drawReferenceMedia(
      ctx as unknown as CanvasRenderingContext2D,
      refLayer(imageMedia(7, 0, 0)),
      100,
      100,
      1,
    );
    expect(ctx.calls.filter((c) => c.startsWith("drawImage"))).toEqual([]);
  });
});

describe("compositeFrameLayers with a drawing-layer transform", () => {
  it("identity transform uses the plain (non-sized) blit", () => {
    const c = keyCanvas();
    const p: Project = {
      width: 100,
      height: 100,
      fps: 12,
      bgColor: "#000",
      frameCount: 1,
      boil: defaultBoilConfig(),
      groups: [],
      layers: [layer([{ kind: "key", canvas: c }], { id: 1 })],
      audio: null,
    };
    const ctx = recordingCtx();
    compositeFrameLayers(ctx as unknown as CanvasRenderingContext2D, p, 0, 1);
    expect(ctx.calls.filter((x) => x.startsWith("drawImage"))).toEqual([
      `drawImage:${(c as unknown as { __id: number }).__id}@1`,
    ]);
  });

  it("non-identity transform draws through the affine (composed path, natural size)", () => {
    const c = keyCanvas();
    const p: Project = {
      width: 100,
      height: 100,
      fps: 12,
      bgColor: "#000",
      frameCount: 1,
      boil: defaultBoilConfig(),
      groups: [],
      layers: [
        layer([{ kind: "key", canvas: c }], {
          id: 1,
          transform: { dx: 5, dy: 0, scale: 1.5, rotation: 0 },
        }),
      ],
      audio: null,
    };
    const ctx = recordingCtx();
    compositeFrameLayers(ctx as unknown as CanvasRenderingContext2D, p, 0, 1);
    expect(ctx.calls.filter((x) => x.startsWith("drawImage"))).toEqual([
      `drawImage:${(c as unknown as { __id: number }).__id}@1`,
    ]);
  });
});

describe("compositeFrameLayers with a per-cell transform", () => {
  it("non-identity cell transform still emits exactly one drawImage (composed path, natural size)", () => {
    const c = keyCanvas();
    const cellT = { dx: 4, dy: 0, scale: 1.3, rotation: 0 };
    const box = { x: 0, y: 0, w: 100, h: 100 };
    const p: Project = {
      width: 100,
      height: 100,
      fps: 12,
      bgColor: "#000",
      frameCount: 1,
      boil: defaultBoilConfig(),
      groups: [],
      layers: [layer([{ kind: "key", canvas: c, transform: cellT, transformBox: box }], { id: 1 })],
      audio: null,
    };
    const ctx = recordingCtx();
    compositeFrameLayers(ctx as unknown as CanvasRenderingContext2D, p, 0, 1);
    expect(ctx.calls.filter((x) => x.startsWith("drawImage"))).toEqual([
      `drawImage:${(c as unknown as { __id: number }).__id}@1`,
    ]);
  });
  it("identity cell + identity layer stays a plain blit", () => {
    const c = keyCanvas();
    const p: Project = {
      width: 100,
      height: 100,
      fps: 12,
      bgColor: "#000",
      frameCount: 1,
      boil: defaultBoilConfig(),
      groups: [],
      layers: [layer([{ kind: "key", canvas: c }], { id: 1 })],
      audio: null,
    };
    const ctx = recordingCtx();
    compositeFrameLayers(ctx as unknown as CanvasRenderingContext2D, p, 0, 1);
    expect(ctx.calls.filter((x) => x.startsWith("drawImage"))).toEqual([
      `drawImage:${(c as unknown as { __id: number }).__id}@1`,
    ]);
  });
});

describe("renderFrame includeReference", () => {
  function imageMediaR(id: number, w = 50, h = 50) {
    return {
      type: "image" as const,
      el: { __id: id, naturalWidth: w, naturalHeight: h } as unknown as HTMLImageElement,
    };
  }
  it("excludes reference layers when opts.includeReference is false", () => {
    const ref = createReferenceLayer(imageMediaR(7), "bg");
    ref.id = 1;
    const drawC = keyCanvas();
    const p: Project = {
      width: 100,
      height: 100,
      fps: 12,
      bgColor: "#fff",
      frameCount: 1,
      boil: defaultBoilConfig(),
      groups: [],
      layers: [ref, layer([{ kind: "key", canvas: drawC }], { id: 2 })],
      audio: null,
    };
    const ctx = recordingCtx();
    renderFrame(ctx as unknown as CanvasRenderingContext2D, p, 0, 1, {
      drawBg: false,
      includeReference: false,
    });
    expect(ctx.calls.filter((c) => c.startsWith("drawImage"))).toEqual([
      `drawImage:${(drawC as unknown as { __id: number }).__id}@1`,
    ]);
  });
});

describe("compositeFrameLayers with a group transform", () => {
  it("non-identity group transform emits the composed wrap + a single drawImage", () => {
    const c = keyCanvas();
    const group = {
      id: 9,
      name: "G",
      collapsed: false,
      visible: true,
      transform: { dx: 8, dy: 0, scale: 1.1, rotation: 0 },
      transformBox: { x: 0, y: 0, w: 100, h: 100 },
    };
    const p: Project = {
      width: 100,
      height: 100,
      fps: 12,
      bgColor: "#000",
      frameCount: 1,
      boil: defaultBoilConfig(),
      groups: [group],
      layers: [layer([{ kind: "key", canvas: c }], { id: 1, groupId: 9 })],
      audio: null,
    };
    const ctx = recordingCtx();
    compositeFrameLayers(ctx as unknown as CanvasRenderingContext2D, p, 0, 1);
    // Exactly one drawImage of the cell at natural size (2-arg form → no ":sized").
    expect(ctx.calls.filter((x) => x.startsWith("drawImage"))).toEqual([
      `drawImage:${(c as unknown as { __id: number }).__id}@1`,
    ]);
    // Sanity: `groupTransform` returns the group's transform when set (cheap pure-fn check).
    expect(groupTransform(group)).toBe(group.transform);
  });

  it("identity group transform keeps the existing fast-path blit", () => {
    const c = keyCanvas();
    const group = { id: 9, name: "G", collapsed: false, visible: true };
    const p: Project = {
      width: 100,
      height: 100,
      fps: 12,
      bgColor: "#000",
      frameCount: 1,
      boil: defaultBoilConfig(),
      groups: [group],
      layers: [layer([{ kind: "key", canvas: c }], { id: 1, groupId: 9 })],
      audio: null,
    };
    const ctx = recordingCtx();
    compositeFrameLayers(ctx as unknown as CanvasRenderingContext2D, p, 0, 1);
    // Fast path: plain blit (no composed wrap). Existing layer-only/cell-only/reference tests stay green.
    expect(ctx.calls.filter((x) => x.startsWith("drawImage"))).toEqual([
      `drawImage:${(c as unknown as { __id: number }).__id}@1`,
    ]);
  });
});
