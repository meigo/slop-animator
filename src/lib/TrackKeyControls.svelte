<script lang="ts">
  /**
   * The per-key controls for ONE animated property: Delete key, Ease, Step — plus the
   * transform-only Copy/Paste pair when asked for.
   *
   * ONE component rendered from every host, rather than a copy per property. These controls were
   * written against the layer transform track alone, so an opacity key could be retimed but never
   * deleted and its segment could never be set to `hold` — and a hard cut is the spec's stated way
   * to use an opacity track. A second copy of this markup is how that gap comes back.
   *
   * Hosted on the timeline bar (and, until the old hosts are removed, ToolOptions / LayerList).
   * Value authors (gizmo, opacity slider) stay with their properties; only these key tools move.
   *
   * The track is resolved from the `TrackRef` rather than passed in, so the ref and the track can
   * never disagree — and so the Step field can read the RESOLVED value straight back out of the
   * store after the action (see its handler).
   */
  import {
    DiamondMinus,
    ClipboardCopy,
    ClipboardPaste,
  } from "@lucide/svelte";
  import {
    state as appState,
    deleteTrackKey,
    setTrackKeyInterp,
    setTrackSampleEvery,
    copyTransformKeyAtPlayhead,
    pasteTransformKeyAtPlayhead,
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
    showCopyPaste = false,
    compact = false,
    blocked = null,
  }: {
    /** Which track: the owner and the property. */
    trackRef: TrackRef;
    /** Copy key / Paste key are TRANSFORM-only: the clipboard holds a `TransformKey`, and carrying
     *  any property's key needs a tagged clipboard plus a refusal story for pasting an opacity
     *  value into a transform key. Deferred, deliberately — so the pair is rendered only when a host
     *  asks for it, never guessed at from the ref. */
    showCopyPaste?: boolean;
    /** Panel sizing: the layer panel's rows are `py-0.5`, the tool bar's controls `h-7`. Same
     *  markup, so the two can't drift; only the padding follows its host. Kept until Task 4 removes
     *  the layer-list host. */
    compact?: boolean;
    /** Why the owner refuses edits right now, phrased to follow "Delete key — ", or null when it
     *  doesn't. A control that silently no-ops explains nothing, so a host whose target can be
     *  locked or hidden (the layer panel) passes the reason; the hosts whose target is already
     *  filtered to an editable one (`animateTargetLayer`/`animateTargetGroup`) pass nothing. */
    blocked?: string | null;
  } = $props();

  const track = $derived(trackForRef(appState.project, trackRef));
  const frame = $derived(appState.playhead);

  const hasKey = $derived(!!track && hasKeyAt(track, frame));
  const onlyKey = $derived(!!track && track.keys.length <= 1);
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

  /** Copy/Paste read and write the transform clipboard, so they only ever act on a LAYER's transform
   *  track — the one shape `copyTransformKeyAtPlayhead`/`pasteTransformKeyAtPlayhead` accept. */
  const clipLayerId = $derived(
    showCopyPaste && trackRef.owner === "layer" && trackRef.prop === "transform"
      ? trackRef.id
      : null,
  );

  // Two literal class strings rather than one interpolated one, so the Tailwind lint can still read
  // them. aria-disabled utilities keep the dimmed, inert look identical to a `disabled` control.
  // Non-compact = timeline `toolBtn` (icon buttons); compact = layer-panel text chips.
  const BTN =
    "w-7 h-7 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover border border-border aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent";
  const BTN_COMPACT =
    "shrink-0 whitespace-nowrap rounded border border-border px-1.5 py-0.5 text-xs text-text-secondary hover:bg-surface-hover hover:text-text aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent";
  const SELECT =
    "h-7 rounded border border-border bg-surface px-1 text-xs text-text aria-disabled:cursor-default aria-disabled:opacity-40";
  const SELECT_COMPACT =
    "rounded border border-border bg-surface px-1 text-xs text-text aria-disabled:cursor-default aria-disabled:opacity-40";
  const STEP =
    "h-7 w-12 rounded border border-border bg-surface px-1 text-xs text-text aria-disabled:opacity-40";
  const STEP_COMPACT =
    "w-12 rounded border border-border bg-surface px-1 text-xs text-text aria-disabled:opacity-40";
  const btn = $derived(compact ? BTN_COMPACT : BTN);
  const select = $derived(compact ? SELECT_COMPACT : SELECT);
  const step = $derived(compact ? STEP_COMPACT : STEP);
</script>

{#if track}
  <!-- aria-disabled, never `disabled`: a disabled element dispatches no pointer events, so the
       status bar's delegated title= listener could not read the reason it is unavailable — the
       control that most needs to explain itself would be the only one unable to — and on iPad a tap
       is the only route to that explanation. Handlers are guarded to match, since the control stays
       clickable and keyboard-activatable. `onclick`, never `onpointerdown`: a window-level
       pointerdown listener overwrites the status hint from the target's title in the bubble phase,
       i.e. AFTER a button's own pointerdown handler.

       Every control stops CLICK propagation: in the layer panel this markup sits inside a row whose
       own onclick re-selects the layer, and the panel's opacity slider already does the same. Click
       is safe to stop — the status hint listens on pointerover/pointerdown, which still bubble. -->
  <button
    class={btn}
    aria-disabled={!canDelete}
    title={deleteTitle}
    onclick={(e) => {
      e.stopPropagation();
      if (canDelete) deleteTrackKey(trackRef, frame);
    }}
    >{#if compact}Delete key{:else}<DiamondMinus size={16} />{/if}</button
  >
  {#if clipLayerId !== null}
    <button
      class={btn}
      aria-disabled={!hasKey}
      title={hasKey
        ? "Copy this key — its position and its curve — to paste on another frame or layer"
        : "Copy key — no key on this frame"}
      onclick={(e) => {
        e.stopPropagation();
        if (hasKey) copyTransformKeyAtPlayhead(clipLayerId);
      }}
      >{#if compact}Copy key{:else}<ClipboardCopy size={16} />{/if}</button
    >
    <button
      class={btn}
      aria-disabled={!appState.transformKeyClipboard}
      title={appState.transformKeyClipboard
        ? "Paste the copied key here, replacing any key on this frame"
        : "Paste key — nothing copied yet"}
      onclick={(e) => {
        e.stopPropagation();
        if (appState.transformKeyClipboard) pasteTransformKeyAtPlayhead(clipLayerId);
      }}
      >{#if compact}Paste key{:else}<ClipboardPaste size={16} />{/if}</button
    >
  {/if}
  <!-- The title sits on this LABEL, not on the <select>, so `pointer-events-none` on the select
       (which is what actually stops the picker opening) still leaves the reason readable. -->
  <label
    class="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-text-secondary"
    title={easeTitle}
  >
    Ease
    <select
      class={select}
      class:pointer-events-none={easeInert}
      aria-disabled={easeInert}
      value={seg?.interp ?? "linear"}
      onclick={(e) => e.stopPropagation()}
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
      class={step}
      class:pointer-events-none={!!blocked}
      aria-disabled={!!blocked}
      type="number"
      min="1"
      max={MAX_SAMPLE_EVERY}
      value={track.sampleEvery ?? 1}
      onclick={(e) => e.stopPropagation()}
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
