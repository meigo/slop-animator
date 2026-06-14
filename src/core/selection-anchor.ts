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

export interface AnchorResult {
  x: number;
  y: number;
}

export function computeAnchor(input: AnchorInput): AnchorResult {
  const { bboxDoc, docToScreen, panelSize, viewport, margin } = input;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
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
  if (aboveY < margin) {
    if (belowY + panelSize.h <= viewport.h - margin) {
      y = belowY;
    } else {
      // Neither side fits — clamp to top margin.
      y = margin;
    }
  }

  return { x, y };
}
