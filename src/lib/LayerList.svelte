<script lang="ts">
  import { onMount } from "svelte";
  import Sortable from "sortablejs";
  import { Plus, Copy, ArrowDownToLine, Trash2, Eye, EyeOff, GripVertical, Pencil } from "@lucide/svelte";
  import { state, bump, addLayerToProject, removeLayer, duplicateLayer, mergeDown, reorderLayers, renameLayer } from "../state/appState.svelte";
  import { createDrawingLayer } from "../anim/document";

  let listEl: HTMLDivElement;

  let editingId: number | null = null;
  let draft = "";

  function startEdit(layer: { id: number; name: string }) {
    draft = layer.name;
    editingId = layer.id;
  }
  function commitEdit(id: number) {
    if (editingId !== id) return; // already cancelled/committed (e.g. Esc then blur)
    renameLayer(id, draft);
    editingId = null;
  }
  function focusSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  function addLayer() {
    addLayerToProject(createDrawingLayer(state.project.frameCount)); // undoable
  }

  // Display order is top-first (reverse of the bottom→top data order).
  // On drop, rebuild the data array from the DOM order so Svelte and Sortable agree.
  function onDrop() {
    const ids = [...listEl.children].map((el) => Number((el as HTMLElement).dataset.layerId));
    const byId = new Map(state.project.layers.map((l) => [l.id, l]));
    const newDisplayOrder = ids.map((id) => byId.get(id)).filter((l): l is NonNullable<typeof l> => !!l);
    reorderLayers(newDisplayOrder.reverse());
  }

  onMount(() => {
    const sortable = Sortable.create(listEl, {
      handle: ".layer-drag-handle",
      animation: 150,
      onEnd: onDrop,
    });
    return () => sortable.destroy();
  });
</script>

<div class="w-56 border-l border-border bg-surface flex flex-col text-text">
  <div class="flex items-center gap-1 p-1 border-b border-border">
    <span class="text-xs font-semibold text-text-secondary flex-1 px-1">Layers</span>
    <button class="w-7 h-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary" title="Add layer" onclick={addLayer}><Plus size={16} /></button>
    <button class="w-7 h-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary" title="Duplicate layer" onclick={() => duplicateLayer(state.activeLayerId)}><Copy size={16} /></button>
    <button class="w-7 h-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary" title="Merge down" onclick={() => mergeDown(state.activeLayerId)}><ArrowDownToLine size={16} /></button>
    <button class="w-7 h-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary" title="Delete layer" onclick={() => removeLayer(state.activeLayerId)}><Trash2 size={16} /></button>
  </div>

  <div bind:this={listEl} class="flex-1 overflow-y-auto">
    {#each [...state.project.layers].reverse() as layer (layer.id)}
      <div data-layer-id={layer.id}
           class="flex items-center gap-1 px-1 py-1 border-b border-border-light cursor-pointer hover:bg-surface-hover"
           class:bg-surface-active={layer.id === state.activeLayerId}
           onclick={() => (state.activeLayerId = layer.id)} role="presentation">
        <span class="layer-drag-handle cursor-grab text-text-muted" title="Drag to reorder"><GripVertical size={14} /></span>
        <button class="text-text-secondary" title="Toggle visibility"
                onclick={(e) => { e.stopPropagation(); layer.visible = !layer.visible; bump(); }}>
          {#if layer.visible}<Eye size={15} />{:else}<EyeOff size={15} />{/if}
        </button>
        {#if layer.kind === "ref"}
          <span class="text-[9px] px-1 rounded bg-surface-active text-text-muted uppercase">{layer.media.type}</span>
        {/if}
        {#if editingId === layer.id}
          <input class="flex-1 min-w-0 text-xs bg-surface border border-border px-1 text-text"
                 use:focusSelect bind:value={draft}
                 onclick={(e) => e.stopPropagation()}
                 onpointerdown={(e) => e.stopPropagation()}
                 onkeydown={(e) => {
                   if (e.key === "Enter") commitEdit(layer.id);
                   else if (e.key === "Escape") editingId = null;
                 }}
                 onblur={() => commitEdit(layer.id)} />
        {:else}
          <span class="flex-1 text-xs truncate">{layer.name}</span>
          <button class="text-text-muted hover:text-text-secondary" title="Rename layer"
                  onclick={(e) => { e.stopPropagation(); startEdit(layer); }}>
            <Pencil size={13} />
          </button>
        {/if}
        {#if layer.kind === "ref" && layer.media.type === "video"}
          <input class="w-9 text-xs bg-surface border border-border px-0.5 text-text" type="number" step="1"
                 bind:value={layer.offsetFrames} oninput={bump}
                 onclick={(e) => e.stopPropagation()} title="Video time offset (frames)" />
        {/if}
        <input class="w-10" type="range" min="0" max="100" bind:value={layer.opacity} oninput={bump}
               onclick={(e) => e.stopPropagation()} title="Opacity" />
      </div>
    {/each}
  </div>
</div>
