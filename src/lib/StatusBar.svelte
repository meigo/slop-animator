<script lang="ts">
  import {
    state as appState,
    activeLayer,
    isAudioRowSelected,
    isGroupRowSelected,
  } from "../state/appState.svelte";
  import { isLayerLocked, isLayerVisible, layerTransformTrack } from "../anim/document";
  import { contextHint } from "./status-hint";
  import { animateTargetGroup, animateTargetLayer } from "./transform-target";

  // Ambient readout: frame, tool (brush/eraser show their stroke type), and the active layer.
  // Split rather than one string: the readout is right-anchored, so a frame number gaining a digit
  // (9 → 10) slid the whole line left and everything after it appeared to jump while scrubbing.
  // tabular-nums equalizes digit WIDTH, not digit COUNT — the counter needs reserved width.
  const toolLabel = $derived(
    appState.tool === "eraser"
      ? "eraser"
      : appState.tool === "brush"
        ? appState.brush.brushType
        : appState.tool,
  );
  const frameDigits = $derived(String(appState.project.frameCount).length);

  // Idle hint: the non-obvious gestures for the current tool + context. A real hover/press hint
  // (sourced from any title=) always wins; this only fills the gap, which on touch is always.
  const idleHint = $derived.by(() => {
    const l = activeLayer();
    // The SAME predicates the Animate controls use (shared, so the two cannot drift): a track alone
    // is not enough, because at FRAME scope a drag writes the CELL's transform, which no track
    // holds. Group scope keys a different target rather than none — hence the second call below.
    const target = animateTargetLayer(
      l,
      appState.project.groups,
      appState.tool,
      appState.transformScope,
      appState.playhead,
      appState.project.fps,
    );
    // Group scope keys the GROUP, so the layer predicate correctly declines there and this one
    // answers instead. Without it auto-key at group scope would happen silently — the very hazard
    // this hint exists to mitigate, in the one scope where ToolOptions' own caption is the only
    // other thing on screen.
    const group = animateTargetGroup(
      l,
      appState.project.groups,
      appState.project.layers,
      appState.tool,
      appState.transformScope,
    );
    const audioOn = isAudioRowSelected();
    const groupOn = isGroupRowSelected();
    const keys =
      !audioOn &&
      !groupOn &&
      ((!!target && layerTransformTrack(target) != null) || group?.tracks?.transform != null);
    return contextHint({
      tool: appState.tool,
      locked: audioOn || groupOn ? false : isLayerLocked(l, appState.project.groups),
      hiddenLayer: audioOn || groupOn ? false : !isLayerVisible(l, appState.project.groups),
      notDraw: l.kind !== "draw",
      audioRow: audioOn,
      groupRow: groupOn,
      selectionActive: appState.selectionActive,
      selectionFloating: appState.selectionFloating,
      poseActive: appState.poseActive,
      // A held drag keys its GRAB frame, not wherever the playhead has since moved to.
      animatedFrame: keys ? (appState.transformDragFrame ?? appState.playhead) : null,
    });
  });
  const targetName = $derived.by(() => {
    if (isAudioRowSelected()) return appState.project.audio?.name ?? "audio";
    const row = appState.activeRow;
    if (row.kind === "group") {
      return appState.project.groups.find((g) => g.id === row.id)?.name ?? activeLayer().name;
    }
    return activeLayer().name;
  });
</script>

<div
  class="flex items-center justify-between gap-3 border-t border-border bg-surface px-2 h-6 text-xs text-text-secondary select-none"
>
  {#if appState.persistAlert}
    <!-- Amber, per the read-only/state-signalling convention: this is a condition to act on, not a
         momentary error. It keeps its own slot rather than replacing the hint, so hovering a control
         still explains that control while the warning stays put. -->
    <span class="truncate text-amber-500 shrink-2" title={appState.persistAlert}
      >⚠ {appState.persistAlert}</span
    >
  {/if}
  <span class="truncate">{appState.statusHint || idleHint}</span>
  <span class="shrink-0 tabular-nums"
    >f <span class="inline-block text-right" style="min-width: {frameDigits}ch"
      >{appState.playhead + 1}</span
    >/{appState.project.frameCount} · {toolLabel} · {targetName}</span
  >
</div>
