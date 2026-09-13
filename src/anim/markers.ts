import type { Marker } from "./document";

/**
 * Timeline markers: pure operations over a SORTED, one-per-frame `Marker[]`.
 *
 * Every function returns a NEW array when something changed and the SAME reference when nothing
 * did, so a store action can skip a no-op undo entry with `next !== ms`. Nothing here mutates its
 * input — undo snapshots hold the array by reference (gotcha #8).
 */

const byFrame = (a: Marker, b: Marker) => a.frame - b.frame;

/** The marker on `frame`, if any. */
export function markerAt(ms: Marker[], frame: number): Marker | undefined {
  return ms.find((m) => m.frame === frame);
}

/** Two labels as one, earlier frame's first; empty labels are skipped so no stray separator shows. */
export function joinLabels(a: string, b: string): string {
  return [a, b].filter((s) => s !== "").join(" · ");
}

/** Append a marker to a sorted list, merging into the previous entry when frames collide. */
function pushJoining(out: Marker[], m: Marker): boolean {
  const prev = out[out.length - 1];
  if (prev && prev.frame === m.frame) {
    out[out.length - 1] = { frame: m.frame, label: joinLabels(prev.label, m.label) };
    return true;
  }
  out.push(m);
  return false;
}

/** Add a marker on `frame`. An occupied, negative or fractional frame changes nothing. */
export function addMarker(ms: Marker[], frame: number, label = ""): Marker[] {
  if (!Number.isInteger(frame) || frame < 0 || markerAt(ms, frame)) return ms;
  return [...ms, { frame, label: label.trim() }].sort(byFrame);
}

export function removeMarker(ms: Marker[], frame: number): Marker[] {
  if (!markerAt(ms, frame)) return ms;
  return ms.filter((m) => m.frame !== frame);
}

export function renameMarker(ms: Marker[], frame: number, label: string): Marker[] {
  const trimmed = label.trim();
  const m = markerAt(ms, frame);
  if (!m || m.label === trimmed) return ms;
  return ms.map((x) => (x.frame === frame ? { frame, label: trimmed } : x));
}

/** Move the marker on `from` to `to` (clamped ≥ 0). Refused — same array — when `to` is occupied,
 *  so a drop can never silently join or overwrite a label. */
export function moveMarker(ms: Marker[], from: number, to: number): Marker[] {
  const dest = Math.max(0, to);
  const m = markerAt(ms, from);
  if (!m || from === dest || markerAt(ms, dest)) return ms;
  return ms.map((x) => (x.frame === from ? { frame: dest, label: x.label } : x)).sort(byFrame);
}

/**
 * Ripple for ONE frame inserted at / deleted from `at`. Same rule as `shiftStartFrame` in
 * `timeline.ts` (repeated here rather than imported: `timeline.ts` imports this module):
 * insert moves `frame >= at` by +1; delete moves `frame > at` by −1 and leaves a marker ON `at`
 * where it is. On a delete, the markers on `at` and `at + 1` both land on `at` — their labels are
 * JOINED rather than one being dropped.
 */
export function shiftMarkers(ms: Marker[], at: number, delta: 1 | -1): Marker[] {
  const out: Marker[] = [];
  let changed = false;
  for (const m of ms) {
    const frame =
      delta === 1 ? (m.frame >= at ? m.frame + 1 : m.frame) : m.frame > at ? m.frame - 1 : m.frame;
    if (frame !== m.frame) changed = true;
    if (pushJoining(out, frame === m.frame ? m : { frame, label: m.label })) changed = true;
  }
  return changed ? out : ms;
}

/** Drop markers at or past `frameCount` (the animation was shortened). */
export function truncateMarkers(ms: Marker[], frameCount: number): Marker[] {
  if (ms.every((m) => m.frame < frameCount)) return ms;
  return ms.filter((m) => m.frame < frameCount);
}

/** Nearest marker frame strictly after `frame` that is still inside the document, else null. */
export function nextMarkerFrame(ms: Marker[], frame: number, frameCount: number): number | null {
  const m = ms.find((x) => x.frame > frame && x.frame < frameCount);
  return m ? m.frame : null;
}

/** Nearest marker frame strictly before `frame`, else null. */
export function prevMarkerFrame(ms: Marker[], frame: number): number | null {
  for (let i = ms.length - 1; i >= 0; i--) if (ms[i].frame < frame) return ms[i].frame;
  return null;
}

/**
 * Markers read back from a file. Anything that is not an array → undefined. Entries whose frame is
 * not an integer or is negative are dropped; a non-string label becomes "". A frame past the
 * document's length is KEPT — the strip only hides it (`frame < frameCount`), and a load must not
 * silently delete a marker that a later length change could bring back into view (final review
 * Ruling 6: §3 and §5 used to disagree, and the loader deleting hidden markers on reload was a
 * silent data change). Labels are trimmed but NOT length-capped (a joined label may exceed the
 * input's 40). Duplicate frames are joined in file order. Nothing left → undefined, so an empty
 * list is never carried.
 */
export function sanitizeMarkers(raw: unknown): Marker[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const valid: Marker[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    const f = r.frame;
    if (typeof f !== "number" || !Number.isInteger(f) || f < 0) continue;
    valid.push({ frame: f, label: typeof r.label === "string" ? r.label.trim() : "" });
  }
  valid.sort(byFrame); // stable: equal frames keep file order for the join below
  const out: Marker[] = [];
  for (const m of valid) pushJoining(out, m);
  return out.length > 0 ? out : undefined;
}
