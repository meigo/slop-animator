<script lang="ts">
  import { state as appState, DPR } from "../state/appState.svelte";
  import { exportPngSequence } from "../export/png-sequence";
  import { exportVideo, isVideoExportSupported, type VideoFormat } from "../export/video";
  import { downloadBlob } from "../export/download";

  let status = $state("");
  let busy = $state(false);
  const videoOk = isVideoExportSupported();

  async function run(kind: "png" | VideoFormat) {
    if (busy) return;
    busy = true;
    status = `Exporting ${kind.toUpperCase()}… (${appState.project.frameCount} frames)`;
    try {
      if (kind === "png") {
        const blob = await exportPngSequence(appState.project, DPR);
        downloadBlob(blob, "animation.zip");
      } else {
        const blob = await exportVideo(appState.project, DPR, kind);
        downloadBlob(blob, `animation.${kind}`);
      }
      status = "Done.";
    } catch (e) {
      status = `Failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      busy = false;
    }
  }
</script>

{#if appState.exportOpen}
  <div
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
    onclick={() => {
      if (!busy) appState.exportOpen = false;
    }}
    role="presentation"
  >
    <div
      class="bg-surface text-text border border-border rounded-lg p-4 w-80 flex flex-col gap-2 text-sm"
      onclick={(e) => e.stopPropagation()}
      role="presentation"
    >
      <div class="flex justify-between items-center">
        <span class="font-semibold">Export</span>
        <button
          onclick={() => {
            if (!busy) appState.exportOpen = false;
          }}>✕</button
        >
      </div>
      <button
        class="border border-border rounded py-1 hover:bg-surface-hover"
        disabled={busy}
        onclick={() => run("png")}
      >
        PNG sequence (.zip)
      </button>
      <button
        class="border border-border rounded py-1 hover:bg-surface-hover disabled:opacity-40"
        disabled={busy || !videoOk}
        onclick={() => run("mp4")}>MP4 video</button
      >
      <button
        class="border border-border rounded py-1 hover:bg-surface-hover disabled:opacity-40"
        disabled={busy || !videoOk}
        onclick={() => run("webm")}>WebM video</button
      >
      {#if !videoOk}
        <span class="text-xs text-text-secondary"
          >Video export needs WebCodecs (Chrome/Edge or Safari 16.4+).</span
        >
      {/if}
      {#if status}<span class="text-xs text-text-secondary">{status}</span>{/if}
    </div>
  </div>
{/if}
