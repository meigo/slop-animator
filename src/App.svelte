<script lang="ts">
  import Toolbar from "./lib/Toolbar.svelte";
  import Canvas from "./lib/Canvas.svelte";
  import LayerList from "./lib/LayerList.svelte";
  import Playbar from "./lib/Playbar.svelte";
  import Timeline from "./lib/Timeline.svelte";
  import { state, history, bump, playbackController, selectionRef } from "./state/appState.svelte";

  function onKey(e: KeyboardEvent) {
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) history.redo(); else history.undo();
      return;
    }
    // Don't hijack single-key shortcuts while typing in a field (e.g. the fps input).
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (e.key === "b") state.tool = "brush";
    else if (e.key === "e") state.tool = "eraser";
    else if (e.key === "g") state.tool = "fill";
    else if (e.key === "s") state.tool = "select";
    else if (e.key === "l") state.tool = "lasso";
    else if (e.key === "Escape") { if (selectionRef.current?.active) selectionRef.current.cancel(); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (selectionRef.current?.active) selectionRef.current.commit();
      else playbackController.toggle();
    }
    else if (e.key === "k") { e.preventDefault(); playbackController.toggle(); }
    else if (e.key === "o") { state.onion.enabled = !state.onion.enabled; bump(); }
    else if (e.key === ",") state.playhead = Math.max(0, state.playhead - 1);
    else if (e.key === ".") state.playhead = Math.min(state.project.frameCount - 1, state.playhead + 1);
    else if (e.key === "[") state.brush.size = Math.max(1, state.brush.size - 1);
    else if (e.key === "]") state.brush.size = Math.min(60, state.brush.size + 1);
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="h-full flex flex-col">
  <Toolbar />
  <div class="flex-1 flex min-h-0">
    <Canvas />
    <LayerList />
  </div>
  <Playbar />
  <Timeline />
</div>
