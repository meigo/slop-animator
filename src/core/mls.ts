// Moving Least Squares RIGID deformation (Schaefer et al. 2006). Closed-form per point — no solver.
// Used by the grid Deform tool ("rigid" mode) and the silhouette Pose tool (geodesic weights).

export interface Pt {
  x: number;
  y: number;
}

/** Rigid fit for one point given per-handle weights `w` and their sum `sw`. sw===0 ⇒ point unchanged. */
function rigidFit(v: Pt, from: Pt[], to: Pt[], w: number[], sw: number): Pt {
  if (sw === 0) return { x: v.x, y: v.y };
  const n = from.length;
  let pcx = 0,
    pcy = 0,
    qcx = 0,
    qcy = 0;
  for (let i = 0; i < n; i++) {
    pcx += w[i] * from[i].x;
    pcy += w[i] * from[i].y;
    qcx += w[i] * to[i].x;
    qcy += w[i] * to[i].y;
  }
  pcx /= sw;
  pcy /= sw;
  qcx /= sw;
  qcy /= sw;
  let a = 0,
    b = 0;
  for (let i = 0; i < n; i++) {
    const phx = from[i].x - pcx,
      phy = from[i].y - pcy;
    const qhx = to[i].x - qcx,
      qhy = to[i].y - qcy;
    a += w[i] * (phx * qhx + phy * qhy);
    b += w[i] * (phx * qhy - phy * qhx);
  }
  let cos = 1,
    sin = 0;
  const r = Math.hypot(a, b);
  if (r > 0) {
    cos = a / r;
    sin = b / r;
  }
  const vx = v.x - pcx,
    vy = v.y - pcy;
  return { x: cos * vx - sin * vy + qcx, y: sin * vx + cos * vy + qcy };
}

/** Deform each point given handle correspondences from[i] → to[i], weighting by 1/|p−v|^(2α). */
export function mlsRigid(points: Pt[], from: Pt[], to: Pt[], alpha = 1): Pt[] {
  return points.map((v) => {
    const n = from.length;
    const w = new Array<number>(n);
    let sw = 0;
    for (let i = 0; i < n; i++) {
      const dx = from[i].x - v.x,
        dy = from[i].y - v.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 1e-12) return { x: to[i].x, y: to[i].y }; // coincident handle → exact
      const wi = 1 / Math.pow(d2, alpha);
      w[i] = wi;
      sw += wi;
    }
    return rigidFit(v, from, to, w, sw);
  });
}

/** Rigid MLS with PRECOMPUTED weights. weights[i][h] = weight of handle h for point i.
 *  weights[i][h] === Infinity ⇒ point i maps exactly to to[h]; an all-zero row ⇒ point unchanged. */
export function mlsRigidWeighted(points: Pt[], from: Pt[], to: Pt[], weights: number[][]): Pt[] {
  return points.map((v, pi) => {
    const n = from.length;
    const row = weights[pi];
    const w = new Array<number>(n);
    let sw = 0;
    for (let i = 0; i < n; i++) {
      const wi = row[i];
      if (wi === Infinity) return { x: to[i].x, y: to[i].y }; // coincident handle → exact
      w[i] = wi;
      sw += wi;
    }
    return rigidFit(v, from, to, w, sw);
  });
}
