<script lang="ts">
  import { onMount } from "svelte";
  import Sortable from "sortablejs";
  import { Plus, Copy, ArrowDownToLine, Trash2, Eye, EyeOff, GripVertical, Pencil, Link, FolderPlus, Ungroup, ChevronDown, ChevronRight } from "@lucide/svelte";
  import { state, bump, addLayerToProject, removeLayer, duplicateLayer, mergeDown, renameLayer, relinkReference, groupActiveLayer, ungroup, toggleGroupCollapsed, toggleGroupVisible, renameGroup, reorderLayersWithGroups } from "../state/appState.svelte";
  import { createDrawingLayer, groupOf } from "../anim/document";
  import type { Layer, LayerGroup } from "../anim/document";
  import { loadReferenceMedia } from "../anim/reference";

  let listEl: HTMLDivElement;

  let editingId: number | null = null;
  let draft = "";

  let editingGroupId: number | null = null;
  let groupDraft = "";

  let relinkInput: HTMLInputElement;
  let relinkTargetId: number | null = null;

  function startRelink(id: number) {
    relinkTargetId = id;
    relinkInput.value = "";
    relinkInput.click();
  }
  async function onRelinkFile() {
    const file = relinkInput.files?.[0];
    const id = relinkTargetId;
    if (!file || id == null) return;
    relinkReference(id, await loadReferenceMedia(file, () => bump()));
  }

  function startEdit(layer: { id: number; name: string }) {
    draft = layer.name;
    editingId = layer.id;
  }
  function commitEdit(id: number) {
    if (editingId !== id) return; // already cancelled/committed (e.g. Esc then blur)
    renameLayer(id, draft);
    editingId = null;
  }

  function startGroupEdit(g: { id: number; name: string }) {
    groupDraft = g.name;
    editingGroupId = g.id;
  }
  function commitGroupEdit(id: number) {
    if (editingGroupId !== id) return;
    renameGroup(id, groupDraft);
    editingGroupId = null;
  }

  function focusSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  function addLayer() {
    addLayerToProject(createDrawingLayer(state.project.frameCount)); // undoable
  }

  // Build display segments (top-first, reverse of the bottom→top data order).
  // Each segment is either a bare layer ({ layer }) or a contiguous group block
  // ({ group, layers }). Called from the template with `state.project.layers`/`.groups` so the
  // template tracks those reactive reads — a `$:` block would NOT (this is a legacy-mode component
  // that imports the `state` proxy, and legacy `$:` doesn't track external rune-proxy reads).
  type Segment = { layer: Layer } | { group: LayerGroup; layers: Layer[] };
  function buildSegments(layers: Layer[], groups: LayerGroup[]): Segment[] {
    const segs: Segment[] = [];
    for (const layer of [...layers].reverse()) {
      const g = groupOf(layer, groups);
      const last = segs[segs.length - 1];
      if (g && last && "group" in last && last.group.id === g.id) last.layers.push(layer);
      else if (g) segs.push({ group: g, layers: [layer] });
      else segs.push({ layer });
    }
    return segs;
  }

  // Rebuild the data array from the nested DOM order so Svelte and Sortable agree.
  // Walks top-first display order (root children, descending into group-members),
  // then reverses to the bottom→top data order.
  function rebuild(evt: Sortable.SortableEvent) {
    const order: { id: number; groupId: number | null }[] = [];
    for (const child of listEl.children) {
      const el = child as HTMLElement;
      if (el.dataset && el.dataset.groupId != null) {
        const gid = Number(el.dataset.groupId);
        const members = el.querySelector(".group-members");
        if (members) for (const row of members.children) order.push({ id: Number((row as HTMLElement).dataset.layerId), groupId: gid });
      } else if (el.dataset && el.dataset.layerId != null) {
        order.push({ id: Number(el.dataset.layerId), groupId: null });
      }
    }
    // Revert SortableJS's DOM move so Svelte stays the single source of truth — otherwise the moved
    // node plus Svelte's re-rendered node show as a duplicate until the next full render. The store
    // update below then drives the real re-render.
    const { item, from, oldIndex } = evt;
    if (item && from && oldIndex != null) {
      item.remove();
      from.insertBefore(item, from.children[oldIndex] ?? null);
    }
    reorderLayersWithGroups(order.reverse());
  }

  // Each .group-members container is its own Sortable sharing the "layers" group,
  // so rows can drag between groups and the root list. Created/destroyed per render.
  function membersSortable(node: HTMLElement) {
    const s = Sortable.create(node, { group: "layers", handle: ".layer-drag-handle", animation: 150, onEnd: rebuild });
    return { destroy: () => s.destroy() };
  }

  onMount(() => {
    const sortable = Sortable.create(listEl, {
      group: "layers",
      handle: ".layer-drag-handle",
      animation: 150,
      onEnd: rebuild,
    });
    return () => sortable.destroy();
  });
