<script lang="ts">
  import {
    state as appState,
    bump,
    seekPlayhead,
    playbackController,
    setAnimationLength,
    setPlayRangeIn,
    setPlayRangeOut,
    clearPlayRange,
  } from "../state/appState.svelte";
  import { countKeyframesPastLength } from "../anim/document";
  import { effectiveRange } from "../anim/playback";
  import { clickOutside } from "./click-outside";
  import {
    SkipBack,
    ChevronLeft,
    Play,
    Pause,
    ChevronRight,
    SkipForward,
    Settings,
    Repeat,
    X,
  } from "@lucide/svelte";

  const FPS_PRESETS = [6, 8, 12, 24];
  let settingsOpen = $state(false);

  const frameDigits = $derived(String(appState.project.frameCount).length);

  function go(f: number) {
    seekPlayhead(f);
  }
  function setFps(v: number) {
    appState.project.fps = Math.max(1, Math.min(60, Math.round(v)));
    bump();
  }
  function commitLength(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const n = Math.max(1, Math.min(9999, Math.floor(+input.value)));
    if (n !== appState.project.frameCount) {
      if (n < appState.project.frameCount) {
        const dropped = countKeyframesPastLength(appState.project, n);
        if (
          dropped > 0 &&
          !confirm(`Shorten to ${n} frames? This removes ${dropped} keyframe(s).`)
        ) {
          input.value = String(appState.project.frameCount); // cancelled — revert the field
          return;
        }
      }
      setAnimationLength(n);
    }
    input.value = String(appState.project.frameCount); // normalize the displayed value (clamp / no-op)
  }

  const btn =
    "w-7 h-7 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover border border-border";
  // Text buttons need horizontal padding instead of a fixed square ("Out" doesn't fit w-7).
  const textBtn =
    "h-7 px-2 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover border border-border";
  const divider = "w-px h-5 bg-border mx-1"; // same separator the timeline tool bar uses
</script>

<div class="flex items-center gap-2 p-2 border-t border-border bg-surface text-text text-sm">
  <!-- transport -->
  <div class="flex items-center gap-1">
    <button class={btn} title="First frame" onclick={() => go(0)}><SkipBack size={16} /></button>
    <button class={btn} title="Previous frame" onclick={() => go(appState.playhead - 1)}
      ><ChevronLeft size={20} strokeWidth={1.6} /></button
    >
    <button
      class="{btn} font-semibold"
      title="Play / pause"
      onclick={() => playbackController.toggle()}
    >
      {#if appState.playback.isPlaying}<Pause size={16} />{:else}<Play size={16} />{/if}
    </button>
    <button class={btn} title="Next frame" onclick={() => go(appState.playhead + 1)}
      ><ChevronRight size={20} strokeWidth={1.6} /></button
    >
    <button class={btn} title="Last frame" onclick={() => go(appState.project.frameCount - 1)}
      ><SkipForward size={16} /></button
    >
  </div>

  <span class={divider}></span>

  <span class="text-text-secondary tabular-nums"
    >Frame <span class="inline-block text-right" style="min-width: {frameDigits}ch"
      >{appState.playhead + 1}</span
    >/{appState.project.frameCount}</span
  >
  <label class="flex items-center gap-1 text-text-secondary"
    >Length
    <input
      class="w-14 bg-surface border border-border text-text px-1"
      type="number"
      min="1"
      max="9999"
      value={appState.project.frameCount}
      onchange={commitLength}
    />
  </label>

  <span class={divider}></span>

  <div class="flex items-center gap-1 text-text-secondary">
    <button class={textBtn} title="Set range in-point to current frame" onclick={setPlayRangeIn}
      >In</button
    >
    <button class={textBtn} title="Set range out-point to current frame" onclick={setPlayRangeOut}
      >Out</button
    >
    {#if appState.playback.range}
      {@const er = effectiveRange(appState.playback.range, appState.project.frameCount)}
      <span class="tabular-nums">{er.start + 1}–{er.end + 1}</span>
      <button class={btn} title="Clear play range" onclick={clearPlayRange}><X size={16} /></button>
    {/if}
    <!-- Loop is a transport MODE, not a project setting: it is flipped constantly while working,
         where fps is set once. It sits with In/Out because looping a range is one workflow, and it
         uses the same on-state treatment as the onion and boil toggles — visible toggle on the bar,
         params behind the gear. It lived in the settings popover until 2026-08-16. -->
    <button
      class={btn}
      class:bg-surface-active={appState.playback.loop}
      title={appState.playback.loop ? "Looping — click to play once" : "Play once — click to loop"}
      aria-pressed={appState.playback.loop}
      onclick={() => (appState.playback.loop = !appState.playback.loop)}
      ><Repeat size={16} /></button
    >
  </div>

  <div class="ml-auto flex items-center gap-1">
    <span class={divider}></span>
    <!-- playback settings -->
    <div class="relative" use:clickOutside={() => (settingsOpen = false)}>
      <button
        class={btn}
        class:bg-surface-active={settingsOpen}
        title="Playback settings"
        onclick={() => (settingsOpen = !settingsOpen)}
      >
        <Settings size={16} />
      </button>
      {#if settingsOpen}
        <div
          class="absolute right-0 bottom-full mb-2 z-30 w-48 p-3 rounded-lg bg-surface border border-border shadow-md flex flex-col gap-2 text-xs"
        >
          <div class="flex items-center gap-2">
            <span class="text-text-secondary w-8">fps</span>
            <input
              class="w-12 bg-surface border border-border text-text px-1"
              type="number"
              min="1"
              max="60"
              value={appState.project.fps}
              onchange={(e) => setFps(+e.currentTarget.value)}
            />
            <div class="flex gap-px ml-auto">
              {#each FPS_PRESETS as p (p)}
                <button
                  class="px-1.5 py-0.5 rounded"
                  class:bg-surface-active={appState.project.fps === p}
                  onclick={() => setFps(p)}>{p}</button
                >
              {/each}
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>
