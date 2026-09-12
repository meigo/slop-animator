<script lang="ts">
  import { buildSegments } from "../anim/row-layout";
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
    FolderPlus,
    ChevronDown,
    ChevronRight,
    Image,
    Film,
    Square,
    Lock,
    LockOpen,
    Grid2x2,
  } from "@lucide/svelte";
  import {
    state as appState,
    bump,
    addLayerToProject,
    removeLayer,
    removeGroup,
    duplicateLayer,
    mergeDown,
    renameLayer,
    groupActiveLayer,
    toggleGroupCollapsed,
    toggleGroupVisible,
    toggleGroupLocked,
    renameGroup,
    reorderLayersWithGroups,
    setActiveLayer,
    isRowSelected,
    selectGroup,
  } from "../state/appState.svelte";
  import { groupHeaderSelected } from "../anim/active-row";
  import {
    createDrawingLayer,
    nextLayerName,
    groupOf,
    isLayerLocked,
    resolvedDisplayKeyCell,
  } from "../anim/document";
  import { isCellEmpty } from "./cell-ink";
  import type { Layer } from "../anim/document";
  import { layerPanelActions } from "../anim/layer-panel-actions";
  import { clampPanelWidth } from "../anim/panel-layout";
  import LayerProps from "./LayerProps.svelte";

  let listEl: HTMLDivElement;
  let dragNonce = $state(0); // bumped after a drag to force a full {#key} re-render of the list
  let dropHandled = false; // latch so a single drop's multiple SortableJS onEnd events run rebuild once

  let editingId: number | null = $state(null);
  let draft = $state("");

  let editingGroupId: number | null = $state(null);
  let groupDraft = $state("");

  function startEdit(layer: { id: number; name: string }) {
    draft = layer.name;
    editingId = layer.id;
  }
  function commitEdit(id: number) {
    if (editingId !== id) return; // already cancelled/committed (e.g. Esc then blur)
    renameLayer(id, draft);
    editingId = null;
  }

  /** Rename started from the properties strip, which no longer sits beside the row: a member of a
   *  COLLAPSED group has no row on screen to put the input in, so open the group first. Focusing
   *  the input (focusSelect) then scrolls it into view. */
  function renameLayerFromStrip(layer: Layer) {
    const g = groupOf(layer, appState.project.groups);
    if (g?.collapsed) toggleGroupCollapsed(g.id);
    startEdit(layer);
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
    // Name from THIS project's layers, not from the layer id — the id is session-wide and only ever
    // climbs, which is why a new project's next layer used to be "Layer 23".
    addLayerToProject(
      createDrawingLayer(appState.project.frameCount, nextLayerName(appState.project.layers)),
    ); // undoable
  }

  // Panel resize, mirroring Timeline's grip. The panel is docked RIGHT, so dragging the left-edge
  // grip LEFT makes it wider — hence (gripStartX - e.clientX), the same inversion the timeline uses
  // for drag-up-to-grow. The prefs $effect persists the result.
  let gripStartX = 0;
  let gripStartW = 0;
  function gripDown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gripStartX = e.clientX;
    gripStartW = appState.layerPanelWidth;
  }
  function gripMove(e: PointerEvent) {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    appState.layerPanelWidth = clampPanelWidth(
      gripStartW + (gripStartX - e.clientX),
      window.innerWidth,
    );
  }
  function gripUp(e: PointerEvent) {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }
  // Keep the panel within half the viewport if the window shrinks.
  function onWindowResize() {
    appState.layerPanelWidth = clampPanelWidth(appState.layerPanelWidth, window.innerWidth);
  }

  // Header actions follow the selected ROW, never leftover `activeLayerId`. A button that
  // silently no-ops explains nothing, so refusals dim and say why. aria-disabled (not disabled)
  // per the app-wide rule: a disabled button dispatches no pointer events, so App.svelte's
  // delegated status-hint listener could never read the title — and on iPad there is no hover.
  const panel = $derived(
    layerPanelActions({
      activeRow: appState.activeRow,
      layers: appState.project.layers,
      groups: appState.project.groups,
    }),
  );

  // Display segments now come from the shared `row-layout` module — the timeline builds its rows
  // from the same function, so the two views cannot disagree about the order or about which layers
  // a collapsed group is hiding. Still called from the template with `appState.project.layers`/
  // `.groups` so the reads stay fine-grained (runes mode).

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

    // Every layer row in document order, each taking its group from whatever encloses it. Flat on
    // purpose: the previous two-level walk read a group block's members as `data-layer-id`, so any
    // element that was not a layer row yielded Number(undefined) = NaN, byId.get(NaN) = undefined,
    // and those layers were dropped from the rebuilt array — SILENT DATA LOSS. The `put` guard on
    // membersSortable should make that unreachable; this makes it impossible.
    const order: { id: number; groupId: number | null }[] = [];
    for (const row of listEl.querySelectorAll<HTMLElement>("[data-layer-id]")) {
      const gid = row.closest<HTMLElement>("[data-group-id]")?.dataset.groupId;
      order.push({ id: Number(row.dataset.layerId), groupId: gid == null ? null : Number(gid) });
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
      // Root and members share the "layers" group so rows cross between them — but a GROUP header
      // is also a root item now, and `layer.groupId` is a single id with no representation for a
      // group inside a group. Refuse that one drop; everything else is unchanged.
      group: { name: "layers", put: (_to, _from, el) => el.dataset.groupId == null },
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
  <!-- One question, one value: `isRowSelected` is the whole answer, so this panel and the timeline
       gutter cannot disagree about what is selected. Also gates the Row 2 detail strip — nothing
       layer-ish is selected while the audio lane is, and one click restores it. The draw target does
       not go missing: the status bar names the active layer independently of any highlight. -->
  {@const active = isRowSelected(layer.id)}
  <!-- `pl-[13px]` on a GROUP MEMBER, and deliberately on this element rather than on the
       `.group-members` container that used to carry it. An inset `box-shadow` paints at the BORDER
       box, which padding does not move — so the row's content indents while its `.ui-selected` bar
       stays at x=0, landing on the group rail drawn there. Put the same padding on the
       `.group-members` container instead and the bar moves with it, which is what made a selected
       member draw a second line beside the rail.
       19px = the group header's chevron (15) plus its gap (4), i.e. the DISCLOSURE COLUMN — so a
       member's eye/lock/name land on exactly the same x as its group's, which is the standard tree
       rule (a child's content aligns under the parent's; the nesting is carried by the guide line,
       here the rail). It was 13px, which put every child column 6px LEFT of its parent's: children
       reading as less indented than their group, a near-miss that looks like an error rather than a
       step. Measured before: group eye/lock/name at 41/60/79, member at 35/54/73. -->
  <div
    data-layer-id={layer.id}
    class="border-b border-border-light cursor-pointer hover:bg-surface-hover"
    class:group-rail={layer.groupId != null}
    class:pl-[19px]={layer.groupId != null}
    class:ui-selected={active}
    onclick={() => setActiveLayer(layer.id)}
    role="presentation"
  >
    <!-- One line per layer. LEFT is identity (grip, type, name); RIGHT is state you scan ACROSS
         layers, in fixed 20px columns — alpha lock, lock, eye (outermost: most used, easiest to hit)
         — so every row's toggles line up whatever its nesting or kind. The per-layer CONTROLS moved to
         the properties strip above the list (LayerProps) on 2026-09-11, so a row never grows when
         selected and the one under the Pencil never moves. -->
    <div class="flex items-center gap-1 p-1">
      <span class="layer-drag-handle cursor-grab text-text-muted" title="Drag to reorder"
        ><GripVertical size={14} /></span
      >
      <!-- Type slot, 15px = the group header's chevron, so a top-level layer's name starts exactly
           where a group's does. Blank for drawing layers; reserved either way. -->
      {#if layer.kind === "ref"}
        {@const t = layer.media.type === "missing" ? layer.media.was : layer.media.type}
        <span
          class="flex w-[15px] shrink-0 justify-center"
          class:text-text-muted={layer.media.type === "missing"}
          class:text-text-secondary={layer.media.type !== "missing"}
          title={layer.media.type === "missing"
            ? "Missing — select it and re-link in the bar above"
            : `${t} reference — a guide only, not included in exports`}
        >
          {#if t === "image"}<Image size={13} />{:else}<Film size={13} />{/if}
        </span>
      {:else}
        <!-- The type slot is ALWAYS filled, so the column never reads as a hole on the commonest row
             (reported: "when chevron or icon are missing there are large gaps"). A square, quiet at
             60% muted: it earns its ink by saying whether this layer has anything ON THIS FRAME —
             FILLED when it does, an empty outline when the frame is blank. Filled-vs-outline, not
             solid-vs-dashed: at 13px the two outlines were "barely visible" apart (reported). 13px
             matches the reference glyphs beside it, so the column has one weight. Same question
             `computeTimelineGlyphs` asks, through the same per-canvas cache (`isCellEmpty`), so the
             two surfaces cannot disagree. NOT mirrored into the timeline gutter: a row there is
             followed by its own strip of ◆/◇, and a second ink mark beside them would compete. -->
        {@const rk = resolvedDisplayKeyCell(layer, appState.playhead)}
        {@const inked = !!rk && !isCellEmpty(rk.cell.canvas, appState.version)}
        <span
          class="flex w-[15px] shrink-0 justify-center text-text-muted/60"
          title={inked
            ? "Drawing layer — ink on this frame"
            : "Drawing layer — blank on this frame"}
        >
          {#if inked}<Square size={13} fill="currentColor" />{:else}<Square size={13} />{/if}
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
        <span class="flex-1 min-w-0 text-xs truncate">{layer.name}</span>
      {/if}
      {#if layer.kind === "draw"}
        <!-- Alpha lock ("lock transparency"): the checkerboard is the usual transparency glyph, and a
             second padlock beside the layer lock would read as a duplicate of it. A view-prop like
             `locked`, toggled the same way (not undoable). Fainter than the other two when off: it is
             the rarely-on one, and a third equal-weight icon read as noise. -->
        <button
          class="flex size-5 shrink-0 items-center justify-center {layer.alphaLock
            ? 'text-accent'
            : 'text-text-muted/50 hover:text-text'}"
          aria-pressed={layer.alphaLock === true}
          title={layer.alphaLock
            ? "Alpha lock on — paint lands only on existing pixels; click to turn off"
            : "Alpha lock off — click to paint only over existing pixels"}
          onclick={(e) => {
            e.stopPropagation();
            layer.alphaLock = !layer.alphaLock;
            bump();
          }}
        >
          <Grid2x2 size={15} />
        </button>
      {:else}
        <span class="size-5 shrink-0" role="presentation"></span>
      {/if}
      <button
        class="flex size-5 shrink-0 items-center justify-center {isLayerLocked(
          layer,
          appState.project.groups,
        )
          ? 'text-warn'
          : 'text-text-muted hover:text-text'}"
        onclick={(e) => {
          e.stopPropagation();
          layer.locked = !layer.locked;
          bump();
        }}
        title={layer.locked
          ? "Locked — click to unlock"
          : layer.kind === "ref"
            ? "Unlocked — click to pin this reference in place"
            : "Unlocked — click to lock drawing"}
      >
        {#if layer.locked}<Lock size={15} />{:else}<LockOpen size={15} />{/if}
      </button>
      <button
        class="flex size-5 shrink-0 items-center justify-center {layer.visible
          ? 'text-text-muted hover:text-text'
          : 'text-warn'}"
        title={layer.visible ? "Visible — click to hide" : "Hidden — edits refused; click to show"}
        onclick={(e) => {
          e.stopPropagation();
          layer.visible = !layer.visible;
          bump();
        }}
      >
        {#if layer.visible}<Eye size={15} />{:else}<EyeOff size={15} />{/if}
      </button>
    </div>
  </div>
{/snippet}

<svelte:window onresize={onWindowResize} />

<div
  class="relative border-l border-border bg-surface flex flex-col text-text shrink-0"
  style="width: {appState.layerPanelWidth}px"
>
  <!-- Resize grip on the LEFT edge, since the panel is docked right: dragging left WIDENS, the same
       inversion as the timeline's drag-up-to-grow. Overlays the panel's edge rather than taking a
       column, so it costs no width. -->
  <div
    class="group absolute inset-y-0 left-0 z-30 w-2 cursor-col-resize"
    style="touch-action: none"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize layer panel"
    title="Drag to resize the layer panel"
    onpointerdown={gripDown}
    onpointermove={gripMove}
    onpointerup={gripUp}
    onpointercancel={gripUp}
  >
    <!-- The HIT area is 8px, but the tint is only the 4px the panel actually reserves. Tinting the
         full 8px painted over the rows' own background (the grip overlays their left 4px), which
         read as a mismatched notch against the active/hover row colour. -->
    <div class="absolute inset-y-0 left-0 w-1 group-hover:bg-text/10"></div>
  </div>
  <!-- The grip's strip is reserved on BOTH direct children (the header's own `p-1`, and `pl-1` on the
       list), never on the panel root: padding the root would inset the header's bottom border too and
       leave it short of the left edge. 4px there plus each row's own 4px `p-1` puts the drag-handle
       icon at 8px — exactly where the 8px grip ends, so the two abut without overlapping and no
       space is wasted between them. -->
  <div class="flex items-center gap-1 p-1 border-b border-border">
    <!-- `min-w-0 truncate` + flex-1 (basis 0): the title only takes LEFTOVER space, so on a narrow panel it
         gives way before the buttons shrink; they stay full 28px targets at the default width. -->
    <span class="min-w-0 flex-1 truncate px-1 text-xs font-semibold text-text-secondary"
      >Layers</span
    >
    <!-- Grouped create │ derive │ destroy, divided (SLOP-TIMELINE-UI §4): Delete stands alone so a slightly
         off tap on New group cannot remove a layer. Not aligned to the rows' columns on purpose — these
         are 28px list actions at a 32px pitch, a different band from the 20px/24px state toggles below;
         only the right edge is shared (the same 4px inset). -->
    <button
      class="size-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary"
      title="Add layer"
      onclick={addLayer}><Plus size={16} /></button
    >
    <button
      class="size-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent"
      title={panel.group.title}
      aria-disabled={!panel.group.enabled}
      onclick={() => {
        if (panel.group.enabled) groupActiveLayer();
      }}><FolderPlus size={16} /></button
    >
    <span class="-mx-0.5 h-5 w-px shrink-0 bg-border" role="presentation"></span>
    <button
      class="size-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent"
      title={panel.duplicate.title}
      aria-disabled={!panel.duplicate.enabled}
      onclick={() => {
        if (panel.duplicate.enabled && panel.layerId != null) duplicateLayer(panel.layerId);
      }}><Copy size={16} /></button
    >
    <button
      class="size-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent"
      title={panel.merge.title}
      aria-disabled={!panel.merge.enabled}
      onclick={() => {
        if (panel.merge.enabled && panel.layerId != null) mergeDown(panel.layerId);
      }}><ArrowDownToLine size={16} /></button
    >
    <span class="-mx-0.5 h-5 w-px shrink-0 bg-border" role="presentation"></span>
    <button
      class="size-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent"
      title={panel.remove.title}
      aria-disabled={!panel.remove.enabled}
      onclick={() => {
        if (!panel.remove.enabled) return;
        if (panel.groupId != null) removeGroup(panel.groupId);
        else if (panel.layerId != null) removeLayer(panel.layerId);
      }}><Trash2 size={16} /></button
    >
  </div>

  <!-- Properties of the selected row (layer, reference or group): the per-layer CONTROLS, which used
       to open as a second line inside the selected row. -->
  <LayerProps onRenameLayer={renameLayerFromStrip} onRenameGroup={startGroupEdit} />

  <div bind:this={listEl} class="flex-1 overflow-y-auto pl-1">
    {#key dragNonce}
      {#each buildSegments(appState.project.layers, appState.project.groups) as seg ("layer" in seg ? `l${seg.layer.id}` : `g${seg.group.id}`)}
        {#if "layer" in seg}
          {@render layerRow(seg.layer)}
        {:else}
          {@const groupLit = groupHeaderSelected(
            appState.activeRow,
            seg.group,
            appState.project.layers,
          )}
          <!-- The rail itself is on the ROWS (`.group-rail`, defined in app.css), not here: a
               parent's background is always covered by an opaque child, so with it on the block a
               member row's hover erased the line under it. -->
          <div class="group-block border-b border-border-light" data-group-id={seg.group.id}>
            <div
              class="group-rail flex items-center gap-1 p-1 hover:bg-surface-hover"
              class:ui-selected={groupLit}
              role="presentation"
            >
              <!-- Same class the layer rows use, so the ROOT Sortable (handle: .layer-drag-handle)
                   can grab the whole .group-block. It lives on the header, not inside
                   .group-members, so the inner Sortable never sees it and the two cannot fight over
                   the gesture. A collapsed group drags as one unit for free — its members stay in
                   the DOM under `hidden`, so `rebuild` still walks them. -->
              <span class="layer-drag-handle cursor-grab text-text-muted" title="Drag to reorder"
                ><GripVertical size={14} /></span
              >
              <!-- `-ml-0.5 mr-0.5`: the chevron glyph carries ~3.75px of its own padding on the left, so at
                   an even gap it sat ~12px from the grip and only ~8px from the name. Shifting the BOX 2px
                   left and giving the 2px back on its right balances the ink without moving the name, which
                   is what keeps group and layer names on one column. -->
              <button
                class="-ml-0.5 mr-0.5 flex w-[15px] shrink-0 justify-center text-text-secondary hover:text-text"
                title={seg.group.collapsed ? "Expand group" : "Collapse group"}
                onclick={() => toggleGroupCollapsed(seg.group.id)}
              >
                {#if seg.group.collapsed}<ChevronRight size={15} />{:else}<ChevronDown
                    size={15}
                  />{/if}
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
                <button
                  class="min-w-0 flex-1 truncate text-left text-xs font-semibold"
                  title="Select group"
                  onclick={() => selectGroup(seg.group.id)}>{seg.group.name}</button
                >
              {/if}
              <!-- The alpha-lock column, empty: groups have no pixels of their own, and the slot keeps
                   the group's lock and eye in the same columns as every layer's. -->
              <span class="size-5 shrink-0" role="presentation"></span>
              <button
                class="flex size-5 shrink-0 items-center justify-center {seg.group.locked
                  ? 'text-warn'
                  : 'text-text-muted hover:text-text'}"
                title={seg.group.locked
                  ? "Group locked — click to unlock (members keep their own locks)"
                  : "Unlocked — click to lock every layer in this group"}
                onclick={() => toggleGroupLocked(seg.group.id)}
              >
                {#if seg.group.locked}<Lock size={15} />{:else}<LockOpen size={15} />{/if}
              </button>
              <button
                class="flex size-5 shrink-0 items-center justify-center {seg.group.visible
                  ? 'text-text-muted hover:text-text'
                  : 'text-warn'}"
                title={seg.group.visible
                  ? "Group visible — click to hide"
                  : "Group hidden — members' edits refused; click to show"}
                onclick={() => toggleGroupVisible(seg.group.id)}
              >
                {#if seg.group.visible}<Eye size={15} />{:else}<EyeOff size={15} />{/if}
              </button>
            </div>
            <!-- No padding here any more: a member's indent lives on the ROW (see `layerRow`), so
                 the row's border box starts at x=0 and its `.ui-selected` bar lands on the block's
                 rail instead of 13px inboard of it. -->
            <div class="group-members" class:hidden={seg.group.collapsed} use:membersSortable>
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