</script>

{#snippet layerRow(layer: Layer)}
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
      {#if layer.media.type === "missing"}
        <span class="text-[9px] px-1 rounded bg-surface-active text-text-muted uppercase">{layer.media.was}?</span>
        <button class="text-text-muted hover:text-text-secondary" title="Re-link media"
                onclick={(e) => { e.stopPropagation(); startRelink(layer.id); }}><Link size={13} /></button>
      {:else}
        <span class="text-[9px] px-1 rounded bg-surface-active text-text-muted uppercase">{layer.media.type}</span>
      {/if}
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
{/snippet}

<div class="w-56 border-l border-border bg-surface flex flex-col text-text">
  <input bind:this={relinkInput} type="file" accept="image/*,video/*" class="hidden" onchange={onRelinkFile} />
  <div class="flex items-center gap-1 p-1 border-b border-border">
    <span class="text-xs font-semibold text-text-secondary flex-1 px-1">Layers</span>
    <button class="w-7 h-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary" title="Add layer" onclick={addLayer}><Plus size={16} /></button>
    <button class="w-7 h-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary" title="Duplicate layer" onclick={() => duplicateLayer(state.activeLayerId)}><Copy size={16} /></button>
    <button class="w-7 h-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary" title="Merge down" onclick={() => mergeDown(state.activeLayerId)}><ArrowDownToLine size={16} /></button>
    <button class="w-7 h-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary" title="New group" onclick={groupActiveLayer}><FolderPlus size={16} /></button>
    <button class="w-7 h-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary" title="Delete layer" onclick={() => removeLayer(state.activeLayerId)}><Trash2 size={16} /></button>
  </div>

  <div bind:this={listEl} class="flex-1 overflow-y-auto">
    {#each buildSegments(state.project.layers, state.project.groups) as seg ("layer" in seg ? `l${seg.layer.id}` : `g${seg.group.id}`)}
      {#if "layer" in seg}
        {@render layerRow(seg.layer)}
      {:else}
        <div class="group-block border-b border-border-light" data-group-id={seg.group.id}>
          <div class="flex items-center gap-1 px-1 py-1 bg-surface-hover" role="presentation">
            <button class="text-text-secondary" title="Collapse group"
                    onclick={() => toggleGroupCollapsed(seg.group.id)}>
              {#if seg.group.collapsed}<ChevronRight size={15} />{:else}<ChevronDown size={15} />{/if}
            </button>
            <button class="text-text-secondary" title="Toggle group visibility"
                    onclick={() => toggleGroupVisible(seg.group.id)}>
              {#if seg.group.visible}<Eye size={15} />{:else}<EyeOff size={15} />{/if}
            </button>
            {#if editingGroupId === seg.group.id}
              <input class="flex-1 min-w-0 text-xs bg-surface border border-border px-1 text-text"
                     use:focusSelect bind:value={groupDraft}
                     onkeydown={(e) => {
                       if (e.key === "Enter") commitGroupEdit(seg.group.id);
                       else if (e.key === "Escape") editingGroupId = null;
                     }}
                     onblur={() => commitGroupEdit(seg.group.id)} />
            {:else}
              <span class="flex-1 text-xs font-semibold truncate">{seg.group.name}</span>
              <button class="text-text-muted hover:text-text-secondary" title="Rename group"
                      onclick={() => startGroupEdit(seg.group)}>
                <Pencil size={13} />
              </button>
            {/if}
            <button class="text-text-muted hover:text-text-secondary" title="Ungroup"
                    onclick={() => ungroup(seg.group.id)}>
              <Ungroup size={14} />
            </button>
          </div>
          <div class="group-members pl-3" class:hidden={seg.group.collapsed} use:membersSortable>
            {#each seg.layers as layer (layer.id)}
              {@render layerRow(layer)}
            {/each}
          </div>
        </div>
      {/if}
    {/each}
  </div>
</div>
