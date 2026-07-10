<script lang="ts">
  import { state as appState, activeLayer } from "../state/appState.svelte";

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
</script>

<div
  class="flex items-center justify-between gap-3 border-t border-border bg-surface px-2 h-6 text-xs text-text-secondary select-none"
>
  <span class="truncate">{appState.statusHint}</span>
  <span class="shrink-0 tabular-nums">{ambient}</span>
</div>
