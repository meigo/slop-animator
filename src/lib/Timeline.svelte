<script lang="ts">
  import { Plus, Diamond, Copy, Minus, Trash2 } from "@lucide/svelte";
  import { state, canvasOps, activeLayer, bump } from "../state/appState.svelte";
  import { addFrame, insertKeyframe, duplicateKeyframe, setHold, deleteFrame } from "../anim/timeline";
  import { resolveKeyframeIndex, type Cell } from "../anim/document";

  const CELL_W = 24;   // px, fixed column width (box-border cells, no gap → contiguous columns)
  const LABEL_W = 80;  // px, layer-name gutter

  // ◆ keyframe · blank (past end or before first key) — hold over a key
  function cellLabel(cells: Cell[], f: number): string {
    if (f >= cells.length) return "";
    if (cells[f].kind === "key") return "◆";
    return resolveKeyframeIndex(cells, f) === null ? "·" : "—";
  }

  // Ruler shows frame 1, then every 5th frame (1, 5, 10, 15, …); other columns are bare ticks.
  function rulerLabel(f: number): string {
    return f === 0 || (f + 1) % 5 === 0 ? String(f + 1) : "";
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

  <!-- aligned grid: ruler + layer rows share one column geometry; a single playhead line spans them -->
  <div class="relative overflow-x-auto">
    <!-- playhead line (visual, non-interactive); centered on the current column -->
    <div class="absolute top-0 bottom-0 w-0.5 bg-accent pointer-events-none z-10"
         style="left: {LABEL_W + state.playhead * CELL_W + CELL_W / 2 - 1}px"></div>

    <!-- ruler -->
    <div class="flex items-stretch mb-1">
      <span class="shrink-0" style="width: {LABEL_W}px"></span>
      <div class="flex">
        {#each Array(state.project.frameCount) as _, f}
          <div class="box-border h-4 border-r border-border text-[10px] leading-4 text-center text-text-muted"
               class:text-accent={f === state.playhead}
               style="width: {CELL_W}px">{rulerLabel(f)}</div>
        {/each}
      </div>
    </div>

    <!-- layer rows (top layer first) -->
    {#each [...state.project.layers].reverse() as layer (layer.id)}
      <div class="flex items-center"
           class:opacity-100={layer.id === state.activeLayerId}
           class:opacity-70={layer.id !== state.activeLayerId}>
        <span class="shrink-0 truncate text-text-secondary pr-1" style="width: {LABEL_W}px">{layer.name}</span>
        {#if layer.kind === "draw"}
          <div class="flex">
            {#each Array(state.project.frameCount) as _, f}
              <button
                class="box-border h-6 border border-border leading-none text-xs"
                class:bg-selection={f === state.playhead}
                class:text-accent-text={f === state.playhead}
                style="width: {CELL_W}px"
                onclick={() => go(f)}>{cellLabel(layer.cells, f)}</button>
            {/each}
          </div>
        {:else}
          <span class="text-xs text-text-muted ml-1">ref</span>
        {/if}
      </div>
    {/each}
  </div>
</div>
