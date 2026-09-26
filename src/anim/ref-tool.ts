/** Selecting a reference layer switches to the Transform tool, and selecting away hands the tool
 *  back (2026-09-26). A reference can only be transformed, so leaving Brush lit while its gizmo is up
 *  made the toolbar claim a tool that did nothing and hid Flip / Keep proportions. Pure: the store
 *  calls it only when "is a reference the working row" CHANGES, never on a tool change, so a tool
 *  the user picks while on a reference is theirs. */

/** Tools a switch never hands back to: both are one-shot commands that hand themselves back when
 *  done (`applyEyedropper`, `leaveOutline`), so returning to one would re-arm a finished command. */
const ONE_SHOT = new Set(["eyedropper", "outline"]);

export interface RefToolState<T extends string> {
  tool: T;
  /** The tool to hand back to on leaving the reference; null when there is nothing to hand back. */
  before: T | null;
}

export function refFocusChange<T extends string>(
  onRef: boolean,
  tool: T,
  before: T | null,
  fallback: T,
): RefToolState<T> {
  if (onRef) {
    // Already on Transform: nothing was switched, so nothing is owed back.
    if (tool === "transform") return { tool, before: null };
    return { tool: "transform" as T, before: ONE_SHOT.has(tool) ? fallback : tool };
  }
  // Hand back only if still on the Transform the switch chose — another tool picked meanwhile is
  // the user's own choice and stays.
  if (before !== null && tool === "transform") return { tool: before, before: null };
  return { tool, before: null };
}
