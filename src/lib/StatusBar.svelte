<script lang="ts">
  import { state as appState, activeLayer } from "../state/appState.svelte";
  import { isIdentityTransform } from "../anim/document";
  import { contextHint } from "./status-hint";

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
    return contextHint({
      tool: appState.tool,
      locked: !!l.locked, // refs can be locked too (pins their transform)
      hiddenLayer: !l.visible,
      layerTransformed: l.kind === "draw" && !isIdentityTransform(l.transform),
      selectionActive: appState.selectionActive,
      selectionFloating: appState.selectionFloating,
      poseActive: appState.poseActive,
    });
  });
</script>

<div
  class="flex items-center justify-between gap-3 border-t border-border bg-surface px-2 h-6 text-xs text-text-secondary select-none"
>
  <span class="truncate">{appState.statusHint || idleHint}</span>
  <span class="shrink-0 tabular-nums"
    >f <span class="inline-block text-right" style="min-width: {frameDigits}ch"
      >{appState.playhead + 1}</span
    >/{appState.project.frameCount} · {toolLabel} · {activeLayer().name}</span
  >
</div>
