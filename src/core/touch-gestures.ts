/**
 * Touch gesture handling for iPad / touch devices.
 *
 * - One finger touch: pan canvas
 * - Two-finger pinch: zoom + pan + rotate
 * - Two-finger tap: undo
 * - Three-finger tap: redo
 *
 * Apple Pencil (pointerType "pen") bypasses this entirely — it goes to input.ts for drawing.
 */

import { Viewport } from "./viewport";

interface ActiveTouch {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
}

export interface TouchGestureCallbacks {
  onUndo: () => void;
  onRedo: () => void;
  onViewportChange: () => void;
}

const TAP_MAX_DURATION = 300; // ms
const TAP_MAX_DISTANCE = 15; // px
/** Snap to nearest 90° when within this threshold (radians, ~5°) */
const SNAP_ANGLE = 5 * (Math.PI / 180);

export function setupTouchGestures(
  /** The stable workspace container (not the transformed element) */
  workspace: HTMLElement,
  viewport: Viewport,
  callbacks: TouchGestureCallbacks
) {
  const touches = new Map<number, ActiveTouch>();

  // Track initial pinch state
  let pinchStartDist = 0;
  let pinchStartAngle = 0;
  let pinchStartZoom = 1;
  let pinchStartRotation = 0;
  let pinchStartMidX = 0;
  let pinchStartMidY = 0;
  let pinchStartPanX = 0;
  let pinchStartPanY = 0;

  // Single-finger pan state
  let singlePanActive = false;
  let singlePanStartX = 0;
  let singlePanStartY = 0;
  let singlePanStartPanX = 0;
  let singlePanStartPanY = 0;

  // Track if gesture moved (to distinguish taps from drags)
  let gestureDidMove = false;

  // Tap detection
  let maxSimultaneousTouches = 0;
  let lastTouchEndTime = 0;

  function onPointerDown(e: PointerEvent) {
    if (e.pointerType !== "touch") return;
    // Don't intercept taps on the floating selection action panel — those are buttons.
    const target = e.target as Element | null;
    if (target?.closest?.(".selection-actions-panel")) return;
    e.preventDefault();

    workspace.setPointerCapture(e.pointerId);

    touches.set(e.pointerId, {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      startTime: e.timeStamp,
    });

    gestureDidMove = false;
    maxSimultaneousTouches = Math.max(maxSimultaneousTouches, touches.size);

    if (touches.size === 1) {
      // Start single-finger pan
      singlePanActive = true;
      singlePanStartX = e.clientX;
      singlePanStartY = e.clientY;
      singlePanStartPanX = viewport.panX;
      singlePanStartPanY = viewport.panY;
    } else if (touches.size === 2) {
      // Switch from pan to pinch+rotate
      singlePanActive = false;
      initPinch();
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerType !== "touch") return;

    const t = touches.get(e.pointerId);
    if (!t) return;

    t.x = e.clientX;
    t.y = e.clientY;

    // Check if this counts as movement
    const dx = t.x - t.startX;
    const dy = t.y - t.startY;
    if (Math.abs(dx) > TAP_MAX_DISTANCE || Math.abs(dy) > TAP_MAX_DISTANCE) {
      gestureDidMove = true;
    }

    if (touches.size === 1 && singlePanActive) {
      // Single finger pan
      viewport.panX = singlePanStartPanX + (t.x - singlePanStartX);
      viewport.panY = singlePanStartPanY + (t.y - singlePanStartY);
      viewport.applyTransformPublic();
      callbacks.onViewportChange();
    } else if (touches.size === 2) {
      // Pinch zoom + pan + rotate
      updatePinch();
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (e.pointerType !== "touch") return;

    const t = touches.get(e.pointerId);
    touches.delete(e.pointerId);

    if (!t) return;

    // If all fingers lifted, check for tap gestures
    if (touches.size === 0 && !gestureDidMove) {
      const duration = e.timeStamp - t.startTime;
      if (duration < TAP_MAX_DURATION) {
        checkTapGesture();
      }
    }

    // Snap rotation on gesture end
    if (touches.size === 0) {
      snapRotation();
    }

    singlePanActive = false;

    // If one finger remains after lifting one, restart single-finger pan from current position
    if (touches.size === 1) {
      const remaining = touches.values().next().value!;
      singlePanActive = true;
      singlePanStartX = remaining.x;
      singlePanStartY = remaining.y;
      singlePanStartPanX = viewport.panX;
      singlePanStartPanY = viewport.panY;
    }
  }

  function onPointerCancel(e: PointerEvent) {
    if (e.pointerType !== "touch") return;
    touches.delete(e.pointerId);
    singlePanActive = false;
  }

  // --- Pinch + rotate helpers ---

  function angleBetween(ax: number, ay: number, bx: number, by: number): number {
    return Math.atan2(by - ay, bx - ax);
  }

  function initPinch() {
    const pts = Array.from(touches.values());
    if (pts.length < 2) return;

    const [a, b] = pts;
    pinchStartDist = dist(a.x, a.y, b.x, b.y);
    pinchStartAngle = angleBetween(a.x, a.y, b.x, b.y);
    pinchStartZoom = viewport.zoom;
    pinchStartRotation = viewport.rotation;
    pinchStartMidX = (a.x + b.x) / 2;
    pinchStartMidY = (a.y + b.y) / 2;
    pinchStartPanX = viewport.panX;
    pinchStartPanY = viewport.panY;
  }

  function updatePinch() {
    const pts = Array.from(touches.values());
    if (pts.length < 2) return;

    const [a, b] = pts;
    const currentDist = dist(a.x, a.y, b.x, b.y);
    const currentAngle = angleBetween(a.x, a.y, b.x, b.y);
    const currentMidX = (a.x + b.x) / 2;
    const currentMidY = (a.y + b.y) / 2;

    // New zoom & rotation
    const scale = currentDist / pinchStartDist;
    const newZoom = Math.max(0.1, Math.min(20, pinchStartZoom * scale));
    const newRotation = pinchStartRotation + (currentAngle - pinchStartAngle);

    // The canvas point under the original pinch midpoint (using start state)
    const rect = workspace.getBoundingClientRect();
    const rx0 = pinchStartMidX - rect.left;
    const ry0 = pinchStartMidY - rect.top;
    // Inverse of start transform: undo translate, undo rotate, undo scale
    const dx0 = rx0 - pinchStartPanX;
    const dy0 = ry0 - pinchStartPanY;
    const startRot = pinchStartRotation;
    const cos0 = Math.cos(-startRot);
    const sin0 = Math.sin(-startRot);
    const cx = (dx0 * cos0 - dy0 * sin0) / pinchStartZoom;
    const cy = (dx0 * sin0 + dy0 * cos0) / pinchStartZoom;

    // Forward transform with new state: that canvas point should land at the new midpoint
    // screen = pan + rotate(scale(canvas))
    const cosN = Math.cos(newRotation);
    const sinN = Math.sin(newRotation);
    const sx = cx * newZoom;
    const sy = cy * newZoom;
    const screenFromCanvas_x = sx * cosN - sy * sinN;
    const screenFromCanvas_y = sx * sinN + sy * cosN;

    const newRx = currentMidX - rect.left;
    const newRy = currentMidY - rect.top;

    viewport.zoom = newZoom;
    viewport.rotation = newRotation;
    viewport.panX = newRx - screenFromCanvas_x;
    viewport.panY = newRy - screenFromCanvas_y;

    viewport.applyTransformPublic();
    callbacks.onViewportChange();
  }

  /** Snap rotation to nearest 90° if within threshold */
  function snapRotation() {
    const HALF_TURN = Math.PI;
    const QUARTER_TURN = Math.PI / 2;

    // Normalize to [-PI, PI]
    let r = viewport.rotation % (2 * Math.PI);
    if (r > HALF_TURN) r -= 2 * Math.PI;
    if (r < -HALF_TURN) r += 2 * Math.PI;

    // Find nearest 90° step
    const nearest = Math.round(r / QUARTER_TURN) * QUARTER_TURN;
    if (Math.abs(r - nearest) < SNAP_ANGLE) {
      viewport.rotation = nearest;
      viewport.applyTransformPublic();
      callbacks.onViewportChange();
    }
  }

  // --- Tap detection ---

  function checkTapGesture() {
    const count = maxSimultaneousTouches;
    maxSimultaneousTouches = 0;

    // Debounce: avoid double-firing
    const now = performance.now();
    if (now - lastTouchEndTime < 100) return;
    lastTouchEndTime = now;

    if (count === 2) {
      callbacks.onUndo();
    } else if (count === 3) {
      callbacks.onRedo();
    }
  }

  function dist(x1: number, y1: number, x2: number, y2: number) {
    return Math.hypot(x2 - x1, y2 - y1);
  }

  workspace.addEventListener("pointerdown", onPointerDown, { capture: true });
  workspace.addEventListener("pointermove", onPointerMove, { capture: true });
  workspace.addEventListener("pointerup", onPointerUp, { capture: true });
  workspace.addEventListener("pointercancel", onPointerCancel, { capture: true });

  // Prevent default touch behaviors on the workspace
  workspace.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  workspace.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });

  return () => {
    workspace.removeEventListener("pointerdown", onPointerDown, { capture: true });
    workspace.removeEventListener("pointermove", onPointerMove, { capture: true });
    workspace.removeEventListener("pointerup", onPointerUp, { capture: true });
    workspace.removeEventListener("pointercancel", onPointerCancel, { capture: true });
  };
}
