import { effectiveRange } from "../anim/playback";

export type ExportRangeMode = "all" | "inout" | "custom";

/**
 * Which frames an export writes.
 *
 * Until 2026-09-19 every exporter silently followed the play In/Out range, so a range set an hour
 * ago and forgotten shortened the file and the dialog could only warn about it afterwards. The mode
 * makes that a choice; `inout` stays the DEFAULT, so nothing changes for anyone who ignores it.
 */
export function resolveExportRange(
  opts: { rangeMode: ExportRangeMode; customStart: number; customEnd: number },
  playRange: { in: number; out: number } | null,
  frameCount: number,
): { start: number; end: number } {
  const last = Math.max(0, frameCount - 1);
  if (opts.rangeMode === "all") return { start: 0, end: last };
  if (opts.rangeMode === "inout") return effectiveRange(playRange, frameCount);
  const a = Math.max(0, Math.min(last, Math.round(opts.customStart)));
  const b = Math.max(0, Math.min(last, Math.round(opts.customEnd)));
  // Reversed pair → that span, not nothing: typing the end first is a slip, not an instruction to
  // export zero frames.
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/** The pixel size an export writes at `scale` — what the dialog's size label must show, so the
 *  label cannot drift from what is actually rendered. Floored at 1: a 25% export of a tiny document
 *  still has to have pixels. Deliberately does NOT multiply by `dpr`, unlike every exporter this
 *  feeds — correct only because `DPR` (`src/state/appState.svelte.ts`) is the fixed constant `1`;
 *  if it ever tracked `devicePixelRatio` this label would silently show half the real output. */
export function exportPixelSize(
  width: number,
  height: number,
  scale: number,
): { w: number; h: number } {
  return {
    w: Math.max(1, Math.round(width * scale)),
    h: Math.max(1, Math.round(height * scale)),
  };
}
