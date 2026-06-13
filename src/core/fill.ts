/**
 * Flood fill (paint bucket) using a scanline algorithm.
 * Operates on raw ImageData for performance.
 */

export interface FillOptions {
  /** Color tolerance for matching the clicked pixel's color (0-255) */
  tolerance?: number;
  /** Alpha threshold (0-255): pixels with alpha >= this are treated as walls */
  alphaThreshold?: number;
  /** Expand fill by this many pixels to cover antialiased edges. Fill draws behind existing content. */
  expand?: number;
}

export function floodFill(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  fillColor: { r: number; g: number; b: number; a: number },
  options: FillOptions = {}
) {
  const tolerance = options.tolerance ?? 32;
  const alphaThreshold = options.alphaThreshold ?? 0;
  const expand = options.expand ?? 0;

  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  const sx = Math.round(startX);
  const sy = Math.round(startY);
  if (sx < 0 || sx >= w || sy < 0 || sy >= h) return;

  const startIdx = (sy * w + sx) * 4;
  const targetR = data[startIdx];
  const targetG = data[startIdx + 1];
  const targetB = data[startIdx + 2];
  const targetA = data[startIdx + 3];

  // Don't fill if clicking on a wall pixel
  if (alphaThreshold > 0 && targetA >= alphaThreshold) return;

  // Don't fill if clicking on the same color
  if (
    Math.abs(targetR - fillColor.r) <= tolerance &&
    Math.abs(targetG - fillColor.g) <= tolerance &&
    Math.abs(targetB - fillColor.b) <= tolerance &&
    Math.abs(targetA - fillColor.a) <= tolerance
  ) {
    return;
  }

  // --- Pass 1: Scanline flood fill to build a fill mask ---
  const mask = new Uint8Array(w * h); // 1 = fill, 0 = no fill

  function isWall(pixelIdx: number): boolean {
    if (alphaThreshold > 0) {
      return data[pixelIdx + 3] >= alphaThreshold;
    }
    return false;
  }

  function matches(pixelIdx: number): boolean {
    const pi = pixelIdx >> 2;
    if (mask[pi]) return false;
    if (isWall(pixelIdx)) return false;
    return (
      Math.abs(data[pixelIdx] - targetR) <= tolerance &&
      Math.abs(data[pixelIdx + 1] - targetG) <= tolerance &&
      Math.abs(data[pixelIdx + 2] - targetB) <= tolerance &&
      Math.abs(data[pixelIdx + 3] - targetA) <= tolerance
    );
  }

  const stack: [number, number][] = [[sx, sy]];

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    let idx = (y * w + x) * 4;

    if (!matches(idx)) continue;

    // Find left edge
    let lx = x;
    while (lx > 0 && matches((y * w + lx - 1) * 4)) {
      lx--;
    }

    // Scan right, filling mask
    let rx = lx;
    let aboveAdded = false;
    let belowAdded = false;

    while (rx < w) {
      idx = (y * w + rx) * 4;
      if (!matches(idx)) break;

      mask[y * w + rx] = 1;

      if (y > 0) {
        const aboveIdx = ((y - 1) * w + rx) * 4;
        if (matches(aboveIdx)) {
          if (!aboveAdded) {
            stack.push([rx, y - 1]);
            aboveAdded = true;
          }
        } else {
          aboveAdded = false;
        }
      }

      if (y < h - 1) {
        const belowIdx = ((y + 1) * w + rx) * 4;
        if (matches(belowIdx)) {
          if (!belowAdded) {
            stack.push([rx, y + 1]);
            belowAdded = true;
          }
        } else {
          belowAdded = false;
        }
      }

      rx++;
    }
  }

  // --- Pass 2: Expand the mask by N pixels (morphological dilation) ---
  let finalMask: Uint8Array<ArrayBuffer> = mask;
  if (expand > 0) {
    finalMask = dilateMask(mask, w, h, expand) as Uint8Array<ArrayBuffer>;
  }

  // --- Pass 3: Apply fill behind existing content ---
  if (expand > 0) {
    // Draw fill to a temp canvas, then composite behind existing content
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext("2d")!;
    const tempData = tempCtx.createImageData(w, h);
    const td = tempData.data;

    for (let i = 0; i < w * h; i++) {
      if (finalMask[i]) {
        const pi = i * 4;
        td[pi] = fillColor.r;
        td[pi + 1] = fillColor.g;
        td[pi + 2] = fillColor.b;
        td[pi + 3] = fillColor.a;
      }
    }
    tempCtx.putImageData(tempData, 0, 0);

    // Draw fill behind existing content using destination-over
    ctx.save();
    ctx.resetTransform();
    ctx.globalCompositeOperation = "destination-over";
    ctx.drawImage(tempCanvas, 0, 0);
    ctx.restore();
  } else {
    // No expand — write directly to the image data (original behavior)
    for (let i = 0; i < w * h; i++) {
      if (finalMask[i]) {
        const pi = i * 4;
        data[pi] = fillColor.r;
        data[pi + 1] = fillColor.g;
        data[pi + 2] = fillColor.b;
        data[pi + 3] = fillColor.a;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }
}

/**
 * Dilate a binary mask by `radius` pixels using a circular kernel.
 * Uses a distance-based approach for clean circular expansion.
 */
function dilateMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const result = new Uint8Array(w * h);

  // Build list of offsets within the circular radius
  const offsets: [number, number][] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        offsets.push([dx, dy]);
      }
    }
  }

  // For each filled pixel, mark all pixels within radius
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (const [dx, dy] of offsets) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          result[ny * w + nx] = 1;
        }
      }
    }
  }

  return result;
}

export function hexToRgba(hex: string, opacity: number): { r: number; g: number; b: number; a: number } {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const a = Math.round((opacity / 100) * 255);
  return { r, g, b, a };
}
