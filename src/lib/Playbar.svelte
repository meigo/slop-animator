<script lang="ts">
  import { state, bump, playbackController } from "../state/appState.svelte";
  import { SkipBack, ChevronLeft, Play, Pause, ChevronRight, SkipForward, Settings } from "@lucide/svelte";

  const FPS_PRESETS = [6, 8, 12, 24];
  // Playbar has no runes, so a plain let is reactive (legacy mode).
  let settingsOpen = false;

  function go(f: number) {
    state.playhead = Math.max(0, Math.min(state.project.frameCount - 1, f));
  }
  function setFps(v: number) {
    state.project.fps = Math.max(1, Math.min(60, Math.round(v)));
    bump();
  }

  const btn = "w-7 h-7 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover";
</script>

<div class="flex items-center gap-2 p-2 border-t border-border bg-surface text-text text-sm">
  <!-- transport -->
  <div class="flex items-center gap-1">
    <button class={btn} title="First frame" onclick={() => go(0)}><SkipBack size={16} /></button>
    <button class={btn} title="Previous frame" onclick={() => go(state.playhead - 1)}><ChevronLeft size={16} /></button>
    <button class="{btn} font-semibold" title="Play / pause" onclick={() => playbackController.toggle()}>
      {#if state.playback.isPlaying}<Pause size={16} />{:else}<Play size={16} />{/if}
    </button>
    <button class={btn} title="Next frame" onclick={() => go(state.playhead + 1)}><ChevronRight size={16} /></button>
    <button class={btn} title="Last frame" onclick={() => go(state.project.frameCount - 1)}><SkipForward size={16} /></button>
  </div>

  <span class="text-text-secondary">Frame {state.playhead + 1}/{state.project.frameCount}</span>

  <div class="ml-auto flex items-center gap-1">
    <!-- playback settings -->
    <div class="relative">
      <button class={btn} class:bg-surface-active={settingsOpen} title="Playback settings"
              onclick={() => (settingsOpen = !settingsOpen)}>
        <Settings size={16} />
      </button>
      {#if settingsOpen}
        <div class="absolute right-0 bottom-full mb-2 z-30 w-48 p-3 rounded-lg bg-surface border border-border shadow-md flex flex-col gap-2 text-xs">
          <div class="flex items-center gap-2">
            <span class="text-text-secondary w-8">fps</span>
            <input class="w-12 bg-surface border border-border text-text px-1" type="number" min="1" max="60"
                   value={state.project.fps} onchange={(e) => setFps(+e.currentTarget.value)} />
            <div class="flex gap-px ml-auto">
              {#each FPS_PRESETS as p}
                <button class="px-1.5 py-0.5 rounded" class:bg-surface-active={state.project.fps === p}
                        onclick={() => setFps(p)}>{p}</button>
              {/each}
            </div>
          </div>
          <label class="flex items-center gap-2"><input type="checkbox" bind:checked={state.playback.loop} /> <span class="text-text-secondary">Loop playback</span></label>
        </div>
      {/if}
    </div>
  </div>
</div>
