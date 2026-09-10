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
 *
 * `bounds` is the PLAY RANGE, passed when one is set. Loop off (`wrap: false`): the range plays
 * once, so ghosts are CONFINED to it — frames outside it are not part of what is being animated.
 * Loop on (`wrap: true`): ghosts wrap across the seam exactly as playback does, so at the in-point
 * the previous drawings are the END of the range and at the out-point the next ones are its START.
 * That seam is where a cycle has to match, and it is the one place the plain onion could never show.
 * Blender's Grease Pencil ships the same idea as its onion "Loop" option.
 * A `current` outside the range ignores it: working outside the range is not working on the cycle.
 */
export function computeOnionFrames(
  current: number,
  frameCount: number,
  prevCount: number,
  nextCount: number,
  keyframes?: number[],
  bounds?: { start: number; end: number; wrap: boolean },
): OnionFrame[] {
  const inRange = !!bounds && current >= bounds.start && current <= bounds.end;
  const lo = inRange ? bounds!.start : 0;
  const hi = inRange ? bounds!.end : frameCount - 1;
  const wrap = inRange && bounds!.wrap;

  // Candidate neighbours on each side, NEAREST FIRST.
  let prevSeq: number[];
  let nextSeq: number[];
  if (keyframes) {
    // Keyframe mode: step to the neighbouring DRAWINGS instead of neighbouring frames, so holds
    // don't burn an onion slot. A key exactly at `current` is not its own neighbour; from a hold,
    // the nearest "prev" is the key it holds (the last key strictly before `current`).
    const keys = [...new Set(keyframes)].filter((f) => f >= lo && f <= hi).sort((a, b) => a - b);
    const before = keys.filter((f) => f < current);
    const after = keys.filter((f) => f > current);
    prevSeq = [...before].reverse();
    nextSeq = after;
    if (wrap) {
      prevSeq = prevSeq.concat([...after].reverse());
      nextSeq = nextSeq.concat(before);
    }
  } else {
    const len = hi - lo + 1;
    const cyc = (f: number) => lo + ((((f - lo) % len) + len) % len);
    prevSeq = [];
    nextSeq = [];
    for (let d = 1; d <= prevCount; d++) {
      const f = current - d;
      if (f >= lo) prevSeq.push(f);
      else if (wrap) prevSeq.push(cyc(f));
      else break;
    }
    for (let d = 1; d <= nextCount; d++) {
      const f = current + d;
      if (f <= hi) nextSeq.push(f);
      else if (wrap) nextSeq.push(cyc(f));
      else break;
    }
  }

  // Take up to `count` per side, alternating nearest-first, never the current frame and never a
  // frame twice. Only reachable when WRAPPING a range shorter than the ghost counts (unwrapped, the
  // two sides are disjoint), where it would otherwise ghost one drawing as both prev and next — or
  // the frame you are on. A side stops at its first miss, so its step distances stay contiguous and
  // the fade below still means "this many steps away".
  const used = new Set([current]);
  const prev: number[] = [];
  const next: number[] = [];
  for (let d = 0; d < Math.max(prevCount, nextCount); d++) {
    if (d < prevCount && prev.length === d) {
      const f = prevSeq[d];
      if (f !== undefined && !used.has(f)) {
        used.add(f);
        prev.push(f);
      }
    }
    if (d < nextCount && next.length === d) {
      const f = nextSeq[d];
      if (f !== undefined && !used.has(f)) {
        used.add(f);
        next.push(f);
      }
    }
  }

  const result: OnionFrame[] = [];
  for (let i = prev.length - 1; i >= 0; i--)
    result.push({ frame: prev[i], kind: "prev", opacity: ghostOpacity(i + 1, prevCount) });
  for (let i = next.length - 1; i >= 0; i--)
    result.push({ frame: next[i], kind: "next", opacity: ghostOpacity(i + 1, nextCount) });
  return result;
}

import {
  resolveDisplayKey,
  displayKeyChangeFrames,
  isLayerVisible,
  isIdentityTransform,
  cellTransform,
  groupOf,
  groupTransformAt,
  transformAt,
  type Project,
} from "./document";
import { compositeFrameLayers, drawCellComposed } from "./render";
import { groupBoxLogical } from "../lib/cell-ink";

