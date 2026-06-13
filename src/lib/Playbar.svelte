<script lang="ts">
  import { state, bump, playbackController } from "../state/appState.svelte";

  const FPS_PRESETS = [6, 8, 12, 24];

  function go(f: number) {
    state.playhead = Math.max(0, Math.min(state.project.frameCount - 1, f));
  }
  function setFps(v: number) {
    state.project.fps = Math.max(1, Math.min(60, Math.round(v)));
    bump();
  }
</script>

<div class="flex items-center gap-3 p-2 border-t border-neutral-300 bg-neutral-100 text-sm">
  <!-- transport -->
  <div class="flex items-center gap-1">
    <button title="First frame" onclick={() => go(0)}>⏮</button>
    <button title="Previous frame" onclick={() => go(state.playhead - 1)}>◀</button>
    <button title="Play / pause" class="px-2 font-semibold" onclick={() => playbackController.toggle()}>
      {state.playback.isPlaying ? "⏸" : "▶"}
    </button>
    <button title="Next frame" onclick={() => go(state.playhead + 1)}>▶▎</button>
    <button title="Last frame" onclick={() => go(state.project.frameCount - 1)}>⏭</button>
    <label class="flex items-center gap-1 ml-1">
      <input type="checkbox" bind:checked={state.playback.loop} /> loop
    </label>
  </div>

  <span class="text-neutral-500">Frame {state.playhead + 1}/{state.project.frameCount}</span>

  <!-- fps -->
  <div class="flex items-center gap-1">
    <span>fps</span>
    <input class="w-12 border border-neutral-300 px-1" type="number" min="1" max="60"
           value={state.project.fps} onchange={(e) => setFps(+e.currentTarget.value)} />
    {#each FPS_PRESETS as p}
      <button class:font-bold={state.project.fps === p} onclick={() => setFps(p)}>{p}</button>
    {/each}
  </div>

  <!-- onion -->
  <div class="flex items-center gap-1 ml-auto">
    <label class="flex items-center gap-1">
      <input type="checkbox" bind:checked={state.onion.enabled} onchange={bump} /> onion
    </label>
    <span class="text-neutral-500">prev</span>
    <input class="w-10 border border-neutral-300 px-1" type="number" min="0" max="3"
           bind:value={state.onion.prev} onchange={bump} />
    <span class="text-neutral-500">next</span>
    <input class="w-10 border border-neutral-300 px-1" type="number" min="0" max="3"
           bind:value={state.onion.next} onchange={bump} />
    <label class="flex items-center gap-1">
      <input type="checkbox" bind:checked={state.onion.allLayers} onchange={bump} /> all layers
    </label>
  </div>
</div>
