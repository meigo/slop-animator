<script lang="ts">
  import { Plus, Diamond, Copy, Minus } from "@lucide/svelte";
  import { state, canvasOps, activeLayer, bump } from "../state/appState.svelte";
  import { addFrame, insertKeyframe, setHold, duplicateKeyframe } from "../anim/timeline";
  import { resolveKeyframeIndex, type Cell } from "../anim/document";

  function cellLabel(layerCells: Cell[], f: number): string {
    const cell = layerCells[f];
    if (cell.kind === "key") return "●";
    return resolveKeyframeIndex(layerCells, f) === null ? "·" : "—";
  }

  function go(f: number) { state.playhead = Math.max(0, Math.min(state.project.frameCount - 1, f)); }
  function newFrame() { addFrame(state.project); go(state.project.frameCount - 1); bump(); }
  function key() { const l = activeLayer(); if (l.kind === "draw") { insertKeyframe(l, state.playhead, canvasOps); bump(); } }
  function hold() { const l = activeLayer(); if (l.kind === "draw") { setHold(l, state.playhead); bump(); } }
  function dup() { const l = activeLayer(); if (l.kind === "draw") { duplicateKeyframe(l, state.playhead, canvasOps); bump(); } }

  const toolBtn = "w-7 h-7 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover border border-border";
</script>

<div class="border-t border-border bg-surface text-text p-2 text-sm">
  <div class="flex gap-1 mb-2">
    <button class={toolBtn} title="Add frame" onclick={newFrame}><Plus size={16} /></button>
    <button class={toolBtn} title="Insert keyframe" onclick={key}><Diamond size={16} /></button>
    <button class={toolBtn} title="Duplicate keyframe" onclick={dup}><Copy size={16} /></button>
    <button class={toolBtn} title="Hold (repeat previous frame)" onclick={hold}><Minus size={16} /></button>
  </div>
  {#each [...state.project.layers].reverse() as layer (layer.id)}
    <div class="flex items-center gap-1">
      <span class="w-20 truncate text-text-secondary">{layer.name}</span>
      {#if layer.kind === "draw"}
        {#each Array(state.project.frameCount) as _, f}
          <button
            class="w-6 h-6 border border-border leading-none"
            class:bg-selection={f === state.playhead}
            class:text-accent-text={f === state.playhead}
            onclick={() => go(f)}>{cellLabel(layer.cells, f)}</button>
        {/each}
      {:else}
        <span class="text-xs text-text-muted ml-1">ref</span>
      {/if}
    </div>
  {/each}
</div>
