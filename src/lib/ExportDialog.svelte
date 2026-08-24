<script lang="ts">
  import { state as appState, DPR, playbackController, liftGuard } from "../state/appState.svelte";
  import { exportPngSequence } from "../export/png-sequence";
  import { exportVideo, isVideoExportSupported, type VideoFormat } from "../export/video";
  import { exportPsdFrame } from "../export/psd-frame";
  import { downloadBlob } from "../export/download";
  import { sanitizeFilename } from "../persist/project-file";
  import { effectiveRange } from "../anim/playback";
  import { isAbort } from "../export/progress";

  const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

  let status = $state("");
  let busy = $state(false);
  // Progress: `done`/`total` frames, and `finalising` for the phase after the loop where the
  // container is assembled — without naming it the bar sits at 100% looking stalled.
  let done = $state(0);
  let total = $state(0);
  let finalising = $state(false);
  // Held only while a render is in flight. Cancel is refused once finalising starts, so the button
  // reads its own availability from `finalising` rather than from the controller being non-null.
  let controller: AbortController | null = null;
  function cancel() {
    if (!busy || finalising) return;
    controller?.abort();
    status = "Cancelling…"; // the loop stops at its next frame boundary
  }
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

  // PSD is the CURRENT frame (playhead), not the range — a "PSD sequence" isn't a thing this
  // format needs. 1-based, per the brief: the same numbering the PNG sequence shows the artist
  // elsewhere. Padded to the project's own frame-count width so the filename doesn't look out of
  // step with frame_0007.png-style names the app already produces.
  const psdFrame = $derived(appState.playhead + 1);
  const psdPad = $derived(Math.max(4, String(appState.project.frameCount).length));
  const psdFilename = $derived(`${stem}-f${String(psdFrame).padStart(psdPad, "0")}.psd`);

  // Escape cancels. It needs its own listener: `App.svelte`'s global handler returns immediately
  // while `exportBusy` is set (so a stray shortcut cannot edit the project mid-render), which would
  // otherwise swallow this too. Bound only while a render is in flight.
  $effect(() => {
    if (!busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function run(kind: "png" | "psd" | VideoFormat) {
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
    controller = new AbortController();
    const signal = controller.signal;
    done = 0;
    finalising = false;
    total = range.end - range.start + 1;
    status = `Exporting ${kind.toUpperCase()}…`;
    const onProgress = (d: number, t: number) => {
      done = d;
      total = t;
      // The loop yields after each frame, so this assignment actually reaches the screen.
      finalising = d === t;
    };
    try {
      if (kind === "png") {
        const blob = await exportPngSequence(appState.project, DPR, range, { signal, onProgress });
        downloadBlob(blob, `${stem}.zip`);
        status = "Done.";
      } else if (kind === "psd") {
        // One frame, CPU-only, no encoder handshake — the whole call is synchronous and typically
        // sub-second even on a busy document, so there is nothing for a progress bar to show and
        // nothing a Cancel button could interrupt before it would already be done. Because nothing
        // here `await`s, Svelte never gets a chance to paint the `busy` progress panel in between —
        // `exportBusy`/`liftGuard`/pause still run around it, matching the other two formats, since
        // those guard against the SAME hazards (a live lift, playback fighting the render) that a
        // single-frame render is just as exposed to.
        const bytes = exportPsdFrame(appState.project, appState.playhead, DPR);
        downloadBlob(
          new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/vnd.adobe.photoshop" }),
          psdFilename,
        );
        status = "Done.";
      } else {
        const { blob, warning } = await exportVideo(appState.project, DPR, kind, range, {
          signal,
          onProgress,
        });
        downloadBlob(blob, `${stem}.${kind}`);
        status = warning ? `Done — exported without audio: ${warning}.` : "Done.";
      }
    } catch (e) {
      // A cancel is not a failure — reporting it as one would read as a bug in the export.
      status = isAbort(e) ? "Cancelled — no file was written." : `Failed: ${errText(e)}`;
    } finally {
      busy = false;
      finalising = false;
      controller = null;
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
        <!-- While rendering this CANCELS rather than sitting inert: Escape already means "get me out
             of here", and a ✕ that silently refuses is exactly the control-that-cannot-explain-itself
             this codebase avoids. Once finalising, `cancel()` no-ops and the title says why. -->
        <button
          title={busy
            ? finalising
              ? "Finalising — the file is being assembled and can no longer be stopped"
              : "Stop the export (Esc). No file is written."
            : "Close"}
          onclick={() => {
            if (busy) cancel();
            else appState.exportOpen = false;
          }}>✕</button
        >
      </div>
      {#if busy}
        <!-- The formats are replaced rather than disabled: while a render is running the only
             decision left is whether to let it finish. -->
        <div class="flex flex-col gap-2">
          <span class="text-xs text-text-secondary">
            {finalising ? "Finalising…" : `Frame ${done} of ${total}`}
          </span>
          <div class="h-1.5 rounded bg-surface-active overflow-hidden">
            <div
              class="h-full bg-selection transition-[width] duration-150"
              style="width: {total ? (done / total) * 100 : 0}%"
            ></div>
          </div>
          <button
            class="border border-border rounded py-1 hover:bg-surface-hover aria-disabled:opacity-40 aria-disabled:hover:bg-transparent"
            aria-disabled={finalising}
            title={finalising
              ? "Finalising — the file is being assembled and can no longer be stopped"
              : "Stop the export (Esc). No file is written."}
            onclick={cancel}>Cancel</button
          >
        </div>
      {:else}
        <button
          class="border border-border rounded py-1 hover:bg-surface-hover"
          onclick={() => run("png")}
        >
          PNG sequence — {stem}.zip
        </button>
        <button
          class="border border-border rounded py-1 hover:bg-surface-hover disabled:opacity-40"
          disabled={!videoOk}
          onclick={() => run("mp4")}>MP4 video — {stem}.mp4</button
        >
        <button
          class="border border-border rounded py-1 hover:bg-surface-hover disabled:opacity-40"
          disabled={!videoOk}
          onclick={() => run("webm")}>WebM video — {stem}.webm</button
        >
        <button
          class="border border-border rounded py-1 hover:bg-surface-hover"
          onclick={() => run("psd")}
        >
          PSD (current frame) — {psdFilename}
        </button>
      {/if}
      {#if partial}
        <span class="text-xs text-amber-500">
          In/Out range is set — exporting frames {range.start + 1}–{range.end + 1} of
          {appState.project.frameCount}. Clear it on the playbar to export everything.
        </span>
      {/if}
      {#if refCount > 0}
        <!-- All three exporters (video/PNG/PSD) hardcode includeReference:false, so references are
             visible while you work and silently absent from every output. Said here because this is
             the moment it matters, and nothing else in the app says it. -->
        <span class="text-xs text-text-secondary">
          {refCount === 1
            ? "1 reference layer is a guide"
            : `${refCount} reference layers are guides`}
          and will not appear in the export. To include an image reference, use “Rasterize to drawing
          layer” on its layer row first.
        </span>
      {/if}
      {#if appState.project.boil.enabled}
        <!-- The one place a PSD deliberately disagrees with a PNG of the same frame: boil is a
             render-time wobble baked by compositing every drawing layer inside one GL surface and
             reading it back once, with no per-layer equivalent to bake into a PSD's separate
             layers — and the clean line is what paint-up wants anyway. Said only when boil is on,
             since with it off there is nothing for the two to disagree about. -->
        <span class="text-xs text-text-secondary">
          Line boil is not applied to the PSD — it will look cleaner than a PNG of the same frame.
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
