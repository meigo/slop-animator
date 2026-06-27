<script lang="ts">
  import { state as appState, bump } from "../state/appState.svelte";

  function close() {
    appState.settingsOpen = false;
  }
  function setBgColor(v: string) {
    appState.project.bgColor = v;
    bump();
  }
  function setTransparent(v: boolean) {
    appState.project.transparentBg = v;
    bump();
  }
  function setFps(v: number) {
    appState.project.fps = Math.max(1, Math.min(60, Math.round(v) || 1));
    bump();
  }
  function openResize() {
    appState.settingsOpen = false;
    appState.sizeDialog.mode = "resize";
    appState.sizeDialog.open = true;
  }
</script>

{#if appState.settingsOpen}
  <div
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
    onclick={close}
    role="presentation"
  >
    <div
      class="w-80 p-4 rounded-lg bg-surface border border-border shadow-lg text-text text-sm flex flex-col gap-4"
      onclick={(e) => e.stopPropagation()}
      role="presentation"
    >
      <div class="font-semibold">Project settings</div>

      <div class="flex flex-col gap-2">
        <span class="text-text-secondary text-xs uppercase tracking-wide">Background</span>
        <label class="flex items-center gap-2 text-text-secondary">
          Color
          <input
            type="color"
            class="w-10 h-6 bg-surface border border-border rounded"
            value={appState.project.bgColor}
            oninput={(e) => setBgColor(e.currentTarget.value)}
          />
        </label>
        <label class="flex items-center gap-2 text-text-secondary">
          <input
            type="checkbox"
            checked={appState.project.transparentBg}
            onchange={(e) => setTransparent(e.currentTarget.checked)}
          /> Transparent
        </label>
        <span class="text-text-secondary text-xs"
          >When transparent, this color flattens video exports.</span
        >
      </div>

      <div class="flex flex-col gap-2">
        <span class="text-text-secondary text-xs uppercase tracking-wide">Playback</span>
        <label class="flex items-center gap-2 text-text-secondary">
          fps
          <input
            type="number"
            min="1"
            max="60"
            class="w-20 bg-surface border border-border text-text px-1"
            value={appState.project.fps}
            oninput={(e) => setFps(e.currentTarget.valueAsNumber)}
          />
        </label>
      </div>

      <div class="flex items-center gap-3">
        <span class="text-text-secondary text-xs uppercase tracking-wide">Canvas</span>
        <span>{appState.project.width}×{appState.project.height}</span>
        <button
          class="px-2 py-1 rounded border border-border text-xs hover:bg-surface-hover"
          onclick={openResize}>Resize…</button
        >
      </div>

      <div class="flex justify-end mt-1">
        <button class="px-3 py-1 rounded bg-surface-active text-text" onclick={close}>Close</button>
      </div>
    </div>
  </div>
{/if}
