<script lang="ts">
  import { state, bump, playbackController } from "../state/appState.svelte";
  import { SkipBack, ChevronLeft, Play, Pause, ChevronRight, SkipForward } from "@lucide/svelte";

  const FPS_PRESETS = [6, 8, 12, 24];

  function go(f: number) {
    state.playhead = Math.max(0, Math.min(state.project.frameCount - 1, f));
  }
  function setFps(v: number) {
    state.project.fps = Math.max(1, Math.min(60, Math.round(v)));
    bump();
  }
</script>

<div class="flex items-center gap-3 p-2 border-t border-border bg-surface text-text text-sm">
  <!-- transport -->
  <div class="flex items-center gap-1">
    <button class="w-7 h-7 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover" title="First frame" onclick={() => go(0)}><SkipBack size={16}/></button>
    <button class="w-7 h-7 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover" title="Previous frame" onclick={() => go(state.playhead - 1)}><ChevronLeft size={16}/></button>
    <button class="w-7 h-7 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover font-semibold" title="Play / pause" onclick={() => playbackController.toggle()}>
      {#if state.playback.isPlaying}<Pause size={16}/>{:else}<Play size={16}/>{/if}
    </button>
    <button class="w-7 h-7 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover" title="Next frame" onclick={() => go(state.playhead + 1)}><ChevronRight size={16}/></button>
    <button class="w-7 h-7 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover" title="Last frame" onclick={() => go(state.project.frameCount - 1)}><SkipForward size={16}/></button>
    <label class="flex items-center gap-1 ml-1">
      <input type="checkbox" bind:checked={state.playback.loop} /> loop
    </label>
  </div>

  <span class="text-text-secondary">Frame {state.playhead + 1}/{state.project.frameCount}</span>

  <!-- fps -->
  <div class="flex items-center gap-1">
    <span class="text-text-secondary">fps</span>
    <input class="w-12 bg-surface border border-border text-text px-1" type="number" min="1" max="60"
           value={state.project.fps} onchange={(e) => setFps(+e.currentTarget.value)} />
    {#each FPS_PRESETS as p}
      <button class:font-bold={state.project.fps === p} onclick={() => setFps(p)}>{p}</button>
    {/each}
  </div>

  <!-- onion -->
  <div class="flex items-center gap-1 ml-auto">
    <label class="flex items-center gap-1">
      <input type="checkbox" bind:checked={state.onion.enabled} onchange={bump} /> <span class="text-text-secondary">onion</span>
    </label>
    <span class="text-text-secondary">prev</span>
    <input class="w-10 bg-surface border border-border text-text px-1" type="number" min="0" max="3"
           bind:value={state.onion.prev} onchange={bump} />
    <span class="text-text-secondary">next</span>
    <input class="w-10 bg-surface border border-border text-text px-1" type="number" min="0" max="3"
           bind:value={state.onion.next} onchange={bump} />
    <label class="flex items-center gap-1">
      <input type="checkbox" bind:checked={state.onion.allLayers} onchange={bump} /> all layers
    </label>
  </div>
</div>
