<script lang="ts">
  import { onMount } from "svelte";
  import Sortable from "sortablejs";
  import {
    Plus,
    Copy,
    ArrowDownToLine,
    Trash2,
    Eye,
    EyeOff,
    GripVertical,
    Pencil,
    Link,
    FolderPlus,
    Ungroup,
    ChevronDown,
    ChevronRight,
    Image,
    Film,
    ImageDown,
    Stamp,
    RotateCcw,
  } from "@lucide/svelte";
  import {
    state as appState,
    bump,
    addLayerToProject,
    removeLayer,
    duplicateLayer,
    mergeDown,
    renameLayer,
    relinkReference,
    rasterizeReference,
    groupActiveLayer,
    ungroup,
    toggleGroupCollapsed,
    toggleGroupVisible,
    renameGroup,
    reorderLayersWithGroups,
    applyLayerTransform,
    resetLayerTransform,
    applyCellTransform,
    resetCellTransform,
    setActiveLayer,
  } from "../state/appState.svelte";
  import {
    createDrawingLayer,
    groupOf,
    isIdentityTransform,
    cellTransform,
    resolvedKeyCell,
  } from "../anim/document";
  import type { Layer, LayerGroup } from "../anim/document";
  import { loadReferenceMedia } from "../anim/reference";

  let listEl: HTMLDivElement;
  let dragNonce = $state(0); // bumped after a drag to force a full {#key} re-render of the list
  let dropHandled = false; // latch so a single drop's multiple SortableJS onEnd events run rebuild once

  let editingId: number | null = $state(null);
  let draft = $state("");

  let editingGroupId: number | null = $state(null);
  let groupDraft = $state("");

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
    addLayerToProject(createDrawingLayer(appState.project.frameCount)); // undoable
  }

  // Show Apply/Reset when the layer transform OR the active frame's resolved key cell transform
  // is non-identity (draw layers only).
  function hasTransform(layer: Layer): boolean {
    if (layer.kind !== "draw") return false;
    if (!isIdentityTransform(layer.transform)) return true;
    const rk = resolvedKeyCell(layer, appState.playhead);
    return !!rk && !isIdentityTransform(cellTransform(rk.cell));
  }

  // Act on whichever transform is actually non-identity; when both are, the scope toggle decides.
  // (Avoids the case where the toggle says "Frame" but only the layer transform is set → no-op.)
  function activeTransformScope(layer: Layer): "frame" | "layer" | "group" | null {
    if (layer.kind !== "draw") return null;
    const layerNI = !isIdentityTransform(layer.transform);
    const rk = resolvedKeyCell(layer, appState.playhead);
    const cellNI = !!rk && !isIdentityTransform(cellTransform(rk.cell));
    if (layerNI && cellNI) return appState.transformScope;
    if (cellNI) return "frame";
    if (layerNI) return "layer";
    return null;
  }

  // Build display segments (top-first, reverse of the bottom→top data order).
  // Each segment is either a bare layer ({ layer }) or a contiguous group block
  // ({ group, layers }). Called from the template with `appState.project.layers`/`.groups` so the
  // reads are tracked fine-grained (runes mode).
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
    // SortableJS can fire onEnd twice for one drop (cross-list: source + destination). Act on the
    // first only — one DOM walk already captures the full final order, and the evt.item removal
    // below would corrupt a second walk. Reset on a microtask, before any future drag.
    if (dropHandled) return;
    dropHandled = true;
    queueMicrotask(() => {
      dropHandled = false;
    });

    const order: { id: number; groupId: number | null }[] = [];
    for (const child of listEl.children) {
      const el = child as HTMLElement;
      if (el.dataset && el.dataset.groupId != null) {
        const gid = Number(el.dataset.groupId);
        const members = el.querySelector(".group-members");
        if (members)
          for (const row of members.children)
            order.push({ id: Number((row as HTMLElement).dataset.layerId), groupId: gid });
      } else if (el.dataset && el.dataset.layerId != null) {
        order.push({ id: Number(el.dataset.layerId), groupId: null });
      }
    }
    reorderLayersWithGroups(order.reverse());

    // SortableJS physically relocated evt.item. Dropped at the bottom it lands AFTER the {#each}
    // end-anchor, so the {#key} re-render's teardown can't reach it and it survives as a duplicate
    // row. Remove the relocated node ourselves; the dragNonce re-render then rebuilds a clean list
    // from state (discarding any node SortableJS moved), robust regardless of drop position.
    evt.item.remove();
    dragNonce++;
  }

  // Each .group-members container is its own Sortable sharing the "layers" group,
  // so rows can drag between groups and the root list. Created/destroyed per render.
  function membersSortable(node: HTMLElement) {
    const s = Sortable.create(node, {
      group: "layers",
      handle: ".layer-drag-handle",
      animation: 150,
      onEnd: rebuild,
    });
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
  {@const active = layer.id === appState.activeLayerId}
  <div
    data-layer-id={layer.id}
    class="border-b border-border-light cursor-pointer hover:bg-surface-hover"
    class:bg-surface-active={active}
    onclick={() => setActiveLayer(layer.id)}
    role="presentation"
  >
    <!-- Row 1: compact (every layer) -->
    <div class="flex items-center gap-1 px-1 py-1">
      <span class="layer-drag-handle cursor-grab text-text-muted" title="Drag to reorder"
        ><GripVertical size={14} /></span
      >
      <button
        class="text-text-secondary"
        title="Toggle visibility"
        onclick={(e) => {
          e.stopPropagation();
          layer.visible = !layer.visible;
          bump();
        }}
      >
        {#if layer.visible}<Eye size={15} />{:else}<EyeOff size={15} />{/if}
      </button>
      {#if layer.kind === "ref"}
        {@const t = layer.media.type === "missing" ? layer.media.was : layer.media.type}
        <span
          class="shrink-0"
          class:text-text-muted={layer.media.type === "missing"}
          class:text-text-secondary={layer.media.type !== "missing"}
          title={layer.media.type === "missing" ? "Missing — re-link below" : t}
        >
          {#if t === "image"}<Image size={13} />{:else}<Film size={13} />{/if}
        </span>
      {/if}
      {#if editingId === layer.id}
        <input
          class="flex-1 min-w-0 text-xs bg-surface border border-border px-1 text-text"
          use:focusSelect
          bind:value={draft}
          onclick={(e) => e.stopPropagation()}
          onpointerdown={(e) => e.stopPropagation()}
          onkeydown={(e) => {
            if (e.key === "Enter") commitEdit(layer.id);
            else if (e.key === "Escape") editingId = null;
          }}
          onblur={() => commitEdit(layer.id)}
        />
      {:else}
        <span class="flex-1 text-xs truncate">{layer.name}</span>
      {/if}
    </div>
    <!-- Row 2: detail controls (active layer only) -->
    {#if active}
      <div class="flex items-center gap-2 pl-6 pr-1 pb-1 text-text-secondary">
        <input
          class="w-14"
          type="range"
          min="0"
          max="100"
          bind:value={layer.opacity}
          oninput={bump}
          onclick={(e) => e.stopPropagation()}
          title="Opacity"
        />
        <span class="text-[10px] tabular-nums w-6 text-text-muted">{layer.opacity}</span>
        <button
          class="text-text-muted hover:text-text-secondary"
          title="Rename layer"
          onclick={(e) => {
            e.stopPropagation();
            startEdit(layer);
          }}><Pencil size={13} /></button
        >
        {#if layer.kind === "ref" && layer.media.type === "video"}
          <input
            class="w-9 text-xs bg-surface border border-border px-0.5 text-text"
            type="number"
            step="1"
            bind:value={layer.offsetFrames}
            oninput={bump}
            onclick={(e) => e.stopPropagation()}
            title="Video time offset (frames)"
          />
        {/if}
        {#if layer.kind === "ref" && layer.media.type === "missing"}
          <button
            class="text-text-muted hover:text-text-secondary"
            title="Re-link media"
            onclick={(e) => {
              e.stopPropagation();
              startRelink(layer.id);
            }}><Link size={13} /></button
          >
        {/if}
        {#if layer.kind === "ref" && layer.media.type === "image"}
          <button
            class="text-text-muted hover:text-text-secondary"
            title="Rasterize to drawing layer"
            onclick={(e) => {
              e.stopPropagation();
              rasterizeReference(layer.id);
            }}><ImageDown size={13} /></button
          >
        {/if}
        {#if hasTransform(layer)}
          <button
            class="text-text-muted hover:text-text-secondary"
            title="Apply transform (bake to pixels)"
            onclick={(e) => {
              e.stopPropagation();
              if (activeTransformScope(layer) === "frame")
                applyCellTransform(layer.id, appState.playhead);
              else applyLayerTransform(layer.id);
            }}><Stamp size={13} /></button
          >
          <button
            class="text-text-muted hover:text-text-secondary"
            title="Reset transform"
            onclick={(e) => {
              e.stopPropagation();
              if (activeTransformScope(layer) === "frame")
                resetCellTransform(layer.id, appState.playhead);
              else resetLayerTransform(layer.id);
            }}><RotateCcw size={13} /></button
          >
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

<div class="w-56 border-l border-border bg-surface flex flex-col text-text">
  <input
    bind:this={relinkInput}
    type="file"
    accept="image/*,video/*"
    class="hidden"
    onchange={onRelinkFile}
  />
  <div class="flex items-center gap-1 p-1 border-b border-border">
    <span class="text-xs font-semibold text-text-secondary flex-1 px-1">Layers</span>
    <button
      class="w-7 h-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary"
      title="Add layer"
      onclick={addLayer}><Plus size={16} /></button
    >
    <button
      class="w-7 h-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary"
      title="Duplicate layer"
      onclick={() => duplicateLayer(appState.activeLayerId)}><Copy size={16} /></button
    >
    <button
      class="w-7 h-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary"
      title="Merge down"
      onclick={() => mergeDown(appState.activeLayerId)}><ArrowDownToLine size={16} /></button
    >
    <button
      class="w-7 h-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary"
      title="New group"
      onclick={groupActiveLayer}><FolderPlus size={16} /></button
    >
    <button
      class="w-7 h-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary"
      title="Delete layer"
      onclick={() => removeLayer(appState.activeLayerId)}><Trash2 size={16} /></button
    >
  </div>

  <div bind:this={listEl} class="flex-1 overflow-y-auto">
    {#key dragNonce}
      {#each buildSegments(appState.project.layers, appState.project.groups) as seg ("layer" in seg ? `l${seg.layer.id}` : `g${seg.group.id}`)}
        {#if "layer" in seg}
          {@render layerRow(seg.layer)}
        {:else}
          <div class="group-block border-b border-border-light" data-group-id={seg.group.id}>
            <div class="flex items-center gap-1 px-1 py-1 bg-surface-hover" role="presentation">
              <button
                class="text-text-secondary"
                title="Collapse group"
                onclick={() => toggleGroupCollapsed(seg.group.id)}
              >
                {#if seg.group.collapsed}<ChevronRight size={15} />{:else}<ChevronDown
                    size={15}
                  />{/if}
              </button>
              <button
                class="text-text-secondary"
                title="Toggle group visibility"
                onclick={() => toggleGroupVisible(seg.group.id)}
              >
                {#if seg.group.visible}<Eye size={15} />{:else}<EyeOff size={15} />{/if}
              </button>
              {#if editingGroupId === seg.group.id}
                <input
                  class="flex-1 min-w-0 text-xs bg-surface border border-border px-1 text-text"
                  use:focusSelect
                  bind:value={groupDraft}
                  onkeydown={(e) => {
                    if (e.key === "Enter") commitGroupEdit(seg.group.id);
                    else if (e.key === "Escape") editingGroupId = null;
                  }}
                  onblur={() => commitGroupEdit(seg.group.id)}
                />
              {:else}
                <span class="flex-1 text-xs font-semibold truncate">{seg.group.name}</span>
                <button
                  class="text-text-muted hover:text-text-secondary"
                  title="Rename group"
                  onclick={() => startGroupEdit(seg.group)}
                >
                  <Pencil size={13} />
                </button>
              {/if}
              <button
                class="text-text-muted hover:text-text-secondary"
                title="Ungroup"
                onclick={() => ungroup(seg.group.id)}
              >
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
    {/key}
  </div>
</div>
