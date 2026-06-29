import { triangulateSilhouette, type Mesh } from "./triangulate";
import { poseWeights } from "./geodesic";
import { mlsRigidWeighted, type Pt } from "./mls";
import { drawTriangle, type SelectionRect } from "./selection";

export interface PoseHandle {
  vertex: number;
  to: Pt;
  angle: number; // radians; rotation of the handle's local frame (0 = none)
  reach?: number; // geodesic influence radius in doc px; undefined = unlimited
}

/** Rotate a vector about the origin. */
function rotateVec(v: Pt, ang: number): Pt {
  const c = Math.cos(ang),
    s = Math.sin(ang);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Satellite offset (doc px) used to inject a handle's rotation into the MLS. The recovered angle is
 *  independent of this magnitude (it cancels in the rigid fit); only numerical conditioning cares. */
const SAT_OFFSET = 16;

const DEFAULT_REACH_FRAC = 0.33; // a new handle reaches ~a third of the content diagonal
const REACH_FLOOR_FRAC = 0.12; // ...but never tighter than this (so it always covers a few vertices)

/** Context-aware default reach (doc px) for a newly added handle: ~a fraction of the content diagonal,
 *  capped by the distance to the nearest existing handle (densely-placed handles auto-tighten), with a
 *  small floor. Pure. */
export function defaultHandleReach(at: Pt, others: Pt[], diag: number): number {
  let r = diag * DEFAULT_REACH_FRAC;
  for (const o of others) r = Math.min(r, Math.hypot(o.x - at.x, o.y - at.y));
  return Math.max(diag * REACH_FLOOR_FRAC, r);
}

/**
 * Deform `rest` from pose handles, injecting each handle's rotation as a "satellite" correspondence so
 * the existing geodesic-MLS reproduces a local rotation about the handle. `from` = pivot rest positions
 * (poseWeights.from, aligned with `handles`); `weights[vertex][handle]`. Pure.
 */
export function solvePoseDeform(
  rest: Pt[],
  handles: PoseHandle[],
  from: Pt[],
  weights: number[][],
  satOffset = SAT_OFFSET,
): Pt[] {
  if (!handles.length) return rest.map((v) => ({ x: v.x, y: v.y }));
  const augFrom: Pt[] = [];
  const augTo: Pt[] = [];
  const cols: number[] = [];
  for (let h = 0; h < handles.length; h++) {
    const hd = handles[h];
    augFrom.push(from[h]);
    augTo.push(hd.to);
    cols.push(h);
    if (hd.angle) {
      const e = { x: satOffset, y: 0 };
      const re = rotateVec(e, hd.angle);
      augFrom.push({ x: from[h].x + e.x, y: from[h].y + e.y });
      augTo.push({ x: hd.to.x + re.x, y: hd.to.y + re.y });
      cols.push(h);
    }
  }
  const augWeights = weights.map((row) => cols.map((h) => row[h]));
  return mlsRigidWeighted(rest, augFrom, augTo, augWeights);
}

/** Index of the vertex closest to `p`. */
export function nearestVertex(verts: Pt[], p: Pt): number {
  let best = 0,
    bd = Infinity;
  for (let i = 0; i < verts.length; i++) {
    const dx = verts[i].x - p.x,
      dy = verts[i].y - p.y;
    const d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Lift + mesh state for the Pose tool. Vertices in DOC coords; deforms via cached geodesic MLS. */
export class MeshPose {
  rest: Pt[];
  deformed: Pt[];
  triangles: [number, number, number][];
  handles: PoseHandle[] = [];
  readonly img: HTMLCanvasElement;
  readonly rect: SelectionRect;
  private from: Pt[] = [];
  private weights: number[][] = [];

  private constructor(
    rest: Pt[],
    triangles: [number, number, number][],
    img: HTMLCanvasElement,
    rect: SelectionRect,
  ) {
    this.rest = rest;
    this.deformed = rest.map((v) => ({ x: v.x, y: v.y }));
    this.triangles = triangles;
    this.img = img;
    this.rect = rect;
  }

  /** Triangulate the lifted alpha and map vertices to doc coords. null if no mesh (empty content). */
  static fromLift(
    img: HTMLCanvasElement,
    rect: SelectionRect,
    dpr: number,
    spacing: number,
  ): MeshPose | null {
    const ctx = img.getContext("2d", { willReadFrequently: true });
    if (!ctx || img.width === 0 || img.height === 0) return null;
    const { data } = ctx.getImageData(0, 0, img.width, img.height);
    const inside = (x: number, y: number) =>
      x >= 0 && x < img.width && y >= 0 && y < img.height && data[(y * img.width + x) * 4 + 3] > 10;
    const mesh: Mesh = triangulateSilhouette(inside, img.width, img.height, { spacing });
    if (mesh.triangles.length === 0) return null;
    const rest = mesh.vertices.map((v) => ({ x: rect.x + v.x / dpr, y: rect.y + v.y / dpr }));
    return new MeshPose(rest, mesh.triangles, img, rect);
  }

  private restMesh(): Mesh {
    return { vertices: this.rest, triangles: this.triangles };
  }
  private recompute() {
    const verts = this.handles.map((h) => h.vertex);
    const pw = poseWeights(
      this.restMesh(),
      verts,
      1,
      this.handles.map((h) => h.reach),
    );
    this.from = pw.from;
    this.weights = pw.weights;
    this.solve();
  }
  private solve() {
    this.deformed = solvePoseDeform(this.rest, this.handles, this.from, this.weights);
  }

  /** Hit-test an existing handle dot (deformed position) within `tol` doc px. */
  handleAt(p: Pt, tol: number): number | null {
    for (let i = 0; i < this.handles.length; i++) {
      const v = this.deformed[this.handles[i].vertex];
      if (Math.hypot(v.x - p.x, v.y - p.y) <= tol) return i;
    }
    return null;
  }
  /** Add a handle at the nearest vertex (pinned at its current deformed pos). Returns its handle index. */
  addHandleAt(p: Pt): number {
    const vtx = nearestVertex(this.deformed, p);
    const existing = this.handles.findIndex((h) => h.vertex === vtx);
    if (existing >= 0) return existing;
    const d = this.deformed[vtx];
    const diag = Math.hypot(this.rect.w, this.rect.h);
    const others = this.handles.map((h) => this.deformed[h.vertex]);
    this.handles.push({
      vertex: vtx,
      to: { x: d.x, y: d.y },
      angle: 0,
      reach: defaultHandleReach(d, others, diag),
    });
    this.recompute(); // handle set changed → geodist + weights
    return this.handles.length - 1;
  }
  /** Move a handle's target and resolve (cached weights — cheap). */
  dragHandle(i: number, p: Pt) {
    if (i < 0 || i >= this.handles.length) return;
    this.handles[i].to = { x: p.x, y: p.y };
    this.solve();
  }
  /** Set a handle's rotation angle (radians) and re-solve (cached weights — cheap). */
  rotateHandle(i: number, angle: number) {
    if (i < 0 || i >= this.handles.length) return;
    this.handles[i].angle = angle;
    this.solve();
  }
  /** Set a handle's geodesic reach (undefined = unlimited) and re-derive weights + re-solve. */
  setReach(i: number, reach: number | undefined) {
    if (i < 0 || i >= this.handles.length) return;
    this.handles[i].reach = reach;
    this.recompute();
  }
  /** Per-vertex: is this vertex within handle `i`'s influence (non-zero weight)? */
  reachMask(i: number): boolean[] {
    return this.weights.map((row) => row[i] > 0);
  }
  resetHandles() {
    this.handles = [];
    this.from = [];
    this.weights = [];
    this.deformed = this.rest.map((v) => ({ x: v.x, y: v.y }));
  }

  /** Warp the lifted raster through the deformed mesh into `ctx` (doc coords). */
  render(ctx: CanvasRenderingContext2D) {
    for (const [a, b, c] of this.triangles) {
      drawTriangle(
        ctx,
        this.img,
        this.rect,
        [this.rest[a], this.rest[b], this.rest[c]],
        [this.deformed[a], this.deformed[b], this.deformed[c]],
      );
    }
  }
  /** Mesh edges (faint) + handle dots (filled), at deformed positions. */
  drawWireframe(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.strokeStyle = "rgba(0,128,255,0.4)";
    ctx.lineWidth = 0.75;
    for (const [a, b, c] of this.triangles) {
      const va = this.deformed[a],
        vb = this.deformed[b],
        vc = this.deformed[c];
      ctx.beginPath();
      ctx.moveTo(va.x, va.y);
      ctx.lineTo(vb.x, vb.y);
      ctx.lineTo(vc.x, vc.y);
      ctx.closePath();
      ctx.stroke();
    }
    for (const h of this.handles) {
      const v = this.deformed[h.vertex];
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(v.x, v.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }
}
