/** Opacity of the nearest onion ghost; farther ghosts fade linearly toward 0. */
export const ONION_BASE_OPACITY = 0.4;

export interface OnionFrame {
  frame: number;
  kind: "prev" | "next";
  opacity: number;
}

/** Linear fade: distance 1 → base, distance `count` → base/count. */
function ghostOpacity(distance: number, count: number): number {
  return ONION_BASE_OPACITY * ((count - distance + 1) / count);
}

/**
 * Which neighbour frames to ghost for `current`, in draw order (farthest first so the
 * nearest ghost paints on top). Out-of-range neighbours are dropped.
 */
export function computeOnionFrames(
  current: number,
  frameCount: number,
  prevCount: number,
  nextCount: number
): OnionFrame[] {
  const result: OnionFrame[] = [];

  for (let d = prevCount; d >= 1; d--) {
    const frame = current - d;
    if (frame < 0) continue;
    result.push({ frame, kind: "prev", opacity: ghostOpacity(d, prevCount) });
  }
  for (let d = nextCount; d >= 1; d--) {
    const frame = current + d;
    if (frame > frameCount - 1) continue;
    result.push({ frame, kind: "next", opacity: ghostOpacity(d, nextCount) });
  }
  return result;
}

import { resolveKeyframeIndex, type Project } from "./document";
import { compositeFrameLayers } from "./render";

export interface OnionConfig {
  enabled: boolean;
  prev: number;
  next: number;
  allLayers: boolean;
  tintPrev: string;
  tintNext: string;
}

/** Paint one ghost frame onto `display` via a `scratch` canvas: render the ghost, tint
 *  it with `source-in`, then draw it onto the display at `opacity`. */
function drawGhost(
  display: CanvasRenderingContext2D,
  scratch: CanvasRenderingContext2D,
  project: Project,
  ghostFrame: number,
  dpr: number,
  allLayers: boolean,
  activeLayerId: number,
  tint: string,
  opacity: number
): void {
  const w = project.width * dpr;
  const h = project.height * dpr;

  scratch.setTransform(1, 0, 0, 1, 0, 0);
  scratch.globalCompositeOperation = "source-over";
  scratch.globalAlpha = 1;
  scratch.clearRect(0, 0, w, h);

  if (allLayers) {
    compositeFrameLayers(scratch, project, ghostFrame, dpr);
  } else {
    const layer = project.layers.find((l) => l.id === activeLayerId);
    if (layer) {
      const ki = resolveKeyframeIndex(layer.cells, ghostFrame);
      const cell = ki === null ? null : layer.cells[ki];
      if (cell && cell.kind === "key") scratch.drawImage(cell.canvas, 0, 0);
    }
  }

  scratch.globalCompositeOperation = "source-in";
  scratch.fillStyle = tint;
  scratch.fillRect(0, 0, w, h);
  scratch.globalCompositeOperation = "source-over";

  display.globalAlpha = opacity;
  display.drawImage(scratch.canvas, 0, 0);
  display.globalAlpha = 1;
}

/**
 * Full composite for `frame` with onion ghosts underneath the current frame.
 * NOTE: this always draws ghosts — the CALLER decides whether onion is active
 * (gate on `onion.enabled` before calling; Canvas.svelte does this).
 */
export function renderFrameWithOnion(
  display: CanvasRenderingContext2D,
  scratch: CanvasRenderingContext2D,
  project: Project,
  frame: number,
  dpr: number,
  onion: OnionConfig,
  activeLayerId: number
): void {
  const w = project.width * dpr;
  const h = project.height * dpr;

  display.setTransform(1, 0, 0, 1, 0, 0);
  display.globalAlpha = 1;
  display.globalCompositeOperation = "source-over";
  display.clearRect(0, 0, w, h);
  display.fillStyle = project.bgColor;
  display.fillRect(0, 0, w, h);

  for (const g of computeOnionFrames(frame, project.frameCount, onion.prev, onion.next)) {
    const tint = g.kind === "prev" ? onion.tintPrev : onion.tintNext;
    drawGhost(display, scratch, project, g.frame, dpr, onion.allLayers, activeLayerId, tint, g.opacity);
  }

  compositeFrameLayers(display, project, frame, dpr);
}
