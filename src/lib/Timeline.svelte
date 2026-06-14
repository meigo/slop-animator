<script lang="ts">
  import { Plus, Diamond, Copy, Minus, Trash2 } from "@lucide/svelte";
  import { state, canvasOps, activeLayer, bump } from "../state/appState.svelte";
  import { addFrame, insertKeyframe, duplicateKeyframe, setHold, deleteFrame } from "../anim/timeline";
  import { resolveKeyframeIndex, type Cell } from "../anim/document";

  // ◆ keyframe · blank (past end or before first key) — hold over a key
  function cellLabel(cells: Cell[], f: number): string {
    if (f >= cells.length) return "";
    if (cells[f].kind === "key") return "◆";
    return resolveKeyframeIndex(cells, f) === null ? "·" : "—";
  }

  function go(f: number) {
    state.playhead = Math.max(0, Math.min(state.project.frameCount - 1, f));
  }

  // All tools act on the active drawing layer at the current frame, current-frame-aware
  // (inserts land AFTER the playhead, then the playhead follows to the new frame).
  function frameTool() {
    const l = activeLayer();
    if (l.kind !== "draw") return;
    addFrame(l, state.playhead);
    bump();
    go(state.playhead + 1);
  }
  function keyTool() {
    const l = activeLayer();
    if (l.kind !== "draw") return;
    insertKeyframe(l, state.playhead, canvasOps);
    bump();
    go(state.playhead + 1);
  }
  function dupTool() {
    const l = activeLayer();
    if (l.kind !== "draw") return;
    duplicateKeyframe(l, state.playhead, canvasOps);
    bump();
    go(state.playhead + 1);
  }
  function holdTool() {
    const l = activeLayer();
    if (l.kind !== "draw") return;
    setHold(l, state.playhead);
    bump();
  }
  function deleteTool() {
    const l = activeLayer();
    if (l.kind !== "draw") return;
    deleteFrame(l, state.playhead);
    bump();
  }

  const toolBtn =
    "w-7 h-7 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover border border-border";
</script>

<div class="border-t border-border bg-surface text-text p-2 text-sm">
  <div class="flex gap-1 mb-2">
    <button class={toolBtn} title="Add frame (after current)" onclick={frameTool}><Plus size={16} /></button>
    <button class={toolBtn} title="Insert keyframe (after current)" onclick={keyTool}><Diamond size={16} /></button>
    <button class={toolBtn} title="Duplicate keyframe (after current)" onclick={dupTool}><Copy size={16} /></button>
    <button class={toolBtn} title="Hold (clear keyframe)" onclick={holdTool}><Minus size={16} /></button>
    <button class={toolBtn} title="Delete frame" onclick={deleteTool}><Trash2 size={16} /></button>
  </div>

  <!-- frame-number header -->
  <div class="flex items-center gap-1 mb-1">
    <span class="w-20"></span>
    {#each Array(state.project.frameCount) as _, f}
      <span class="w-6 text-center text-[10px] leading-none"
            class:text-accent={f === state.playhead}
            class:text-text-muted={f !== state.playhead}>{f + 1}</span>
    {/each}
  </div>

  {#each [...state.project.layers].reverse() as layer (layer.id)}
    <div class="flex items-center gap-1"
         class:opacity-100={layer.id === state.activeLayerId}
         class:opacity-70={layer.id !== state.activeLayerId}>
      <span class="w-20 truncate text-text-secondary">{layer.name}</span>
      {#if layer.kind === "draw"}
        {#each Array(state.project.frameCount) as _, f}
          <button
            class="w-6 h-6 border border-border leading-none text-xs"
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