export interface OnionConfig {
  enabled: boolean;
  prev: number;
  next: number;
  allLayers: boolean;
  /** Step to neighbouring KEYFRAMES instead of neighbouring frames (holds don't consume a slot). */
  byKeyframes?: boolean;
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
  opacity: number,
  version: number,
): void {
  const w = project.width * dpr;
  const h = project.height * dpr;

  scratch.setTransform(1, 0, 0, 1, 0, 0);
  scratch.globalCompositeOperation = "source-over";
  scratch.globalAlpha = 1;
  scratch.clearRect(0, 0, w, h);

  if (allLayers) {
    compositeFrameLayers(scratch, project, ghostFrame, dpr, false, undefined, version);
  } else {
    const layer = project.layers.find((l) => l.id === activeLayerId);
    if (layer && layer.kind === "draw" && isLayerVisible(layer, project.groups)) {
      const ki = resolveDisplayKey(layer.cells, ghostFrame);
      const cell = ki === null ? null : layer.cells[ki];
      if (cell && cell.kind === "key") {
        const cellT = cellTransform(cell);
        const g = groupOf(layer, project.groups);
        // `ghostFrame`, not the playhead — see the note below; the group's track is subject to
        // exactly the same rule as the layer's.
        const groupT = groupTransformAt(g, ghostFrame);
        // This ghost renders `ghostFrame`, not the playhead — each ghost is a different frame, so
        // its layer transform must resolve at ITS frame or every ghost would collapse onto the
        // playhead's position.
        const layerT = transformAt(layer, ghostFrame);
        const layerId = isIdentityTransform(layerT),
          cellId = isIdentityTransform(cellT),
          groupId = isIdentityTransform(groupT);
        if (layerId && cellId && groupId) scratch.drawImage(cell.canvas, 0, 0);
        else {
          const boxDev = cellId
            ? { x: 0, y: 0, w, h }
            : {
                x: cell.transformBox!.x * dpr,
                y: cell.transformBox!.y * dpr,
                w: cell.transformBox!.w * dpr,
                h: cell.transformBox!.h * dpr,
              };
          const groupBoxDev = groupId
            ? { x: 0, y: 0, w, h }
            : (() => {
                const lb = groupBoxLogical(g!, project, ghostFrame, dpr, version);
                return { x: lb.x * dpr, y: lb.y * dpr, w: lb.w * dpr, h: lb.h * dpr };
              })();
          drawCellComposed(
            scratch,
            cell.canvas,
            w,
            h,
            layerT,
            cellT,
            boxDev,
            dpr,
            groupT,
            groupBoxDev,
          );
        }
      }
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
  activeLayerId: number,
  version = 0,
  outputScale = 1,
  /** The play range — see `computeOnionFrames`. A separate argument rather than a field on
   *  `OnionConfig`, because that is onion SETTINGS and the range is session playback state. */
  bounds?: { start: number; end: number; wrap: boolean },
): void {
  const w = project.width * dpr;
  const h = project.height * dpr;

  display.setTransform(outputScale, 0, 0, outputScale, 0, 0);
  display.imageSmoothingEnabled = true;
  display.imageSmoothingQuality = "high";
  display.globalAlpha = 1;
  display.globalCompositeOperation = "source-over";
  display.clearRect(0, 0, w, h);
  if (!project.transparentBg) {
    display.fillStyle = project.bgColor;
    display.fillRect(0, 0, w, h);
  }

  // Keyframe mode reads the ACTIVE layer's keys — they are the drawings being worked on — even
  // when allLayers is on (that flag only controls what gets drawn at the chosen frames).
  let keyframes: number[] | undefined;
  if (onion.byKeyframes) {
    const layer = project.layers.find((l) => l.id === activeLayerId);
    keyframes =
      layer && layer.kind === "draw" ? displayKeyChangeFrames(layer.cells, project.frameCount) : [];
  }

  for (const g of computeOnionFrames(
    frame,
    project.frameCount,
    onion.prev,
    onion.next,
    keyframes,
    bounds,
  )) {
    const tint = g.kind === "prev" ? onion.tintPrev : onion.tintNext;
    drawGhost(
      display,
      scratch,
      project,
      g.frame,
      dpr,
      onion.allLayers,
      activeLayerId,
      tint,
      g.opacity,
      version,
    );
  }

  compositeFrameLayers(display, project, frame, dpr, true, undefined, version);
}
