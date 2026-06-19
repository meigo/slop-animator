<script lang="ts">
  import { onMount } from "svelte";
  import { writable } from "svelte/store";
  import { state, history, bump, addLayerToProject, replaceProject, setAudioTrack, DPR, pressureCurve, bumpCurve, pasteImageReference } from "../state/appState.svelte";
  import { loadImageLayer, loadVideoLayer } from "../anim/reference";
  import { loadAudioTrack } from "../audio/decode";
  import { saveProjectBlob, loadProjectBlob } from "../persist/project-file";
  import { downloadBlob } from "../export/download";
  import { createCurveEditor } from "../core/pressure-curve";
  import { clickOutside } from "./click-outside";
  import { Paintbrush, Eraser, PaintBucket, BoxSelect, Lasso, Undo2, Redo2, Image, Film, Music, Download, Save, FolderOpen, FilePlus2, Scaling, Sun, Moon, Spline, ClipboardPaste } from "@lucide/svelte";

  const SIZE_PRESETS = [0.5, 1, 2, 4, 8, 16, 32, 60];

  const curveOpen = writable(false);
  let curvePopupEl: HTMLDivElement;
  let curveEditor: (HTMLElement & { redraw: () => void }) | null = null;

  onMount(() => {
    curveEditor = createCurveEditor(pressureCurve, bumpCurve);
    curvePopupEl.appendChild(curveEditor);
  });

  // Keep the popup within the viewport: it's left-anchored to its trigger, but the toolbar
  // wraps, so the trigger can sit near the right (or left) edge. Shift it back into view.
  function positionPopup() {
    if (!curvePopupEl) return;
    const margin = 8;
    curvePopupEl.style.left = "0px"; // reset to the anchor before measuring
    const rect = curvePopupEl.getBoundingClientRect();
    const overflowRight = rect.right - (window.innerWidth - margin);
    if (overflowRight > 0) curvePopupEl.style.left = `${-overflowRight}px`;
    else if (rect.left < margin) curvePopupEl.style.left = `${margin - rect.left}px`;
  }

  // Redraw the editor whenever its popup opens, so it reflects the current (e.g. restored) curve,
  // then reposition once it's laid out (next frame) so it can't open off-screen.
  $: if ($curveOpen) {
    curveEditor?.redraw();
    requestAnimationFrame(positionPopup);
  }

  let fileInput: HTMLInputElement;
  let pendingKind: "image" | "video" | "project" | "audio" = "image";

  function pick(kind: "image" | "video" | "project" | "audio") {
    pendingKind = kind;
    fileInput.accept = kind === "image" ? "image/*" : kind === "video" ? "video/*" : kind === "audio" ? "audio/*" : ".zip,application/zip";
    fileInput.value = "";
    fileInput.click();
  }

  async function onFile() {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (pendingKind === "project") {
      replaceProject(await loadProjectBlob(file, DPR));
      return;
    }
    if (pendingKind === "audio") { setAudioTrack(await loadAudioTrack(file)); return; }
    const layer = pendingKind === "image"
      ? await loadImageLayer(file)
      : await loadVideoLayer(file, () => bump());
    addLayerToProject(layer);
  }

  async function pasteImage() {
    // The async Clipboard API is unavailable outside a secure context (e.g. the LAN dev server over
    // plain http on iPad), where navigator.clipboard is undefined. Say so instead of a vague error.
    if (!navigator.clipboard?.read) {
      alert("Clipboard paste needs HTTPS. On iPad, open the app over https (npm run dev:lan), or use Cmd+V with a keyboard.");
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith("image/"));
        if (type) {
          await pasteImageReference(await it.getType(type));
          return;
        }
      }
      alert("No image found in the clipboard.");
    } catch {
      alert("Couldn't read the clipboard (permission denied or unsupported).");
    }
  }

  async function saveProject() {
    downloadBlob(await saveProjectBlob(state.project), "project.zip");
  }

  function toggleTheme() {
    state.theme = state.theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", state.theme === "dark");
  }
</script>

