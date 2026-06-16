/**
 * Svelte action: call `onOutside` when a pointerdown lands outside `node`.
 *
 * Attach it to a wrapper that contains BOTH the trigger button and the popup, so clicking the
 * trigger (to toggle) isn't treated as "outside" — only clicks elsewhere close the popup. Uses the
 * capture phase so it fires even if an inner handler stops propagation (e.g. canvas gizmo handles).
 */
export function clickOutside(node: HTMLElement, onOutside: () => void) {
  let cb = onOutside;
  function handler(e: PointerEvent) {
    if (!node.contains(e.target as Node)) cb();
  }
  document.addEventListener("pointerdown", handler, true);
  return {
    update(next: () => void) { cb = next; },
    destroy() { document.removeEventListener("pointerdown", handler, true); },
  };
}
