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
import { defaultBoilConfig } from "../anim/document";

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
  return {
    kind: "draw",
    id,
    name: `L${id}`,
    visible: true,
    locked: false,
    opacity: 100,
    boilStrength: 1,
    groupId: null,
    cells,
    transform: { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };
}

describe("renderFrameWithOnion", () => {
  const onion: OnionConfig = {
    enabled: true,
    prev: 1,
    next: 1,
    allLayers: false,
    tintPrev: "#ff0000",
    tintNext: "#0000ff",
  };

  it("draws bg, then the prev ghost (tinted+faded) and next ghost, then the current frame on top", () => {
    const prevC = kc();
    const curC = kc();
    const nextC = kc();
    const layerId = 1;
    const p: Project = {
      name: "t",
      width: 100,
      height: 100,
      fps: 12,
      bgColor: "#eee",
      frameCount: 3,
      boil: defaultBoilConfig(),
      groups: [],
      layers: [
        dlayer(layerId, [
          { kind: "key", canvas: prevC },
          { kind: "key", canvas: curC },
          { kind: "key", canvas: nextC },
        ]),
      ],
      audio: null,
    };
    const display = recCtx();
    const scratch = recCtx();
    renderFrameWithOnion(
      display as unknown as CanvasRenderingContext2D,
      scratch as unknown as CanvasRenderingContext2D,
      p,
      1,
      1,
      onion,
      layerId,
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

describe("computeOnionFrames — keyframe mode", () => {
  // Keyframes at 0, 4, 5, 9 (a typical hold-heavy track).
  const keys = [0, 4, 5, 9];

  it("ghosts the nearest keyframes, not frame offsets", () => {
    const g = computeOnionFrames(5, 10, 1, 1, keys);
    expect(g.map((x) => x.frame).sort((a, b) => a - b)).toEqual([4, 9]);
  });

  it("walks outward N keyframes, farthest first (draw order)", () => {
    const g = computeOnionFrames(5, 10, 2, 1, keys);
    expect(g.map((x) => x.frame)).toEqual([0, 4, 9]); // prev farthest→nearest, then next
    expect(g[0].kind).toBe("prev");
    expect(g[2].kind).toBe("next");
  });

  it("drops missing neighbours at the ends", () => {
    expect(computeOnionFrames(0, 10, 2, 0, keys).map((x) => x.frame)).toEqual([]);
    expect(computeOnionFrames(9, 10, 0, 2, keys).map((x) => x.frame)).toEqual([]);
  });

  it("ignores a keyframe exactly at the current frame", () => {
    const g = computeOnionFrames(4, 10, 1, 1, keys);
    expect(g.map((x) => x.frame).sort((a, b) => a - b)).toEqual([0, 5]);
  });

  it("from a HOLD frame, the nearest previous keyframe is the one it holds", () => {
    const g = computeOnionFrames(7, 10, 1, 1, keys); // 7 is a hold over key 5
    expect(g.map((x) => x.frame).sort((a, b) => a - b)).toEqual([5, 9]);
  });

  it("nearer ghosts are more opaque, as in frame mode", () => {
    const g = computeOnionFrames(9, 10, 2, 0, keys); // prev keys 4 then 5
    const byFrame = Object.fromEntries(g.map((x) => [x.frame, x.opacity]));
    expect(byFrame[5]).toBeGreaterThan(byFrame[4]);
  });
});

describe("computeOnionFrames — within a play range", () => {
  // Frames and kinds only; opacity is checked once below and is unchanged by bounds.
  const fk = (r: ReturnType<typeof computeOnionFrames>) =>
    r.map(({ frame, kind }) => ({ frame, kind }));

  // Loop OFF: the range plays once, so ghosts come only from inside it — frames outside the range
  // are not part of what is being animated.
  it("confines ghosts to the range when not looping", () => {
    const b = { start: 5, end: 12, wrap: false };
    expect(fk(computeOnionFrames(5, 30, 2, 2, undefined, b))).toEqual([
      { frame: 7, kind: "next" },
      { frame: 6, kind: "next" },
    ]);
    expect(fk(computeOnionFrames(12, 30, 2, 2, undefined, b))).toEqual([
      { frame: 10, kind: "prev" },
      { frame: 11, kind: "prev" },
    ]);
  });

  // Loop ON: the seam is where a cycle has to match, so the ghosts wrap exactly as playback does —
  // at the in-point the previous drawings are the END of the range, at the out-point the next ones
  // are its START.
  it("wraps ghosts across the seam when looping", () => {
    const b = { start: 5, end: 12, wrap: true };
    expect(fk(computeOnionFrames(5, 30, 2, 2, undefined, b))).toEqual([
      { frame: 11, kind: "prev" },
      { frame: 12, kind: "prev" },
      { frame: 7, kind: "next" },
      { frame: 6, kind: "next" },
    ]);
    expect(fk(computeOnionFrames(12, 30, 2, 2, undefined, b))).toEqual([
      { frame: 10, kind: "prev" },
      { frame: 11, kind: "prev" },
      { frame: 6, kind: "next" },
      { frame: 5, kind: "next" },
    ]);
  });

  it("keeps the step-distance fade when wrapping", () => {
    const r = computeOnionFrames(5, 30, 2, 0, undefined, { start: 5, end: 12, wrap: true });
    expect(r).toEqual([
      { frame: 11, kind: "prev", opacity: ONION_BASE_OPACITY * 0.5 },
      { frame: 12, kind: "prev", opacity: ONION_BASE_OPACITY * 1.0 },
    ]);
  });

  // A range shorter than the ghost counts would otherwise reach the same frame from both sides — or
  // the current frame itself. Nearest wins, alternating sides, and nothing is ghosted twice.
  it("never ghosts a frame twice or the current frame in a short wrapped range", () => {
    const b = { start: 5, end: 7, wrap: true };
    expect(fk(computeOnionFrames(5, 30, 2, 2, undefined, b))).toEqual([
      { frame: 7, kind: "prev" },
      { frame: 6, kind: "next" },
    ]);
    expect(computeOnionFrames(5, 30, 3, 3, undefined, { start: 5, end: 5, wrap: true })).toEqual(
      [],
    );
  });

  // Working outside the range is not working on the cycle, so the range does not apply there.
  it("ignores the range when the current frame is outside it", () => {
    expect(
      fk(computeOnionFrames(2, 30, 2, 2, undefined, { start: 5, end: 12, wrap: true })),
    ).toEqual(fk(computeOnionFrames(2, 30, 2, 2)));
  });

  it("confines and wraps by KEYFRAMES too, so holds still don't use up a ghost", () => {
    const keys = [0, 3, 6, 9, 14];
    // Confined to [3, 9]: from the last drawing, the previous is 6 and nothing follows (14 is outside).
    expect(fk(computeOnionFrames(9, 30, 1, 1, keys, { start: 3, end: 9, wrap: false }))).toEqual([
      { frame: 6, kind: "prev" },
    ]);
    // Wrapped: at the first drawing of the cycle, the previous one is the cycle's LAST drawing.
    expect(fk(computeOnionFrames(3, 30, 1, 1, keys, { start: 3, end: 9, wrap: true }))).toEqual([
      { frame: 9, kind: "prev" },
      { frame: 6, kind: "next" },
    ]);
  });
});
