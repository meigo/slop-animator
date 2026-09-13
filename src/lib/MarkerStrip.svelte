<script lang="ts">
  import { Flag, Plus, Trash2 } from "@lucide/svelte";
  import { untrack } from "svelte";
  import {
    state as appState,
    addMarkerAtPlayhead,
    renameMarkerAt,
    deleteMarkerAt,
    moveMarkerTo,
    seekPlayhead,
    markerActions,
  } from "../state/appState.svelte";
  import { markerAt } from "../anim/markers";
  import { moveCancelPx } from "./timeline-grid";
  import { clickOutside } from "./click-outside";

  // Grid metrics and gestures passed from Timeline, exactly as AudioLane takes them, so the strip's
  // columns line up with the rows and a finger pans the same scroller.
  let {
    cellW,
    labelW,
    markerW,
    minWidth = 0,
    playRange,
    onTouchDown,
    onTouchMove,
    onTouchUp,
    onEdgeScrollStart,
    onEdgeScrollStop,
    onEdgePointerX,
  }: {
    cellW: number;
    labelW: number;
    markerW: number;
    minWidth?: number;
    /** The effective play range, for this strip's slice of the range lines (null = no range). */
    playRange: { start: number; end: number } | null;
    onTouchDown: (e: PointerEvent) => void;
    onTouchMove: (e: PointerEvent) => boolean;
    /** Takes the event so a `pointercancel` does not fling (see Timeline's touchPanUp). */
    onTouchUp: (e?: PointerEvent) => void;
    onEdgeScrollStart: (apply: (clientX: number) => void, owner: string) => void;
    onEdgeScrollStop: (owner: string) => void;
    onEdgePointerX: (clientX: number) => void;
  } = $props();

  const DRAG_OWNER = "marker-drag";

  /** Markers inside the document. `frameCount` can drop below a marker outside the length tools
   *  (it is re-derived from the cells), and those are hidden here rather than deleted — deleting
   *  outside an undoable edit would be a silent data change. */
  const shown = $derived(
    (appState.project.markers ?? []).filter((m) => m.frame < appState.project.frameCount),
  );

  let frameAreaEl: HTMLDivElement | undefined = $state();

  // ── Tap / drag ───────────────────────────────────────────────────────────────────────────────
  // The document is NOT touched during a drag: `dragFrame` is a preview, and one moveMarkerTo on
  // release is the whole gesture — one undo entry, and nothing to revert on a cancel.
  let press: {
    pointerId: number;
    from: number;
    x: number;
    /** Pointer offset from the marker's column edge at grab, so the flag does not jump. */
    grab: number;
    /** Was the playhead already on this marker at press? Decides tap = jump vs tap = edit. */
    onPlayhead: boolean;
    dragging: boolean;
  } | null = null;
  let dragFrom: number | null = $state(null);
  let dragFrame: number | null = $state(null);

  function markerDown(e: PointerEvent, frame: number) {
    // A finger bubbles to the frame area, which pans; only Pencil/mouse edit markers.
    if (e.pointerType === "touch" || e.button > 0 || !frameAreaEl) return;
    e.preventDefault();
    const rect = frameAreaEl.getBoundingClientRect();
    press = {
      pointerId: e.pointerId,
      from: frame,
      x: e.clientX,
      grab: e.clientX - rect.left - frame * cellW,
      onPlayhead: appState.playhead === frame,
      dragging: false,
    };
    onEdgePointerX(e.clientX);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  /** The column the dragged flag sits over. Measured from the frame area's CURRENT rect, which moves
   *  with the scroller, so edge auto-scroll needs no scroll-offset bookkeeping. */
  function dragAt(clientX: number) {
    if (!press || !frameAreaEl) return;
    const rect = frameAreaEl.getBoundingClientRect();
    const f = Math.round((clientX - rect.left - press.grab) / cellW);
    dragFrame = Math.max(0, Math.min(appState.project.frameCount - 1, f));
  }

  function onMove(e: PointerEvent) {
    if (!press || e.pointerId !== press.pointerId) return;
    onEdgePointerX(e.clientX);
    if (!press.dragging && Math.abs(e.clientX - press.x) > moveCancelPx(cellW)) {
      press.dragging = true;
      dragFrom = press.from;
      onEdgeScrollStart(dragAt, DRAG_OWNER);
    }
    if (press.dragging) dragAt(e.clientX);
  }

  function endPress() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    onEdgeScrollStop(DRAG_OWNER);
    press = null;
    dragFrom = null;
    dragFrame = null;
  }

  function onUp(e: PointerEvent) {
    if (!press || e.pointerId !== press.pointerId) return;
    const { from, dragging, onPlayhead } = press;
    const to = dragFrame;
    endPress();
    if (dragging) {
      if (to !== null && to !== from && !moveMarkerTo(from, to))
        appState.statusHint = `Frame ${to + 1} already has a marker`;
    } else if (onPlayhead) {
      openEditor(from);
    } else {
      seekPlayhead(from);
    }
  }

  /** An OS-cancelled stream (iPad palm rejection) drops the preview. Nothing was written, so there
   *  is nothing to settle. */
  function onCancel(e: PointerEvent) {
    if (!press || e.pointerId !== press.pointerId) return;
    endPress();
  }

  $effect(() => () => {
    if (press) endPress(); // unmounted mid-gesture: release the window listeners
  });

  // ── Finger pan (label column and empty strip) ────────────────────────────────────────────────
  function touchDown(e: PointerEvent) {
    if (e.pointerType !== "touch") return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onTouchDown(e);
  }
  function touchMove(e: PointerEvent) {
    if (e.pointerType === "touch") onTouchMove(e);
  }
  /** Same as AudioLane's buttons: a finger on a control is a pan, never a press. */
  function ignoreTouchClick(e: PointerEvent) {
    if (e.pointerType === "touch") e.preventDefault();
  }

  // ── Editor popover ───────────────────────────────────────────────────────────────────────────
  // `position: fixed`, because the timeline's scroll box clips anything `absolute` (the
  // `.curve-popup` trap). It does NOT close on scroll: on iPad the on-screen keyboard can scroll the
  // page as it opens, which would close the popover the instant it appeared.
  const EDITOR_W = 220;
  let editing: { frame: number; left: number; top: number } | null = $state(null);
  let draft = $state("");

  function openEditor(frame: number) {
    if (!frameAreaEl) return;
    const r = frameAreaEl.getBoundingClientRect();
    editing = {
      frame,
      left: Math.max(8, Math.min(window.innerWidth - EDITOR_W - 8, r.left + frame * cellW - 4)),
      top: Math.max(8, Math.min(window.innerHeight - 48, r.bottom + 4)),
    };
    draft = markerAt(appState.project.markers ?? [], frame)?.label ?? "";
  }

  function commitEdit() {
    if (!editing) return;
    const { frame } = editing;
    editing = null;
    renameMarkerAt(frame, draft); // no-op (no undo entry) when unchanged or the marker is gone
  }

  function deleteEdit() {
    if (!editing) return;
    const { frame } = editing;
    editing = null;
    deleteMarkerAt(frame);
  }

  function editorKey(e: KeyboardEvent) {
    e.stopPropagation(); // typing n / < / > must not reach App's shortcuts
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      editing = null;
    }
  }

  function focusSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  let popoverEl: HTMLDivElement | undefined = $state();

  /** Fix B (final review #2, Ruling 7): a keyboard-only focus change out of the popover — Tab to
   *  Delete then Tab again, or iPad's "hide keyboard" — has no pointerdown for `clickOutside` to
   *  catch, so the draft was silently lost (or a later App shortcut acted on the wrong marker).
   *  Commit whenever focus actually leaves the popover; a focus move WITHIN it (e.g. onto the
   *  Delete button) is not a close. */
  function popoverFocusOut(e: FocusEvent) {
    if (!editing || !popoverEl) return;
    const next = e.relatedTarget as Node | null;
    if (!next || !popoverEl.contains(next)) commitEdit();
  }

  /** Fix B: a key pressed while focus is anywhere in the popover (not just the input — e.g. the
   *  focused Delete button) must not bubble to App's window `keydown` handler, or Tab-to-Delete then
   *  Enter would toggle playback instead of activating the button. Don't preventDefault here: Enter
   *  must still activate a focused button natively, and the input's own `editorKey` still runs
   *  first and handles Enter/Escape itself. */
  function popoverKeydown(e: KeyboardEvent) {
    e.stopPropagation();
  }

  function addAtPlayhead() {
    addMarkerAtPlayhead(); // no-op when the frame already has one — the editor opens on it either way
    openEditor(appState.playhead);
  }

  // The playhead moving away closes the editor, saving — same as pressing outside.
  $effect(() => {
    const ph = appState.playhead;
    untrack(() => {
      if (editing && editing.frame !== ph) commitEdit();
    });
  });

  $effect(() => {
    markerActions.openEditor = openEditor;
    return () => {
      if (markerActions.openEditor === openEditor) markerActions.openEditor = null;
    };
  });
