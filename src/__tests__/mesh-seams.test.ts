import { describe, expect, it } from "vitest";
import { dilateTriangle, MESH_DILATE_PX } from "../core/selection";

type Pt = { x: number; y: number };

// Batch-B review of #9 / 646ddb7: `lighter` removed the seams but added colour where a mesh folds
// over itself (grey + grey → white). Each triangle is now drawn as a LERP over what is under it
// (`destination-out` by its coverage, then `lighter` of its image: c·src + (1 − c)·dst) through its
// clip DILATED outward (`dilateTriangle`). Here the canvas is modelled with supersampled box-filter
// coverage, the way an antialiased clip/fill covers a pixel, to check the result numerically.

function inside(poly: Pt[], x: number, y: number): boolean {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cr = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (cr !== 0) {
      if (s === 0) s = Math.sign(cr);
      else if (Math.sign(cr) !== s) return false;
    }
  }
  return true;
}
const N = 16; // samples per pixel side
function coverage(poly: Pt[], px: number, py: number): number {
  let n = 0;
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) if (inside(poly, px + (i + 0.5) / N, py + (j + 0.5) / N)) n++;
  return n / (N * N);
}
/** Draw `tris` (each with its own colour) as the lerp chain, optionally dilated; or `lighter`. */
function render(
  tris: { pts: [Pt, Pt, Pt]; col: number }[],
  w: number,
  h: number,
  how: "lerp" | "lerp-undilated" | "lighter",
): Float64Array {
  const out = new Float64Array(w * h);
  for (const t of tris) {
    const poly = how === "lerp" ? dilateTriangle(t.pts, MESH_DILATE_PX) : t.pts;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = coverage(poly, x, y);
        const i = y * w + x;
        out[i] = how === "lighter" ? Math.min(1, out[i] + c * t.col) : c * t.col + (1 - c) * out[i];
      }
  }
  return out;
}
const P = (x: number, y: number): Pt => ({ x, y });

describe("mesh triangles: no seams, no added colour on folds", () => {
  // A fan of six triangles round an off-grid interior vertex, with off-grid outer corners, so
  // its edges cross pixels at every angle and fraction.
  const c = P(10.37, 9.81);
  const ring = [P(1.2, 1.7), P(10.6, 0.9), P(19.3, 2.2), P(18.8, 18.4), P(9.9, 19.2), P(1.6, 17.7)];
  const fan = ring.map((p, i) => ({ pts: [c, p, ring[(i + 1) % ring.length]] as [Pt, Pt, Pt] }));
  // Pixels at least 2 px inside the fan's outer boundary.
  const interior = (x: number, y: number) =>
    x >= 4 && x <= 15 && y >= 4 && y <= 14 && inside(ring, x + 0.5, y + 0.5);

  for (const alpha of [1, 0.5]) {
    it(`uniform art (alpha ${alpha}) comes out uniform across every interior edge`, () => {
      const img = render(
        fan.map((t) => ({ ...t, col: alpha })),
        21,
        21,
        "lerp",
      );
      let worst = 0;
      for (let y = 0; y < 21; y++)
        for (let x = 0; x < 21; x++)
          if (interior(x, y)) worst = Math.max(worst, Math.abs(img[y * 21 + x] - alpha));
      expect(worst).toBeLessThan(1 / 255); // under one 8-bit step
    });
  }

  it("without the dilation the lerp leaves seams (why it is dilated)", () => {
    const img = render(
      fan.map((t) => ({ ...t, col: 1 })),
      21,
      21,
      "lerp-undilated",
    );
    let worst = 0;
    for (let y = 0; y < 21; y++)
      for (let x = 0; x < 21; x++) if (interior(x, y)) worst = Math.max(worst, 1 - img[y * 21 + x]);
    expect(worst).toBeGreaterThan(0.1);
  });

  it("a fold shows the top triangle's colour, not the sum (lighter made grey + grey white)", () => {
    const lower = { pts: [P(2, 2), P(18, 2), P(2, 18)] as [Pt, Pt, Pt], col: 0.5 };
    const upper = { pts: [P(6, 6), P(18, 6), P(6, 18)] as [Pt, Pt, Pt], col: 0.5 };
    const at = (img: Float64Array) => img[8 * 21 + 8]; // well inside both
    expect(at(render([lower, upper], 21, 21, "lighter"))).toBe(1); // the bug
    expect(at(render([lower, upper], 21, 21, "lerp"))).toBeCloseTo(0.5, 9);
  });
});

describe("dilateTriangle", () => {
  const dist = (p: Pt, a: Pt, b: Pt) => {
    const t = Math.max(
      0,
      Math.min(
        1,
        ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) /
          ((b.x - a.x) ** 2 + (b.y - a.y) ** 2),
      ),
    );
    return Math.hypot(p.x - a.x - t * (b.x - a.x), p.y - a.y - t * (b.y - a.y));
  };
  const distToTri = (p: Pt, t: [Pt, Pt, Pt]) =>
    inside(t, p.x, p.y)
      ? 0
      : Math.min(dist(p, t[0], t[1]), dist(p, t[1], t[2]), dist(p, t[2], t[0]));

  for (const [name, tri] of [
    ["clockwise", [P(0, 0), P(10, 0), P(0, 10)]],
    ["counter-clockwise (a flipped, folded triangle)", [P(0, 0), P(0, 10), P(10, 0)]],
    ["a sliver", [P(0, 0), P(40, 0.5), P(0, 1)]],
  ] as [string, [Pt, Pt, Pt]][]) {
    it(`${name}: holds every point within the dilation and stays near the triangle`, () => {
      const d = 1;
      const poly = dilateTriangle(tri, d);
      for (let i = 0; i < 400; i++) {
        // Points on a ring at distance d·0.999 round each edge.
        const e = i % 3;
        const a = tri[e];
        const b = tri[(e + 1) % 3];
        const u = (i * 0.618) % 1;
        const p = P(a.x + u * (b.x - a.x), a.y + u * (b.y - a.y));
        const ang = i * 2.399;
        const q = P(p.x + Math.cos(ang) * d * 0.999, p.y + Math.sin(ang) * d * 0.999);
        expect(inside(poly, q.x, q.y)).toBe(true);
      }
      for (const v of poly) expect(distToTri(v, tri)).toBeLessThanOrEqual(2 * d + 1e-9); // miter limit
    });
  }

  it("leaves a degenerate triangle as it is", () => {
    const t: [Pt, Pt, Pt] = [P(0, 0), P(5, 5), P(10, 10)];
    expect(dilateTriangle(t, 1)).toEqual(t);
  });
});
