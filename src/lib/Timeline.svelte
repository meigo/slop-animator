<script lang="ts">
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
</script>

<div class="border-t border-neutral-300 bg-neutral-100 p-2 text-sm">
  <div class="flex gap-2 mb-2">
    <button onclick={() => go(state.playhead - 1)}>◀</button>
    <span>Frame {state.playhead + 1} / {state.project.frameCount}</span>
    <button onclick={() => go(state.playhead + 1)}>▶</button>
    <button onclick={newFrame}>+ Frame</button>
    <button onclick={key}>Keyframe</button>
    <button onclick={dup}>Dup</button>
    <button onclick={hold}>Hold</button>
  </div>
  {#each [...state.project.layers].reverse() as layer (layer.id)}
    <div class="flex items-center gap-1">
      <span class="w-20 truncate">{layer.name}</span>
      {#if layer.kind === "draw"}
        {#each Array(state.project.frameCount) as _, f}
          <button
            class="w-6 h-6 border border-neutral-300 leading-none"
            class:bg-amber-200={f === state.playhead}
            onclick={() => go(f)}>{cellLabel(layer.cells, f)}</button>
        {/each}
      {:else}
        <span class="text-xs text-neutral-400 ml-1">ref</span>
      {/if}
    </div>
  {/each}
</div>
