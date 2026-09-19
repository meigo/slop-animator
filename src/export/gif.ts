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

/**
 * Replace every pixel with its luminance, in place. Alpha is untouched.
 *
 * Rec. 601 weights, the same ones a browser's `grayscale()` filter and every video codec use: the
 * eye is far more sensitive to green than to blue, so a flat average turns a green into a much
 * lighter grey than it looks and a blue into a much darker one.
 *
 * Done BEFORE quantising rather than by building a grey palette and letting `applyPalette` find the
 * nearest entry: that mapping measures RGB distance, so a saturated colour would land on whichever
 * grey happens to be closest in the cube rather than on the grey it actually looks like. Converting
 * first also means the quantiser CHOOSES the greys — `colors: 4` on a drawing gives the four greys
 * that drawing needs, not four evenly spaced ones.
 */
export function grayscaleInPlace(rgba: Uint8ClampedArray): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const y = rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = y;
  }
}

/**
 * Do two rendered frames contain exactly the same pixels?
 *
 * This is what lets a HOLD cost one GIF frame instead of three. Compared a word at a time through a
 * Uint32Array view — a quarter of the iterations, and the tail is exact because an RGBA frame is
 * always a whole number of 32-bit pixels. Measured (2026-09-19, 24 frames at 1280×720): collapsing a
 * shot held on threes writes 8 frames instead of 24 and is FASTER than not collapsing, because
 * skipping a quantise-and-encode costs far more than the comparison; where nothing collapses (a shot
 * on ones, or boil on, which displaces every frame) the overhead is ~2%.
 */
export function framesIdentical(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  const wa = new Uint32Array(a.buffer, a.byteOffset, a.length >> 2);
  const wb = new Uint32Array(b.buffer, b.byteOffset, b.length >> 2);
  for (let i = 0; i < wa.length; i++) if (wa[i] !== wb[i]) return false;
  return true;
}

export interface GifExportOptions extends ExportProgress {
  /** 1 = document size, 0.5 = half. Clamped into (0, 1]. */
  scale?: number;
  /** Palette size, 2–256. Default 64. */
  colors?: number;
  /** Convert every frame to luminance before quantising, so the palette comes out as `colors`
   *  GREYS. On grey artwork this costs nothing and shrinks the file; on colour artwork it is a
   *  deliberate conversion, tinted paper included. */
  grayscale?: boolean;
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
  {
    signal,
    onProgress,
    scale = 1,
    colors = PALETTE_COLORS,
    grayscale = false,
  }: GifExportOptions = {},
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
  // Transparent path: GIF transparency is one bit per pixel, so rgba4444 (the alpha channel
  // quantised alongside the colour) is as close as the format goes — a soft edge lands either
  // fully opaque or fully clear. There is no rgba565, so this path has no other option.
  // Opaque path: rgb565 (gifenc's own default) gives 32/64/32 levels per channel; rgb444's
  // 16/16/16 caches nearest-colour lookups by a 4-bit-per-channel bin, so every pixel landing in
  // one bin gets the same palette index no matter how large `colors` is — that made Colours nearly
  // meaningless above ~64 on a smooth gradient. `quantize` and `applyPalette` below are both passed
  // this same string, since they must agree on how pixels are binned.
  const format = transparent ? "rgba4444" : "rgb565";

  const draw = (frame: number) => {
    // `Math.round(width * dpr * scale)` can make the canvas a fraction wider than the rect
    // `renderFrame` fills, leaving a sub-pixel transparent sliver down the right/bottom edge —
    // same reasoning as `renderFramePng` in png-sequence.ts. Under `rgb565` that sliver quantises
    // as near-black instead of paper, so pre-fill first. Skipped for a transparent export.
    if (!transparent) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = project.bgColor;
      ctx.fillRect(0, 0, w, h);
    }
    renderFrame(ctx, project, frame, dpr, {
      drawBg: !transparent,
      includeReference: false,
      boil: project.boil.enabled ? project.boil : undefined,
      outputScale: s,
    });
    const data = ctx.getImageData(0, 0, w, h).data;
    if (grayscale) grayscaleInPlace(data);
    return data;
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

