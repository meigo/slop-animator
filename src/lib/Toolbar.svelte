<script lang="ts">
  import { onMount } from "svelte";
  import { writable } from "svelte/store";
  import { state, history, bump, addLayerToProject, replaceProject, DPR, pressureCurve } from "../state/appState.svelte";
  import { loadImageLayer, loadVideoLayer } from "../anim/reference";
  import { saveProjectBlob, loadProjectBlob } from "../persist/project-file";
  import { downloadBlob } from "../export/download";
  import { createCurveEditor } from "../core/pressure-curve";
  import { Paintbrush, Eraser, PaintBucket, BoxSelect, Lasso, Undo2, Redo2, Image, Film, Download, Save, FolderOpen, FilePlus2, Scaling, Sun, Moon, Spline } from "@lucide/svelte";

  const curveOpen = writable(false);
  let curvePopupEl: HTMLDivElement;

  onMount(() => {
    curvePopupEl.appendChild(createCurveEditor(pressureCurve, () => {}));
  });

  let fileInput: HTMLInputElement;
  let pendingKind: "image" | "video" | "project" = "image";

  function pick(kind: "image" | "video" | "project") {
    pendingKind = kind;
    fileInput.accept = kind === "image" ? "image/*" : kind === "video" ? "video/*" : ".zip,application/zip";
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
    const layer = pendingKind === "image"
      ? await loadImageLayer(file)
      : await loadVideoLayer(file, () => bump());
    addLayerToProject(layer);
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
  </label>
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
  <div class="relative">
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
    title="Add Video"
    onclick={() => pick("video")}
  ><Film size={18} /></button>
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
