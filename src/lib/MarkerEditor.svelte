<script lang="ts">
  import { Trash2 } from "@lucide/svelte";
  import { untrack } from "svelte";
  import {
    state as appState,
    renameMarkerAt,
    deleteMarkerAt,
    markerActions,
  } from "../state/appState.svelte";
  import { markerAt } from "../anim/markers";
  import { clickOutside } from "./click-outside";

  // The marker label editor, mounted at APP level just under the tool options row — not beside the
  // marker in the timeline. On iPad it lived in the timeline, near the bottom of the window, which is
  // exactly where the on-screen keyboard appears: iOS shifted the whole (fixed, `app.css`) app up to
  // reveal the field, tucked the popover under the timeline toolbar, and left the page shifted after
  // the keyboard closed (blank space under the status bar). A field at the top of the window can
  // never be covered, so iOS never has a reason to move the page. `app.css` records the rule this
  // follows: no text input may open low in the window (CLAUDE.md gotcha #15).
  let editing: { frame: number } | null = $state(null);
  let draft = $state("");
  let barEl: HTMLDivElement | undefined = $state();

  /** Open on `frame`, pre-filled with its label (empty for a marker just added). */
  function openEditor(frame: number) {
    editing = { frame };
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

  /** A keyboard-only focus change out of the bar — Tab past Delete, or iPad's "hide keyboard" — has
   *  no pointerdown for `clickOutside` to catch, so commit whenever focus actually leaves the bar. A
   *  move WITHIN it (onto the Delete button) is not a close. */
  function barFocusOut(e: FocusEvent) {
    if (!editing || !barEl) return;
    const next = e.relatedTarget as Node | null;
    if (!next || !barEl.contains(next)) commitEdit();
  }

  /** No key pressed anywhere in the bar reaches App's window shortcuts (`n`, `<`, `>`, Enter's
   *  play toggle on a focused Delete button). No preventDefault: Enter must still activate a focused
   *  button natively, and the input's own `editorKey` runs first for Enter/Escape. */
  function barKeydown(e: KeyboardEvent) {
    e.stopPropagation();
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

{#if editing}
  <!-- Centred over the top of the canvas area; the outer box is click-through so only the bar itself
       takes presses. -->
  <div class="pointer-events-none absolute inset-x-0 top-2 z-50 flex justify-center px-4">
    <div
      bind:this={barEl}
      role="presentation"
      class="pointer-events-auto flex w-full max-w-sm items-center gap-2 rounded border border-border bg-surface py-1 pr-1 pl-2 shadow-lg"
      use:clickOutside={commitEdit}
      onfocusout={barFocusOut}
      onkeydown={barKeydown}
    >
      <span class="shrink-0 text-sm text-text-secondary">Marker · frame {editing.frame + 1}</span>
      <input
        class="h-7 min-w-0 flex-1 rounded-sm border border-border bg-surface px-1 text-sm text-text"
        maxlength="40"
        placeholder="Label"
        bind:value={draft}
        use:focusSelect
        onkeydown={editorKey}
      />
      <!-- preventDefault on pointerdown keeps focus on the input through the press, so barFocusOut
           does not fire (and unmount this button) before the click lands. -->
      <button
        type="button"
        class="shrink-0 rounded-sm p-1 text-text-secondary hover:text-text"
        title="Delete marker"
        onpointerdown={(e) => e.preventDefault()}
        onclick={deleteEdit}><Trash2 size={14} /></button
      >
    </div>
  </div>
{/if}
