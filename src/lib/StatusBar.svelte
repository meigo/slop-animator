<script lang="ts">
  import { state as appState, activeLayer } from "../state/appState.svelte";
  import { isIdentityTransform } from "../anim/document";
  import { contextHint } from "./status-hint";

  // Ambient readout: frame, tool (brush/eraser show their stroke type), and the active layer.
  const ambient = $derived.by(() => {
    const p = appState.project;
    const toolLabel =
      appState.tool === "eraser"
        ? "eraser"
        : appState.tool === "brush"
          ? appState.brush.brushType
          : appState.tool;
    return `f ${appState.playhead + 1}/${p.frameCount} · ${toolLabel} · ${activeLayer().name}`;
  });

  // Idle hint: the non-obvious gestures for the current tool + context. A real hover/press hint
  // (sourced from any title=) always wins; this only fills the gap, which on touch is always.
  const idleHint = $derived.by(() => {
    const l = activeLayer();
    return contextHint({
      tool: appState.tool,
      locked: l.kind === "draw" && l.locked,
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
  <span class="shrink-0 tabular-nums">{ambient}</span>
</div>
