<script lang="ts">
  import { Music, X, Volume2, VolumeX } from "@lucide/svelte";
  import { state, bump, removeAudioTrack, toggleAudioMute } from "../state/appState.svelte";
  import { audioEngine } from "../audio/engine";
  import { computePeaks, audioFrameSpan } from "../audio/peaks";

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
  // the clip may start before frame 0). Not undoable: audio is outside StructSnapshot (P2 spec).
  let dragStart: { x: number; offset: number } | null = null;
  function ignoreTouchClick(e: PointerEvent) {
    if (e.pointerType === "touch") e.preventDefault();
  }

  function laneDown(e: PointerEvent) {
    if (!state.project.audio) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (e.pointerType === "touch") {
      onTouchDown(e);
      return;
    }
    dragStart = { x: e.clientX, offset: state.project.audio.offsetFrames };
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
  function laneUp() {
    if (dragStart && state.playback.isPlaying)
      audioEngine.syncTo(state.playhead, state.project.fps);
    dragStart = null;
    onTouchUp();
  }

  // Browser canvas dimension cap (Safari/Firefox blank the canvas past ~16384px).
  const MAX_CANVAS_W = 16384;

  // Draw the waveform onto the canvas; redraws when params change (Svelte action).
  function waveform(node: HTMLCanvasElement, _p: { audioVersion: number }) {
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
      // Clip plate — start/end read as a rectangle, not just a grey scribble.
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#3a3a3a";
      ctx.fillRect(0, 0, Math.min(w, Math.max(0, docEndX)), node.height);
      if (docEndX < w) {
        ctx.globalAlpha = 0.25;
        ctx.fillRect(Math.max(0, docEndX), 0, w - Math.max(0, docEndX), node.height);
        ctx.globalAlpha = 1;
      }
      const peaks = computePeaks(audio.buffer.getChannelData(0), w);
      ctx.fillStyle = "#888";
      const mid = node.height / 2;
      for (let x = 0; x < peaks.length; x++) {
        const h = peaks[x] * (node.height - 2);
        ctx.globalAlpha = x < docEndX ? 1 : 0.25;
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
    <canvas
      class="h-7 cursor-grab"
      style="touch-action: none; margin-left: {state.project.audio.offsetFrames * cellW}px"
      use:waveform={{ audioVersion: state.version }}
      onpointerdown={laneDown}
      onpointermove={laneMove}
      onpointerup={laneUp}
      onpointercancel={laneUp}
      title="Drag to offset the audio clip"
    ></canvas>
  </div>
{/if}
