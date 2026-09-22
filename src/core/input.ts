export interface InputPoint {
  x: number;
  y: number;
  pressure: number;
  /** True when the device reports real pressure (pen). False for mouse, so the
   *  renderer can draw a constant nominal width instead of the thin pressure floor. */
  hasPressure: boolean;
  timestamp: number;
}

export type StrokeHandler = (points: InputPoint[], done: boolean) => void;
export type CoordTransform = (screenX: number, screenY: number) => { x: number; y: number };

export interface InputOptions {
  onStroke: StrokeHandler;
  transformCoords?: CoordTransform;
  /** Streamline factor 0-1, or a getter for dynamic values. Smooths input points (0 = none, 1 = max) */
  streamline?: number | (() => number);
  /** Called when a pencil double-tap is detected (two quick taps with minimal movement) */
  onPencilDoubleTap?: () => void;
}

const DOUBLE_TAP_INTERVAL = 300; // ms between taps
const TAP_MAX_DURATION = 200; // ms — a tap must be shorter than this
const TAP_MAX_DISTANCE = 8; // px — must not move more than this
/** Max distance (canvas px) between consecutive points before we interpolate */
const INTERPOLATION_THRESHOLD = 4;

/**
 * True when the event landed on UI chrome that lives *inside* the drawing stage
 * (the floating selection bar, pose bar). Svelte 5 delegates `pointerdown` to the
 * document, so a child's `onpointerdown` + `stopPropagation` runs AFTER a native
 * bubble listener on `stage` — filtering here is the only reliable guard.
 * Same selector `touch-gestures.ts` already uses for finger pans.
 */
export function isStageChromeTarget(target: EventTarget | null): boolean {
  const el = target as Element | null;
  // Handles too: their Svelte `onpointerdown` runs at the document, after this bubble listener,
  // so a pen press on a gizmo handle otherwise also starts an on-canvas transform drag.
  return !!el?.closest?.(".selection-actions-panel") || !!el?.closest?.("[data-ref-handle]");
}