  // Write each sample straight into `merged` at its offset rather than collecting an array of
  // frames and THEN allocating `merged` the same total size — that would double the peak (up to
  // five full frames, the largest live allocation in this function) on top of `merged` itself,
  // which matters on iPad, the platform this is unverified on and the most memory-constrained.
  const frameBytes = w * h * 4;
  const merged = new Uint8ClampedArray(sampleFrames.length * frameBytes);
  for (let i = 0; i < sampleFrames.length; i++) {
    if (signal?.aborted) throw abortError();
    merged.set(draw(sampleFrames[i]), i * frameBytes);
    await yieldToEventLoop();
  }
  const palette = quantize(merged, colors, { format });

  // GIF transparency punches a hole through ONE palette index. Nothing in gifenc's quantizer
  // guarantees a transparent colour lands at index 0 — it only usually does, because rgba4444
  // packs alpha in the high bits. So find the index of an entry whose alpha is actually 0, rather
  // than assuming; if the quantizer merged it away (a busy frame pushed distinct colours past
  // `colors`, or none of the sampled frames had a transparent pixel), insert one deterministically,
  // dropping the palette's LAST entry to stay within `colors` — not its "least populous" one; gifenc
  // fills the palette by walking a PNN merge chain, which is not a popularity order. This branch
  // only runs when the quantizer produced no zero-alpha entry at all.
  let transparentIndex = 0;
  if (transparent) {
    const ti = palette.findIndex((c) => (c[3] ?? 255) === 0);
    if (ti >= 0) {
      transparentIndex = ti;
    } else {
      palette.unshift([0, 0, 0, 0]);
      if (palette.length > colors) palette.pop();
      transparentIndex = 0;
    }
  }

  // ── Encode ────────────────────────────────────────────────────────────────────────────────────
  //
  // A frame identical to the one before it is NOT encoded again: its delay is added to the frame
  // already pending instead, which is exactly what a hold is — one drawing shown for three
  // exposures becomes one GIF frame of triple the delay. Measured on 24 frames at 1280×720: on twos
  // 121 kB → 61 kB, on threes 116 kB → 39 kB, with the total duration unchanged to the hundredth.
  //
  // A frame therefore cannot be written until the NEXT one has been compared to it — its delay is
  // not final until then — so one frame is always held pending and flushed either when a different
  // frame arrives or after the loop.
  const gif = GIFEncoder();
  const delays = gifFrameDelays(total, project.fps);
  let pending: { index: Uint8Array; delay: number } | null = null;
  let prevPixels: Uint8ClampedArray | null = null;
  let written = 0;
  const flush = () => {
    if (!pending) return;
    gif.writeFrame(pending.index, w, h, {
      // The global palette goes with the first WRITTEN frame, not source frame 0 — which are the
      // same frame today, but would silently diverge if the first frames were ever skipped.
      palette: written === 0 ? palette : undefined,
      // gifenc takes MILLISECONDS and divides by 10 for the GIF's hundredths.
      delay: pending.delay * 10,
      transparent,
      transparentIndex,
    });
    written++;
    pending = null;
  };

  for (let f = range.start; f <= range.end; f++) {
    // OUTSIDE the try below, deliberately: an abort must not be re-thrown as "frame N could not be
    // encoded", which would report a deliberate cancel as a defect. Same rule as the PNG sequence.
    if (signal?.aborted) throw abortError();
    const i = f - range.start;
    try {
      const pixels = draw(f);
      if (pending && prevPixels && framesIdentical(prevPixels, pixels)) {
        // Held: lengthen the pending frame rather than encoding this one again.
        pending.delay += delays[i];
      } else {
        flush();
        pending = { index: applyPalette(pixels, palette, format), delay: delays[i] };
        prevPixels = pixels; // `draw` returns a fresh array each call, so this cannot alias
      }
    } catch (e) {
      throw new Error(
        `frame ${i + 1} of ${total} (timeline frame ${f + 1}) could not be encoded — ${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      );
    }
    // Progress counts SOURCE frames, not written ones: the bar has to match the timeline the artist
    // is looking at, and a held shot would otherwise appear to stall.
    onProgress?.(i + 1, total);
    await yieldToEventLoop(); // paint the bar, deliver a Cancel tap
  }
  if (signal?.aborted) throw abortError(); // the last frame's cancel, before the file is assembled
  flush(); // the last run of held frames
  gif.finish();
  return new Blob([gif.bytes() as Uint8Array<ArrayBuffer>], { type: "image/gif" });
}
