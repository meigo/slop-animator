import { inverseChain, type ComposeStep, type Pt } from "./ref-transform";
import { isIdentityTransform } from "../anim/document";

/** True when the chain actually moves points — an all-identity compose is a no-op everywhere, and
 *  every caller short-circuits on it so the identity path stays bit-identical to the pre-compose
 *  code. Exported because `selection.ts` gates on the same condition: if the two disagreed, a
 *  caller could take the mapped branch while the mapper returned the input unchanged. */
export function needsMap(steps: ComposeStep[]): boolean {
  return steps.some((s) => !isIdentityTransform(s.t));
}

export function mapDocRectToCell(
  steps: ComposeStep[],
  r: { x: number; y: number; w: number; h: number },
): Pt[] {
  const corners = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
  return mapDocPolyToCell(steps, corners);
}

export function mapDocPolyToCell(steps: ComposeStep[], pts: Pt[]): Pt[] {
  if (!needsMap(steps)) return pts.map((p) => ({ ...p }));
  return pts.map((p) => inverseChain(steps, p));
}

/** Canvas 2D affine as `ctx.transform` takes it: [a, b, c, d, e, f] = [[a c e], [b d f]]. */
export type Mat6 = [number, number, number, number, number, number];

/** m ∘ n (apply n first), in canvas column-vector convention. */
function mul(m: Mat6, n: Mat6): Mat6 {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/**
 * The affine that maps a DOCUMENT-space point into the innermost cell space — the matrix form of
 * `inverseChain` over the same inner-to-outer step list, for stamping a paper-space bitmap back
 * into a cell (`Canvas.applyInverseCompose`).
 *
 * Each step contributes `T(c) · S(1/scale) · R(-rot) · T(-c - d)`; the product is taken in step
 * order, which (canvas multiplies on the right) applies the OUTERMOST step to the point first —
 * the same order `inverseChain` walks. An identity step contributes the identity matrix exactly.
 */
export function inverseComposeMatrix(steps: ComposeStep[]): Mat6 {
  let m: Mat6 = [1, 0, 0, 1, 0, 0];
  for (const s of steps) {
    const cx = s.base.x + s.base.w / 2;
    const cy = s.base.y + s.base.h / 2;
    const k = 1 / s.t.scale;
    const cos = Math.cos(-s.t.rotation);
    const sin = Math.sin(-s.t.rotation);
    const a = k * cos;
    const b = k * sin;
    const c = -k * sin;
    const d = k * cos;
    const tx = -(cx + s.t.dx);
    const ty = -(cy + s.t.dy);
    m = mul(m, [a, b, c, d, a * tx + c * ty + cx, b * tx + d * ty + cy]);
  }
  return m;
}

/** Apply a Mat6 to a point — the same arithmetic the 2D context does. */
export function applyMat6(m: Mat6, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}
