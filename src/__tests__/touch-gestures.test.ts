import { describe, it, expect, vi } from "vitest";
import {
  SNAP_ANGLE,
  snappedRotation,
  shouldPreventTouchDefault,
  setupTouchGestures,
} from "../core/touch-gestures";
import type { Viewport } from "../core/viewport";

describe("snappedRotation", () => {
  it("snaps a tiny tilt back to 0", () => {
    expect(snappedRotation(SNAP_ANGLE * 0.5)).toBe(0);
    expect(snappedRotation(-SNAP_ANGLE * 0.5)).toBe(0);
  });

  it("leaves a small intentional rotate (above the snap window) alone", () => {
    const eightDeg = (8 * Math.PI) / 180;
    expect(eightDeg).toBeGreaterThan(SNAP_ANGLE);
    expect(snappedRotation(eightDeg)).toBeCloseTo(eightDeg);
  });

  it("snaps to the nearest 90° when close enough", () => {
    const almostRight = Math.PI / 2 - SNAP_ANGLE * 0.4;
    expect(snappedRotation(almostRight)).toBeCloseTo(Math.PI / 2);
  });
});

describe("shouldPreventTouchDefault", () => {
  // A fake element whose `closest` matches by a class list, the way the real DOM one does.
  const el = (...classes: string[]) =>
    ({
      closest: (sel: string) => (classes.includes(sel.slice(1)) ? {} : null),
    }) as unknown as EventTarget;

  it("prevents the default touch behaviour over the canvas, so a finger pans instead of scrolling", () => {
    expect(shouldPreventTouchDefault(el("stage"))).toBe(true);
  });

  it("LEAVES the default alone on the floating panels, so their checkboxes and fields still work", () => {
    // preventDefault() on touchstart suppresses the click WebKit synthesises, which is why the pose
    // bar's "Fill outlines" checkbox could not be unchecked on iPad (2026-09-18).
    expect(shouldPreventTouchDefault(el("selection-actions-panel"))).toBe(false);
  });

  it("treats a missing target as canvas", () => {
    expect(shouldPreventTouchDefault(null)).toBe(true);
  });
});

describe("fingers landing during a stroke", () => {
  // A fake workspace that records its listeners, and a viewport with just what the gestures touch.
  function rig(drawing: { on: boolean }) {
    const on: Record<string, (e: unknown) => void> = {};
    const workspace = {
      addEventListener: (t: string, f: (e: unknown) => void) => (on[t] = f),
      removeEventListener: () => {},
      setPointerCapture: () => {},
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    } as unknown as HTMLElement;
    const viewport = {
      panX: 0,
      panY: 0,
      zoom: 1,
      rotation: 0,
      applyTransformPublic: () => {},
    } as unknown as Viewport;
    const cb = {
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onToggleEraser: vi.fn(),
      onViewportChange: vi.fn(),
      isDrawing: () => drawing.on,
    };
    setupTouchGestures(workspace, viewport, cb);
    let t = 0;
    const ev = (type: string, id: number, x: number, y: number) =>
      on[type]({
        pointerType: "touch",
        pointerId: id,
        clientX: x,
        clientY: y,
        timeStamp: (t += 10),
        target: null,
        preventDefault: () => {},
      });
    return { viewport, cb, ev };
  }

  it("a finger dragging while the pen draws does not pan the view", () => {
    const drawing = { on: true };
    const { viewport, ev } = rig(drawing);
    ev("pointerdown", 1, 100, 100);
    ev("pointermove", 1, 160, 130);
    expect(viewport.panX).toBe(0);
    expect(viewport.panY).toBe(0);
  });

  it("a two-finger tap while the pen draws does not undo", () => {
    const { cb, ev } = rig({ on: true });
    ev("pointerdown", 1, 100, 100);
    ev("pointerdown", 2, 140, 100);
    ev("pointerup", 1, 100, 100);
    ev("pointerup", 2, 140, 100);
    expect(cb.onUndo).not.toHaveBeenCalled();
  });

  it("stays ignored until every finger lifts, even when the stroke ends first", () => {
    const drawing = { on: true };
    const { viewport, ev } = rig(drawing);
    ev("pointerdown", 1, 100, 100);
    drawing.on = false; // the pen lifts, the palm stays
    ev("pointermove", 1, 150, 100);
    expect(viewport.panX).toBe(0);
    ev("pointerup", 1, 150, 100);
    // A fresh gesture after that pans normally.
    ev("pointerdown", 3, 100, 100);
    ev("pointermove", 3, 150, 100);
    expect(viewport.panX).toBe(50);
  });

  it("with no stroke open, a two-finger tap still undoes", () => {
    const { cb, ev } = rig({ on: false });
    ev("pointerdown", 1, 100, 100);
    ev("pointerdown", 2, 140, 100);
    ev("pointerup", 1, 100, 100);
    ev("pointerup", 2, 140, 100);
    expect(cb.onUndo).toHaveBeenCalledTimes(1);
  });
});
