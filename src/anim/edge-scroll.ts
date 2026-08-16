/** Auto-scroll while dragging past a scroller's edge (pure; no DOM). */

/** How close to an edge the pointer must be before scrolling starts. */
export const EDGE_ZONE_PX = 40;
/** Cap per tick — roughly one 24px frame column at full deflection. */
export const EDGE_MAX_PX = 24;

/**
 * Horizontal scroll delta for one animation frame, given where the pointer is against the
 * scroller's client rect. Negative scrolls left, positive right, 0 inside the safe middle.
 *
 * PROPORTIONAL, not constant: a small overshoot creeps so you can place an edge precisely, while a
 * large one (or dragging clean off the element) races. Deflection past the edge counts as full
 * speed rather than growing without bound, so flinging the pointer to the far side of the screen is
 * no faster than sitting just outside it — otherwise the scroll is impossible to steer.
 */
export function edgeScrollDelta(
  pointerX: number,
  rectLeft: number,
  rectRight: number,
  zonePx: number = EDGE_ZONE_PX,
  maxPxPerTick: number = EDGE_MAX_PX,
): number {
  if (zonePx <= 0) return 0;
  const leftDepth = rectLeft + zonePx - pointerX; // >0 once inside the left zone
  if (leftDepth > 0) return -Math.round(Math.min(1, leftDepth / zonePx) * maxPxPerTick);
  const rightDepth = pointerX - (rectRight - zonePx);
  if (rightDepth > 0) return Math.round(Math.min(1, rightDepth / zonePx) * maxPxPerTick);
  return 0;
}
