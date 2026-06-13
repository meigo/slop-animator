<script lang="ts">
  import { state, bump } from "../state/appState.svelte";
  import { createDrawingLayer } from "../anim/document";

  function addLayer() {
    const layer = createDrawingLayer(state.project.frameCount);
    state.project.layers.push(layer);
    state.activeLayerId = layer.id;
    bump();
  }
</script>

<div class="w-48 border-l border-neutral-300 bg-neutral-100 p-2 flex flex-col gap-1">
  <div class="flex justify-between items-center">
    <span class="text-sm font-semibold">Layers</span>
    <button onclick={addLayer}>＋</button>
  </div>
  {#each [...state.project.layers].reverse() as layer (layer.id)}
    <div class="flex items-center gap-2 px-1 py-0.5 rounded"
         class:bg-neutral-300={layer.id === state.activeLayerId}>
      <input type="checkbox" bind:checked={layer.visible} onchange={bump} />
      <button class="flex-1 text-left text-sm" onclick={() => (state.activeLayerId = layer.id)}>
        {layer.name}
      </button>
    </div>
  {/each}
</div>
