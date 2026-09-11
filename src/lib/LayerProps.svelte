<script lang="ts">
  // The selected row's PROPERTIES — the per-layer controls that used to open as a second line
  // inside the selected row of the layer list (2026-09-11). Photoshop/Krita convention: one strip at
  // the top of the panel for whatever is selected, so list rows stay one line and never move under
  // the Pencil. It follows `workingTarget(activeRow)`: a layer (or its own track) → that layer, a
  // group (or its track) → the group, audio → a note. Everything below the target resolution was
  // MOVED here verbatim from LayerList.svelte, comments included; only the template is new.
  import { sliderFill } from "./slider-fill";
  import {
    Blend,
    Pencil,
    Link,
    Ungroup,
    Waves,
    ImageDown,
    Stamp,
    RotateCcw,
    Volume2,
    VolumeX,
    Save,
    SaveOff,
  } from "@lucide/svelte";
  import {
    state as appState,
    bump,
    repaint,
    relinkReference,
    rasterizeReference,
    ungroup,
    applyLayerTransform,
    resetLayerTransform,
    applyCellTransform,
    resetCellTransform,
    resetGroupTransform,
    toggleEmbedMedia,
    applyLayerOpacityAt,
    applyGroupOpacityAt,
    beginStructuralEdit,
    commitStructuralEdit,
    transformDragGuard,
    transformScope,
  } from "../state/appState.svelte";
  import type { StructSnapshot } from "../state/appState.svelte";
  import { workingTarget } from "../anim/active-row";
  import {
    groupOf,
    isLayerLocked,
    groupTransform,
    isIdentityTransform,
    cellTransform,
    frameEditKeyCell,
    layerTransformTrack,
    layerOpacityTrack,
    opacityAt,
    groupOpacityAt,
    groupHasLockedLayer,
    isLayerVisible,
  } from "../anim/document";
  import type { Layer, LayerGroup } from "../anim/document";
  import { loadReferenceMedia } from "../anim/reference";

  let {
    onRenameLayer,
    onRenameGroup,
  }: { onRenameLayer: (layer: Layer) => void; onRenameGroup: (group: LayerGroup) => void } =
    $props();

  const wt = $derived(workingTarget(appState.activeRow));
  const layer = $derived(
    wt.kind === "layer" ? (appState.project.layers.find((l) => l.id === wt.id) ?? null) : null,
  );
  const group = $derived(
    wt.kind === "group" ? (appState.project.groups.find((g) => g.id === wt.id) ?? null) : null,
  );

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

  // Show Apply/Reset when the layer transform, the active frame's resolved key cell transform,
  // or the containing group's transform is non-identity (draw layers only).
  function hasTransform(layer: Layer): boolean {
    if (layer.kind !== "draw") return false;
    // On an ANIMATED layer the static `transform` is retained but IGNORED, so it says nothing about
    // what is on screen — and Apply/Reset refuse on it anyway. The cell and group terms below are
    // unaffected: neither is driven by the track.
    if (!layerTransformTrack(layer) && !isIdentityTransform(layer.transform)) return true;
    const rk = frameEditKeyCell(layer, appState.playhead);
    if (rk && !isIdentityTransform(cellTransform(rk.cell))) return true;
    const g = groupOf(layer, appState.project.groups);
    // Same rule as the layer term above, one level out: an ANIMATED group's static transform is
    // retained but IGNORED, and Reset refuses on it — so it must not light this indicator or win
    // the scope dispatch below and offer an action that no-ops.
    return !!g && !g.tracks?.transform && !isIdentityTransform(groupTransform(g));
  }

  // Which transform Apply/Reset act on — always one that is actually non-identity. A GROUP row means
  // the group's; otherwise the layer's own, else a per-frame (cell) transform: no longer creatable
  // since Frame scope left the Transform bar (2026-09-11), but saved projects can still carry one and
  // must be able to bake or clear it.
  function activeTransformScope(layer: Layer): "frame" | "layer" | "group" | null {
    if (layer.kind !== "draw") return null;
    // Same reason as hasTransform: an animated layer's static transform is ignored, and Apply/Reset
    // refuse on it — so it must not win the scope dispatch and offer an action that no-ops.
    const layerNI = !layerTransformTrack(layer) && !isIdentityTransform(layer.transform);
    const rk = frameEditKeyCell(layer, appState.playhead);
    const cellNI = !!rk && !isIdentityTransform(cellTransform(rk.cell));
    const g = groupOf(layer, appState.project.groups);
    const groupNI = !!g && !g.tracks?.transform && !isIdentityTransform(groupTransform(g)); // see hasTransform
    if (!layerNI && !cellNI && !groupNI) return null;
    if (transformScope() === "group" && groupNI) return "group";
    if (layerNI) return "layer";
    if (cellNI) return "frame";
    return "group";
  }
</script>

<input
  bind:this={relinkInput}
  type="file"
  accept="image/*,video/*"
  class="hidden"
  onchange={onRelinkFile}
/>
<!-- Settings LEFT, actions RIGHT (`ml-auto`; Rename always last, for a layer and a group alike). Wraps
     on a narrow panel rather than clipping — the rule this strip inherited from the row it replaces.
     `min-h-8` so switching between a one-line target and an empty one does not move the list.
     `pl-2` keeps the first control abutting the panel's 8px resize grip, like the rows' drag handle.
     Each target is its own `{#key}`: a slider must UNMOUNT when the selection moves on, because its
     settle-on-unmount action is the backstop that closes an open opacity undo bracket. -->
<div
  class="flex min-h-8 flex-wrap items-center gap-1 border-b border-border pl-2 pr-1 py-1 text-text-secondary"
