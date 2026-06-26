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
