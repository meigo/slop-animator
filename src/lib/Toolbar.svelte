<script lang="ts">
  import { state, history, bump, addLayerToProject } from "../state/appState.svelte";
  import { loadImageLayer, loadVideoLayer } from "../anim/reference";

  let fileInput: HTMLInputElement;
  let pendingKind: "image" | "video" = "image";

  function pick(kind: "image" | "video") {
    pendingKind = kind;
    fileInput.accept = kind === "image" ? "image/*" : "video/*";
    fileInput.value = "";
    fileInput.click();
  }

  async function onFile() {
    const file = fileInput.files?.[0];
    if (!file) return;
    const layer = pendingKind === "image"
      ? await loadImageLayer(file)
      : await loadVideoLayer(file, () => bump());
    addLayerToProject(layer);
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
  <input type="color" bind:value={state.brush.color} />
  <button onclick={() => history.undo()}>Undo</button>
  <button onclick={() => history.redo()}>Redo</button>
  <span class="w-px h-5 bg-neutral-300 mx-1"></span>
  <button onclick={() => pick("image")}>Add Image</button>
  <button onclick={() => pick("video")}>Add Video</button>
  <input bind:this={fileInput} type="file" class="hidden" onchange={onFile} />
</div>
