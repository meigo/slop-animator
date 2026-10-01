import Delaunator from "delaunator";

export interface Pt {
  x: number;
  y: number;
}
export interface Mesh {
  vertices: Pt[];
  triangles: [number, number, number][];
}

type Inside = (x: number, y: number) => boolean;

/** Silhouette-edge pixels (inside, with an outside 4-neighbor), greedily decimated so kept points are
 *  at least `spacing` apart (scan order; reject a candidate within `spacing` of any kept point). */
export function boundaryPoints(
  inside: Inside,
  width: number,
  height: number,
  spacing: number,
): Pt[] {
  const minD2 = spacing * spacing;
  const kept: Pt[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(x, y)) continue;
      const isEdge =
        !inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y + 1) || !inside(x, y - 1);
      if (!isEdge) continue;
      let ok = true;
      for (const p of kept) {
        const dx = p.x - x,
          dy = p.y - y;
        if (dx * dx + dy * dy < minD2) {
          ok = false;
          break;
        }
      }
      if (ok) kept.push({ x, y });
    }
  }
  return kept;
}

/** Interior grid samples (inside, at `spacing`), excluding any within ~spacing/2 of a boundary point. */
export function interiorPoints(
  inside: Inside,
  width: number,
  height: number,
  spacing: number,
  boundary: Pt[],
): Pt[] {
  const min = (spacing / 2) * (spacing / 2);
  const out: Pt[] = [];
  for (let y = spacing; y < height; y += spacing) {
    for (let x = spacing; x < width; x += spacing) {
      if (!inside(x, y)) continue;
      let tooClose = false;
      for (const b of boundary) {
        const dx = b.x - x,
          dy = b.y - y;
        if (dx * dx + dy * dy < min) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) out.push({ x, y });
    }
  }
  return out;
}

/** Triangulate the silhouette of a binary alpha mask into a conforming triangle mesh (pixel space). */
export function triangulateSilhouette(
  inside: Inside,
  width: number,
  height: number,
  opts: { spacing?: number } = {},
): Mesh {
  const spacing = Math.max(2, opts.spacing ?? 16);
  const boundary = boundaryPoints(inside, width, height, spacing);
  const interior = interiorPoints(inside, width, height, spacing, boundary);
  return meshPoints(boundary.concat(interior), (cx, cy) => inside(Math.round(cx), Math.round(cy)));
}

/** Pixels within this distance of the shape join it before meshing, so the mesh edge runs OUTSIDE
 *  the ink rather than through its outer pixels (which the triangle clip then halves or drops). */
const GROW = 2;

/**
 * A mesh that covers EVERY ink pixel — the Pose tool's, which lifts the whole content out of the
 * cell and paints back only what its triangles carry, so a pixel outside the mesh is erased.
 * `triangulateSilhouette` alone lost the right and bottom outer pixel row (its vertices sit on pixel
 * corners), corners and stroke ends cut off between decimated boundary points, thin strokes whose
 * triangles failed the centroid test, and small separate details with fewer than three points.
 *
 * The shape (`body` — what counts as the figure, e.g. with enclosed holes filled — plus `ink`) is
 * grown by GROW px and meshed with vertices at pixel centres. Then, while some ink pixel is not
 * covered (`uncoveredPixels`), more points go in around it — the grown edge nearby, and the pixel
 * itself — and it is meshed again, with finer spacing each round.
 */
export function coverSilhouette(
  ink: Inside,
  body: Inside,
  width: number,
  height: number,
  opts: { spacing?: number } = {},
): Mesh {
  const spacing = Math.max(2, opts.spacing ?? 16);
  const pad = GROW;
  const gw = width + 2 * pad;
  const gh = height + 2 * pad;
  const grown = new Uint8Array(gw * gh);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!ink(x, y) && !body(x, y)) continue;
      for (let dy = -GROW; dy <= GROW; dy++) {
        for (let dx = -GROW; dx <= GROW; dx++) {
          if (dx * dx + dy * dy <= GROW * GROW) grown[(y + pad + dy) * gw + (x + pad + dx)] = 1;
        }
      }
    }
  }
  // Grid coordinates (0..gw) for the point pickers; pixel-centre image coordinates for the mesh.
  const inGrid = (gx: number, gy: number) =>
    gx >= 0 && gx < gw && gy >= 0 && gy < gh && grown[gy * gw + gx] === 1;
  const isEdge = (gx: number, gy: number) =>
    inGrid(gx, gy) &&
    (!inGrid(gx + 1, gy) || !inGrid(gx - 1, gy) || !inGrid(gx, gy + 1) || !inGrid(gx, gy - 1));
  const toImage = (gx: number, gy: number): Pt => ({ x: gx - pad + 0.5, y: gy - pad + 0.5 });
  const keep = (cx: number, cy: number) => inGrid(Math.floor(cx) + pad, Math.floor(cy) + pad);

  const boundary = boundaryPoints(inGrid, gw, gh, spacing);
  const interior = interiorPoints(inGrid, gw, gh, spacing, boundary);
  const pts = boundary.concat(interior).map((p) => toImage(p.x, p.y));
  let mesh = meshPoints(pts, keep);
  // Each round refines around what is still bare, with new points at least `step` apart (from each
  // other and from the points already there) — so a long bare stroke gains points along it, not one
  // per pixel — halving `step` each round down to 1.
  let step = Math.max(2, spacing >> 2);
  for (let finest = false; ; step = Math.max(1, step >> 1)) {
    const bare = uncoveredPixels(mesh, ink, width, height);
    if (bare.length === 0 || finest) break;
    finest = step === 1;
    const near = new PointHash(step);
    for (const p of pts) near.add(p);
    const add = (gx: number, gy: number) => {
      const p = toImage(gx, gy);
      if (near.within(p, step)) return;
      near.add(p);
      pts.push(p);
    };
    const reach = Math.max(4, step * 2);
    for (const b of bare) {
      const bx = b.x + pad;
      const by = b.y + pad;
      add(bx, by);
      for (let gy = by - reach; gy <= by + reach; gy++) {
        for (let gx = bx - reach; gx <= bx + reach; gx++) if (isEdge(gx, gy)) add(gx, gy);
      }
    }
    mesh = meshPoints(pts, keep);
  }
  return mesh;
}

