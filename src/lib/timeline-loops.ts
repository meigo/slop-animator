import { displayFrame, loopRegions, type Cell } from "../anim/document";
import type { TimelineSpan } from "./timeline-spans";

/**
 * The spans a loop's region REPLAYS, for the timeline's ghosted repeats — so you can see where a
 * loop stops without scrubbing. Each frame in a region takes the glyph of the frame it shows
 * (`displayFrame`), and runs are built per region. Unlike `computeTimelineSpans` a ghost run may start
 * on a held frame, so a ghost content span can have EMPTY `keyFrames` (a pass that begins mid-hold).
 */
export function computeLoopGhostSpans(
  cells: Cell[],
  glyphs: string[],
  frameCount: number,
): TimelineSpan[] {
  const out: TimelineSpan[] = [];
  for (const r of loopRegions(cells, frameCount)) {
    let run: TimelineSpan | null = null;
    for (let f = r.frame; f < r.end; f++) {
      const g = glyphs[displayFrame(cells, f)] ?? "";
      if (g === "◆" || g === "—") {
        if (!run) {
          run = { startFrame: f, endFrame: f, blank: false, keyFrames: [] };
          out.push(run);
        }
        run.endFrame = f;
        if (g === "◆") run.keyFrames.push(f);
      } else {
        run = null;
        if (g === "◇") out.push({ startFrame: f, endFrame: f, blank: true, keyFrames: [] });
      }
    }
  }
  return out;
}

/** Default `back` for a new loop at `frame`: the whole content run ending at `frame - 1`
 *  (usually the cycle just drawn); 1 when that frame shows nothing. */
export function defaultLoopBack(spans: TimelineSpan[], frame: number): number {
  const s = spans.find((x) => !x.blank && x.startFrame <= frame - 1 && frame - 1 <= x.endFrame);
  return s ? frame - s.startFrame : 1;
}

export type LoopButton = { action: "add" | "remove" | null; title: string };

/** What the timeline's Loop button does at `frame` on the selected drawing row (`cells`, or null
 *  when no drawing row is selected). */
export function loopButtonState(
  cells: Cell[] | null,
  frame: number,
  editable: boolean,
): LoopButton {
  if (!cells) return { action: null, title: "Loop — select a drawing layer" };
  if (!editable) return { action: null, title: "Loop — the layer is locked or hidden" };
  const c = frame < cells.length ? cells[frame] : undefined;
  if (c?.kind === "loop") return { action: "remove", title: "Remove loop" };
  if (frame < 1) return { action: null, title: "Loop — nothing before frame 1 to repeat" };
  if (c?.kind === "key")
    return {
      action: null,
      title: "Loop — loops go on a held frame; a key's drawing would be replaced",
    };
  return { action: "add", title: "Loop — repeat the drawings before this frame" };
}
