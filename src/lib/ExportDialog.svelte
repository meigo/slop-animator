<script lang="ts">
  import { state as appState, DPR, playbackController, liftGuard } from "../state/appState.svelte";
  import { exportPngSequence } from "../export/png-sequence";
  import { exportVideo, isVideoExportSupported, type VideoFormat } from "../export/video";
  import { downloadBlob } from "../export/download";
  import { sanitizeFilename } from "../persist/project-file";
  import { effectiveRange } from "../anim/playback";

  let status = $state("");
  let busy = $state(false);
  const videoOk = isVideoExportSupported();
  const stem = $derived(sanitizeFilename(appState.project.name));
  // Counted regardless of visibility: a hidden reference is equally absent from the export, and the
  // point of the note is "these are guides", not "these would otherwise have shown".
  const refCount = $derived(appState.project.layers.filter((l) => l.kind === "ref").length);
  // Export honours the play In/Out range — it always rendered the whole timeline, which reads as a
  // bug the moment you have set a range. Stated in the dialog below whenever it is narrower than the
  // project, because a range set an hour ago and forgotten would otherwise silently shorten the file.
  const range = $derived(effectiveRange(appState.playback.range, appState.project.frameCount));
  const partial = $derived(range.end - range.start + 1 < appState.project.frameCount);

  async function run(kind: "png" | VideoFormat) {
    if (busy) return;
    busy = true;
    playbackController.pause(); // boil GL is a process singleton — don't interleave with playback
    // A live lift (selection float / deform / pose) has CLEARED its region from the cell canvas —
    // the pixels exist only on the overlay, which renderFrame never composites. Exporting through
    // that state writes a hole into every frame resolving to that key (a pose lift takes the whole
    // content bbox, i.e. the layer goes blank for the hold span). Discard, not bank: the lift is an
    // uncommitted edit and an export must not silently commit one.
    liftGuard.discard?.();
    appState.exportBusy = true; // gate the global keyboard handler for the WHOLE render (A10)
    status = `Exporting ${kind.toUpperCase()}… (${appState.project.frameCount} frames)`;
    try {
      if (kind === "png") {
        const blob = await exportPngSequence(appState.project, DPR, range);
        downloadBlob(blob, `${stem}.zip`);
        status = "Done.";
      } else {
        const { blob, warning } = await exportVideo(appState.project, DPR, kind, range);
        downloadBlob(blob, `${stem}.${kind}`);
        status = warning ? `Done — exported without audio: ${warning}.` : "Done.";
      }
    } catch (e) {
      status = `Failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      busy = false;
      appState.exportBusy = false;
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
        PNG sequence — {stem}.zip
      </button>
      <button
        class="border border-border rounded py-1 hover:bg-surface-hover disabled:opacity-40"
        disabled={busy || !videoOk}
        onclick={() => run("mp4")}>MP4 video — {stem}.mp4</button
      >
      <button
        class="border border-border rounded py-1 hover:bg-surface-hover disabled:opacity-40"
        disabled={busy || !videoOk}
        onclick={() => run("webm")}>WebM video — {stem}.webm</button
      >
      {#if partial}
        <span class="text-xs text-amber-500">
          In/Out range is set — exporting frames {range.start + 1}–{range.end + 1} of
          {appState.project.frameCount}. Clear it on the playbar to export everything.
        </span>
      {/if}
      {#if refCount > 0}
        <!-- Both exporters hardcode includeReference:false, so references are visible while you
             work and silently absent from every output. Said here because this is the moment it
             matters, and nothing else in the app says it. -->
        <span class="text-xs text-text-secondary">
          {refCount === 1
            ? "1 reference layer is a guide"
            : `${refCount} reference layers are guides`}
          and will not appear in the export. To include an image reference, use “Rasterize to drawing
          layer” on its layer row first.
        </span>
      {/if}
      {#if !videoOk}
        <span class="text-xs text-text-secondary"
          >Video export needs WebCodecs (Chrome/Edge or Safari 16.4+).</span
        >
      {/if}
      {#if status}<span class="text-xs text-text-secondary">{status}</span>{/if}
    </div>
  </div>
{/if}
