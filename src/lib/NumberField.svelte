<script lang="ts">
  import { untrack } from "svelte";
  import { SCRUB_THRESHOLD_PX, scrubbedValue, stepDecimals } from "../core/scrub";

  interface Props {
    value: number;
    min: number;
    max: number;
    /** The typing/arrow increment AND the grid a drag snaps to. */
    step: number;
    /** Horizontal travel worth one step. */
    pxPerStep?: number;
    decimals?: number;
    title?: string;
    ariaLabel: string;
    disabled?: boolean;
    class?: string;
    /** Called on every move of a LIVE field. Omit it for a field whose setter is undoable and has
     *  no non-committing variant: the field then shows the number while dragging and writes once,
     *  on release, so one drag is one undo entry. */
    onInput?: (v: number) => void;
    onCommit: (v: number) => void;
  }

  let {
    value,
    min,
    max,
    step,
    pxPerStep = 8,
    decimals,
    title = "",
    ariaLabel,
    disabled = false,
    class: klass = "",
    onInput,
    onCommit,
  }: Props = $props();

  const dp = $derived(decimals ?? stepDecimals(step));
  const show = (v: number) => v.toFixed(dp);

  let input: HTMLInputElement | undefined;
  let draft = $state(untrack(() => show(value)));
  /** The field owns the text while it is focused OR being dragged; outside that the store does.
   *  Two flags, not one: the drag BLURS the field on its first move, and a single flag cleared by
   *  that blur would let the effect below snap the text back to the stored value on every move of
   *  a field that only writes on release (Length, Track step). */
  let focused = $state(false);
  let dragging = $state(false);

  // Re-sync when the value changes from OUTSIDE this field — undo, a preset button, a timeline
  // drag. Guarded, or it would overwrite what is being typed or dragged.
  $effect(() => {
    const next = show(value);
    if (!focused && !dragging && draft !== next) draft = next;
  });

  const clamp = (v: number) => Math.max(min, Math.min(max, v));

  // Non-reactive on purpose: nothing renders from it.
  let scrub: { startX: number; startValue: number; moved: boolean; lastEmitted: number } | null =
    null;

  function onPointerDown(e: PointerEvent) {
    if (disabled || e.button !== 0) return;
    scrub = { startX: e.clientX, startValue: value, moved: false, lastEmitted: value };
    // NO preventDefault: the browser still focuses the field and places the caret, so a press that
    // never travels is an ordinary tap-to-type.
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    // An OS-cancelled stream (iPad palm rejection) must END the gesture, not leave it armed for the
    // next press to inherit — the gap CLAUDE.md gotcha #6 records for the transform drags.
    window.addEventListener("pointercancel", onPointerUp);
  }

  function onPointerMove(e: PointerEvent) {
    if (!scrub) return;
    const dx = e.clientX - scrub.startX;
    if (!scrub.moved) {
      if (Math.abs(dx) < SCRUB_THRESHOLD_PX) return;
      scrub.moved = true;
      dragging = true;
      input?.blur(); // a caret blinking in a field being scrubbed is a lie
    }
    const next = scrubbedValue({
      startValue: scrub.startValue,
      dx,
      step,
      pxPerStep,
      fine: e.shiftKey,
      min,
      max,
    });
    draft = show(next); // the display follows the pointer even when the number itself didn't move
    // Pose Gap's onInput reruns silhouette-trace/dilate/Delaunay/geodesic-weights on every call, so a
    // slow drag across a wide range must not fire it for every pointermove that lands on the same
    // quantised value — only when the number actually changes.
    if (next !== scrub.lastEmitted) {
      scrub.lastEmitted = next;
      onInput?.(next);
    }
  }

  function onPointerUp() {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    const moved = scrub?.moved ?? false;
    const startValue = scrub?.startValue ?? value;
    scrub = null;
    dragging = false;
    if (!moved) return; // a tap: the field is focused for typing, nothing is written
    swallowNextClick();
    const v = Number(draft);
    if (!Number.isFinite(v)) return;
    const c = clamp(v);
    if (c !== startValue) onCommit(c); // a drag that returns to its origin writes nothing
  }

  /** A drag that ends outside this field's ancestor panel (a 320px dialog, a fast W/H drag) still
   *  makes the browser fire a `click` on the nearest common ancestor once the pointer releases — for
   *  a modal backdrop with `onclick={close}`, that closes the dialog and discards the values just
   *  dragged in. Swallow exactly the one click this gesture produces, in the capture phase so it
   *  never reaches the backdrop's handler. Bounded two ways so it can't leak and eat a later,
   *  unrelated click: removed on the first click it sees, and also on a timeout in case no click
   *  follows (rare, but observed to vary by browser/input type). */
  function swallowNextClick() {
    const timer = setTimeout(() => window.removeEventListener("click", swallow, true), 400);
    function swallow(e: MouseEvent) {
      e.stopPropagation();
      e.preventDefault();
      clearTimeout(timer);
      window.removeEventListener("click", swallow, true);
    }
    window.addEventListener("click", swallow, true);
  }

  /** Write a typed value. A draft equal to the current value writes NOTHING, so tabbing through a
   *  field cannot push an empty undo entry. Rounded to the field's own display precision (`dp`) —
   *  NOT snapped to the step grid, so typing 1281 into canvas width keeps 1281; only the drag path
   *  snaps. */
  function commitDraft() {
    if (disabled) {
      draft = show(value);
      return;
    }
    const v = Number(draft);
    if (!Number.isFinite(v) || draft.trim() === "") {
      draft = show(value);
      return;
    }
    const c = Number(clamp(v).toFixed(dp));
    if (c === value) {
      draft = show(value); // normalise what is displayed (e.g. "07" → "7")
      return;
    }
    onCommit(c);
    draft = show(c);
  }

  function onKeyDown(e: KeyboardEvent) {
    // The global handler drops single-key shortcuts whose target is an INPUT (App.svelte), but a
    // field is exactly where a stray `b`/`e`/`f` would be most annoying, so stop them here too. BUT
    // App.svelte handles Cmd/Ctrl+Z ABOVE that INPUT/TEXTAREA guard on purpose (undo/redo must work
    // no matter what has focus), and Svelte 5 delegates `keydown` at the document, so stopping
    // propagation unconditionally would keep that event from ever reaching `<svelte:window>`. Only
    // block the plain single-key shortcuts; let a Ctrl/Meta chord through.
    if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
    if (e.key === "Enter") {
      input?.blur();
      return;
    }
    if (e.key === "Escape") {
      draft = show(value);
      input?.blur();
      return;
    }
    // Replaces the spinner arrows the text input does not have.
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (disabled) return;
      e.preventDefault();
      const next = clamp(value + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
      if (next === value) return;
      draft = show(next);
      onInput?.(next);
      onCommit(next);
    }
  }
</script>

<!-- `type="text"` with a decimal inputmode, NOT `type="number"`: a number input owns pointer
     gestures for its spinner, which is exactly the gesture the scrub needs. It stays an <input> so
     App.svelte's INPUT/TEXTAREA guard keeps single-key tool shortcuts out while it is focused. -->
<input
  bind:this={input}
  class="{klass} touch-none tabular-nums {disabled ? '' : 'cursor-ew-resize'}"
  type="text"
  inputmode="decimal"
  readonly={disabled}
  aria-label={ariaLabel}
  aria-disabled={disabled}
  title={title ? `${title} · Drag to change` : "Drag to change"}
  value={draft}
  oninput={(e) => (draft = e.currentTarget.value)}
  onpointerdown={onPointerDown}
  onfocus={() => (focused = true)}
  onblur={() => {
    focused = false;
    // The blur the drag itself fires (first move) must not commit: the drag commits on release.
    if (!dragging) commitDraft();
  }}
  onkeydown={onKeyDown}
/>