export function setupInput(
  canvas: HTMLElement,
  onStroke: StrokeHandler,
  transformCoords?: CoordTransform,
  options?: Omit<InputOptions, "onStroke" | "transformCoords">,
) {
  let isDrawing = false;
  let drawPointer = -1;
  let currentPoints: InputPoint[] = [];

  // Streamline: interpolate toward raw input with factor t.
  // streamline=0 → t=1 (no smoothing), streamline=1 → t≈0.12 (heavy smoothing)
  const streamlineOpt = options?.streamline;
  function getStreamlineT(): number {
    const v = typeof streamlineOpt === "function" ? streamlineOpt() : (streamlineOpt ?? 0);
    return 1 - v * 0.88;
  }
  let lastStreamlined: InputPoint | null = null;

  // Pencil double-tap detection
  let lastPenTapTime = 0;
  let penDownTime = 0;
  let penDownX = 0;
  let penDownY = 0;
  let penMoved = false;

  function getPoint(e: PointerEvent): InputPoint {
    let x: number, y: number;
    if (transformCoords) {
      const p = transformCoords(e.clientX, e.clientY);
      x = p.x;
      y = p.y;
    } else {
      const rect = canvas.getBoundingClientRect();
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }
    return {
      x,
      y,
      // Mouse has no pressure sensor. Under Model 2 the size mapping thins below the
      // nominal size at low pressure, so a mouse must be flagged hasPressure:false —
      // Canvas.svelte then draws it at constant nominal width (sizeRange = 1).
      pressure: e.pointerType === "mouse" ? 0 : e.pressure,
      hasPressure: e.pointerType !== "mouse",
      timestamp: e.timeStamp,
    };
  }

  // On touch devices, only pen (Apple Pencil) and mouse draw.
  // Finger touches are handled by touch-gestures.ts for pan/zoom/undo.
  function shouldDraw(e: PointerEvent): boolean {
    return e.pointerType === "mouse" || e.pointerType === "pen";
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || !shouldDraw(e)) return;
    if (isStageChromeTarget(e.target)) return;
    // A second pen or mouse contact must not restart the stroke the first one owns.
    if (isDrawing) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    isDrawing = true;
    drawPointer = e.pointerId;
    const first = getPoint(e);
    lastStreamlined = first;
    currentPoints = [first];
    onStroke(currentPoints, false);

    // Track pen tap start
    if (e.pointerType === "pen") {
      penDownTime = e.timeStamp;
      penDownX = e.clientX;
      penDownY = e.clientY;
      penMoved = false;
    }
  }

  function onPointerMove(e: PointerEvent) {
    // Finger contacts share this element with the Pencil. Only the pointer that started the
    // stroke may extend it — a resting finger otherwise spikes the stroke and ends it.
    if (!isDrawing || e.pointerId !== drawPointer) return;
    e.preventDefault();

    // Track pen movement for tap detection
    if (e.pointerType === "pen" && !penMoved) {
      const dx = e.clientX - penDownX;
      const dy = e.clientY - penDownY;
      if (Math.abs(dx) > TAP_MAX_DISTANCE || Math.abs(dy) > TAP_MAX_DISTANCE) {
        penMoved = true;
      }
    }

    // Collect coalesced events (Safari may return empty array — fall back to event itself)
    const coalesced = e.getCoalescedEvents?.();
    const events = coalesced && coalesced.length > 0 ? coalesced : [e];
    for (const ce of events) {
      const raw = getPoint(ce);

      // Streamline: lerp toward raw input to smooth jitter
      let pt: InputPoint;
      const sT = getStreamlineT();
      if (lastStreamlined && sT < 1) {
        pt = {
          x: lastStreamlined.x + (raw.x - lastStreamlined.x) * sT,
          y: lastStreamlined.y + (raw.y - lastStreamlined.y) * sT,
          pressure: lastStreamlined.pressure + (raw.pressure - lastStreamlined.pressure) * sT,
          hasPressure: raw.hasPressure,
          timestamp: raw.timestamp,
        };
      } else {
        pt = raw;
      }
      lastStreamlined = pt;

      // Interpolate if gap between consecutive points is too large (iPad sparse events)
      if (currentPoints.length > 0) {
        const prev = currentPoints[currentPoints.length - 1];
        const dx = pt.x - prev.x;
        const dy = pt.y - prev.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > INTERPOLATION_THRESHOLD) {
          const steps = Math.ceil(dist / INTERPOLATION_THRESHOLD);
          for (let i = 1; i < steps; i++) {
            const t = i / steps;
            currentPoints.push({
              x: prev.x + dx * t,
              y: prev.y + dy * t,
              pressure: prev.pressure + (pt.pressure - prev.pressure) * t,
              hasPressure: pt.hasPressure,
              timestamp: prev.timestamp + (pt.timestamp - prev.timestamp) * t,
            });
          }
        }
      }
      currentPoints.push(pt);
    }
    onStroke(currentPoints, false);
  }

  function onPointerUp(e: PointerEvent) {
    if (!isDrawing || e.pointerId !== drawPointer) return;
    e.preventDefault();
    isDrawing = false;
    drawPointer = -1;
    lastStreamlined = null;
    currentPoints.push(getPoint(e));
    onStroke(currentPoints, true);
    currentPoints = [];

    // Detect pencil double-tap
    if (e.pointerType === "pen" && !penMoved && options?.onPencilDoubleTap) {
      const duration = e.timeStamp - penDownTime;
      if (duration < TAP_MAX_DURATION) {
        // This was a quick tap — check if it's a double-tap
        if (penDownTime - lastPenTapTime < DOUBLE_TAP_INTERVAL) {
          options.onPencilDoubleTap();
          lastPenTapTime = 0; // reset so triple-tap doesn't fire again
        } else {
          lastPenTapTime = e.timeStamp;
        }
      }
    }
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  // Capture lost without an up (the element or capture went away) must still end the stroke, or
  // the `isDrawing` guard in onPointerDown refuses every later press. After a normal up it no-ops.
  canvas.addEventListener("lostpointercapture", onPointerUp);
  const onContextMenu = (e: Event) => e.preventDefault();
  canvas.addEventListener("contextmenu", onContextMenu);

  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("lostpointercapture", onPointerUp);
    canvas.removeEventListener("contextmenu", onContextMenu);
  };
}
