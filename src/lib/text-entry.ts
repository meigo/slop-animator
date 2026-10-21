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

/** Whether a canvas press should take focus from `el`: a text field, and a `<select>` too. The key
 *  handlers stand aside for both ("a dropdown keeps its own keys"), and the canvas press prevents
 *  the browser's own focus change, so a dropdown picked from once (brush type, a key's easing) kept
 *  focus through any number of strokes — every shortcut dead, and typed tool keys retyped it by
 *  typeahead (review 2026-10-17 #30). */
export function blursOnCanvasPress(
  el: { tagName?: string; type?: string; isContentEditable?: boolean } | null,
): boolean {
  return isTextEntry(el) || el?.tagName === "SELECT";
}

/** Whether this keydown is an Enter that commits a text field's value — not the Enter that commits
 *  an input method's composition (Japanese, Chinese…), which arrives as a keydown too:
 *  `isComposing`, or keyCode 229 in Safari. Taken as a commit, it ended a rename or a marker label
 *  mid-composition. */
export function isCommitEnter(e: {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
}): boolean {
  return e.key === "Enter" && !e.isComposing && e.keyCode !== 229;
}
