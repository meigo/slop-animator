/** Pure fit math (no DOM): scale `contentW × contentH` to fit `parentW × parentH` with a margin,
 *  centered. Returns the viewport zoom + screen-pixel pan (canvas origin offset). Degenerate inputs
 *  (any dimension ≤ 0) return the identity transform. */
export function computeFitTransform(
  parentW: number,
  parentH: number,
  contentW: number,
  contentH: number,
  margin = 0.9,
): { zoom: number; panX: number; panY: number } {
  if (parentW <= 0 || parentH <= 0 || contentW <= 0 || contentH <= 0)
    return { zoom: 1, panX: 0, panY: 0 };
  const zoom = Math.min(parentW / contentW, parentH / contentH) * margin;
  return {
    zoom,
    panX: (parentW - contentW * zoom) / 2,
    panY: (parentH - contentH * zoom) / 2,
  };
}
