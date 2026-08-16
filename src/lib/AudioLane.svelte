<script lang="ts">
  import { Music, X, Volume2, VolumeX } from "@lucide/svelte";
  import {
    state,
    bump,
    removeAudioTrack,
    toggleAudioMute,
    setAudioTrim,
    beginStructuralEdit,
    commitStructuralEdit,
    transformDragGuard,
  } from "../state/appState.svelte";
  import { audioEngine } from "../audio/engine";
  import { computePeaks, audioFrameSpan } from "../audio/peaks";
  import { trimHead, trimTail, AUDIO_MIN_TRIM_FRAMES } from "../audio/trim";

  // Grid metrics passed from Timeline so the lane aligns with the frame columns.
  let {
    cellW,
    labelW,
    markerW,
    minWidth = 0,
    onTouchDown,
    onTouchMove,
    onTouchUp,
  }: {
    cellW: number;
    labelW: number;
    markerW: number;
    minWidth?: number;
    onTouchDown: (e: PointerEvent) => void;
    onTouchMove: (e: PointerEvent) => boolean;
    onTouchUp: () => void;
  } = $props();

  // Drag the clip along the lane to set offsetFrames (snaps to whole frames; negative allowed —
  // the clip may start before frame 0). Undoable, one entry per completed gesture.
  //
  // It HAS to be. `StructSnapshot` carries `audioOffsetFrames` (so a ripple insert/delete can move
  // audio undoably), and once a field is in the snapshot every writer of it must push a command —
  // otherwise an unrelated structural undo silently reverts the writes that don't. Before this, a
  // drag followed by any structural edit followed by undo snapped the audio back to its pre-drag
  // position. Import, remove-track and mute were brought under undo for the same reason shortly
  // after, so every audio edit now pushes a command.
  let dragStart: {
    x: number;
    offset: number;
    undo: ReturnType<typeof beginStructuralEdit>;
  } | null = null;
  function ignoreTouchClick(e: PointerEvent) {
    if (e.pointerType === "touch") e.preventDefault();
  }

  function laneDown(e: PointerEvent) {
    if (!state.project.audio) return;
    if (trimDrag) return; // a trim handle already claimed this gesture
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (e.pointerType === "touch") {
      onTouchDown(e);
      return;
    }
    dragStart = {
      x: e.clientX,
      offset: state.project.audio.offsetFrames,
      undo: beginStructuralEdit(),
    };
    transformDragGuard.settle = () => settleLaneDrag(); // undo / Open mid-drag settles the bracket
  }
  function laneMove(e: PointerEvent) {
    if (e.pointerType === "touch") {
      onTouchMove(e);
      return;
    }
    const audio = state.project.audio;
    if (!dragStart || !audio) return;
    const next = dragStart.offset + Math.round((e.clientX - dragStart.x) / cellW);
    if (next !== audio.offsetFrames) {
      audio.offsetFrames = next;
      bump();
    }
  }
  /** Commit iff the offset actually moved — a click without a drag must push nothing, or the next
   *  undo appears dead. Also the settle hook, so a mid-drag undo/Open cannot leave the bracket open. */
  function settleLaneDrag() {
    if (!dragStart) return;
    const audio = state.project.audio;
    if (audio && audio.offsetFrames !== dragStart.offset) commitStructuralEdit(dragStart.undo);
    dragStart = null;
    transformDragGuard.settle = null;
  }

  function laneUp() {
    if (dragStart && state.playback.isPlaying)
      audioEngine.syncTo(state.playhead, state.project.fps);
    settleLaneDrag();
    onTouchUp();
  }

  // The kept span in BUFFER-frame space, resolved once for both the handle markup and the drag
  // handlers. `$derived` rather than `{@const}` in the markup: Svelte 5 only allows `{@const}` as
  // the immediate child of a block, and these are needed in the script anyway.
  // (`in` is a reserved word, hence `trimIn`/`trimLen`.)
  const extentFrames = $derived(
    state.project.audio
      ? audioFrameSpan(state.project.audio.buffer.duration, state.project.fps)
      : 0,
  );
  const trimIn = $derived(Math.max(0, state.project.audio?.trimInFrames ?? 0));
  const trimLen = $derived(state.project.audio?.trimLenFrames ?? extentFrames - trimIn);

  // Edge trim. Separate from the body drag (which slides offsetFrames) but brackets undo the same
  // way: one entry per completed gesture, settle registered so a mid-drag undo cannot leave it open.
  let trimDrag: {
    edge: "head" | "tail";
    x: number;
    from: { offsetFrames: number; trimInFrames: number; trimLenFrames: number };
    undo: ReturnType<typeof beginStructuralEdit>;
  } | null = null;

  function trimDown(e: PointerEvent, edge: "head" | "tail") {
    const audio = state.project.audio;
    if (!audio) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (e.pointerType === "touch") {
      onTouchDown(e); // finger navigates, pen/mouse edits
      return;
    }
    if (trimDrag) return; // a handle already owns this gesture
    trimDrag = {
      edge,
      x: e.clientX,
      from: { offsetFrames: audio.offsetFrames, trimInFrames: trimIn, trimLenFrames: trimLen },
      undo: beginStructuralEdit(),
    };
    transformDragGuard.settle = () => settleTrimDrag();
  }

  function trimMove(e: PointerEvent) {
    if (e.pointerType === "touch") {
      onTouchMove(e);
      return;
    }
    const audio = state.project.audio;
    if (!trimDrag || !audio) return;
    const delta = Math.round((e.clientX - trimDrag.x) / cellW);
    const f = trimDrag.from;
    const next =
      trimDrag.edge === "head"
        ? trimHead(f.offsetFrames, f.trimInFrames, f.trimLenFrames, delta, extentFrames)
        : {
            offsetFrames: f.offsetFrames,
            ...trimTail(f.trimInFrames, f.trimLenFrames, delta, extentFrames),
          };
    // Compare against the CURRENT EFFECTIVE values, not against `delta === 0`.
    //   - A tap writes nothing, because next equals what is already there (so no autosave re-arm,
    //     and an untrimmed clip is not silently materialised into explicit 0/extent fields).
    //   - A drag that goes out and comes BACK to its start still writes, restoring the clip.
    // An early `if (delta === 0) return` gets the first right and the second wrong: it would leave
    // the clip stranded at the last non-zero delta, so a gesture could not be cancelled by
    // returning to where it began.
    if (
      audio.offsetFrames === next.offsetFrames &&
      trimIn === next.trimInFrames &&
      trimLen === next.trimLenFrames
    )
      return;
    setAudioTrim(next.trimInFrames, next.trimLenFrames, next.offsetFrames);
  }

  /** Commit iff the gesture changed something — a click without a drag must push nothing.
   *  The comparison is against the EFFECTIVE trim (`trimIn`/`trimLen`), never the raw optional
   *  fields: an untouched clip leaves `trimLenFrames` undefined while `from` holds the resolved
   *  extent, so a raw compare would read as changed and commit an empty undo entry. */
  function settleTrimDrag() {
    if (!trimDrag) return;
    const audio = state.project.audio;
    const f = trimDrag.from;
    const changed =
      !!audio &&
      (audio.offsetFrames !== f.offsetFrames ||
        trimIn !== f.trimInFrames ||
        trimLen !== f.trimLenFrames);
    if (changed) commitStructuralEdit(trimDrag.undo);
    trimDrag = null;
    transformDragGuard.settle = null;
  }

  function trimUp(e: PointerEvent) {
    if (e.pointerType === "touch") {
      onTouchUp();
      return;
    }
    if (trimDrag && state.playback.isPlaying) audioEngine.syncTo(state.playhead, state.project.fps);
    settleTrimDrag();
  }

  // Browser canvas dimension cap (Safari/Firefox blank the canvas past ~16384px).
  const MAX_CANVAS_W = 16384;

  // Draw the waveform onto the canvas; redraws when params change (Svelte action).
  // `theme` is unread inside, but it is what re-runs the draw on a theme toggle: the colors come
  // from CSS tokens via getComputedStyle, which nothing else invalidates.
  function waveform(node: HTMLCanvasElement, _p: { audioVersion: number; theme: string }) {
    const draw = () => {
      const audio = state.project.audio;
      const ctx = node.getContext("2d");
      if (!ctx) return;
      if (!audio) {
        ctx.clearRect(0, 0, node.width, node.height);
        return;
      }
      const cols = audioFrameSpan(audio.buffer.duration, state.project.fps);
      const naturalW = Math.max(1, cols * cellW);
      const w = Math.min(MAX_CANVAS_W, naturalW);
      node.width = w;
      node.height = 28;
      // Keep the on-screen width at the full frame span so the lane stays aligned
      // with the timeline columns; the clamped backing store is stretched to fit.
      node.style.width = naturalW + "px";
      ctx.clearRect(0, 0, node.width, node.height);
      // Boundary in backing-store px: CSS px scaled by the canvas-width clamp ratio.
      // The clip may outlast the document: past the last frame there is no ruler and nothing to
      // scrub, so dim that tail (still visible for drag-positioning, clearly not frame-backed).
      const docEndX = (state.project.frameCount - audio.offsetFrames) * cellW * (w / naturalW);
      // Trimmed head/tail stay drawn, dimmed, so you can see what was cut and drag it back.
      // Same tokens and alpha the past-the-last-frame tail already uses. `cols` is already the
      // buffer's extent in frames, so there is nothing to recompute.
      const keptFrom = Math.max(0, audio.trimInFrames ?? 0);
      const keptTo = Math.min(cols, keptFrom + (audio.trimLenFrames ?? cols - keptFrom));
      const pxPerFrame = (w / naturalW) * cellW;
      const keptX0 = keptFrom * pxPerFrame;
      const keptX1 = keptTo * pxPerFrame;
      // Canvas can't use Tailwind classes, so read the same media-clip tokens the video-ref clip
      // block uses — hardcoded greys were near-black in light mode, and any grey blends with the
      // ruler (surface-active) directly above this lane.
      const cs = getComputedStyle(node);
      const token = (name: string, fallback: string) =>
        cs.getPropertyValue(name).trim() || fallback;
      // Clip plate — start/end read as a rectangle, not just a scribble. The tail past the last
      // frame is a DIFFERENT token rather than the plate at low alpha: alpha reads as "dimmer" only
      // against a dark lane, and would have vanished into white once the plate stopped being dark.
      ctx.globalAlpha = 1;
      const plateEnd = Math.min(w, Math.max(0, docEndX));
      ctx.fillStyle = token("--color-media-clip", "#2b3240");
      ctx.fillRect(0, 0, plateEnd, node.height);
      if (docEndX < w) {
        ctx.fillStyle = token("--color-media-clip-dim", "#24272f");
        ctx.fillRect(Math.max(0, docEndX), 0, w - Math.max(0, docEndX), node.height);
      }
      if (keptX0 > 0 || keptX1 < w) {
        ctx.fillStyle = token("--color-media-clip-dim", "#24272f");
        if (keptX0 > 0) ctx.fillRect(0, 0, keptX0, node.height);
        if (keptX1 < w) ctx.fillRect(keptX1, 0, w - keptX1, node.height);
      }
      // Outline, matching the video clip's border. Scaled with the backing store on a
      // >MAX_CANVAS_W clip, which is cosmetic-only.
      ctx.strokeStyle = token("--color-media-clip-border", "#3d4759");
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, w - 1, node.height - 1);
      const peaks = computePeaks(audio.buffer.getChannelData(0), w);
      ctx.fillStyle = token("--color-text-secondary", "#999999");
      const mid = node.height / 2;
      for (let x = 0; x < peaks.length; x++) {
        const h = peaks[x] * (node.height - 2);
        ctx.globalAlpha = x >= keptX0 && x < keptX1 && x < docEndX ? 1 : 0.25;
        ctx.fillRect(x, mid - h / 2, 1, h);
      }
      ctx.globalAlpha = 1;
    };
    draw();
    return { update: draw };
  }
