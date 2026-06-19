<script lang="ts">
  import { Music, X } from "@lucide/svelte";
  import { state, removeAudioTrack } from "../state/appState.svelte";
  import { computePeaks, audioFrameSpan } from "../audio/peaks";

  // Grid metrics passed from Timeline so the lane aligns with the frame columns.
  let { cellW, labelW }: { cellW: number; labelW: number } = $props();

  // Browser canvas dimension cap (Safari/Firefox blank the canvas past ~16384px).
  const MAX_CANVAS_W = 16384;

  // Draw the waveform onto the canvas; redraws when params change (legacy-mode action).
  function waveform(node: HTMLCanvasElement, _p: { audioVersion: number }) {
    const draw = () => {
      const audio = state.project.audio;
      const ctx = node.getContext("2d");
      if (!ctx) return;
      if (!audio) { ctx.clearRect(0, 0, node.width, node.height); return; }
      const cols = audioFrameSpan(audio.buffer.duration, state.project.fps);
      const naturalW = Math.max(1, cols * cellW);
      const w = Math.min(MAX_CANVAS_W, naturalW);
      node.width = w;
      node.height = 28;
      // Keep the on-screen width at the full frame span so the lane stays aligned
      // with the timeline columns; the clamped backing store is stretched to fit.
      node.style.width = naturalW + "px";
      ctx.clearRect(0, 0, node.width, node.height);
      const peaks = computePeaks(audio.buffer.getChannelData(0), w);
      ctx.fillStyle = "#888";
      const mid = node.height / 2;
      for (let x = 0; x < peaks.length; x++) {
        const h = peaks[x] * (node.height - 2);
        ctx.fillRect(x, mid - h / 2, 1, h);
      }
    };
    draw();
    return { update: draw };
  }
</script>

{#if state.project.audio}
  <div class="flex items-center">
    <div class="shrink-0 sticky left-0 z-20 bg-surface flex items-center gap-1 h-7 px-1 text-xs text-text-secondary"
         style="width: {labelW}px">
      <Music size={13} />
      <span class="truncate flex-1" title={state.project.audio.name}>{state.project.audio.name}</span>
      <button class="text-text-muted hover:text-text-secondary" title="Remove audio" onclick={removeAudioTrack}><X size={13} /></button>
    </div>
    <canvas class="h-7" use:waveform={{ audioVersion: state.version }}></canvas>
  </div>
{/if}
