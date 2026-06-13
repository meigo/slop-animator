<script lang="ts">
  import Toolbar from "./lib/Toolbar.svelte";
  import Canvas from "./lib/Canvas.svelte";
  import LayerList from "./lib/LayerList.svelte";
  import Timeline from "./lib/Timeline.svelte";
  import { state, history } from "./state/appState.svelte";

  function onKey(e: KeyboardEvent) {
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) history.redo(); else history.undo();
    } else if (e.key === "b") state.tool = "brush";
    else if (e.key === "e") state.tool = "eraser";
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
  <Timeline />
</div>
