import { describe, it, expect } from "vitest";
import { computeOnionFrames, ONION_BASE_OPACITY } from "../anim/onion";

describe("computeOnionFrames", () => {
  it("returns nothing when both counts are zero", () => {
    expect(computeOnionFrames(3, 10, 0, 0)).toEqual([]);
  });

  it("emits prev frames (farthest→nearest) then next frames (farthest→nearest)", () => {
    expect(computeOnionFrames(3, 10, 2, 2)).toEqual([
      { frame: 1, kind: "prev", opacity: ONION_BASE_OPACITY * 0.5 },
      { frame: 2, kind: "prev", opacity: ONION_BASE_OPACITY * 1.0 },
      { frame: 5, kind: "next", opacity: ONION_BASE_OPACITY * 0.5 },
      { frame: 4, kind: "next", opacity: ONION_BASE_OPACITY * 1.0 },
    ]);
  });

  it("clamps at the start of the timeline (no negative frames)", () => {
    expect(computeOnionFrames(0, 3, 2, 1)).toEqual([
      { frame: 1, kind: "next", opacity: ONION_BASE_OPACITY * 1.0 },
    ]);
  });

  it("clamps at the end of the timeline (no frames past the last)", () => {
    expect(computeOnionFrames(2, 3, 1, 2)).toEqual([
      { frame: 1, kind: "prev", opacity: ONION_BASE_OPACITY * 1.0 },
    ]);
  });

  it("with count 1 each, nearest neighbours at full base opacity", () => {
    expect(computeOnionFrames(5, 10, 1, 1)).toEqual([
      { frame: 4, kind: "prev", opacity: ONION_BASE_OPACITY },
      { frame: 6, kind: "next", opacity: ONION_BASE_OPACITY },
    ]);
  });
});

import { renderFrameWithOnion, type OnionConfig } from "../anim/onion";
import type { Project, Cell, DrawingLayer } from "../anim/document";

function recCtx(w = 100, h = 100) {
  const calls: string[] = [];
  const ctx = {
    calls,
    canvas: { width: w, height: h },
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "",
    setTransform: () => {},
    clearRect: () => calls.push("clear"),
    fillRect: () => calls.push(`fill:${ctx.fillStyle}:${ctx.globalCompositeOperation}`),
    drawImage: (img: { __id: number }) => calls.push(`draw:${img.__id}@${ctx.globalAlpha}`),
  };
  return ctx;
}

let oid = 0;
const kc = () => ({ __id: ++oid }) as unknown as HTMLCanvasElement;
function dlayer(id: number, cells: Cell[]): DrawingLayer {
  return { kind: "draw", id, name: `L${id}`, visible: true, locked: false, opacity: 100, cells };
}

describe("renderFrameWithOnion", () => {
  const onion: OnionConfig = {
    enabled: true, prev: 1, next: 1, allLayers: false,
    tintPrev: "#ff0000", tintNext: "#0000ff",
  };

  it("draws bg, then the prev ghost (tinted+faded) and next ghost, then the current frame on top", () => {
    const prevC = kc(); const curC = kc(); const nextC = kc();
    const layerId = 1;
    const p: Project = {
      width: 100, height: 100, fps: 12, bgColor: "#eee", frameCount: 3,
      layers: [dlayer(layerId, [
        { kind: "key", canvas: prevC }, { kind: "key", canvas: curC }, { kind: "key", canvas: nextC },
      ])],
    };
    const display = recCtx();
    const scratch = recCtx();
    renderFrameWithOnion(
      display as unknown as CanvasRenderingContext2D,
      scratch as unknown as CanvasRenderingContext2D,
      p, 1, 1, onion, layerId
    );

    expect(display.calls[0]).toBe("clear");
    expect(display.calls[1]).toBe("fill:#eee:source-over");
    expect(scratch.calls).toContain("fill:#ff0000:source-in");
    expect(scratch.calls).toContain("fill:#0000ff:source-in");

    const draws = display.calls.filter((c) => c.startsWith("draw:"));
    expect(draws.length).toBe(3);
    expect(draws[2]).toBe(`draw:${(curC as unknown as { __id: number }).__id}@1`);
  });
});
