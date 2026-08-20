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
    selectGroup,
    isGroupDetailShown,
    toggleEmbedMedia,
    applyLayerOpacityAt,
    applyGroupOpacityAt,
    beginStructuralEdit,
    commitStructuralEdit,
    transformDragGuard,
  } from "../state/appState.svelte";
  import type { StructSnapshot } from "../state/appState.svelte";
  import { groupHeaderSelected } from "../anim/active-row";
  import {
    createDrawingLayer,
    nextLayerName,
    groupOf,
    isLayerLocked,
    groupTransform,
    isIdentityTransform,
    cellTransform,
    resolvedKeyCell,
    layerTransformTrack,
    layerOpacityTrack,
    opacityAt,
    groupOpacityAt,
    groupHasLockedLayer,
    isLayerVisible,
  } from "../anim/document";
  import type { Layer, LayerGroup } from "../anim/document";
  import { layerPanelActions } from "../anim/layer-panel-actions";
  import { loadReferenceMedia } from "../anim/reference";
  import { clampPanelWidth } from "../anim/panel-layout";

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
  /** Prior `transformDragGuard.settle` owner — restored on settle so we do not wipe a chained hook. */
  let opacitySettlePrev: (() => void) | null = null;
  /** Wrapper assigned to the shared settle slot; identity check never clears someone else's hook. */
  let opacitySettleHook: (() => void) | null = null;
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
    // Read the playhead FIRST, unconditionally. `opacityUndo`/`opacityUndoFrame` are plain `let`s,
    // not `$state`, so a short-circuiting ternary would drop `playhead` from the derived's
    // dependency set for the whole time a bracket is open — and it would never come back: after
    // that gesture released, scrubbing left this row's thumb and its "keys frame N" title pinned to
    // the grab frame until the row remounted, so the next nudge started from a thumb that was lying.
    const ph = appState.playhead;
    return opacityUndo && opacityUndoLayerId === layer.id ? opacityUndoFrame : ph;
  }

  function opacityKeyValue(layerId: number, frame: number): number | null {
    const l = appState.project.layers.find((x) => x.id === layerId);
    // Through the accessor, like every other opacity-track read — a leftover track on a REFERENCE
    // is inert, so this must not report a key the store's writers will refuse.
    const track = l && layerOpacityTrack(l);
    return track?.keys.find((k) => k.frame === frame)?.v ?? null;
  }

  function onOpacityInput(layer: Layer, value: number) {
    // A bracket may never span two layers. Every settle route below is bound to the SLIDER element,
    // and the slider lives inside `{#if active}` — so a row that unmounts mid-drag (a second contact
    // selecting another row, or the audio lane, which deselects every layer) fires none of them and
    // loses its implicit pointer capture. Without this the next layer's drag would inherit the open
    // bracket and write ITS keys to the abandoned gesture's layer id and frame.
    if (opacityUndo && opacityUndoLayerId !== layer.id) settleOpacityDrag();
    // The accessor, not the raw bag: on a reference carrying a leftover track from the previous
    // release the raw read took the key-writing branch, which wrote into a track `opacityAt`
    // ignores — no visible change, one undo entry per drag.
    if (!layerOpacityTrack(layer)) {
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
      // Chain the previous owner: the settle slot is shared by every undoable drag (gizmo, range,
      // hold-span, both opacity sliders). Replacing it would orphan an earlier open bracket.
      // The hook must also CALL through, not merely restore: a single `settle?.()` drains only the
      // slot it finds, so an outer bracket (a timeline range drag, reachable with a second contact
      // on iPad) survived the undo and its release then committed a pre-undo snapshot — exactly
      // what the guard exists to prevent. Every settle in the chain is idempotent (each guards on
      // its own open bracket), so calling through is safe.
      const prev = transformDragGuard.settle;
      opacitySettlePrev = prev;
      const hook = () => {
        settleOpacityDrag();
        if (transformDragGuard.settle === hook) transformDragGuard.settle = prev;
        prev?.();
      };
      opacitySettleHook = hook;
      transformDragGuard.settle = hook;
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
    if (transformDragGuard.settle === opacitySettleHook)
      transformDragGuard.settle = opacitySettlePrev;
    opacitySettleHook = null;
    opacitySettlePrev = null;
    if (!before || layerId === null) return;
    // Nothing net changed — dragged back onto the value the key already held, OR every write was
    // refused (locked/hidden layer, or a locked group) so no key exists where none did. Both are
    // one comparison: no `startV !== null` term, because that would skip the test in exactly the
    // refused case and push a `before === after` entry — a ⌘Z that visibly does nothing. A key
    // CREATED where there was none still commits, since a number never equals null.
    if (opacityKeyValue(layerId, frame) === startV) return;
    commitStructuralEdit(before);
  }

  /**
   * The unmount backstop, on the ELEMENT rather than on any cause of its removal.
   *
   * Every other settle route — `change`, `pointerup`, `pointercancel`, `keyup`, `blur` — is bound to
   * this input, and a removed element fires none of them and loses its implicit pointer capture. So
   * a slider that goes away mid-drag leaked its bracket, and the next drag inherited it and wrote to
   * the abandoned gesture's layer id and frame. The causes are plural and keep growing: the row's
   * `{#if active}` (a second contact selecting another layer, or the audio lane, which deselects
   * every layer), the list's `{#key dragNonce}` REBUILD after any SortableJS reorder drop — which
   * leaves `activeRow` untouched, so watching selection could not see it — and component teardown.
   * A `destroy` hook covers all of them and any future one, which an enumeration of causes cannot.
   */
  function settleOnUnmount(_node: HTMLElement, layerId: number) {
    return {
      destroy() {
        // Only OUR bracket: the guard costs nothing and keeps this honest if a second slider ever
        // renders (today only the active row has one).
        if (opacityUndoLayerId === layerId) settleOpacityDrag();
      },
    };
  }

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

  // --- Group opacity: labeled slider on the header (even when collapsed) -------------------------
  // Same apply/commit split as the layer slider. Static writes stay non-undoable (view-prop);
  // with a track, one undo entry per gesture. Lock-only when animated: a locked member pins the
  // group; the static slider stays writable when locked (matches the layer lock table).
  let groupOpacityUndo: StructSnapshot | null = null;
  let groupOpacityUndoGroupId: number | null = null;
  let groupOpacityUndoFrame = 0;
  let groupOpacityUndoStartV: number | null = null;
  let groupOpacityKeyHeld = false;
  let groupOpacitySettlePrev: (() => void) | null = null;
  let groupOpacitySettleHook: (() => void) | null = null;

  function groupOpacityFrameFor(group: LayerGroup): number {
    const ph = appState.playhead;
    return groupOpacityUndo && groupOpacityUndoGroupId === group.id ? groupOpacityUndoFrame : ph;
  }

  function groupOpacityKeyValue(groupId: number, frame: number): number | null {
    const g = appState.project.groups.find((x) => x.id === groupId);
    return g?.tracks?.opacity?.keys.find((k) => k.frame === frame)?.v ?? null;
  }

  function onGroupOpacityInput(groupId: number, value: number) {
    if (groupOpacityUndo && groupOpacityUndoGroupId !== groupId) settleGroupOpacityDrag();
    const g = appState.project.groups.find((x) => x.id === groupId);
    if (!g) return;
    if (!g.tracks?.opacity) {
      applyGroupOpacityAt(groupId, appState.playhead, value);
      return;
    }
    if (!groupOpacityUndo) {
      groupOpacityUndo = beginStructuralEdit();
      groupOpacityUndoGroupId = groupId;
      groupOpacityUndoFrame = appState.playhead;
      groupOpacityUndoStartV = groupOpacityKeyValue(groupId, groupOpacityUndoFrame);
      // Same shared-slot chain as the layer slider — restore the previous owner AND call through,
      // or one settle drains only the innermost bracket and leaves the outer one open.
      const prev = transformDragGuard.settle;
      groupOpacitySettlePrev = prev;
      const hook = () => {
        settleGroupOpacityDrag();
        if (transformDragGuard.settle === hook) transformDragGuard.settle = prev;
        prev?.();
      };
      groupOpacitySettleHook = hook;
      transformDragGuard.settle = hook;
    }
    applyGroupOpacityAt(groupId, groupOpacityUndoFrame, value);
  }

  function settleGroupOpacityDrag() {
    const before = groupOpacityUndo;
    const groupId = groupOpacityUndoGroupId;
    const frame = groupOpacityUndoFrame;
    const startV = groupOpacityUndoStartV;
    groupOpacityUndo = null;
    groupOpacityUndoGroupId = null;
    groupOpacityUndoStartV = null;
    if (transformDragGuard.settle === groupOpacitySettleHook) {
      transformDragGuard.settle = groupOpacitySettlePrev;
    }
    groupOpacitySettleHook = null;
    groupOpacitySettlePrev = null;
    if (!before || groupId === null) return;
    if (groupOpacityKeyValue(groupId, frame) === startV) return;
    commitStructuralEdit(before);
  }

  function settleGroupOpacityOnUnmount(_node: HTMLElement, groupId: number) {
    return {
      destroy() {
        if (groupOpacityUndoGroupId === groupId) settleGroupOpacityDrag();
      },
    };
  }

  function groupOpacityKeyDown(e: KeyboardEvent) {
    if (RANGE_KEYS.has(e.key)) groupOpacityKeyHeld = true;
  }
  function groupOpacityKeyUp() {
    groupOpacityKeyHeld = false;
    settleGroupOpacityDrag();
  }
  function groupOpacityChange() {
    if (!groupOpacityKeyHeld) settleGroupOpacityDrag();
  }
  function groupOpacityBlur() {
    groupOpacityKeyHeld = false;
    settleGroupOpacityDrag();
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
      {@const opacityTrack = layerOpacityTrack(layer)}
      {@const opacityFrame = opacityFrameFor(layer)}
      {@const opacityNow = opacityAt(layer, opacityFrame)}
      {@const opacityOk = opacityEditable(layer)}
      <!-- A LOCKED or hidden layer keeps its STATIC opacity editable (a lock protects content, not
           organization), but the store's key writers refuse it — so an ANIMATED one is dimmed rather
           than silently swallowing drags. -->
      {@const opacityInert = !!opacityTrack && !opacityOk}
      <!-- Wraps rather than clipping: the panel is DRAG-RESIZABLE (panel-layout.ts, default 224px)
           and this row keeps gaining controls, so wrap is what makes both safe — a narrower panel
           takes another line instead of clipping. Sizes are tuned so a DRAW layer stays on one line
           at the default width; a video ref flows onto a second. -->
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
            use:settleOnUnmount={layer.id}
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
    <button
      class="size-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent"
      title={panel.group.title}
      aria-disabled={!panel.group.enabled}
      onclick={() => {
        if (panel.group.enabled) groupActiveLayer();
      }}><FolderPlus size={16} /></button
    >
    <button
      class="size-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent"
      title={panel.remove.title}
      aria-disabled={!panel.remove.enabled}
      onclick={() => {
        if (panel.remove.enabled && panel.layerId != null) removeLayer(panel.layerId);
      }}><Trash2 size={16} /></button
    >
  </div>

  <div bind:this={listEl} class="flex-1 overflow-y-auto pl-1">
    {#key dragNonce}
      {#each buildSegments(appState.project.layers, appState.project.groups) as seg ("layer" in seg ? `l${seg.layer.id}` : `g${seg.group.id}`)}
        {#if "layer" in seg}
          {@render layerRow(seg.layer)}
        {:else}
          {@const groupDetail = isGroupDetailShown(seg.group.id)}
          {@const groupLit = groupHeaderSelected(
            appState.activeRow,
            seg.group,
            appState.project.layers,
          )}
          <div class="group-block border-b border-border-light" data-group-id={seg.group.id}>
            <div
              class="flex items-center gap-1 p-1 hover:bg-surface-hover"
              class:bg-surface-active={groupLit}
              role="presentation"
            >
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
                <button
                  class="min-w-0 flex-1 truncate text-left text-xs font-semibold"
                  title="Select group"
                  onclick={() => selectGroup(seg.group.id)}>{seg.group.name}</button
                >
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
            <!-- Same rule as a layer's Row 2: detail controls only for the group you're on
                 (a member selected, or this group's own track). Always-on looked like selection. -->
            {#if groupDetail}
              {@const gOpTrack = seg.group.tracks?.opacity}
              {@const gOpFrame = groupOpacityFrameFor(seg.group)}
              {@const gOpNow = groupOpacityAt(seg.group, gOpFrame)}
              {@const gOpPinned =
                !!gOpTrack && groupHasLockedLayer(seg.group, appState.project.layers)}
              <div
                class="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 pb-1 text-text-secondary"
                class:bg-surface-active={groupLit}
              >
                <span
                  class="flex items-center gap-2"
                  title={gOpPinned
                    ? "Group opacity — animated, and a locked member pins the group"
                    : gOpTrack
                      ? `Group opacity — animated; a change keys frame ${gOpFrame + 1}`
                      : "Group opacity"}
                >
                  <span class="text-xs text-text-muted">Group</span>
                  <input
                    use:settleGroupOpacityOnUnmount={seg.group.id}
                    class="w-12 aria-disabled:opacity-40"
                    class:pointer-events-none={gOpPinned}
                    aria-disabled={gOpPinned}
                    type="range"
                    min="0"
                    max="100"
                    value={gOpNow}
                    oninput={(e) =>
                      onGroupOpacityInput(seg.group.id, Number(e.currentTarget.value))}
                    onchange={groupOpacityChange}
                    onpointerup={settleGroupOpacityDrag}
                    onpointercancel={settleGroupOpacityDrag}
                    onkeydown={groupOpacityKeyDown}
                    onkeyup={groupOpacityKeyUp}
                    onblur={groupOpacityBlur}
                    onclick={(e) => e.stopPropagation()}
                  />
                  <span class="text-xs tabular-nums w-6 text-text-muted">{Math.round(gOpNow)}</span>
                </span>
              </div>
            {/if}
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
