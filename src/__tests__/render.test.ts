import { describe, it, expect } from "vitest";
import type { Cell, DrawingLayer, Project } from "../anim/document";
import { renderFrame, compositeFrameLayers } from "../anim/render";

function recordingCtx() {
  const calls: string[] = [];
  const ctx = {
    calls,
    canvas: { width: 100, height: 100 },
    globalAlpha: 1,
    fillStyle: "",
    // setTransform is transform plumbing, not a paint op — intentionally not recorded
    // so the call-order assertions reflect the visible drawing sequence.
    setTransform: () => {},
    clearRect: () => calls.push("clearRect"),
    fillRect: () => calls.push(`fillRect:${ctx.fillStyle}`),
    drawImage: (img: { __id: number }) => calls.push(`drawImage:${img.__id}@${ctx.globalAlpha}`),
  };
  return ctx;
}

let id = 0;
const keyCanvas = () => ({ __id: ++id }) as unknown as HTMLCanvasElement;
function layer(cells: Cell[], over: Partial<DrawingLayer> = {}): DrawingLayer {
  return { kind: "draw", id: 1, name: "L", visible: true, locked: false, opacity: 100, cells, ...over };
}

describe("renderFrame", () => {
  it("clears, fills the background, then draws each layer keyframe bottom→top with layer alpha", () => {
    const c1 = keyCanvas();
    const c2 = keyCanvas();
    const p: Project = {
      width: 100, height: 100, fps: 12, bgColor: "#abc", frameCount: 1,
      layers: [
        layer([{ kind: "key", canvas: c1 }], { id: 1 }),
        layer([{ kind: "key", canvas: c2 }], { id: 2, opacity: 50 }),
      ],
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
      width: 100, height: 100, fps: 12, bgColor: "#abc", frameCount: 1,
      layers: [layer([{ kind: "key", canvas: keyCanvas() }])],
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
      width: 100, height: 100, fps: 12, bgColor: "#abc", frameCount: 1,
      layers: [
        layer([{ kind: "key", canvas: c1 }], { id: 1 }),
        layer([{ kind: "key", canvas: c2 }], { id: 2, opacity: 50 }),
      ],
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
