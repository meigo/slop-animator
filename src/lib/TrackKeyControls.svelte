<script lang="ts">
  /**
   * The per-key controls for ONE animated property: Add key, Delete key, Copy, Paste, Ease, Step.
   *
   * ONE component rendered from every host, rather than a copy per property. These controls were
   * written against the layer transform track alone, so an opacity key could be retimed but never
   * deleted and its segment could never be set to `hold` — and a hard cut is the spec's stated way
   * to use an opacity track. A second copy of this markup is how that gap comes back.
   *
   * Hosted on the timeline bar only. Value authors (gizmo, opacity slider) stay with their
   * properties; only these key tools live here.
   *
   * The track is resolved from the `TrackRef` rather than passed in, so the ref and the track can
   * never disagree — and so the Step field can read the RESOLVED value straight back out of the
   * store after the action (see its handler).
   */
  import { DiamondPlus, DiamondMinus, ClipboardCopy, ClipboardPaste } from "@lucide/svelte";
  import {
    state as appState,
    addTrackKey,
    deleteTrackKey,
    setTrackKeyInterp,
    setTrackSampleEvery,
    copyTrackKey,
    pasteTrackKey,
  } from "../state/appState.svelte";
  import {
    hasKeyAt,
    segmentKeyAt,
    trackForRef,
    MAX_SAMPLE_EVERY,
    type KeyInterp,
    type TrackRef,
  } from "../anim/document";

  let {
    trackRef,
    blocked = null,
  }: {
    /** Which track: the owner and the property. */
    trackRef: TrackRef;
    /** Why the owner refuses edits right now, phrased to follow "Delete key — ", or null when it
     *  doesn't. A control that silently no-ops explains nothing, so the timeline bar passes
     *  `animBar.blocked` when the focused track's owner is locked (or otherwise inert). */
    blocked?: string | null;
  } = $props();

  const track = $derived(trackForRef(appState.project, trackRef));
  const frame = $derived(appState.playhead);

  const hasKey = $derived(!!track && hasKeyAt(track, frame));
  const onlyKey = $derived(!!track && track.keys.length <= 1);
  const canAdd = $derived(!blocked && !hasKey);
  const addTitle = $derived(
    blocked
      ? `Add key — ${blocked}`
      : hasKey
        ? "Add key — already a key on this frame"
        : "Add a key on this frame, freezing the value you can see",
  );
  const canDelete = $derived(!blocked && hasKey && !onlyKey);
  const deleteTitle = $derived(
    blocked
      ? `Delete key — ${blocked}`
      : !hasKey
        ? "Delete key — no key on this frame"
        : onlyKey
          ? "Delete key — this is the only key; use Stop animating"
          : "Delete the key on this frame",
  );

  // Easing belongs to the SEGMENT, so this edits the key the playhead currently sits in — the curve
  // from that key to the next — not the whole track. Scrub into a segment to shape it. Unavailable
  // before the first key (no segment yet) and ON OR PAST THE LAST key, where `segmentKeyAt` returns
  // that key but no segment starts at it: choosing a value there pushed a real undo entry, changed
  // no rendered frame, and turned the marker into a circle implying easing that does not exist. A
  // one-key track right after Animate is that case.
  const seg = $derived(track ? segmentKeyAt(track, frame) : null);
  const segLast = $derived(
    !!track && !!seg && seg.frame === track.keys[track.keys.length - 1].frame,
  );
  const easeInert = $derived(!!blocked || !seg || segLast);
  const easeTitle = $derived(
    blocked
      ? `Ease — ${blocked}`
      : !seg
        ? "Ease — the playhead is before the first key, so there is no segment here"
        : segLast
          ? "Ease — this is the last key, and no segment starts at it; add a later key first"
          : `Interpolation from the key at frame ${seg.frame + 1} to the next`,
  );

  const stepTitle = $derived(
    blocked
      ? `Step — ${blocked}`
      : "Update this property every N frames, so it can sit on 2s like the drawings",
  );

  // BOTH halves of the clipboard's identity have to match, and they are reported separately: an
  // owner mismatch is not the same refusal as an empty clipboard or the wrong property, and this
  // title is the only place the difference is ever stated (on iPad a tap on it is the status hint).
  // A layer transform is stored relative to the LAYER's base rect while a group transform pivots on
  // the group's bbox, so pasting across would land a plausible pose that is not the copied one; a
  // group's opacity multiplies its members' rather than replacing it, so that one does not transfer
  // either. The tag is uniform rather than per-property so there is one rule to remember.
  const clip = $derived(appState.keyClipboard);
  const propMatches = $derived(!!clip && clip.prop === trackRef.prop);
  const ownerMatches = $derived(!!clip && clip.owner === trackRef.owner);
  const canPaste = $derived(!blocked && propMatches && ownerMatches);
  const pasteTitle = $derived(
    blocked
      ? `Paste key — ${blocked}`
      : !clip
        ? "Paste key — nothing copied yet"
        : !propMatches
          ? `Paste key — copied key is ${clip.prop === "opacity" ? "opacity" : "a transform"}`
          : !ownerMatches
            ? `Paste key — copied from a ${clip.owner}, and this row animates a ${trackRef.owner}`
            : "Paste the copied key here, replacing any key on this frame",
  );

  // Literal class strings rather than interpolated ones, so the Tailwind lint can still read them.
  // aria-disabled utilities keep the dimmed, inert look identical to a `disabled` control.
  // Sized to the timeline bar's `toolBtn` (icon buttons).
  const BTN =
    "w-7 h-7 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover border border-border aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent";
  const SELECT =
    "h-7 rounded border border-border bg-surface px-1 text-xs text-text aria-disabled:cursor-default aria-disabled:opacity-40";
  const STEP =
    "h-7 w-12 rounded border border-border bg-surface px-1 text-xs text-text aria-disabled:opacity-40";
