<script lang="ts">
  import {
    state as appState,
    DPR,
    playbackController,
    liftGuard,
    type ExportFormat,
  } from "../state/appState.svelte";
  import { exportCanvas, exportPngSequence, renderFramePng } from "../export/png-sequence";
  import { exportVideo, isVideoExportSupported } from "../export/video";
  import { exportGif } from "../export/gif";
  import { exportPsdFrame } from "../export/psd-frame";
  import { downloadBlob } from "../export/download";
  import { saveToFilesAvailable } from "../export/share";
  import { deliverToFiles } from "./deliver-file";
  import { sanitizeFilename } from "../persist/project-file";
  import {
    resolveExportRange,
    exportPixelSize,
    type ExportRangeMode,
  } from "../export/export-range";
  import { isAbort, yieldToEventLoop } from "../export/progress";
  import { currentFrameFileName, evenDimensions } from "../export/frames";
  import NumberField from "./NumberField.svelte";

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
  // Which format is running, so the busy panel (and Cancel) can special-case PSD: it is one
  // synchronous encode with a single yield to let this paint, not a per-frame loop, so there is no
  // progress to report and nothing an abort could reach mid-encode. The single-frame PNG is the same:
  // one render and one encode, so it shares that panel.
  let activeFormat: ExportFormat | null = $state(null);
  const singleFrame = (f: ExportFormat | null) => f === "psd-frame" || f === "png-frame";
  const formatLabel = (f: ExportFormat) =>
    f === "png-sequence" || f === "png-frame" ? "PNG" : f === "psd-frame" ? "PSD" : f.toUpperCase();
  function cancel() {
    if (!busy || finalising || singleFrame(activeFormat)) return;
    controller?.abort();
    status = "Cancelling…"; // the loop stops at its next frame boundary
  }
  const videoOk = isVideoExportSupported();
  // iPad/iPhone: a finished export goes to the Save to Files dialog instead of downloading. A render
  // always outlasts the tap that started it, so the sheet is never opened directly from here.
  const toFiles = saveToFilesAvailable();

  /** Hand the finished file over. Returns whether the export dialog should close (the ready dialog
   *  replaces it); a type the share sheet won't take downloads as before and the dialog stays. */
  async function deliver(blob: Blob, filename: string, note = ""): Promise<boolean> {
    if (!toFiles) {
      downloadBlob(blob, filename);
      return false;
    }
    const file = new File([blob], filename, { type: blob.type });
    return (await deliverToFiles(file, { isProject: false, tryDirect: false, note })) === "ready";
  }
  const stem = $derived(sanitizeFilename(appState.project.name));
  // Counted regardless of visibility: a hidden reference is equally absent from the export, and the
  // point of the note is "these are guides", not "these would otherwise have shown".
  const refCount = $derived(appState.project.layers.filter((l) => l.kind === "ref").length);

  const opts = $derived(appState.exportOptions);
  // PSD always writes at 100%; every other format honours the size control.
  const scaleFor = (f: ExportFormat) => (f === "psd-frame" ? 1 : opts.scale);
  // `exportVideo` rounds the scaled size UP to even (H.264 needs even dimensions) — mirror that here
  // so the label never claims an odd size the video exporters don't actually write.
  const pixels = $derived.by(() => {
    const size = exportPixelSize(
      appState.project.width,
      appState.project.height,
      scaleFor(opts.format),
    );
    return opts.format === "mp4" || opts.format === "webm" ? evenDimensions(size.w, size.h) : size;
  });

  // Export honours the play In/Out range by default (`inout` mode) — it always rendered the whole
  // timeline, which reads as a bug the moment you have set a range. `resolveExportRange` also
  // supports exporting the whole timeline or a typed-in custom span.
  const range = $derived(
    resolveExportRange(opts, appState.playback.range, appState.project.frameCount),
  );
  // Stated only in `inout` mode: the other two modes SAY what they export (All / the typed range),
  // so the warning would be noise. Stated because a range set an hour ago and forgotten would
  // otherwise silently shorten the file.
  const partial = $derived(
    opts.rangeMode === "inout" && range.end - range.start + 1 < appState.project.frameCount,
  );

  /** Switch the range mode. Landing on Custom seeds its fields from the range that was in effect a
   *  moment earlier (the resolved all/inout range) — read `range`/`opts.rangeMode` BEFORE the mode
   *  itself is overwritten below — so Custom opens on what was already being exported, not 1–1. Done
   *  here (not in an effect) so it fires once, on the switch, rather than fighting later edits. */
  function setRangeMode(m: ExportRangeMode) {
    if (m === "custom" && opts.rangeMode !== "custom") {
      appState.exportOptions.customStart = range.start;
      appState.exportOptions.customEnd = range.end;
    }
    appState.exportOptions.rangeMode = m;
  }

  // PSD and the single PNG are the CURRENT frame (playhead), not the range. 1-based, per the brief:
  // the same numbering the PNG sequence shows the artist elsewhere. Padded to the project's own
  // frame-count width so the filename doesn't look out of step with frame_0007.png-style names the
  // app already produces.
  const psdFilename = $derived(
    currentFrameFileName(stem, appState.playhead, appState.project.frameCount, "psd"),
  );
  const pngFrameFilename = $derived(
    currentFrameFileName(stem, appState.playhead, appState.project.frameCount, "png"),
  );
  const outputName = $derived(
    opts.format === "png-sequence"
      ? `${stem}.zip`
      : opts.format === "png-frame"
        ? pngFrameFilename
        : opts.format === "psd-frame"
          ? psdFilename
          : `${stem}.${opts.format}`,
  );
  const formatAvailable = $derived(
    opts.format === "mp4" || opts.format === "webm" ? videoOk : true,
  );

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

  async function run() {
    if (busy) return;
    const format = opts.format;
    const scale = scaleFor(format);
    busy = true;
    activeFormat = format;
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
    status = `Exporting ${formatLabel(format)}…`;
    const onProgress = (d: number, t: number) => {
      done = d;
      total = t;
      // The loop yields after each frame, so this assignment actually reaches the screen.
      finalising = d === t;
    };
    let closeAfter = false;
    try {
      if (format === "png-sequence") {
        const blob = await exportPngSequence(appState.project, DPR, range, {
          signal,
          onProgress,
          scale,
        });
        closeAfter = await deliver(blob, `${stem}.zip`);
        status = "Done.";
      } else if (format === "png-frame") {
        // Same frame the PSD button takes, rendered exactly as the sequence renders it (boil
        // included). toBlob is async, but the render before it is not — yield once so "Writing
        // PNG…" paints first.
        await yieldToEventLoop();
        const blob = await renderFramePng(
          exportCanvas(appState.project, DPR, scale),
          appState.project,
          appState.playhead,
          DPR,
          scale,
        );
        closeAfter = await deliver(blob, pngFrameFilename);
        status = "Done.";
      } else if (format === "psd-frame") {
        // One frame, but NOT instant: the driver draws each surviving layer twice (once to measure
        // its ink bounds, once to crop it) plus a full-frame read for the merged composite, all
        // before a single PackBits byte is written — on a busy document at 4K this is low seconds,
        // worse on iPad Safari's full-frame readback. That is long enough to freeze the tab with no
        // visual change, so it still needs ONE yield to paint the "Writing…" line below before the
        // synchronous encode blocks the thread. There is no second phase to report progress for, and
        // nothing mid-encode an abort could reach, so that one yield is the whole difference from
        // PNG/video — `exportBusy`/`liftGuard`/pause around it are unchanged, matching those two,
        // since a live lift and playback fighting the render are hazards this path is equally
        // exposed to.
        await yieldToEventLoop();
        const bytes = exportPsdFrame(appState.project, appState.playhead, DPR);
        closeAfter = await deliver(
          new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/vnd.adobe.photoshop" }),
          psdFilename,
        );
        status = "Done.";
      } else if (format === "mp4" || format === "webm") {
        const { blob, warning } = await exportVideo(appState.project, DPR, format, range, {
          signal,
          onProgress,
          scale,
          quality: opts.videoQuality,
        });
        const note = warning ? `exported without audio: ${warning}` : "";
        closeAfter = await deliver(blob, `${stem}.${format}`, note);
        status = warning ? `Done — ${note}.` : "Done.";
      } else if (format === "gif") {
        const blob = await exportGif(appState.project, DPR, range, {
          signal,
          onProgress,
          scale,
          colors: opts.gifColors,
        });
        closeAfter = await deliver(blob, `${stem}.gif`);
        status = "Done.";
      } else {
        // Exhaustiveness guard: stops a future format from silently falling through to video/PNG.
        throw new Error(`Unhandled export format: ${format satisfies never}`);
      }
    } catch (e) {
      // A cancel is not a failure — reporting it as one would read as a bug in the export.
      status = isAbort(e) ? "Cancelled — no file was written." : `Failed: ${errText(e)}`;
    } finally {
      busy = false;
      finalising = false;
      controller = null;
      activeFormat = null;
      appState.exportBusy = false;
    }
    if (closeAfter) {
      appState.exportOpen = false;
      status = "";
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
            ? singleFrame(activeFormat)
              ? "Writing — finishes on its own in a moment, nothing to stop"
              : finalising
                ? "Finalising — the file is being assembled and can no longer be stopped"
                : "Stop the export (Esc). No file is written."
            : "Close"}
          onclick={() => {
            if (busy) cancel();
            else appState.exportOpen = false;
          }}>✕</button
        >
      </div>
      {#if busy && singleFrame(activeFormat)}
        <!-- No bar, no Cancel: there is exactly one yield (to paint this line) before the whole
             encode runs synchronously, so there is no per-frame count to show and nothing an abort
             could interrupt mid-encode — a Cancel button here would set "Cancelling…" only to be
             overwritten by "Done." the instant the encode finishes, which is the same misleading
             flash this line exists to avoid. -->
        <span class="text-xs text-text-secondary"
          >Writing {activeFormat === "psd-frame" ? "PSD" : "PNG"}…</span
        >
      {:else if busy}
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
        {#snippet formatRow(f: ExportFormat, label: string, enabled = true)}
          <button
            class="border border-border rounded py-1 text-xs hover:bg-surface-hover aria-disabled:opacity-40 aria-disabled:hover:bg-transparent"
            class:ui-on={opts.format === f}
            aria-pressed={opts.format === f}
            aria-disabled={!enabled}
            onclick={() => enabled && (appState.exportOptions.format = f)}>{label}</button
          >
        {/snippet}

        <span class="text-text-secondary text-xs uppercase tracking-wide">Image</span>
        <div class="grid grid-cols-2 gap-1">
          {@render formatRow("png-sequence", "PNG sequence")}
          {@render formatRow("png-frame", "PNG frame")}
          {@render formatRow("psd-frame", "PSD frame")}
        </div>
        <span class="text-text-secondary text-xs uppercase tracking-wide">Animation</span>
        <div class="grid grid-cols-2 gap-1">
          {@render formatRow("gif", "GIF")}
        </div>
        <span class="text-text-secondary text-xs uppercase tracking-wide">Video</span>
        <div class="grid grid-cols-2 gap-1">
          {@render formatRow("mp4", "MP4", videoOk)}
          {@render formatRow("webm", "WebM", videoOk)}
        </div>

        <span class="text-text-secondary text-xs uppercase tracking-wide">Options</span>
        {#if opts.format !== "psd-frame"}
          <div class="flex items-center gap-1 text-xs">
            <span class="w-10 text-text-secondary">Size</span>
            {#each [1, 0.5, 0.25] as s (s)}
              <button
                class="flex-1 border border-border rounded py-1 hover:bg-surface-hover"
                class:ui-on={opts.scale === s}
                aria-pressed={opts.scale === s}
                onclick={() => (appState.exportOptions.scale = s)}>{s * 100}%</button
              >
            {/each}
            <span class="text-text-muted tabular-nums">{pixels.w}×{pixels.h}</span>
          </div>
        {/if}
        {#if !singleFrame(opts.format)}
          <div class="flex items-center gap-1 text-xs">
            <span class="w-10 text-text-secondary">Range</span>
            {#each [["all", "All"], ["inout", "In/Out"], ["custom", "Custom"]] as const as [m, label] (m)}
              <button
                class="flex-1 border border-border rounded py-1 hover:bg-surface-hover"
                class:ui-on={opts.rangeMode === m}
                aria-pressed={opts.rangeMode === m}
                onclick={() => setRangeMode(m)}>{label}</button
              >
            {/each}
          </div>
          {#if opts.rangeMode === "custom"}
            <div class="flex items-center gap-2 text-xs">
              <span class="w-10 text-text-secondary">Frames</span>
              <NumberField
                class="w-14 bg-surface border border-border rounded px-1 text-xs text-text"
                value={opts.customStart + 1}
                min={1}
                max={appState.project.frameCount}
                step={1}
                title="First frame to export"
                ariaLabel="First frame to export"
                onInput={(v) => (appState.exportOptions.customStart = v - 1)}
                onCommit={(v) => (appState.exportOptions.customStart = v - 1)}
              />
              <span class="text-text-muted">–</span>
              <NumberField
                class="w-14 bg-surface border border-border rounded px-1 text-xs text-text"
                value={opts.customEnd + 1}
                min={1}
                max={appState.project.frameCount}
                step={1}
                title="Last frame to export"
                ariaLabel="Last frame to export"
                onInput={(v) => (appState.exportOptions.customEnd = v - 1)}
                onCommit={(v) => (appState.exportOptions.customEnd = v - 1)}
              />
              <span class="text-text-muted tabular-nums">{range.end - range.start + 1} frames</span>
            </div>
          {/if}
        {/if}
        {#if opts.format === "mp4" || opts.format === "webm"}
          <div class="flex items-center gap-1 text-xs">
            <span class="w-10 text-text-secondary">Quality</span>
            {#each [["low", "Low"], ["medium", "Medium"], ["high", "High"]] as const as [q, label] (q)}
              <button
                class="flex-1 border border-border rounded py-1 hover:bg-surface-hover"
                class:ui-on={opts.videoQuality === q}
                aria-pressed={opts.videoQuality === q}
                onclick={() => (appState.exportOptions.videoQuality = q)}>{label}</button
              >
            {/each}
          </div>
        {/if}
        {#if opts.format === "gif"}
          <div class="flex items-center gap-1 text-xs">
            <span class="w-10 text-text-secondary">Colours</span>
            {#each [64, 128, 256] as c (c)}
              <button
                class="flex-1 border border-border rounded py-1 hover:bg-surface-hover"
                class:ui-on={opts.gifColors === c}
                aria-pressed={opts.gifColors === c}
                onclick={() => (appState.exportOptions.gifColors = c)}>{c}</button
              >
            {/each}
          </div>
        {/if}

        <span class="text-xs text-text-muted">{outputName}</span>
        <!-- `ui-on` is unconditional here, not `class:ui-on={formatAvailable}` — that was reviewed
             and rejected: the conditional form made an unavailable Export read as OFF rather than
             disabled. The accent fill at reduced opacity from `aria-disabled:opacity-40`, alongside
             `aria-disabled`, is the ordinary disabled-primary look. Don't flip this back. -->
        <button
          class="border border-border rounded py-1 hover:bg-surface-hover aria-disabled:opacity-40 aria-disabled:hover:bg-transparent ui-on"
          aria-disabled={!formatAvailable}
          onclick={() => formatAvailable && run()}>Export</button
        >
      {/if}
      {#if partial}
        <span class="text-xs text-warn">
          In/Out range is set — this export covers frames {range.start + 1}–{range.end + 1} of
          {appState.project.frameCount}. Clear it on the playbar to export everything. The
          current-frame exports are not affected.
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
      {#if appState.project.transparentBg && opts.format === "gif"}
        <span class="text-xs text-text-secondary">
          GIF transparency is per pixel, on or off — soft edges against the transparent background
          will harden.
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
