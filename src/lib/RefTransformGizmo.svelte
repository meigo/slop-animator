<script lang="ts">
  import { onMount } from "svelte";
  import type { Viewport } from "../core/viewport";
  import {
    state as appState,
    bump,
    DPR,
    beginStructuralEdit,
    commitStructuralEdit,
    resetLayerTransform,
    resetCellTransform,
    resetGroupTransform,
    transformDragGuard,
    transformActions,
  } from "../state/appState.svelte";
  import {
    transformBaseRect,
    cellTransform,
    resolvedKeyCell,
    groupOf,
    groupHasLockedLayer,
    isLayerEditable,
    isLayerLocked,
    isLayerVisible,
    isRefVisibleAtFrame,
    groupTransformAt,
    transformAt,
    layerTransformTrack,
    withTransformKey,
    isIdentityTransform,
    isSameTransform,
    type Cell,
    type Layer,
    type LayerGroup,
    type RefTransform,
    type TransformTrack,
  } from "../anim/document";
  import { contentBoxLogical, groupBoxLogical } from "./cell-ink";
  import {
    transformedCorners,
    rotateHandlePos,
    transformCenter,
    applyScale,
    applyRotate,
    forwardChain,
    inverseChain,
    type ComposeStep,
    type Pt,
  } from "../core/ref-transform";

  let {
    getViewport,
    getContainer,
  }: { getViewport: () => Viewport | null; getContainer: () => HTMLElement | null } = $props();

  const ROTATE_GAP_PX = 28;
  let visible = $state(false);
  let corners = $state<{ x: number; y: number }[]>([]);
  let rotatePt = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  let raf = 0;

  type DragHandle = "nw" | "ne" | "se" | "sw" | "rotate";
  // Active handle drag. center/start are in the TARGET's local logical coords (pointer mapped
  // through `outer` chain inverse); startT is a snapshot of the target transform at grab time so
  // each move recomputes from the original. setT writes back to the target (layer, cell, or group).
  let drag: {
    handle: DragHandle;
    startT: RefTransform;
    start: Pt;
    center: Pt;
    outer: ComposeStep[];
    setT: (t: RefTransform) => void;
    getT: () => RefTransform;
    /** Grab-time playhead. `setT`/`getT` above are closures over `transformTarget(keyFrame)`, so they
     *  already read and key at this frame for the whole gesture — this field records WHICH frame
     *  that is, so the freeze is visible in the drag state rather than only inside a closure. */
    keyFrame: number;
    /** The last value written by `setT`, or null when the drag never moved. The settle compares
     *  against this rather than re-reading, because a `sampleEvery > 1` track resolves a frame off
     *  its sample grid to a lerp — equal in value, not guaranteed equal under exact field equality. */
    lastT: RefTransform | null;
    /** The pointer that owns this gesture. move/up/cancel are on WINDOW, where pointer capture
     *  cannot isolate them, so a second contact would otherwise drive and settle this drag. */
    pointerId: number;
  } | null = null;
  let dragUndo: ReturnType<typeof beginStructuralEdit> | null = null;
  let dragFreeze: {
    cell: Extract<Cell, { kind: "key" }> | null;
    group: LayerGroup | null;
    prevBox: Rect | null;
  } | null = null;
  // Same direct-object-ref shape as dragFreeze, for the layer-scope transform track: captured at
  // grab so a no-op drag can put the track back exactly as it was. withTransformKey always
  // REPLACES the track (never mutates in place), so the reference captured here is already a
  // valid before-snapshot — nothing needs deep-copying, unlike the box freeze above.
  let trackFreeze: {
    layer: Layer | null;
    group: LayerGroup | null;
    prevTrack: TransformTrack;
  } | null = null;

  function activeTransformLayer(): Layer | null {
    const l = appState.project.layers.find((x) => x.id === appState.activeLayerId);
    if (!l) return null;
    // Group-derived, not raw flags: a ref inside a hidden or LOCKED GROUP is pinned too. Also gated
    // on the ref's own frame SPAN — outside it the ref draws nothing, so handles over blank canvas
    // would offer to move something invisible. Canvas.svelte's refPinned must agree with this.
    if (l.kind === "ref")
      return isLayerVisible(l, appState.project.groups) &&
        !isLayerLocked(l, appState.project.groups) &&
        isRefVisibleAtFrame(l, appState.playhead, appState.project.fps)
        ? l
        : null;
    if (l.kind === "draw" && appState.tool === "transform") {
      // GROUP scope moves the whole group, so a hidden/locked ANCHOR must not veto it — other
      // members may be visible, and transformTarget's groupHasLockedLayer is the real gate there.
      // Frame/layer scope edits THIS layer's content → editable (draw + unlocked + visible) only.
      if (appState.transformScope === "group") return l;
      return isLayerEditable(l, appState.project.groups) ? l : null;
    }
    return null;
  }

  function baseRect(layer: Layer) {
    return transformBaseRect(layer, appState.project.width, appState.project.height); // {x,y,w,h} | null
  }

  type Rect = { x: number; y: number; w: number; h: number };
  // Scope-aware transform target: which transform the gizmo edits/displays, its logical base
  // rect, and the outer compose chain (inner-to-outer) for display/pointer mapping.
  //
  // `frame` is the playhead this target reads and WRITES at. The DISPLAY path (tick) leaves it
  // defaulted, so the gizmo always draws where the layer currently is; a DRAG passes the grab-time
  // playhead, so the whole gesture — the startT capture, every move, and the isSameTransform no-op
  // check at settle — reads and keys at one frame. Reading it live scattered a key at every frame
  // playback passed while a drag was held, all derived from the grab-frame's startT and all inside
  // one undo entry.
  function transformTarget(frame: number = appState.playhead): {
    getT: () => RefTransform;
    setT: (t: RefTransform) => void;
    base: Rect | null;
    outer: ComposeStep[]; // inner-to-outer (innermost first)
    cell: Extract<Cell, { kind: "key" }> | null;
    group: LayerGroup | null;
    scope: "frame" | "layer" | "group";
    /** Layer scope on a layer driven by a transform TRACK — Reset-to-fit refuses on those. */
    animated: boolean;
  } | null {
    const l = activeTransformLayer();
    if (!l) return null;
    const W = appState.project.width,
      H = appState.project.height;
    const g = groupOf(l, appState.project.groups);
    const groupStep: ComposeStep[] = g
      ? [
          {
            base: groupBoxLogical(g, appState.project, frame, DPR, appState.version),
            // At `frame` — the display path's playhead, or a drag's frozen grab frame, exactly
            // like the layer step this composes over.
            t: groupTransformAt(g, frame),
          },
        ]
      : [];

    if (l.kind === "draw" && appState.transformScope === "group") {
      if (!g) return null; // Group scope is disabled when ungrouped; safety fallback.
      if (groupHasLockedLayer(g, appState.project.layers)) return null; // a locked member pins the group
      return {
        // An animated GROUP reads and writes THROUGH its track, exactly as the layer branch below
        // does — the drag lifecycle (undo bracket, settle hook, isSameTransform no-op check) works
        // unchanged because it all runs through this getT/setT pair.
        getT: () => groupTransformAt(g, frame),
        setT: (t: RefTransform) => {
          const track = g.tracks?.transform;
          if (!track) {
            g.transform = t;
            return;
          }
          // Replace the BAG and the track: undo snapshots share the GROUP object too (gotcha #8 at
          // two levels), and the spread keeps any sibling track a group may gain later.
          g.tracks = { ...g.tracks, transform: withTransformKey(track, frame, t) };
        },
        base: groupBoxLogical(g, appState.project, frame, DPR, appState.version),
        outer: [], // group is top of the compose chain
        cell: null,
        group: g,
        scope: "group",
        // An animated MEMBER still does not block a group drag — but an animated GROUP does block
        // Reset-to-fit, for the same reason an animated layer does: the static field it clears is
        // retained-but-ignored, so the button would do nothing (`resetGroupTransform` refuses).
        animated: !!g.tracks?.transform,
      };
    }

    if (l.kind === "draw" && appState.transformScope === "frame") {
      const rk = resolvedKeyCell(l, frame);
      if (!rk) return null;
      const outer: ComposeStep[] = [
        { base: { x: 0, y: 0, w: W, h: H }, t: transformAt(l, frame) },
        ...groupStep,
      ];
      return {
        getT: () => cellTransform(rk.cell),
        setT: (t: RefTransform) => (rk.cell.transform = t),
        base: contentBoxLogical(rk.cell.canvas, rk.cell.transformBox, W, H, DPR, appState.version),
        outer,
        cell: rk.cell,
        group: g,
        scope: "frame",
        animated: false, // a per-cell transform is static even on an animated layer
      };
    }

    // scope = "layer" (or ref layer of any scope)
    const outer: ComposeStep[] = [...groupStep];
    return {
      // An animated layer reads and writes THROUGH the track. Everything else about the drag —
      // the undo bracket, the settle hook, the isSameTransform no-op check — works unchanged,
      // because the whole lifecycle already goes through this getT/setT pair. `base` stays live
      // (never frozen to `track.box`, which Task 5 fixed at null for layer tracks): a layer's
      // base rect is the document rect / a media contain-fit, neither of which drifts the way a
      // content-derived transformBox does, and resizeProject never touches transform/tracks.
      getT: () => transformAt(l, frame),
      setT: (t: RefTransform) => {
        const track = layerTransformTrack(l);
        if (!track) {
          l.transform = t;
          return;
        }
        // Replace the BAG and the track: undo snapshots share the layer (gotcha #8), and the
        // no-mutation rule now reaches both levels. The spread keeps any sibling track.
        l.tracks = { ...l.tracks, transform: withTransformKey(track, frame, t) };
      },
      base: baseRect(l),
      outer,
      cell: null,
      group: g,
      scope: "layer",
      animated: !!layerTransformTrack(l),
    };
  }

  function startHandleDrag(handle: DragHandle, e: PointerEvent) {
    // A second grab must never overwrite a drag in flight: `dragUndo`/`trackFreeze` would be
    // replaced, so the first gesture's snapshot is dropped without commit OR revert and a stray key
    // is left behind with nothing on the undo stack. Two pointers on two handles is enough.
    if (drag) return;
    // Finger navigates, Pencil edits — the app-wide rule. Without this a touch dragged the handles
    // while touch-gestures.ts also claimed the same contact as a canvas pan.
    if (e.pointerType === "touch" || !e.isPrimary || e.button !== 0) return;
    const vp = getViewport();
    // Freeze the frame for the whole gesture (see transformTarget): every closure below reads and
    // writes here, so a playhead that moves mid-drag cannot retarget the key.
    const keyFrame = appState.playhead;
    let tgt = transformTarget(keyFrame);
    if (!vp || !tgt || !tgt.base) return;
    e.stopPropagation();
    e.preventDefault();
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    dragUndo = beginStructuralEdit(); // FIRST (gotcha #8: snapshot the old shared cell)
    // Named reference, not a fresh closure: the settle slot is shared, so releasing it has to be
    // conditional on this drag still owning it (see settleDragUndo).
    transformDragGuard.settle = endDragFromGuard;
    if (tgt.scope === "frame" && tgt.cell) {
      const l = activeTransformLayer();
      if (l?.kind === "draw") {
        const idx = l.cells.indexOf(tgt.cell);
        if (idx >= 0) {
          l.cells[idx] = { ...tgt.cell };
          tgt = transformTarget(keyFrame); // re-resolve: closures must write the clone, not the snapshot's cell
          if (!tgt || !tgt.base) {
            dragUndo = null;
            if (transformDragGuard.settle === endDragFromGuard) transformDragGuard.settle = null;
            return;
          }
        }
      }
    }
    const base = tgt.base;
    const t = tgt.getT();
    // Freeze the content box on grab for a frame or group transform that's currently identity,
    // so the gizmo's box stays put as content moves under the new transform.
    if (isIdentityTransform(t)) {
      if (tgt.scope === "frame" && tgt.cell) {
        dragFreeze = { cell: tgt.cell, group: null, prevBox: tgt.cell.transformBox ?? null };
        tgt.cell.transformBox = base;
      } else if (tgt.scope === "group" && tgt.group) {
        dragFreeze = { cell: null, group: tgt.group, prevBox: tgt.group.transformBox ?? null };
        tgt.group.transformBox = base;
      }
    }
    // An animated layer's (or group's) track is mutable state a no-op drag must be able to revert
    // (see settleDragUndo) — capture it here, before any write. ONLY when a track actually exists:
    // with none, the revert would write `tracks = { transform: undefined }` where the field had
    // been ABSENT, leaving an empty bag behind after the most common gesture in the app — and a
    // revert of nothing is a no-op anyway, since `setT` writes the static field on an unanimated
    // target.
    if (tgt.scope === "layer") {
      const l = activeTransformLayer();
      const tr = l && layerTransformTrack(l);
      if (l && tr) trackFreeze = { layer: l, group: null, prevTrack: tr };
    } else if (tgt.scope === "group" && tgt.group) {
      const tr = tgt.group.tracks?.transform;
      if (tr) trackFreeze = { layer: null, group: tgt.group, prevTrack: tr };
    }
    const start = inverseChain(tgt.outer, vp.screenToCanvas(e.clientX, e.clientY));
    drag = {
      handle,
      startT: { ...t },
      start,
      center: transformCenter(base, t),
      outer: tgt.outer,
      setT: tgt.setT,
      getT: tgt.getT,
      keyFrame,
      lastT: null,
      pointerId: e.pointerId,
    };
    appState.transformDragFrame = keyFrame; // see the note in Canvas.finishTransformDragUndo
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", endHandleDrag);
    window.addEventListener("pointercancel", endHandleDrag);
  }

  function onDragMove(e: PointerEvent) {
    const d = drag;
    const vp = getViewport();
    if (!d || !vp || e.pointerId !== d.pointerId) return;
    // The handles unmount when the target stops being transformable (lock/hide landing mid-drag,
    // including via its group), but these listeners are on WINDOW and survive that teardown — so
    // without this the pinned layer kept rotating under the pointer and the change was committed.
    if (!activeTransformLayer()) {
      endDragFromGuard();
      return;
    }
    e.preventDefault();
    const p = inverseChain(d.outer, vp.screenToCanvas(e.clientX, e.clientY));
    const nt =
      d.handle === "rotate"
        ? applyRotate(d.startT, d.center, d.start, p)
        : applyScale(d.startT, d.center, d.start, p); // any corner = uniform scale
    d.setT(nt);
    d.lastT = nt; // settle compares what was WRITTEN — see the note in Canvas.onTransformDrag
    bump();
  }

  function removeDragListeners() {
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", endHandleDrag);
    window.removeEventListener("pointercancel", endHandleDrag);
  }

  function endHandleDrag(e: PointerEvent) {
    if (drag && e.pointerId !== drag.pointerId) return; // a second contact must not settle this drag
    if (drag) {
      try {
        (e.target as Element).releasePointerCapture?.(e.pointerId);
      } catch {
        /* may already be released */
      }
    }
    settleDragUndo();
    drag = null;
    removeDragListeners();
  }

  /** transformDragGuard settle hook: undo/redo mid-drag has no PointerEvent to release capture
   *  with, so it settles the bracket and tears down listeners without that step. */
  function endDragFromGuard() {
    settleDragUndo();
    drag = null;
    removeDragListeners();
  }

  function settleDragUndo() {
    if (dragUndo && drag) {
      if (drag.lastT === null || isSameTransform(drag.startT, drag.lastT)) {
        if (dragFreeze?.cell) dragFreeze.cell.transformBox = dragFreeze.prevBox;
        else if (dragFreeze?.group) dragFreeze.group.transformBox = dragFreeze.prevBox;
        // Also revert any key withTransformKey inserted along the way: the resulting VALUE
        // matches startT (that's why we're here), but the TRACK OBJECT may not — a fresh key can
        // exist where none did — and no undo command is being pushed to fix that via
        // restoreStructure, since committing was just decided against above.
        // Put the frozen track back into a FRESH bag, so the revert cannot clobber a sibling
        // track the same layer may have gained — and never mutate the bag in place (gotcha #8).
        if (trackFreeze?.layer)
          trackFreeze.layer.tracks = {
            ...trackFreeze.layer.tracks,
            transform: trackFreeze.prevTrack,
          };
        else if (trackFreeze?.group)
          trackFreeze.group.tracks = {
            ...trackFreeze.group.tracks,
            transform: trackFreeze.prevTrack,
          };
        // The drag bumped persistTick on every move, so the ~3s autosave debounce may already have
        // written the TRANSIENT state (press and hold past it without moving). Reverting the live
        // document is not enough — the saved slot has to be re-dirtied so the restore lands too.
        // Covers the prevBox revert above as well, which is not value-neutral either.
        bump();
      } else {
        commitStructuralEdit(dragUndo);
      }
    }
    appState.transformDragFrame = null;
    dragUndo = null;
    dragFreeze = null;
    trackFreeze = null;
    // Only release the shared hook if this drag still owns it — clearing another gesture's settle
    // would leave that one's bracket unsettleable by undo.
    if (transformDragGuard.settle === endDragFromGuard) transformDragGuard.settle = null;
  }

  function tick() {
    const vp = getViewport();
    const container = getContainer();
    const tgt = transformTarget();
    if (vp && container && tgt && tgt.base) {
      const base = tgt.base;
      const t = tgt.getT();
      const gap = ROTATE_GAP_PX / vp.zoom;
      const rect = container.getBoundingClientRect();
      // Map the target-local point out through the outer chain, then to screen.
      const toLocal = (p: { x: number; y: number }) => {
        const q = forwardChain(tgt.outer, p);
        const s = vp.canvasToScreen(q.x, q.y);
        return { x: s.x - rect.left, y: s.y - rect.top };
      };
      corners = transformedCorners(base, t).map(toLocal);
      rotatePt = toLocal(rotateHandlePos(base, t, gap));
      visible = true;
      // Publish whether Reset would do anything, so the ToolOptions bar can hide a dead button.
      // Assigning the same boolean is a no-op for $state dependents, so this is safe per frame.
      // An ANIMATED layer's resolved transform is usually non-identity, so this alone left the
      // button rendered on a target where resetLayerTransform only prints its refusal hint — a
      // button that appears "only when it does something" must account for that guard too. Frame
      // and group scope keep working on an animated layer (`animated` is layer-scope only).
      appState.canResetTransform = !isIdentityTransform(t) && !tgt.animated;
    } else {
      visible = false;
      appState.canResetTransform = false;
    }
    raf = requestAnimationFrame(tick);
  }

  // A corner handle resizes along its diagonal from the gizmo centre — and that diagonal ROTATES
  // with the layer, so the cursor is derived from the corner's actual on-screen angle rather than
  // its index (index-mapping is only right at 0°). Spelling the four class names out as literals is
  // also what lets Tailwind's scanner see them, since the class is chosen at runtime.
  const RESIZE_CURSORS = [
    "cursor-ew-resize",
    "cursor-nwse-resize",
    "cursor-ns-resize",
    "cursor-nesw-resize",
  ];
  function cornerCursor(i: number): string {
    // corners[0] and corners[2] are opposite corners, so their midpoint is the centre.
    const cx = (corners[0].x + corners[2].x) / 2;
    const cy = (corners[0].y + corners[2].y) / 2;
    const deg = (Math.atan2(corners[i].y - cy, corners[i].x - cx) * 180) / Math.PI;
    // Screen y grows DOWNWARD, so a down-right diagonal is the NW↔SE axis. A resize axis is the
    // same in both directions, so fold to [0,180) and bucket every 45°.
    const a = ((deg % 180) + 180) % 180;
    return RESIZE_CURSORS[Math.round(a / 45) % 4];
  }

  function resetTransform() {
    const l = activeTransformLayer();
    const tgt = transformTarget();
    if (!l || !tgt) return;
    if (tgt.scope === "frame") resetCellTransform(l.id, appState.playhead);
    else if (tgt.scope === "group" && tgt.group) resetGroupTransform(tgt.group.id);
    else resetLayerTransform(l.id); // draw layer-scope AND reference layers (Task 1 generalized it)
  }

  onMount(() => {
    transformActions.reset = resetTransform;
    raf = requestAnimationFrame(tick);
    return () => {
      transformActions.reset = null;
      appState.canResetTransform = false;
      cancelAnimationFrame(raf);
      // Drop any in-flight drag listeners if the component unmounts mid-drag.
      settleDragUndo();
      window.removeEventListener("pointermove", onDragMove);
      window.removeEventListener("pointerup", endHandleDrag);
      window.removeEventListener("pointercancel", endHandleDrag);
    };
  });
