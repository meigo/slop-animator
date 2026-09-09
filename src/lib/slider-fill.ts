/**
 * The filled portion of a range input, as the two CSS custom properties the stylesheet's gradient
 * reads (SLOP-TIMELINE-UI.md §6).
 *
 * Taking over a slider's rendering with `appearance: none` — which is the only way to size the
 * thumb, since the browser draws it — costs the filled track the browser was drawing for free.
 * The family rebuilds it as a gradient with two stops rather than one, so a BIPOLAR control can
 * fill outward from its centre. Every slider in this app is unipolar, so `from` is always 0% and
 * only `to` moves; the two-stop shape is kept so a bipolar control can be added without changing
 * the stylesheet.
 *
 * A pure function rather than a Svelte action on purpose: `bind:value` already re-renders the
 * `style` attribute on every change, so the fill tracks the value with no lifecycle of its own —
 * including changes made from the store rather than by dragging, which an action listening for
 * `input` events would miss.
 */
export function sliderFill(value: number, min: number, max: number): string {
  const span = max - min;
  // A zero or inverted range has no meaningful fill; render an empty track rather than NaN%.
  const t = span > 0 ? (value - min) / span : 0;
  const pct = Math.max(0, Math.min(1, t)) * 100;
  return `--fill-from:0%;--fill-to:${pct.toFixed(2)}%`;
}
