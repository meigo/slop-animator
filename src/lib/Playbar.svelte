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
    addMarkerAtPlayhead,
    deleteMarkerAt,
    markerActions,
  } from "../state/appState.svelte";
  import { countKeyframesPastLength } from "../anim/document";
  import { markerAt } from "../anim/markers";
  import { clickOutside } from "./click-outside";
  import NumberField from "./NumberField.svelte";
  import {
    ArrowLeftToLine,
    ArrowRightToLine,
    BookmarkPlus,
    BookmarkOff,
    ChevronLeft,
    ChevronRight,
    Pause,
    Play,
    Repeat,
    Settings,
    SkipBack,
    SkipForward,
    X,
  } from "@lucide/svelte";

  const FPS_PRESETS = [6, 8, 12, 24];
  let settingsOpen = $state(false);

  function go(f: number) {
    seekPlayhead(f);
  }
  function setFps(v: number) {
    appState.project.fps = Math.max(1, Math.min(60, Math.round(v)));
    bump();
  }
  // Called once per gesture (release of a drag, Enter, or blur) — never per pointermove, so the
  // confirm below cannot fire mid-drag and a drag cannot leave a trail of undo entries.
  function commitLength(n: number) {
    const target = Math.max(1, Math.min(9999, Math.floor(n)));
    if (target === appState.project.frameCount) return;
    if (target < appState.project.frameCount) {
      const dropped = countKeyframesPastLength(appState.project, target);
      if (
        dropped > 0 &&
        !confirm(`Shorten to ${target} frames? This removes ${dropped} keyframe(s).`)
      )
        return; // cancelled — NumberField re-reads the unchanged store value and snaps back
    }
    setAnimationLength(target);
  }

  let { variant = "transport" }: { variant?: "transport" | "settings" } = $props();

  /** The marker on the playhead's frame, if any — turns the add-marker button into delete. */
  const markerHere = $derived(markerAt(appState.project.markers ?? [], appState.playhead));

  const btn =
    "w-7 h-7 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover border border-border shrink-0";
  const divider = "mx-3 h-5 w-px shrink-0 bg-border";
</script>

{#if variant === "transport"}
  <div class="flex items-center gap-1 shrink-0">
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
    <!-- Loop is a transport MODE, not a project setting: it is flipped constantly while working,
         where fps is set once. It sits LAST in transport, where media players put it, and uses the
         same on-state treatment as the onion and boil toggles — visible toggle on the bar, params
         behind the gear. It lived in the settings popover until 2026-08-16. -->
    <button
      class={btn}
      class:ui-on={appState.playback.loop}
      title={appState.playback.loop ? "Looping — click to play once" : "Play once — click to loop"}
      aria-pressed={appState.playback.loop}
      onclick={() => (appState.playback.loop = !appState.playback.loop)}
      ><Repeat size={16} /></button
    >
  </div>

  <span class={divider}></span>

  <div class="flex items-center gap-1 text-text-secondary">
    <!-- The SAME glyphs slop-video-compositor and slop-audio-editor use for in/out, in the same
         order: left-to-line sets in, right-to-line sets out. They were text ("In"/"Out") here while
         those two icons were spent on the reference-clip trim buttons — so one glyph meant "set the
         in point" in two apps and "trim the end" in this one, mirrored as well as reused. Trim moved
         to the chevrons; see Timeline.svelte. -->
    <button
      class={btn}
      title="Set range in-point at the playhead"
      aria-label="Set range in"
      onclick={setPlayRangeIn}><ArrowLeftToLine size={16} /></button
    >
    <button
      class={btn}
      title="Set range out-point at the playhead"
      aria-label="Set range out"
      onclick={setPlayRangeOut}><ArrowRightToLine size={16} /></button
    >
    <!-- Clear only: no numeric range readout. The ruler draws the range in place, with warn edge
         markers over numbered frames, so the extent is legible where it lives, and the status bar
         already carries the frame readout. The family layout agrees (SLOP-TIMELINE-UI.md §"transport
         row": set in / set out / clear, and the readout it names is the playhead's, not the range's)
         — slop-video-compositor reports range changes through its status line transiently rather than
         parking numbers in the bar.
         ALWAYS rendered, disabled and dimmed while no range is set (2026-09-14). It used to appear only
         with a range, which forced the marker button in front of it (a button after it would jump
         sideways) and split the range group apart. Now the order is In · Out · ✕ · marker and nothing
         on the bar moves; a lit ✕ is what says a range is set. -->
    <button
      class="{btn} disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
      title={appState.playback.range ? "Clear play range" : "No play range set"}
      aria-label="Clear play range"
      disabled={!appState.playback.range}
      onclick={clearPlayRange}><X size={16} /></button
    >
    <!-- Add / delete marker: in this group because markers and the play range both mark a moment on
         the timeline. After the range's always-present ✕, so its position never shifts. On an empty frame it adds a marker and opens its label
         field. On a frame that has one it becomes a warn-coloured delete, `BookmarkOff` because
         its strike-through changes the silhouette where BookmarkX's small ✕ went unnoticed (2026-09-14, saves the
         tap-again + Delete round trip; undoable). The `n` key stays add-or-edit on purpose: a key
         pressed without looking must never delete a note. Renaming is tap-again on the tag. -->
    {#if markerHere}
      <button
        class={btn.replace("text-text-secondary", "text-warn")}
        title={markerHere.label
          ? `Delete marker “${markerHere.label}” at playhead`
          : "Delete marker at playhead"}
        aria-label="Delete marker"
        onclick={() => deleteMarkerAt(appState.playhead)}><BookmarkOff size={16} /></button
      >
    {:else}
      <button
        class={btn}
        title="Add marker at playhead (N)"
        aria-label="Add marker"
        onclick={() => {
          addMarkerAtPlayhead();
          markerActions.openEditor?.(appState.playhead);
        }}><BookmarkPlus size={16} /></button
      >
    {/if}
  </div>
{:else}
  <!-- playback settings: fps + length, last on the merged timeline bar -->
  <div class="relative shrink-0" use:clickOutside={() => (settingsOpen = false)}>
    <button
      class={btn}
      class:ui-on={settingsOpen}
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
          <NumberField
            class="w-12 bg-surface border border-border text-text px-1"
            value={appState.project.fps}
            min={1}
            max={60}
            step={1}
            title="Frames per second"
            ariaLabel="Frames per second"
            onInput={setFps}
            onCommit={setFps}
          />
          <div class="flex gap-px ml-auto">
            {#each FPS_PRESETS as p (p)}
              <button
                class="px-1.5 py-0.5 rounded"
                class:ui-on={appState.project.fps === p}
                onclick={() => setFps(p)}>{p}</button
              >
            {/each}
          </div>
        </div>
        <!-- Length lives with fps: both are TIMING PARAMS you set rather than transport you flip.
               The common adjustment is dragging the ruler's right edge in the timeline; this is the
               type-an-exact-number path. -->
        <label class="flex items-center justify-between gap-2"
          >Length
          <NumberField
            class="w-16 bg-surface border border-border text-text px-1"
            value={appState.project.frameCount}
            min={1}
            max={9999}
            step={1}
            pxPerStep={6}
            title="Animation length in frames"
            ariaLabel="Animation length in frames"
            onCommit={commitLength}
          />
        </label>
      </div>
    {/if}
  </div>
{/if}
