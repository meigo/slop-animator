<script lang="ts">
  import { state, bump, removeLayer } from "../state/appState.svelte";
  import { createDrawingLayer } from "../anim/document";

  function addLayer() {
    const layer = createDrawingLayer(state.project.frameCount);
    state.project.layers.push(layer);
    state.activeLayerId = layer.id;
    bump();
  }
</script>

<div class="w-56 border-l border-neutral-300 bg-neutral-100 p-2 flex flex-col gap-1">
  <div class="flex justify-between items-center">
    <span class="text-sm font-semibold">Layers</span>
    <button onclick={addLayer} title="Add drawing layer">＋</button>
  </div>
  {#each [...state.project.layers].reverse() as layer (layer.id)}
    <div class="flex items-center gap-1 px-1 py-0.5 rounded"
         class:bg-neutral-300={layer.id === state.activeLayerId}>
      <input type="checkbox" bind:checked={layer.visible} onchange={bump} title="Visible" />
      {#if layer.kind === "ref"}
        <span class="text-[10px] px-1 rounded bg-neutral-400 text-white uppercase">{layer.media.type}</span>
      {/if}
      <button class="flex-1 text-left text-sm truncate" onclick={() => (state.activeLayerId = layer.id)}>
        {layer.name}
      </button>
      <input class="w-12" type="range" min="0" max="100" bind:value={layer.opacity} onchange={bump}
             title="Opacity" />
      <button class="text-neutral-500 hover:text-red-600" onclick={() => removeLayer(layer.id)} title="Delete">×</button>
    </div>
  {/each}
</div>
