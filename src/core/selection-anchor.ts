/**
 * Pure positioning math for the floating selection action panel.
 * Maps a doc-space bbox to a screen-space anchor point above (or, if there's
 * no room, below) the bbox, clamped to the viewport.
 */

export type Point = { x: number; y: number };

export interface AnchorInput {
  /** Bbox points in document space. Any number of points; their screen-space AABB is used. */
  bboxDoc: Point[];
  /** Maps a doc-space point to a screen-space (workspace-relative) point. */
  docToScreen: (p: Point) => Point;
  /** Panel size in screen px. */
  panelSize: { w: number; h: number };
  /** Workspace size in screen px. */
  viewport: { w: number; h: number };
  /** Gap from bbox and from screen edge, in screen px. */
  margin: number;
}

/** Where the panel ended up relative to the bbox: above it, below it, or (fits neither) clamped to the
 *  top margin, overlapping it. */
export type AnchorSide = "above" | "below" | "overlap";

export interface AnchorResult {
  x: number;
  y: number;
  side: AnchorSide;
}

export function computeAnchor(input: AnchorInput): AnchorResult {
  const { bboxDoc, docToScreen, panelSize, viewport, margin } = input;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of bboxDoc) {
    const s = docToScreen(p);
    if (s.x < minX) minX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.x > maxX) maxX = s.x;
    if (s.y > maxY) maxY = s.y;
  }

  const centerX = (minX + maxX) / 2;
  let x = Math.round(centerX - panelSize.w / 2);
  x = Math.max(margin, Math.min(viewport.w - panelSize.w - margin, x));

  const aboveY = minY - margin - panelSize.h;
  const belowY = maxY + margin;

  let y = aboveY;
  let side: AnchorSide = "above";
  if (aboveY < margin) {
    if (belowY + panelSize.h <= viewport.h - margin) {
      y = belowY;
      side = "below";
    } else {
      // Neither side fits — clamp to top margin.
      y = margin;
      side = "overlap";
    }
  }

  return { x, y, side };
}

/**
 * Which local edge of a free-transform float should carry the rotate handle, so the panel never
 * covers it: the candidate that lands FARTHER from the panel on screen. `topY` / `bottomY` are the
 * screen y of the handle placed on the float's local top / bottom edge — screen, not document, so a
 * rotated float or a rotated view still picks the right one. An overlapping panel is clamped to the
 * top margin, so it counts as above.
 */
export function pickRotateEdge(side: AnchorSide, topY: number, bottomY: number): "top" | "bottom" {
  const wantLower = side !== "below";
  return bottomY > topY === wantLower ? "bottom" : "top";
}
