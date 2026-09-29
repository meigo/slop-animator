import {
  PAUSE_MS,
  ROPE_MAX_PX,
  STILL_PX,
  TRAIL_SPAN,
  catchUpPath,
  replayTimes,
  ropeLength,
  ropeStep,
} from "./stroke-smoothing";

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
  /** Stream 0-1, or a getter for dynamic values: the line trails the pen on a string of
   *  `ropeLength(v)` screen px (0 = follows the pen exactly). See stroke-smoothing.ts. */
  streamline?: number | (() => number);
}

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

  // Stream: the brush end of the rope, in screen (client) px — screen space, so the string is
  // the same length on screen at any zoom or rotation.
  const streamlineOpt = options?.streamline;
  function getRopeLength(): number {
    const v = typeof streamlineOpt === "function" ? streamlineOpt() : (streamlineOpt ?? 0);
    return ropeLength(v);
  }
  let rope: { x: number; y: number } | null = null;
  // The pen's recent path (client px), a point each time it has moved STILL_PX from the last —
  // so a held pen's tremble adds nothing. When the rope has to catch up (a pause, a lift) the line
  // follows THIS to the pen instead of a straight chord across the curve it just drew
  // (slop-paint b158081).
  type TrailPt = { x: number; y: number; pressure: number; t: number };
  let trail: TrailPt[] = [];
  let trailLen = 0;
  // Corners: where the pen last moved more than STILL_PX (the trail's last point), and when. Held
  // still for PAUSE_MS, the rope catches up (a frame loop — a still pen sends no events), so the
  // line reaches the corner before the pen sets off in the new direction.
  let penEvent: PointerEvent | null = null;
  let stillAt = { x: 0, y: 0 };
  let stillSince = 0;
  let catchUpFrame = 0;

  function trailPush(p: TrailPt) {
    const last = trail[trail.length - 1];
    if (last) trailLen += Math.hypot(p.x - last.x, p.y - last.y);
    trail.push(p);
    // Keep only what the rope could still be lagging along (and some): TRAIL_SPAN strings.
    while (trail.length > 2 && trailLen > TRAIL_SPAN * ROPE_MAX_PX) {
      trailLen -= Math.hypot(trail[1].x - trail[0].x, trail[1].y - trail[0].y);
      trail.shift();
    }
  }

  const pressureOf = (e: PointerEvent) => (e.pointerType === "mouse" ? 0 : e.pressure);

  /** Bring the lagging line up to the pen along the pen's own path, timed as the pen went (up to
   *  `now` at the latest — see `replayTimes`; one shared timestamp read to ink's Pool as a linger
   *  and pooled from the line's end to the tip, slop-paint 0a38872). Only with a string: at Stream 0
   *  (every non-brush tool) the brush IS the pen, and a catch-up would pull it back up to STILL_PX
   *  to the last trail point — nudging a held gizmo handle. */
  function catchUpAlongTrail(now: number) {
    const len = getRopeLength();
    if (!rope || !penEvent || len === 0) return;
    const { path, from } = catchUpPath(trail, rope, 2 * len + 2 * STILL_PX);
    if (!path.length || !from) return;
    const lastT = currentPoints[currentPoints.length - 1]?.timestamp ?? now;
    const times = replayTimes(
      from.t,
      path.map((p) => p.t),
      lastT,
      now,
    );
    const ev = penEvent;
    path.forEach((p, i) => {
      addPoint({ ...getPoint(ev, p.x, p.y), pressure: p.pressure, timestamp: times[i] });
    });
    const end = path[path.length - 1];
    if (end) rope = { x: end.x, y: end.y };
  }

  /** The event as a stroke point, at client position (`cx`, `cy`) — the pen's own unless the rope
   *  holds the brush elsewhere. */
  function getPoint(e: PointerEvent, cx = e.clientX, cy = e.clientY): InputPoint {
    let x: number, y: number;
    if (transformCoords) {
      const p = transformCoords(cx, cy);
      x = p.x;
      y = p.y;
    } else {
      const rect = canvas.getBoundingClientRect();
      x = cx - rect.left;
      y = cy - rect.top;
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
    rope = { x: e.clientX, y: e.clientY };
    penEvent = e;
    stillAt = { ...rope };
    stillSince = e.timeStamp;
    trail = [];
    trailLen = 0;
    trailPush({ ...rope, pressure: pressureOf(e), t: e.timeStamp });
    catchUpFrame = requestAnimationFrame(catchUp);
    currentPoints = [first];
    onStroke(currentPoints, false);
  }

  function onPointerMove(e: PointerEvent) {
    // Finger contacts share this element with the Pencil. Only the pointer that started the
    // stroke may extend it — a resting finger otherwise spikes the stroke and ends it.
    if (!isDrawing || e.pointerId !== drawPointer) return;
    e.preventDefault();

    // Collect coalesced events (Safari may return empty array — fall back to event itself)
    const coalesced = e.getCoalescedEvents?.();
    const events = coalesced && coalesced.length > 0 ? coalesced : [e];
    const countBefore = currentPoints.length;
    for (const ce of events) {
      // Stream: the brush moves only once the string is taut; while it's slack there is no new
      // point (the pen's pressure then is dropped with it).
      const now = { x: ce.clientX, y: ce.clientY };
      if (Math.hypot(now.x - stillAt.x, now.y - stillAt.y) > STILL_PX) {
        // Setting off after a pause: if the frame loop hasn't caught up (frames late or not
        // running), finish it now — to where the pen came to rest, before this new point joins the
        // trail — so the corner is kept regardless. Stamped with the pause's start, so Smooth sees
        // the pause too.
        if (ce.timeStamp - stillSince >= PAUSE_MS) catchUpAlongTrail(stillSince);
        stillAt = now;
        stillSince = ce.timeStamp;
        trailPush({ ...now, pressure: pressureOf(ce), t: ce.timeStamp });
      }
      penEvent = ce;
      const len = getRopeLength();
      // Stream 0 passes the pen through, still-pen events included (as before the rope).
      const next = rope && len > 0 ? ropeStep(rope, now, len) : now;
      if (next === rope) {
        // Slack. Once the rope has caught up with a resting pen, keep its events as points at
        // the rest point: the line doesn't move, but the ink engine's Pool reads their timestamps
        // (`dwellSwell`) and a press held there still changes pressure. Before that, drop them.
        if (rope.x !== stillAt.x || rope.y !== stillAt.y) continue;
      }
      rope = next;
      addPoint(getPoint(ce, next.x, next.y));
    }
    // Only when a point was added. A slack rope adds none, and a repeat call with the first point
    // alone reads to a stroke handler as a NEW stroke (slop-paint 2b7f465: its undo snapshot was
    // re-taken with the opening dot drawn). Here the brush path snapshots once per stroke, but the
    // Pose/Deform/Outline branches enter on `points.length === 1 && !done`.
    if (currentPoints.length !== countBefore) onStroke(currentPoints, false);
  }

  /** While the pen pauses, bring the line up to where it came to rest, along its path. Checked
   *  once per frame; after the first catch-up there is nothing left to add until it moves again. */
  function catchUp(now: number) {
    if (!isDrawing || !rope || !penEvent) return;
    catchUpFrame = requestAnimationFrame(catchUp);
    if (now - stillSince < PAUSE_MS) return;
    const before = currentPoints.length;
    catchUpAlongTrail(now);
    if (currentPoints.length !== before) onStroke(currentPoints, false);
  }

  function addPoint(pt: InputPoint) {
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

  function onPointerUp(e: PointerEvent) {
    if (!isDrawing || e.pointerId !== drawPointer) return;
    e.preventDefault();
    isDrawing = false;
    drawPointer = -1;
    cancelAnimationFrame(catchUpFrame);
    // The stroke ends at the pen, not where the rope held the brush: the line catches up along the
    // pen's path (not a straight chord), so a short hatch still reaches the lift point.
    catchUpAlongTrail(e.timeStamp);
    rope = null;
    penEvent = null;
    // Pen pointerup reports pressure 0; keep the last move's pressure so the stroke doesn't taper.
    const up = getPoint(e);
    const last = currentPoints[currentPoints.length - 1];
    if (last) up.pressure = last.pressure;
    currentPoints.push(up);
    onStroke(currentPoints, true);
    currentPoints = [];
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
    cancelAnimationFrame(catchUpFrame); // a stroke open at teardown would otherwise loop forever
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("lostpointercapture", onPointerUp);
    canvas.removeEventListener("contextmenu", onContextMenu);
  };
}
