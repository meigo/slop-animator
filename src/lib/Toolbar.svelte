<script lang="ts">
  import { state, history } from "../state/appState.svelte";
</script>

<div class="flex items-center gap-2 p-2 border-b border-neutral-300 bg-neutral-100">
  <button class:font-bold={state.tool === "brush"} onclick={() => (state.tool = "brush")}>Brush</button>
  <button class:font-bold={state.tool === "eraser"} onclick={() => (state.tool = "eraser")}>Eraser</button>
  <button class:font-bold={state.tool === "fill"} onclick={() => (state.tool = "fill")}>Fill</button>
  <label class="flex items-center gap-1 text-sm">Size
    <input type="range" min="1" max="60" bind:value={state.brush.size} />
  </label>
  <input type="color" bind:value={state.brush.color} />
  <button onclick={() => history.undo()}>Undo</button>
  <button onclick={() => history.redo()}>Redo</button>
</div>