>
  {#if wt.kind === "audio"}
    <span class="text-xs text-text-muted">Audio — edit it in the timeline</span>
  {:else if layer}
    {#key layer.id}
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
      <!-- Slider + readout share one wrapper so they can never wrap apart, and so the title can live on
           an element that still receives pointer events when the slider itself is made inert. The
           icon identifies the slider WITHOUT text (no tooltips on iPad): Blend = opacity, Waves = boil. -->
      <span
        class="flex items-center gap-1"
        title={opacityInert
          ? "Opacity — animated, and the layer is locked or hidden, so its keys can't be edited"
          : opacityTrack
            ? `Opacity — animated; a change keys frame ${opacityFrame + 1}`
            : "Opacity"}
      >
        <Blend size={13} class="shrink-0" />
        <input
          use:settleOnUnmount={layer.id}
          style={sliderFill(opacityNow, 0, 100)}
          class="w-9 aria-disabled:opacity-40"
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
        />
        <!-- ROUNDED: between two keys the resolved value is fractional, and the w-6 readout is sized
             for "100". -->
        <span class="text-xs tabular-nums w-6 text-text-muted">{Math.round(opacityNow)}</span>
      </span>
      {#if layer.kind === "draw"}
        <!-- Icon + slider + readout in ONE wrapper, so boil can never wrap away from its own value. -->
        <span class="flex items-center gap-1" title="Line boil strength (this layer)">
          <Waves size={13} class="shrink-0" />
          <input
            class="w-9"
            type="range"
            min="0"
            max="1"
            step="0.05"
            bind:value={layer.boilStrength}
            oninput={bump}
            style={sliderFill(layer.boilStrength, 0, 1)}
          />
          <span class="text-xs tabular-nums w-6 text-text-muted"
            >{layer.boilStrength.toFixed(1)}</span
          >
        </span>
      {/if}
      {#if layer.kind === "ref" && layer.media.type === "video"}
        <!-- Per-clip settings: audio, embed, speed. -->
        <button
          class="text-text-secondary hover:text-text"
          onclick={() => {
            if (layer.kind !== "ref") return;
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
          onclick={() => void toggleEmbedMedia(layer.id)}
          title={layer.embedMedia
            ? "Video stored in project — survives reload & save"
            : "Video not stored — re-link after reload (tap to keep it)"}
        >
          {#if layer.embedMedia}<Save size={15} />{:else}<SaveOff size={15} />{/if}
        </button>
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
          />×
        </label>
      {/if}
      <span class="ml-auto flex items-center gap-1">
        {#if hasTransform(layer)}
          {#if activeTransformScope(layer) !== "group"}
            <button
              class="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-text-secondary hover:text-text hover:bg-surface-hover"
              title="Apply transform (bake to pixels)"
              onclick={() => {
                const scope = activeTransformScope(layer);
                if (scope === "frame") applyCellTransform(layer.id, appState.playhead);
                else applyLayerTransform(layer.id);
              }}><Stamp size={13} /> Apply</button
            >
          {/if}
          <button
            class="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-text-secondary hover:text-text hover:bg-surface-hover"
            title="Reset transform"
            onclick={() => {
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
        {#if layer.kind === "ref" && layer.media.type === "image"}
          <button
            class="text-text-secondary hover:text-text"
            title="Rasterize to drawing layer"
            onclick={() => rasterizeReference(layer.id)}><ImageDown size={13} /></button
          >
        {/if}
        {#if layer.kind === "ref" && layer.media.type === "missing"}
          <button
            class="text-text-secondary hover:text-text"
            title="Re-link media"
            onclick={() => startRelink(layer.id)}><Link size={13} /></button
          >
        {/if}
        <button
          class="text-text-secondary hover:text-text"
          title="Rename layer"
          onclick={() => onRenameLayer(layer)}><Pencil size={13} /></button
        >
      </span>
    {/key}
  {:else if group}
    {#key group.id}
      {@const gOpTrack = group.tracks?.opacity}
      {@const gOpFrame = groupOpacityFrameFor(group)}
      {@const gOpNow = groupOpacityAt(group, gOpFrame)}
      {@const gOpPinned = !!gOpTrack && groupHasLockedLayer(group, appState.project.layers)}
      <span
        class="flex items-center gap-1"
        title={gOpPinned
          ? "Group opacity — animated, and a locked member pins the group"
          : gOpTrack
            ? `Group opacity — animated; a change keys frame ${gOpFrame + 1}`
            : "Group opacity"}
      >
        <Blend size={13} class="shrink-0" />
        <input
          use:settleGroupOpacityOnUnmount={group.id}
          style={sliderFill(gOpNow, 0, 100)}
          class="w-9 aria-disabled:opacity-40"
          class:pointer-events-none={gOpPinned}
          aria-disabled={gOpPinned}
          type="range"
          min="0"
          max="100"
          value={gOpNow}
          oninput={(e) => onGroupOpacityInput(group.id, Number(e.currentTarget.value))}
          onchange={groupOpacityChange}
          onpointerup={settleGroupOpacityDrag}
          onpointercancel={settleGroupOpacityDrag}
          onkeydown={groupOpacityKeyDown}
          onkeyup={groupOpacityKeyUp}
          onblur={groupOpacityBlur}
        />
        <span class="text-xs tabular-nums w-6 text-text-muted">{Math.round(gOpNow)}</span>
      </span>
      <span class="ml-auto flex items-center gap-1">
        <button
          class="text-text-secondary hover:text-text"
          title="Ungroup"
          onclick={() => ungroup(group.id)}
        >
          <Ungroup size={14} />
        </button>
        <button
          class="text-text-secondary hover:text-text"
          title="Rename group"
          onclick={() => onRenameGroup(group)}
        >
          <Pencil size={13} />
        </button>
      </span>
    {/key}
  {/if}
</div>