</script>

{#if visible && corners.length === 4}
  <svg class="absolute inset-0 size-full pointer-events-none" style="overflow: visible">
    <polygon
      points={corners.map((c) => `${c.x},${c.y}`).join(" ")}
      fill="none"
      stroke="#3b82f6"
      stroke-width="1.5"
    />
    <line
      x1={(corners[0].x + corners[1].x) / 2}
      y1={(corners[0].y + corners[1].y) / 2}
      x2={rotatePt.x}
      y2={rotatePt.y}
      stroke="#3b82f6"
      stroke-width="1.5"
    />
    {#each corners as c, i (i)}
      <rect
        role="button"
        tabindex="-1"
        aria-label="Scale reference"
        class="pointer-events-auto {cornerCursor(i)}"
        data-ref-handle=""
        x={c.x - 6}
        y={c.y - 6}
        width="12"
        height="12"
        fill="#fff"
        stroke="#3b82f6"
        stroke-width="1.5"
        onpointerdown={(e) => startHandleDrag((["nw", "ne", "se", "sw"] as const)[i], e)}
      />
    {/each}
    <circle
      role="button"
      tabindex="-1"
      aria-label="Rotate reference"
      class="pointer-events-auto cursor-rotate"
      data-ref-handle=""
      cx={rotatePt.x}
      cy={rotatePt.y}
      r="7"
      fill="#fff"
      stroke="#3b82f6"
      stroke-width="1.5"
      onpointerdown={(e) => startHandleDrag("rotate", e)}
    />
  </svg>
  <!-- Nothing else on canvas: the gesture text moved to the status bar (2026-08-11) and Reset moved
       to the ToolOptions bar (2026-08-15), so the gizmo never paints over the artwork. -->
{/if}