<div class="flex flex-wrap items-center gap-2 p-2 border-b border-border bg-surface text-text">
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={state.tool === "brush"}
    title="Brush"
    onclick={() => (state.tool = "brush")}
  ><Paintbrush size={18} /></button>
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={state.tool === "eraser"}
    title="Eraser"
    onclick={() => (state.tool = "eraser")}
  ><Eraser size={18} /></button>
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={state.tool === "fill"}
    title="Fill"
    onclick={() => (state.tool = "fill")}
  ><PaintBucket size={18} /></button>
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={state.tool === "select"}
    title="Select"
    onclick={() => (state.tool = "select")}
  ><BoxSelect size={18} /></button>
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={state.tool === "lasso"}
    title="Lasso"
    onclick={() => (state.tool = "lasso")}
  ><Lasso size={18} /></button>
  <label class="flex items-center gap-1 text-sm text-text-secondary">Size
    <input type="range" min="0.5" max="60" step="0.5" bind:value={state.brush.size} />
    <input class="w-12 text-xs bg-surface border border-border rounded px-1 text-text"
           type="number" min="0.5" max="60" step="0.5" bind:value={state.brush.size}
           title="Brush size" />
  </label>
  <div class="flex items-center gap-0.5" title="Size presets">
    {#each SIZE_PRESETS as preset}
      <button class="px-1 text-xs rounded text-text-secondary hover:bg-surface-hover tabular-nums"
              class:bg-surface-active={state.brush.size === preset}
              onclick={() => (state.brush.size = preset)}>{preset}</button>
    {/each}
  </div>
  <label class="flex items-center gap-1 text-sm text-text-secondary" title="How much pen pressure widens the stroke">Press
    <input type="range" min="1" max="8" step="0.5" bind:value={state.sizeRange} />
    <span class="text-xs text-text-secondary w-6">{state.sizeRange}×</span>
  </label>
  <select class="h-7 border border-border rounded bg-surface text-text-secondary text-xs px-1" bind:value={state.brushType} title="Brush type">
    <option value="smooth">Smooth</option>
    <option value="ink">Ink</option>
    <option value="pencil">Pencil</option>
    <option value="charcoal">Charcoal</option>
    <option value="airbrush">Airbrush</option>
  </select>
  <label class="flex items-center gap-1 text-xs text-text-secondary">Opacity
    <input type="range" min="1" max="100" class="w-16" bind:value={state.brush.opacity} />
  </label>
  <label class="flex items-center gap-1 text-xs text-text-secondary">Smooth
    <input type="range" min="0" max="100" class="w-16" bind:value={state.brush.smoothing} />
  </label>
  <label class="flex items-center gap-1 text-xs text-text-secondary">Stream
    <input type="range" min="0" max="100" class="w-16" bind:value={state.streamline} />
  </label>
  <label class="flex items-center gap-1 text-xs text-text-secondary" title="Taper stroke ends">
    <input type="checkbox" bind:checked={state.brush.taper} /> Taper
  </label>
  <div class="relative" use:clickOutside={() => curveOpen.set(false)}>
    <button class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
            class:bg-surface-active={$curveOpen} title="Pressure curve" onclick={() => curveOpen.update(v => !v)}>
      <Spline size={18} />
    </button>
    <div class="curve-popup" class:open={$curveOpen} bind:this={curvePopupEl}></div>
  </div>
  <input type="color" bind:value={state.brush.color} />
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    title="Undo"
    onclick={() => history.undo()}
  ><Undo2 size={18} /></button>
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    title="Redo"
    onclick={() => history.redo()}
  ><Redo2 size={18} /></button>
  <span class="w-px h-5 bg-border mx-1"></span>
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    title="Add Image"
    onclick={() => pick("image")}
  ><Image size={18} /></button>
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    title="Paste image from clipboard"
    onclick={pasteImage}
  ><ClipboardPaste size={18} /></button>
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    title="Add Video"
    onclick={() => pick("video")}
  ><Film size={18} /></button>
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    title="Import audio"
    onclick={() => pick("audio")}
  ><Music size={18} /></button>
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    title="Export"
    onclick={() => (state.exportOpen = true)}
  ><Download size={18} /></button>
  <span class="w-px h-5 bg-border mx-1"></span>
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    title="Save"
    onclick={saveProject}
  ><Save size={18} /></button>
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    title="Open"
    onclick={() => pick("project")}
  ><FolderOpen size={18} /></button>
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    title="New"
    onclick={() => { state.sizeDialog.mode = "new"; state.sizeDialog.open = true; }}
  ><FilePlus2 size={18} /></button>
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    title="Resize canvas"
    onclick={() => { state.sizeDialog.mode = "resize"; state.sizeDialog.open = true; }}
  ><Scaling size={18} /></button>
  <input bind:this={fileInput} type="file" class="hidden" onchange={onFile} />
  <button class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover ml-auto" title="Toggle theme" onclick={toggleTheme}>
    {#if state.theme === "dark"}<Sun size={18} />{:else}<Moon size={18} />{/if}
  </button>
</div>