</script>

{#if state.project.audio}
  <div class="flex w-max items-center" style="min-width: {minWidth}px">
    <div
      class="shrink-0 sticky left-0 z-20 bg-surface flex items-center gap-1 h-7 px-1 text-text-secondary"
      role="presentation"
      style="width: {labelW}px; touch-action: none"
      onpointerdown={(e) => {
        if (e.pointerType !== "touch") return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        onTouchDown(e);
      }}
      onpointermove={(e) => {
        if (e.pointerType === "touch") onTouchMove(e);
      }}
      onpointerup={onTouchUp}
      onpointercancel={onTouchUp}
    >
      <Music size={13} class="shrink-0" />
      <span class="truncate flex-1" title={state.project.audio.name}
        >{state.project.audio.name}</span
      >
      <button
        class="text-text-secondary hover:text-text shrink-0"
        title={state.project.audio.muted ? "Muted — click to unmute" : "Click to mute audio"}
        onpointerdown={ignoreTouchClick}
        onclick={toggleAudioMute}
        >{#if state.project.audio.muted}<VolumeX size={13} />{:else}<Volume2
            size={13}
          />{/if}</button
      >
    </div>
    <!-- Remove sits in the layer rows' marker column, so it lines up with their lock/hidden icons. -->
    <div
      class="shrink-0 sticky z-20 bg-surface flex items-center justify-center h-7 border-r border-text-muted"
      style="left: {labelW}px; width: {markerW}px"
    >
      <button
        class="text-text-secondary hover:text-text"
        title="Remove audio"
        onpointerdown={ignoreTouchClick}
        onclick={removeAudioTrack}><X size={13} /></button
      >
    </div>
    <!-- The clip's position lives on this wrapper, not the canvas: the absolutely-positioned trim
         handles need a positioned ancestor sharing the buffer's frame-0 origin, so their `left`
         carries no offsetFrames term. -->
    <div class="relative" style="margin-left: {state.project.audio.offsetFrames * cellW}px">
      <canvas
        class="h-7 cursor-grab"
        style="touch-action: none"
        use:waveform={{ audioVersion: state.version, theme: state.theme }}
        onpointerdown={laneDown}
        onpointermove={laneMove}
        onpointerup={laneUp}
        onpointercancel={laneUp}
        title="Drag to offset the audio clip"
      ></canvas>
      <div
        class="absolute inset-y-0 z-20 w-2 cursor-ew-resize"
        style="left: {trimIn * cellW}px; touch-action: none"
        role="presentation"
        title="Trim the start of the audio"
        onpointerdown={(e) => trimDown(e, "head")}
        onpointermove={trimMove}
        onpointerup={trimUp}
        onpointercancel={trimUp}
      ></div>
      <div
        class="absolute inset-y-0 z-20 w-2 cursor-ew-resize"
        style="left: {Math.max(trimIn + AUDIO_MIN_TRIM_FRAMES, trimIn + trimLen) * cellW -
          8}px; touch-action: none"
        role="presentation"
        title="Trim the end of the audio"
        onpointerdown={(e) => trimDown(e, "tail")}
        onpointermove={trimMove}
        onpointerup={trimUp}
        onpointercancel={trimUp}
      ></div>
    </div>
  </div>
{/if}
