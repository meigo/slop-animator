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
    Volume2,
    VolumeX,
    Save,
    SaveOff,
    Lock,
    LockOpen,
  } from "@lucide/svelte";
  import {
    state as appState,
    bump,
    repaint,
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
    toggleGroupLocked,
    renameGroup,
    reorderLayersWithGroups,
    applyLayerTransform,
    resetLayerTransform,
    applyCellTransform,
    resetCellTransform,
    resetGroupTransform,
    setActiveLayer,
    isRowSelected,
    toggleEmbedMedia,
    animateLayerOpacity,
    removeLayerOpacityAnimation,
    applyLayerOpacityAt,
    beginStructuralEdit,
    commitStructuralEdit,
    transformDragGuard,
  } from "../state/appState.svelte";
  import type { StructSnapshot } from "../state/appState.svelte";
  import {
    createDrawingLayer,
    nextLayerName,
    groupOf,
    isLayerLocked,
    groupTransform,
    isIdentityTransform,
    cellTransform,
    resolvedKeyCell,
    canRemoveLayer,
    canDuplicateLayer,
    whyNotMergeDown,
    layerTransformTrack,
    opacityAt,
    isLayerVisible,
  } from "../anim/document";
  import type { Layer, MergeDownBlock } from "../anim/document";
  import { loadReferenceMedia } from "../anim/reference";
  import { clampPanelWidth } from "../anim/panel-layout";
  import TrackKeyControls from "./TrackKeyControls.svelte";

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
    relinkReference(id, await loadReferenceMedia(file, () => repaint()), file);
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

  // --- Opacity: the slider IS the keying control -------------------------------------------------
  // The property's existing control is its gizmo (spec): a transform key comes from dragging the
  // gizmo, an opacity key from dragging this slider. With no track it keeps writing `layer.opacity`
  // exactly as before (not undoable, like visibility and boil strength); with a track it writes a
  // key at the playhead instead.
  //
  // The gesture brackets its OWN undo. A range input fires `input` per pixel of travel, so a
  // self-committing write would push ~100 entries for one drag and evict the whole 50-command
  // history — the same flood the animation-length drag was fixed for (2026-08-16). Snapshot at the
  // first write, live-write through `applyLayerOpacityAt` (no history), commit once at settle.
  let opacityUndo: StructSnapshot | null = null;
  let opacityUndoLayerId: number | null = null;
  /** The frame the bracket was OPENED on. Every write of the gesture goes there and the settle test
   *  reads there, rather than re-reading `appState.playhead`: both transform drag sites capture a
   *  grab-time `keyFrame` for the same reason (a held drag keys its GRAB frame, which is what
   *  `transformDragFrame` publishes). Re-reading would scatter keys across frames while playback
   *  runs, and — worse — make the settle compare the grab frame's before-value against a DIFFERENT
   *  frame's key, so a coincidental match would drop a bracket whose writes had already landed,
   *  leaving them permanently un-undoable. */
  let opacityUndoFrame = 0;
  /** The key sitting on that frame when the bracket opened, or null when there was none — the no-op
   *  test at settle. A drag out and back onto a pre-existing key's own value changes nothing, and an
   *  undo entry that visibly does nothing is worse than none. */
  let opacityUndoStartV: number | null = null;
  /** A range key is held down. Auto-repeat runs at ~30 Hz and fires `change` PER repeat, so a
   *  two-second hold would push ~60 entries and evict the stack by the other door — the very flood
   *  the non-committing writer exists to prevent. One held run is one gesture, so `change` defers to
   *  `keyup` while this is set. A single tap still settles immediately, on its own keyup. */
  let opacityKeyHeld = false;
  /** The keys a range input responds to. Anything else (Tab, modifiers) must NOT latch the flag, or
   *  tabbing away would leave it set with the keyup delivered to another element. */
  const RANGE_KEYS = new Set([
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "PageUp",
    "PageDown",
    "Home",
    "End",
  ]);

  /** The frame this layer's opacity controls are TALKING ABOUT: the bracket's grab frame while a
   *  gesture is open, else the playhead. Every write of a gesture goes to `opacityUndoFrame`, so
   *  reading the live playhead for the title and the thumb made both lie the moment playback moved
   *  it — the title named a frame nothing would be written to, and the thumb jumped to the resolved
   *  value at the new frame, fighting the pointer. `transformDragFrame` freezes the transform drags
   *  for the same reason. */
  function opacityFrameFor(layer: Layer): number {
    return opacityUndo && opacityUndoLayerId === layer.id ? opacityUndoFrame : appState.playhead;
  }

  function opacityKeyValue(layerId: number, frame: number): number | null {
    const l = appState.project.layers.find((x) => x.id === layerId);
    return l?.tracks?.opacity?.keys.find((k) => k.frame === frame)?.v ?? null;
  }

  function onOpacityInput(layer: Layer, value: number) {
    // A bracket may never span two layers. Every settle route below is bound to the SLIDER element,
    // and the slider lives inside `{#if active}` — so a row that unmounts mid-drag (a second contact
    // selecting another row, or the audio lane, which deselects every layer) fires none of them and
    // loses its implicit pointer capture. Without this the next layer's drag would inherit the open
    // bracket and write ITS keys to the abandoned gesture's layer id and frame.
    if (opacityUndo && opacityUndoLayerId !== layer.id) settleOpacityDrag();
    if (!layer.tracks?.opacity) {
      layer.opacity = value; // static: unchanged behaviour, straight assignment + repaint
      bump();
      return;
    }
    if (!opacityUndo) {
      opacityUndo = beginStructuralEdit();
      opacityUndoLayerId = layer.id;
      opacityUndoFrame = appState.playhead;
      opacityUndoStartV = opacityKeyValue(layer.id, opacityUndoFrame);
      // Undo/redo and Open settle an open bracket before they run — without this a ⌘Z mid-drag
      // would leave it open and the release would commit a snapshot of the pre-undo document.
      transformDragGuard.settle = settleOpacityDrag;
    }
    applyLayerOpacityAt(layer.id, opacityUndoFrame, value);
  }

  /** Idempotent (it guards on an open bracket), which is why the slider can bind it to `change`,
   *  `pointerup`, `pointercancel`, `keyup` AND `blur`: `change` does not fire when a drag ends back
   *  on the value it started from, a cancelled pointer fires neither, and a held-key run must settle
   *  once at `keyup` rather than per repeat. */
  function settleOpacityDrag() {
    const before = opacityUndo;
    const layerId = opacityUndoLayerId;
    const frame = opacityUndoFrame;
    const startV = opacityUndoStartV;
    opacityUndo = null;
    opacityUndoLayerId = null;
    opacityUndoStartV = null;
    if (transformDragGuard.settle === settleOpacityDrag) transformDragGuard.settle = null;
    if (!before || layerId === null) return;
    // Nothing net changed — dragged back onto the value the key already held, OR every write was
    // refused (locked/hidden layer, or a locked group) so no key exists where none did. Both are
    // one comparison: no `startV !== null` term, because that would skip the test in exactly the
    // refused case and push a `before === after` entry — a ⌘Z that visibly does nothing. A key
    // CREATED where there was none still commits, since a number never equals null.
    if (opacityKeyValue(layerId, frame) === startV) return;
    commitStructuralEdit(before);
  }

  /** The unmount backstop. `settleOpacityDrag` is reachable only through the slider's own events,
   *  which a removed element never fires — so the ROW's selection is watched instead: the slider
   *  exists exactly while its layer is the selected row, and `activeRow` becoming any other layer
   *  (or the audio lane, which selects no layer at all) is precisely the moment it goes away. The
   *  bracket then commits or drops on its own terms rather than leaking into the next gesture.
   *  Nothing else narrows that window: `seekPlayhead`, `setActiveLayer` and `commitStructural` all
   *  leave `transformDragGuard` alone, and only undo/redo/Open and the Canvas tool effect settle it. */
  $effect(() => {
    const id = appState.activeRow.kind === "layer" ? appState.activeRow.id : null;
    if (opacityUndoLayerId !== null && opacityUndoLayerId !== id) settleOpacityDrag();
  });

  function opacityKeyDown(e: KeyboardEvent) {
    if (RANGE_KEYS.has(e.key)) opacityKeyHeld = true;
  }
  function opacityKeyUp() {
    opacityKeyHeld = false;
    settleOpacityDrag();
  }
  /** `change` settles the POINTER path immediately; during a held-key run it defers to `keyup`. */
  function opacityChange() {
    if (!opacityKeyHeld) settleOpacityDrag();
  }
  /** Backstop: focus can leave mid-hold (a click elsewhere), and then no `keyup` ever arrives here. */
  function opacityBlur() {
    opacityKeyHeld = false;
    settleOpacityDrag();
  }

  /** Whether the opacity controls can act: the same lock/hidden guard the store actions apply, so a
   *  refusal is shown (dimmed, with a reason) rather than discovered by pressing. */
  function opacityEditable(layer: Layer): boolean {
    return (
      !isLayerLocked(layer, appState.project.groups) &&
      isLayerVisible(layer, appState.project.groups)
    );
  }

  // A button that silently no-ops explains nothing, so the three actions that can refuse dim and say
  // why. aria-disabled (not disabled) per the app-wide rule: a disabled button dispatches no pointer
  // events, so App.svelte's delegated status-hint listener could never read the title — and on iPad
  // there is no hover at all. The predicates are the same ones the actions themselves guard on.
  const canDelete = $derived(canRemoveLayer(appState.project.layers, appState.activeLayerId));
  const canDuplicate = $derived(canDuplicateLayer(appState.project.layers, appState.activeLayerId));
  const mergeBlock = $derived(
    whyNotMergeDown(appState.project.layers, appState.project.groups, appState.activeLayerId),
  );
  const MERGE_BLOCK_REASON: Record<MergeDownBlock, string> = {
    "no-layer-below": "no layer below to merge into",
    "not-drawing": "only drawing layers can be merged",
    "read-only": "a layer is locked or hidden",
    animated: "a layer is animated — Stop animating first",
  };
  const mergeTitle = $derived(
    mergeBlock ? `Merge down — ${MERGE_BLOCK_REASON[mergeBlock]}` : "Merge down",
  );

  // Show Apply/Reset when the layer transform, the active frame's resolved key cell transform,
  // or the containing group's transform is non-identity (draw layers only).
  function hasTransform(layer: Layer): boolean {
    if (layer.kind !== "draw") return false;
    // On an ANIMATED layer the static `transform` is retained but IGNORED, so it says nothing about
    // what is on screen — and Apply/Reset refuse on it anyway. The cell and group terms below are
    // unaffected: neither is driven by the track.
    if (!layerTransformTrack(layer) && !isIdentityTransform(layer.transform)) return true;
    const rk = resolvedKeyCell(layer, appState.playhead);
    if (rk && !isIdentityTransform(cellTransform(rk.cell))) return true;
    const g = groupOf(layer, appState.project.groups);
    // Same rule as the layer term above, one level out: an ANIMATED group's static transform is
    // retained but IGNORED, and Reset refuses on it — so it must not light this indicator or win
    // the scope dispatch below and offer an action that no-ops.
    return !!g && !g.tracks?.transform && !isIdentityTransform(groupTransform(g));
  }

  // Act on whichever transform is actually non-identity; when multiple are, the scope toggle decides.
  // (Avoids the case where the toggle says "Frame" but only the layer transform is set → no-op.)
  function activeTransformScope(layer: Layer): "frame" | "layer" | "group" | null {
    if (layer.kind !== "draw") return null;
    // Same reason as hasTransform: an animated layer's static transform is ignored, and Apply/Reset
    // refuse on it — so it must not win the scope dispatch and offer an action that no-ops.
    const layerNI = !layerTransformTrack(layer) && !isIdentityTransform(layer.transform);
    const rk = resolvedKeyCell(layer, appState.playhead);
    const cellNI = !!rk && !isIdentityTransform(cellTransform(rk.cell));
    const g = groupOf(layer, appState.project.groups);
    const groupNI = !!g && !g.tracks?.transform && !isIdentityTransform(groupTransform(g)); // see hasTransform
    if (!layerNI && !cellNI && !groupNI) return null;
    // Honour the active toolbar scope when it points at a non-identity transform.
    if (appState.transformScope === "frame" && cellNI) return "frame";
    if (appState.transformScope === "layer" && layerNI) return "layer";
    if (appState.transformScope === "group" && groupNI) return "group";
    // Tiebreak: whichever is non-identity (frame > layer > group).
    if (cellNI) return "frame";
    if (layerNI) return "layer";
    return "group";
  }

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
  <!-- One question, one value: `isRowSelected` is the whole answer, so this panel and the timeline
       gutter cannot disagree about what is selected. Also gates the Row 2 detail strip — nothing
       layer-ish is selected while the audio lane is, and one click restores it. The draw target does
       not go missing: the status bar names the active layer independently of any highlight. -->
  {@const active = isRowSelected(layer.id)}
  <div
    data-layer-id={layer.id}
    class="border-b border-border-light cursor-pointer hover:bg-surface-hover"
    class:bg-surface-active={active}
    onclick={() => setActiveLayer(layer.id)}
    role="presentation"
  >
    <!-- Row 1: compact (every layer) -->
    <div class="flex items-center gap-1 p-1">
      <span class="layer-drag-handle cursor-grab text-text-muted" title="Drag to reorder"
        ><GripVertical size={14} /></span
      >
      <button
        class={layer.visible ? "text-text-muted hover:text-text" : "text-amber-500"}
        title={layer.visible ? "Visible — click to hide" : "Hidden — edits refused; click to show"}
        onclick={(e) => {
          e.stopPropagation();
          layer.visible = !layer.visible;
          bump();
        }}
      >
        {#if layer.visible}<Eye size={15} />{:else}<EyeOff size={15} />{/if}
      </button>
      <button
        class={isLayerLocked(layer, appState.project.groups)
          ? "text-amber-500"
          : "text-text-muted hover:text-text"}
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
      {#if layer.kind === "ref"}
        {@const t = layer.media.type === "missing" ? layer.media.was : layer.media.type}
        <span
          class="shrink-0"
          class:text-text-muted={layer.media.type === "missing"}
          class:text-text-secondary={layer.media.type !== "missing"}
          title={layer.media.type === "missing"
            ? "Missing — re-link below"
            : `${t} reference — a guide only, not included in exports`}
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
      <!-- Reads through `opacityAt`, never the raw field: on an animated layer the static number is
           retained but IGNORED, so a slider bound to it would sit still while the drawing faded. -->
      {@const opacityTrack = layer.tracks?.opacity}
      {@const opacityFrame = opacityFrameFor(layer)}
      {@const opacityNow = opacityAt(layer, opacityFrame)}
      {@const opacityOk = opacityEditable(layer)}
      <!-- A LOCKED or hidden layer keeps its STATIC opacity editable (a lock protects content, not
           organization), but the store's key writers refuse it — so an ANIMATED one is dimmed rather
           than silently swallowing drags. -->
      {@const opacityInert = !!opacityTrack && !opacityOk}
      <!-- Wraps rather than clipping: the panel is a fixed w-56 and this row keeps gaining controls.
           Sizes are tuned so a DRAW layer stays on one line; a video ref flows onto a second. -->
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 pl-2 pr-1 pb-1 text-text-secondary">
        <!-- Slider + readout share one wrapper so they can never wrap apart — and so the title can
             live on an element that still receives pointer events when the slider itself is made
             inert, the same split ToolOptions' Ease control uses. -->
        <span
          class="flex items-center gap-2"
          title={opacityInert
            ? "Opacity — animated, and the layer is locked or hidden, so its keys can't be edited"
            : opacityTrack
              ? `Opacity — animated; a change keys frame ${opacityFrame + 1}`
              : "Opacity"}
        >
          <input
            class="w-12 aria-disabled:opacity-40"
            class:pointer-events-none={opacityInert}
            aria-disabled={opacityInert}
            type="range"
            min="0"
            max="100"
            value={opacityNow}
            oninput={(e) => onOpacityInput(layer, Number(e.currentTarget.value))}
            onchange={opacityChange}
            onpointerup={settleOpacityDrag}
            onpointercancel={settleOpacityDrag}
            onkeydown={opacityKeyDown}
            onkeyup={opacityKeyUp}
            onblur={opacityBlur}
            onclick={(e) => e.stopPropagation()}
          />
          <!-- ROUNDED: between two keys the resolved value is fractional, and the w-6 readout is
               sized for "100". The slider itself takes the raw number and the browser snaps it to
               the step. -->
          <span class="text-xs tabular-nums w-6 text-text-muted">{Math.round(opacityNow)}</span>
        </span>
        <!-- The Animate entry point sits HERE rather than in ToolOptions because opacity is not a
             tool — its control lives in this panel, so its keying switch does too. aria-disabled,
             never `disabled`: a disabled control dispatches no pointer events, so the status bar's
             delegated listener could never read the title explaining the refusal, and on iPad a tap
             is the only route to that explanation. -->
        {#if !opacityTrack}
          <button
            class="rounded border border-border px-1.5 py-0.5 text-xs text-text-secondary hover:text-text hover:bg-surface-hover aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent"
            aria-disabled={!opacityOk}
            title={opacityOk
              ? "Animate opacity — the current value becomes a key at frame 0"
              : "Animate opacity — the layer is locked or hidden"}
            onclick={(e) => {
              e.stopPropagation();
              if (opacityOk) animateLayerOpacity(layer.id);
            }}>Animate</button
          >
        {:else}
          <!-- The SAME key controls the tool bar shows for a transform track — one component, so an
               opacity key can be deleted and its segment set to `hold` (the spec's way to get a hard
               cut rather than a fade) without a second copy of this markup drifting from the first.
               `compact` matches this row's button sizing; Copy/Paste are transform-only and are not
               asked for. The row deliberately `flex-wrap`s, so these wrap onto another line in the
               fixed-width panel rather than clipping. -->
          <TrackKeyControls
            trackRef={{ owner: "layer", id: layer.id, prop: "opacity" }}
            compact
            blocked={opacityOk ? null : "the layer is locked or hidden"}
          />
          <button
            class="rounded border border-border px-1.5 py-0.5 text-xs text-text-secondary hover:text-text hover:bg-surface-hover aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent"
            aria-disabled={!opacityOk}
            title={opacityOk
              ? "Stop animating opacity — keeps the value you can see now"
              : "Stop animating opacity — the layer is locked or hidden"}
            onclick={(e) => {
              e.stopPropagation();
              if (opacityOk) removeLayerOpacityAnimation(layer.id);
            }}>Stop animating</button
          >
        {/if}
        <!-- Video-only toggles live here, not in Row 1: they are per-clip settings you adjust on the
             layer you're working on, and four icons before the name left no room for it (2026-08-11).
             Row 1 keeps only what you scan ACROSS layers: visibility, lock, type. -->
        {#if layer.kind === "ref" && layer.media.type === "video"}
          <button
            class="text-text-secondary hover:text-text"
            onclick={(e) => {
              e.stopPropagation();
              layer.audioEnabled = !layer.audioEnabled;
              if (layer.media.type === "video") layer.media.el.muted = !layer.audioEnabled;
              bump();
            }}
            title={layer.audioEnabled
              ? "Audio on — click to mute"
              : "Audio off — click to play video sound"}
          >
            {#if layer.audioEnabled}<Volume2 size={15} />{:else}<VolumeX size={15} />{/if}
          </button>
          <button
            class="text-text-secondary hover:text-text"
            onclick={(e) => {
              e.stopPropagation();
              void toggleEmbedMedia(layer.id);
            }}
            title={layer.embedMedia
              ? "Video stored in project — survives reload & save"
              : "Video not stored — re-link after reload (tap to keep it)"}
          >
            {#if layer.embedMedia}<Save size={15} />{:else}<SaveOff size={15} />{/if}
          </button>
        {/if}
        {#if layer.kind === "draw"}
          <input
            class="w-12"
            type="range"
            min="0"
            max="1"
            step="0.05"
            bind:value={layer.boilStrength}
            oninput={bump}
            onclick={(e) => e.stopPropagation()}
            title="Line boil strength (this layer)"
          />
          <span class="text-xs tabular-nums w-6 text-text-muted"
            >{layer.boilStrength.toFixed(1)}</span
          >
        {/if}
        <button
          class="text-text-secondary hover:text-text"
          title="Rename layer"
          onclick={(e) => {
            e.stopPropagation();
            startEdit(layer);
          }}><Pencil size={13} /></button
        >
        {#if layer.kind === "ref" && layer.media.type === "video"}
          <label
            class="flex items-center gap-1 text-xs text-text-muted"
            title="Playback speed (× real time)"
          >
            speed
            <input
              class="w-9 text-xs bg-surface border border-border px-0.5 text-text"
              type="number"
              step="0.1"
              min="0.1"
              max="8"
              bind:value={layer.speed}
              oninput={bump}
              onclick={(e) => e.stopPropagation()}
            />×
          </label>
        {/if}
        {#if layer.kind === "ref" && layer.media.type === "missing"}
          <button
            class="text-text-secondary hover:text-text"
            title="Re-link media"
            onclick={(e) => {
              e.stopPropagation();
              startRelink(layer.id);
            }}><Link size={13} /></button
          >
        {/if}
        {#if layer.kind === "ref" && layer.media.type === "image"}
          <button
            class="text-text-secondary hover:text-text"
            title="Rasterize to drawing layer"
            onclick={(e) => {
              e.stopPropagation();
              rasterizeReference(layer.id);
            }}><ImageDown size={13} /></button
          >
        {/if}
        {#if hasTransform(layer)}
          {#if activeTransformScope(layer) !== "group"}
            <button
              class="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-text-secondary hover:text-text hover:bg-surface-hover"
              title="Apply transform (bake to pixels)"
              onclick={(e) => {
                e.stopPropagation();
                const scope = activeTransformScope(layer);
                if (scope === "frame") applyCellTransform(layer.id, appState.playhead);
                else applyLayerTransform(layer.id);
              }}><Stamp size={13} /> Apply</button
            >
          {/if}
          <button
            class="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-text-secondary hover:text-text hover:bg-surface-hover"
            title="Reset transform"
            onclick={(e) => {
              e.stopPropagation();
              const scope = activeTransformScope(layer);
              if (scope === "frame") {
                resetCellTransform(layer.id, appState.playhead);
              } else if (scope === "group") {
                const g = groupOf(layer, appState.project.groups);
                if (g) resetGroupTransform(g.id);
              } else {
                resetLayerTransform(layer.id);
              }
            }}><RotateCcw size={13} /> Reset</button
          >
        {/if}
      </div>
    {/if}
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
  <input
    bind:this={relinkInput}
    type="file"
    accept="image/*,video/*"
    class="hidden"
    onchange={onRelinkFile}
  />
  <!-- The grip's strip is reserved on BOTH direct children (the header's own `p-1`, and `pl-1` on the
       list), never on the panel root: padding the root would inset the header's bottom border too and
       leave it short of the left edge. 4px there plus each row's own 4px `p-1` puts the drag-handle
       icon at 8px — exactly where the 8px grip ends, so the two abut without overlapping and no
       space is wasted between them. -->
  <div class="flex items-center gap-1 p-1 border-b border-border">
    <span class="text-xs font-semibold text-text-secondary flex-1 px-1">Layers</span>
    <button
      class="size-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary"
      title="Add layer"
      onclick={addLayer}><Plus size={16} /></button
    >
    <button
      class="size-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent"
      title={canDuplicate ? "Duplicate layer" : "Duplicate layer — only drawing layers duplicate"}
      aria-disabled={!canDuplicate}
      onclick={() => {
        if (canDuplicate) duplicateLayer(appState.activeLayerId);
      }}><Copy size={16} /></button
    >
    <button
      class="size-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent"
      title={mergeTitle}
      aria-disabled={!!mergeBlock}
      onclick={() => {
        if (!mergeBlock) mergeDown(appState.activeLayerId);
      }}><ArrowDownToLine size={16} /></button
    >
    <button
      class="size-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary"
      title="New group"
      onclick={groupActiveLayer}><FolderPlus size={16} /></button
    >
    <button
      class="size-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent"
      title={canDelete
        ? "Delete layer"
        : "Delete layer — a project needs at least one drawing layer"}
      aria-disabled={!canDelete}
      onclick={() => {
        if (canDelete) removeLayer(appState.activeLayerId);
      }}><Trash2 size={16} /></button
    >
  </div>

  <div bind:this={listEl} class="flex-1 overflow-y-auto pl-1">
    {#key dragNonce}
      {#each buildSegments(appState.project.layers, appState.project.groups) as seg ("layer" in seg ? `l${seg.layer.id}` : `g${seg.group.id}`)}
        {#if "layer" in seg}
          {@render layerRow(seg.layer)}
        {:else}
          <div class="group-block border-b border-border-light" data-group-id={seg.group.id}>
            <div class="flex items-center gap-1 p-1 bg-surface-hover" role="presentation">
              <button
                class="text-text-secondary hover:text-text"
                title="Collapse group"
                onclick={() => toggleGroupCollapsed(seg.group.id)}
              >
                {#if seg.group.collapsed}<ChevronRight size={15} />{:else}<ChevronDown
                    size={15}
                  />{/if}
              </button>
              <button
                class={seg.group.visible ? "text-text-muted hover:text-text" : "text-amber-500"}
                title={seg.group.visible
                  ? "Group visible — click to hide"
                  : "Group hidden — members' edits refused; click to show"}
                onclick={() => toggleGroupVisible(seg.group.id)}
              >
                {#if seg.group.visible}<Eye size={15} />{:else}<EyeOff size={15} />{/if}
              </button>
              <button
                class={seg.group.locked ? "text-amber-500" : "text-text-muted hover:text-text"}
                title={seg.group.locked
                  ? "Group locked — click to unlock (members keep their own locks)"
                  : "Unlocked — click to lock every layer in this group"}
                onclick={() => toggleGroupLocked(seg.group.id)}
              >
                {#if seg.group.locked}<Lock size={15} />{:else}<LockOpen size={15} />{/if}
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
                  class="text-text-secondary hover:text-text"
                  title="Rename group"
                  onclick={() => startGroupEdit(seg.group)}
                >
                  <Pencil size={13} />
                </button>
              {/if}
              <button
                class="text-text-secondary hover:text-text"
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
