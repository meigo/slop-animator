/**
 * Stamp-based brush engine.
 * Draws incrementally — only new points since last call.
 */

import type { InputPoint } from "./input";
import type { BrushSettings } from "./brush";
import { getTip, type BrushType } from "./brush-textures";

export interface StampBrushSettings extends BrushSettings {
  brushType: BrushType;
}

// Track how many points we've already drawn for incremental stamping
let lastStampCount = 0;
let tintedTip: HTMLCanvasElement | null = null;
let tintedColor = "";
let tintedType: BrushType | null = null;

export function resetStampState() {
  lastStampCount = 0;
  tintedTip = null;
}

function getTintedTip(type: BrushType, color: string): HTMLCanvasElement {
  if (tintedTip && tintedColor === color && tintedType === type) return tintedTip;

  const tip = getTip(type);
  const cvs = document.createElement("canvas");
  cvs.width = tip.width;
  cvs.height = tip.height;
  const ctx = cvs.getContext("2d")!;
  ctx.drawImage(tip, 0, 0);
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, cvs.width, cvs.height);

  tintedTip = cvs;
  tintedColor = color;
  tintedType = type;
  return cvs;
}

/**
 * Draw new stamps incrementally onto ctx.
 * Call resetStampState() at stroke start.
 */
export function drawStampStrokeIncremental(
  ctx: CanvasRenderingContext2D,
  points: InputPoint[],
  settings: StampBrushSettings,
  sizeRange: number = 1.0,
  spacing: number = 0.15
) {
  if (points.length === 0) return;

  const minSize = Math.max(0.5, settings.size);
  const maxSize = minSize * sizeRange;
  const tip = getTintedTip(settings.brushType, settings.color);

  ctx.save();
  if (settings.isEraser) {
    ctx.globalCompositeOperation = "destination-out";
  } else if (settings.alphaLock) {
    ctx.globalCompositeOperation = "source-atop";
  } else if (settings.drawBehind) {
    ctx.globalCompositeOperation = "destination-over";
  } else {
    ctx.globalCompositeOperation = "source-over";
  }

  // Only process points we haven't stamped yet
  const startIdx = Math.max(0, lastStampCount - 1);
  const newPoints = points.slice(startIdx);

  if (newPoints.length < 2 && lastStampCount > 0) {
    ctx.restore();
    return;
  }

  // If first stroke point, stamp it
  if (lastStampCount === 0 && newPoints.length > 0) {
    const p = newPoints[0];
    const size = minSize + p.pressure * (maxSize - minSize);
    const drawSize = Math.max(1, size);
    ctx.globalAlpha = (settings.opacity / 100) * (0.5 + p.pressure * 0.5);
    ctx.drawImage(tip, p.x - drawSize / 2, p.y - drawSize / 2, drawSize, drawSize);
  }

  // Stamp along new segments
  let dist = 0;
  for (let i = 1; i < newPoints.length; i++) {
    const prev = newPoints[i - 1];
    const curr = newPoints[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (segLen === 0) continue;

    const avgSize = minSize + ((prev.pressure + curr.pressure) / 2) * (maxSize - minSize);
    const stepSize = Math.max(1, avgSize * spacing);

    let pos = -dist; // start from leftover distance of previous segment
    while (pos < segLen) {
      if (pos >= 0) {
        const t = pos / segLen;
        const x = prev.x + dx * t;
        const y = prev.y + dy * t;
        const p = prev.pressure + (curr.pressure - prev.pressure) * t;
        const size = minSize + p * (maxSize - minSize);
        const drawSize = Math.max(1, size);

        ctx.globalAlpha = (settings.opacity / 100) * (0.5 + p * 0.5);
        ctx.drawImage(tip, x - drawSize / 2, y - drawSize / 2, drawSize, drawSize);
      }
      pos += stepSize;
    }
    dist = pos - segLen;
  }

  lastStampCount = points.length;
  ctx.restore();
}
