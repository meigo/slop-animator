/** Input types that take no typed text: app shortcuts must keep working while one has focus. */
const NON_TEXT_INPUTS = new Set([
  "range",
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "color",
  "file",
  "image",
]);

/** Whether keys pressed in `el` are typing — the one case app shortcuts must stand aside for. A
 *  slider keeps focus after a drag (the canvas prevents the focus change on press), so treating
 *  every `<input>` as a text field left Ctrl+Z and the tool keys dead after touching one. */
export function isTextEntry(
  el: { tagName?: string; type?: string; isContentEditable?: boolean } | null,
): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA") return true;
  if (el.tagName === "INPUT") return !NON_TEXT_INPUTS.has((el.type || "text").toLowerCase());
  return false;
}
