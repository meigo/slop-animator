import { mlsRigid, type Pt } from "./mls";

/**
 * One frame of rigid (MLS) grid posing.
 *
 * The rest/source grid is `gridStart` — the pose captured at the START of this drag — NOT the uniform
 * entry grid. Sourcing from the current pose means an under-constrained drag (e.g. 0 pins → a single
 * handle → pure translation) rigidly moves the CURRENT shape instead of collapsing any un-pinned
 * deformation back to the uniform grid.
 *
 * Handles: each pinned point (≠ the dragged one) maps `gridStart[i] → its pinned position` (a
 * zero-displacement anchor, since a pinned point sits at its pinned position in `gridStart`); the
 * dragged point `idx` maps `gridStart[idx] → target`. Returns the new warp grid (same shape as
 * `gridStart`).
 */
export function rigidDeformGrid(
  gridStart: Pt[][],
  pinned: Map<number, Pt>,
  idx: number,
  target: Pt,
  cols: number,
): Pt[][] {
  const rest = gridStart.flat();
  const from: Pt[] = [];
  const to: Pt[] = [];
  for (const [i, pos] of pinned) {
    if (i !== idx) {
      from.push(rest[i]);
      to.push(pos);
    }
  }
  from.push(rest[idx]);
  to.push(target);
  const deformed = mlsRigid(rest, from, to);
  return gridStart.map((row, r) => row.map((_, c) => deformed[r * cols + c]));
}