/** Points bucketed in `cell`-sized squares, for "is any point closer than d (<= cell)?". */
class PointHash {
  private cells = new Map<string, Pt[]>();
  private cell: number;
  constructor(cell: number) {
    this.cell = cell;
  }
  add(p: Pt) {
    const k = `${Math.floor(p.x / this.cell)},${Math.floor(p.y / this.cell)}`;
    const list = this.cells.get(k);
    if (list) list.push(p);
    else this.cells.set(k, [p]);
  }
  within(p: Pt, d: number): boolean {
    const cx = Math.floor(p.x / this.cell);
    const cy = Math.floor(p.y / this.cell);
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) {
        for (const q of this.cells.get(`${x},${y}`) ?? []) {
          if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 < d * d) return true;
        }
      }
    }
    return false;
  }
}

/** Ink pixels no triangle covers. A pixel counts as covered when all four of its corners lie in the
 *  mesh (in the same or different triangles) — so the clip keeps the whole pixel, not part of it. */
export function uncoveredPixels(mesh: Mesh, ink: Inside, width: number, height: number): Pt[] {
  const cw = width + 1;
  const covered = new Uint8Array(cw * (height + 1));
  const v = mesh.vertices;
  const EPS = 1e-9;
  for (const [a, b, c] of mesh.triangles) {
    const A = v[a],
      B = v[b],
      C = v[c];
    const area = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
    if (area === 0) continue;
    const x0 = Math.max(0, Math.ceil(Math.min(A.x, B.x, C.x)));
    const x1 = Math.min(width, Math.floor(Math.max(A.x, B.x, C.x)));
    const y0 = Math.max(0, Math.ceil(Math.min(A.y, B.y, C.y)));
    const y1 = Math.min(height, Math.floor(Math.max(A.y, B.y, C.y)));
    const s = Math.sign(area);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const w0 = ((B.x - A.x) * (y - A.y) - (B.y - A.y) * (x - A.x)) * s;
        const w1 = ((C.x - B.x) * (y - B.y) - (C.y - B.y) * (x - B.x)) * s;
        const w2 = ((A.x - C.x) * (y - C.y) - (A.y - C.y) * (x - C.x)) * s;
        if (w0 >= -EPS && w1 >= -EPS && w2 >= -EPS) covered[y * cw + x] = 1;
      }
    }
  }
  const out: Pt[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!ink(x, y)) continue;
      const i = y * cw + x;
      if (!covered[i] || !covered[i + 1] || !covered[i + cw] || !covered[i + cw + 1])
        out.push({ x, y });
    }
  }
  return out;
}

/** Delaunay-triangulate `pts`, keep the triangles whose centroid passes `keep`, and drop the
 *  vertices no kept triangle uses. */
function meshPoints(pts: Pt[], keep: (cx: number, cy: number) => boolean): Mesh {
  if (pts.length < 3) return { vertices: [], triangles: [] };

  const d = Delaunator.from(
    pts,
    (p) => p.x,
    (p) => p.y,
  );
  const tris: [number, number, number][] = [];
  for (let t = 0; t < d.triangles.length; t += 3) {
    const a = d.triangles[t],
      b = d.triangles[t + 1],
      c = d.triangles[t + 2];
    const cx = (pts[a].x + pts[b].x + pts[c].x) / 3;
    const cy = (pts[a].y + pts[b].y + pts[c].y) / 3;
    if (keep(cx, cy)) tris.push([a, b, c]);
  }

  // Reindex: keep only referenced vertices, compact.
  const remap = new Map<number, number>();
  const vertices: Pt[] = [];
  const triangles: [number, number, number][] = tris.map(([a, b, c]) => {
    const m = (i: number) => {
      let n = remap.get(i);
      if (n === undefined) {
        n = vertices.length;
        remap.set(i, n);
        vertices.push(pts[i]);
      }
      return n;
    };
    return [m(a), m(b), m(c)];
  });
  return { vertices, triangles };
}
