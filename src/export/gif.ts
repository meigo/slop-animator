import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { renderFrame } from "../anim/render";
import { gifFrameDelays } from "./gif-timing";
import { abortError, yieldToEventLoop, type ExportProgress } from "./progress";
import type { Project } from "../anim/document";

/** Colours in the global palette. Ink, paper and their anti-aliasing need far fewer than GIF's 256,
 *  and a smaller table is a smaller file. Raise it if a painted project ever looks posterised. */
const PALETTE_COLORS = 64;

/** Frames sampled to build that palette. One is not enough: a colour introduced later — a coloured
 *  layer switched on mid-shot — would otherwise be mapped to its nearest neighbour for the whole
 *  export. Five costs one extra render each and covers the shot. */
const PALETTE_SAMPLES = 5;

export interface GifExportOptions extends ExportProgress {
  /** 1 = document size, 0.5 = half. Clamped into (0, 1]. */
  scale?: number;
  /** Palette size; the dialog offers 64 / 128 / 256. Default 64. */
  colors?: number;
}

/**
 * Encode the range as an animated GIF (drawing layers over the paper background, reference layers
 * excluded, line boil applied when enabled — the same picture the PNG sequence exports).
 *
 * Shaped like `exportPngSequence` on purpose: same signature, same abort/progress contract, same
 * yield after every frame so the bar paints and Cancel is deliverable.
 */
export async function exportGif(
  project: Project,
  dpr: number,
  range: { start: number; end: number },
  { signal, onProgress, scale = 1, colors = PALETTE_COLORS }: GifExportOptions = {},
): Promise<Blob> {
  const s = Math.min(1, Math.max(0.01, scale));
  const w = Math.max(1, Math.round(project.width * dpr * s));
  const h = Math.max(1, Math.round(project.height * dpr * s));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  const total = range.end - range.start + 1;
  const transparent = !!project.transparentBg;
  // GIF transparency is one bit per pixel, so RGBA4444 (the alpha channel quantised alongside the
  // colour) is as close as the format goes; a soft edge lands either fully opaque or fully clear.
  const format = transparent ? "rgba4444" : "rgb444";

  const draw = (frame: number) => {
    renderFrame(ctx, project, frame, dpr, {
      drawBg: !transparent,
      includeReference: false,
      boil: project.boil.enabled ? project.boil : undefined,
      outputScale: s,
    });
    return ctx.getImageData(0, 0, w, h).data;
  };

  // ── One global palette, sampled across the range ──────────────────────────────────────────────
  // Evenly spaced across the range, always including the first and last frame, deduped so a range
  // shorter than the sample count does not render the same frame twice.
  const sampleFrames: number[] = [];
  const span = Math.max(1, PALETTE_SAMPLES - 1);
  for (let i = 0; i < PALETTE_SAMPLES; i++) {
    const f = range.start + Math.round(((range.end - range.start) * i) / span);
    if (sampleFrames[sampleFrames.length - 1] !== f) sampleFrames.push(f);
  }

  const samples: Uint8ClampedArray[] = [];
  for (const f of sampleFrames) {
    if (signal?.aborted) throw abortError();
    samples.push(draw(f));
    await yieldToEventLoop();
  }
  const merged = new Uint8ClampedArray(samples.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of samples) {
    merged.set(a, at);
    at += a.length;
  }
  const palette = quantize(merged, colors, { format });

  // ── Encode ────────────────────────────────────────────────────────────────────────────────────
  const gif = GIFEncoder();
  const delays = gifFrameDelays(total, project.fps);
  for (let f = range.start; f <= range.end; f++) {
    // OUTSIDE the try below, deliberately: an abort must not be re-thrown as "frame N could not be
    // encoded", which would report a deliberate cancel as a defect. Same rule as the PNG sequence.
    if (signal?.aborted) throw abortError();
    const i = f - range.start;
    try {
      const index = applyPalette(draw(f), palette, format);
      gif.writeFrame(index, w, h, {
        // The global palette is written ONCE, with the first frame. Passing it again would write a
        // local palette per frame: same bytes on this kind of art, 2.2× the time (measured).
        palette: i === 0 ? palette : undefined,
        // gifenc takes MILLISECONDS and divides by 10 for the GIF's hundredths.
        delay: delays[i] * 10,
        transparent,
        transparentIndex: 0,
      });
    } catch (e) {
      throw new Error(
        `frame ${i + 1} of ${total} (timeline frame ${f + 1}) could not be encoded — ${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      );
    }
    onProgress?.(i + 1, total);
    await yieldToEventLoop(); // paint the bar, deliver a Cancel tap
  }
  if (signal?.aborted) throw abortError(); // the last frame's cancel, before the file is assembled
  gif.finish();
  return new Blob([gif.bytes() as Uint8Array<ArrayBuffer>], { type: "image/gif" });
}