</script>

<!-- Pinned under the ruler inside Timeline's sticky header, and styled as PART of that header: the
     ruler's tones (lighter `surface-active` over the name column and the frames, `surface` past the
     last frame) and the header's closing divider in `text-muted`, so it reads as the time band rather
     than as another track. OPAQUE on purpose — rows scroll underneath it. -->
<div
  class="flex w-max items-stretch border-b border-text-muted bg-surface"
  style="min-width: {minWidth}px"
>
  <!-- Name column: same box and padding as AudioLane's label, so the text sits in the column. -->
  <div
    class="shrink-0 sticky left-0 z-20 flex h-6 items-center gap-1 bg-surface-active pr-1 pl-[5px] text-text-secondary"
    role="presentation"
    style="width: {labelW}px; touch-action: none"
    onpointerdown={touchDown}
    onpointermove={touchMove}
    onpointerup={onTouchUp}
    onpointercancel={onTouchUp}
  >
    <Flag size={13} class="shrink-0" />
    <span class="truncate flex-1">Markers</span>
    <button
      type="button"
      class="shrink-0 text-text-secondary hover:text-text"
      title="Add marker at playhead (N)"
      onpointerdown={ignoreTouchClick}
      onclick={addAtPlayhead}><Plus size={13} /></button
    >
  </div>
  <!-- The rows' lock/hidden glyph column: empty here, reserved so the frame columns line up. -->
  <div
    class="shrink-0 sticky z-20 h-6 bg-surface-active border-r border-text-muted"
    style="left: {labelW}px; width: {markerW}px"
  ></div>
  <div
    bind:this={frameAreaEl}
    class="relative h-6 flex-1"
    role="presentation"
    style="touch-action: none"
    onpointerdown={touchDown}
    onpointermove={touchMove}
    onpointerup={onTouchUp}
    onpointercancel={onTouchUp}
  >
    <!-- The ruler's lighter band, ending at the last frame like the ruler's tick strip does. -->
    <div
      class="pointer-events-none absolute inset-y-0 left-0 bg-surface-active"
      style="width: {appState.project.frameCount * cellW}px"
    ></div>
    <!-- This strip's slice of the play-range and playhead lines: the scroller draws them through the
         rows, but this strip is opaque and pinned over them. Same x as the scroller's (frame area
         origin = the scroller's GUTTER_W). No z-index, and before the markers in the DOM, so a flag's
         label paints over a line and the sticky z-20 name column covers the lines when scrolled left
         (they cannot leak under the gutter: the name cell is this frame area's full height). -->
    {#if playRange}
      {#each [playRange.start * cellW, (playRange.end + 1) * cellW - 1] as x (x)}
        <div
          class="pointer-events-none absolute inset-y-0 w-px"
          style="left: {x}px; background: var(--color-warn)"
        ></div>
      {/each}
    {/if}
    <div
      class="pointer-events-none absolute inset-y-0 w-px bg-danger"
      style="left: {appState.playhead * cellW + cellW / 2}px; transform: translateX(-50%)"
    ></div>
    {#each shown as m (m.frame)}
      {@const col = dragFrom === m.frame && dragFrame !== null ? dragFrame : m.frame}
      <button
        type="button"
        tabindex="-1"
        class="absolute inset-y-0 flex min-w-6 cursor-grab items-start"
        class:z-10={dragFrom === m.frame}
        style="left: {col * cellW}px; touch-action: none"
        title="Marker: {m.label || 'unlabelled'} · tap to jump, tap again to edit, drag to move"
        onpointerdown={(e) => markerDown(e, m.frame)}
      >
        <!-- stem: full-strength on the playhead's frame, muted elsewhere -->
        <span
          class="pointer-events-none absolute inset-y-0 left-0 w-px {appState.playhead === m.frame
            ? 'bg-text'
            : 'bg-text-muted'}"
        ></span>
        <!-- 8×4 downward flag, tip on the column edge -->
        <span
          class="pointer-events-none absolute top-0 left-[-4px] h-1 w-2 bg-text"
          style="clip-path: polygon(0 0, 100% 0, 50% 100%)"
        ></span>
        {#if m.label}
          <span
            class="pointer-events-none mt-[5px] ml-1 max-w-20 truncate rounded-sm bg-text px-1 text-[10px]/[14px] font-semibold text-surface"
            >{m.label}</span
          >
        {/if}
      </button>
    {/each}
  </div>
</div>

{#if editing}
  <div
    bind:this={popoverEl}
    role="presentation"
    class="fixed z-50 flex items-center gap-1 rounded border border-border bg-surface p-1 shadow-lg"
    style="left: {editing.left}px; top: {editing.top}px; width: {EDITOR_W}px"
    use:clickOutside={commitEdit}
    onfocusout={popoverFocusOut}
    onkeydown={popoverKeydown}
  >
    <input
      class="min-w-0 flex-1 rounded-sm border border-border bg-surface px-1 text-xs text-text"
      maxlength="40"
      placeholder="Label"
      bind:value={draft}
      use:focusSelect
      onkeydown={editorKey}
    />
    <!-- Fix B: preventDefault on pointerdown keeps focus on the input through the press, so the new
         popoverFocusOut above does not fire (and unmount this button) before the click lands. -->
    <button
      type="button"
      class="shrink-0 rounded-sm p-1 text-text-secondary hover:text-text"
      title="Delete marker"
      onpointerdown={(e) => e.preventDefault()}
      onclick={deleteEdit}><Trash2 size={14} /></button
    >
  </div>
{/if}
