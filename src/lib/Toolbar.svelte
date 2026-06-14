<script lang="ts">
  import { state, history, bump, addLayerToProject, replaceProject, DPR } from "../state/appState.svelte";
  import { loadImageLayer, loadVideoLayer } from "../anim/reference";
  import { saveProjectBlob, loadProjectBlob } from "../persist/project-file";
  import { clearAutosave } from "../persist/autosave";
  import { downloadBlob } from "../export/download";
  import { createProject } from "../anim/document";

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
</script>

<div class="flex items-center gap-2 p-2 border-b border-neutral-300 bg-neutral-100">
  <button class:font-bold={state.tool === "brush"} onclick={() => (state.tool = "brush")}>Brush</button>
  <button class:font-bold={state.tool === "eraser"} onclick={() => (state.tool = "eraser")}>Eraser</button>
  <button class:font-bold={state.tool === "fill"} onclick={() => (state.tool = "fill")}>Fill</button>
  <button class:font-bold={state.tool === "select"} onclick={() => (state.tool = "select")}>Select</button>
  <button class:font-bold={state.tool === "lasso"} onclick={() => (state.tool = "lasso")}>Lasso</button>
  <label class="flex items-center gap-1 text-sm">Size
    <input type="range" min="1" max="60" bind:value={state.brush.size} />
  </label>
  <label class="flex items-center gap-1 text-sm" title="How much pen pressure widens the stroke">Press
    <input type="range" min="1" max="8" step="0.5" bind:value={state.sizeRange} />
    <span class="text-xs text-neutral-500 w-6">{state.sizeRange}×</span>
  </label>
  <input type="color" bind:value={state.brush.color} />
  <button onclick={() => history.undo()}>Undo</button>
  <button onclick={() => history.redo()}>Redo</button>
  <span class="w-px h-5 bg-neutral-300 mx-1"></span>
  <button onclick={() => pick("image")}>Add Image</button>
  <button onclick={() => pick("video")}>Add Video</button>
  <button onclick={() => (state.exportOpen = true)}>Export</button>
  <span class="w-px h-5 bg-neutral-300 mx-1"></span>
  <button onclick={saveProject}>Save</button>
  <button onclick={() => pick("project")}>Open</button>
  <button onclick={newProject}>New</button>
  <input bind:this={fileInput} type="file" class="hidden" onchange={onFile} />
</div>