</script>

{#if track}
  <!-- aria-disabled, never `disabled`: a disabled element dispatches no pointer events, so the
       status bar's delegated title= listener could not read the reason it is unavailable — the
       control that most needs to explain itself would be the only one unable to — and on iPad a tap
       is the only route to that explanation. Handlers are guarded to match, since the control stays
       clickable and keyboard-activatable. `onclick`, never `onpointerdown`: a window-level
       pointerdown listener overwrites the status hint from the target's title in the bubble phase,
       i.e. AFTER a button's own pointerdown handler. -->
  <button
    class={BTN}
    aria-disabled={!canAdd}
    title={addTitle}
    onclick={() => {
      if (canAdd) addTrackKey(trackRef, frame);
    }}><DiamondPlus size={16} /></button
  >
  <button
    class={BTN}
    aria-disabled={!canDelete}
    title={deleteTitle}
    onclick={() => {
      if (canDelete) deleteTrackKey(trackRef, frame);
    }}><DiamondMinus size={16} /></button
  >
  <button
    class={BTN}
    aria-disabled={!hasKey}
    title={hasKey
      ? "Copy this key — its value and its curve — to paste on another frame or layer"
      : "Copy key — no key on this frame"}
    onclick={() => {
      if (hasKey) copyTrackKey(trackRef);
    }}><ClipboardCopy size={16} /></button
  >
  <button
    class={BTN}
    aria-disabled={!canPaste}
    title={pasteTitle}
    onclick={() => {
      if (canPaste) pasteTrackKey(trackRef);
    }}><ClipboardPaste size={16} /></button
  >
  <!-- The title sits on this LABEL, not on the <select>, so `pointer-events-none` on the select
       (which is what actually stops the picker opening) still leaves the reason readable. -->
  <label
    class="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-text-secondary"
    title={easeTitle}
  >
    Ease
    <select
      class={SELECT}
      class:pointer-events-none={easeInert}
      aria-disabled={easeInert}
      value={seg?.interp ?? "linear"}
      onchange={(e) => {
        if (!easeInert && seg)
          setTrackKeyInterp(
            trackRef,
            seg.frame,
            (e.currentTarget as HTMLSelectElement).value as KeyInterp,
          );
      }}
    >
      <option value="linear">Linear</option>
      <option value="ease-in">Ease in</option>
      <option value="ease-out">Ease out</option>
      <option value="ease-in-out">Ease in-out</option>
      <option value="hold">Hold</option>
    </select>
  </label>
  <label
    class="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-text-secondary"
    title={stepTitle}
  >
    Step
    <input
      class={STEP}
      class:pointer-events-none={!!blocked}
      aria-disabled={!!blocked}
      type="number"
      min="1"
      max={MAX_SAMPLE_EVERY}
      value={track.sampleEvery ?? 1}
      onchange={(e) => {
        const el = e.currentTarget as HTMLInputElement;
        if (!blocked) setTrackSampleEvery(trackRef, Number(el.value));
        // Write the RESOLVED value back. The action early-returns when the clamp lands on the value
        // already stored, so the bound expression never changes and Svelte leaves the DOM alone:
        // typing `0` and blurring left the field showing 0 while the store held 1. Re-read from the
        // STORE, not from the `track` snapshot this handler closed over — that is the value the
        // action actually settled on. `MAX_SAMPLE_EVERY` is clamped in the action, not just by this
        // input's `max`, because a browser accepts a typed value beyond an advisory max.
        el.value = String(trackForRef(appState.project, trackRef)?.sampleEvery ?? 1);
      }}
    />
  </label>
{/if}
