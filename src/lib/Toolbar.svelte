<script lang="ts">
  import { state, history, bump, addLayerToProject, replaceProject, DPR } from "../state/appState.svelte";
  import { loadImageLayer, loadVideoLayer } from "../anim/reference";
  import { saveProjectBlob, loadProjectBlob } from "../persist/project-file";
  import { clearAutosave } from "../persist/autosave";
  import { downloadBlob } from "../export/download";
  import { createProject } from "../anim/document";
  import { Paintbrush, Eraser, PaintBucket, BoxSelect, Lasso, Undo2, Redo2, Image, Film, Download, Save, FolderOpen, FilePlus2, Sun, Moon } from "@lucide/svelte";

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

  async function newProject() {
    replaceProject(createProject());
    await clearAutosave();
  }

  function toggleTheme() {
    state.theme = state.theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", state.theme === "dark");
  }
</script>

<div class="flex items-center gap-2 p-2 border-b border-border bg-surface text-text">
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
    onclick={newProject}
  ><FilePlus2 size={18} /></button>
  <input bind:this={fileInput} type="file" class="hidden" onchange={onFile} />
  <button class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover ml-auto" title="Toggle theme" onclick={toggleTheme}>
    {#if state.theme === "dark"}<Sun size={18} />{:else}<Moon size={18} />{/if}
  </button>
</div>
