/** Pure parts of the autosave: checkpoint rotation, the blank-layers guard, the memory estimate.
 *  Ported from slop-paint `2c53625`; `mediaIds` and `comparableLayers` are this app's. */

/** What is stored beside each autosaved copy, to list it in File ▸ Restore autosave…. */
export interface AutosaveMeta {
  savedAt: number;
  projectName: string;
  /** Drawing layers. */
  layerCount: number;
  /** Drawing layers that had pixels when it was saved. */
  inkedCount: number;
  /** The reference media it points at. Media pruning keeps these, so a restored copy comes back
   *  with its references (the media store is shared by every stored copy). */
  mediaIds: string[];
}

export interface AutosaveEntry extends AutosaveMeta {
  /** The IndexedDB key its project blob is stored under. */
  key: string;
}

/**
 * Whether this save also becomes a checkpoint: yes when there is none yet, or the newest is at
 * least `intervalMs` old. Checkpoints take the keys `autosave-cp-0 … -(keep-1)`; once all are
 * used, the oldest's key is reused, so its copy is overwritten and nothing needs deleting.
 */
export function planCheckpoint(
  list: AutosaveEntry[],
  meta: AutosaveMeta,
  intervalMs: number,
  keep: number,
): { write: string | null; list: AutosaveEntry[] } {
  const byAge = [...list].sort((a, b) => a.savedAt - b.savedAt);
  const newest = byAge[byAge.length - 1];
  if (newest && meta.savedAt - newest.savedAt < intervalMs) return { write: null, list };
  const used = new Set(list.map((e) => e.key));
  const free = Array.from({ length: keep }, (_, i) => `autosave-cp-${i}`).find((k) => !used.has(k));
  const key = free ?? byAge[0].key;
  return { write: key, list: [...byAge.filter((e) => e.key !== key), { ...meta, key }] };
}

/** The shape `looksBlanked` reads: a drawing layer's key cells and their canvases. */
export interface InkLayerShape<C> {
  id: number;
  kind: string;
  cells?: readonly { kind: string; canvas?: C }[];
}

/** The guard's baseline, taken at each save: every drawing layer that had pixels → each of its
 *  inked key-cell canvases → that canvas's ink revision then (`inkRevision` in `cell-ink`). */
export type InkBaseline<C> = ReadonlyMap<number, ReadonlyMap<C, number>>;

/**
 * The blank-layers guard: did drawings lose their pixels with nothing the user did to explain it?
 * That is iPad dropping the page's image memory in the background, which keeps the layers and
 * their very canvases and empties them.
 *
 * Judged per CELL: a key-cell canvas that was inked at the save (`baseline`), is still in that
 * layer, was never written to since — its ink revision (`revision`, bumped by every pixel write,
 * undo and redo) has not moved — and is empty now (`isEmpty`) was blanked. Every way the user
 * empties a canvas (erase, clear, cut, undo) moves its revision, and ink drawn on another cell
 * excuses nothing. A canvas no longer in the layer was deleted or replaced (a timeline delete
 * across rows, a resize — one step for many cells): gone, not blank.
 *
 * Only the FIRST untouched canvas of each layer is probed: iOS empties a page's canvases together,
 * so one per layer tells, and probing every cell on every save froze the page on a long shot. A
 * blanking that spares that one canvas (partial reclaim) goes unseen, as it did before.
 *
 * It used to excuse one emptied layer per undo step taken since the save, whatever the step
 * touched — on a 1-4 layer document one stroke was enough to hide a blanking, and the hide flush
 * always has one (2026-10-17 review #2).
 */
export function looksBlanked<C>(
  layers: readonly InkLayerShape<C>[],
  baseline: InkBaseline<C>,
  revision: (canvas: C) => number,
  isEmpty: (canvas: C) => boolean,
): boolean {
  for (const l of layers) {
    const was = baseline.get(l.id);
    if (l.kind !== "draw" || !was) continue;
    for (const c of l.cells ?? []) {
      if (c.kind !== "key" || c.canvas === undefined) continue;
      if (was.get(c.canvas) !== revision(c.canvas)) continue; // not inked at the save, or edited
      if (isEmpty(c.canvas)) return true;
      break;
    }
  }
  return false;
}

/** Image memory `count` canvases take: 4 bytes a pixel, at the canvas's device resolution. */
export function layerMemoryBytes(count: number, w: number, h: number, dpr: number): number {
  return count * Math.round(w * dpr) * Math.round(h * dpr) * 4;
}

/** Image memory the drawings take: every drawing layer's key-cell canvases (each document-sized,
 *  `w`×`h` at `dpr`), each canvas counted once. What an iPad empties in the background. */
export function keyCellMemoryBytes<C>(
  layers: readonly InkLayerShape<C>[],
  w: number,
  h: number,
  dpr: number,
): number {
  const canvases = new Set<C>();
  for (const l of layers) {
    if (l.kind !== "draw") continue;
    for (const c of l.cells ?? []) if (c.kind === "key" && c.canvas) canvases.add(c.canvas);
  }
  return layerMemoryBytes(canvases.size, w, h, dpr);
}

/** Above this, an iPad may drop the canvases' pixels while the app is in the background (a
 *  40-layer 1920×1080 slop-paint document at dpr 2 — 1.2 GB — lost them all). A guess on the safe
 *  side: the real limit depends on the device and what else is running. */
export const IPAD_MEMORY_WARN_BYTES = 600 * 1024 * 1024;

/** "1.3 GB", "420 MB". */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
