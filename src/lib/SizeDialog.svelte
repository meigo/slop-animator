<script lang="ts">
  import { state as appState, replaceProject, resizeProject } from "../state/appState.svelte";
  import { createProject } from "../anim/document";
  import { clearAutosave } from "../persist/autosave";
  import { clearAllMedia } from "../persist/media-store";
  import type { ResizeMode, Anchor } from "../anim/resize";

  const PRESETS = [
    { label: "1920×1080", w: 1920, h: 1080 },
    { label: "1280×720", w: 1280, h: 720 },
    { label: "1080×1080", w: 1080, h: 1080 },
    { label: "1080×1920", w: 1080, h: 1920 },
    { label: "1024×768", w: 1024, h: 768 },
  ];
  const ANCHORS: Anchor[] = [
    { ax: 0, ay: 0 },
    { ax: 0.5, ay: 0 },
    { ax: 1, ay: 0 },
    { ax: 0, ay: 0.5 },
    { ax: 0.5, ay: 0.5 },
    { ax: 1, ay: 0.5 },
    { ax: 0, ay: 1 },
    { ax: 0.5, ay: 1 },
    { ax: 1, ay: 1 },
  ];

  let w = $state(1280);
  let h = $state(720);
  let mode: ResizeMode = $state("scale");
  let anchor: Anchor = $state({ ax: 0.5, ay: 0.5 });

  // Prefill from the current document each time the dialog opens.
  $effect(() => {
    if (appState.sizeDialog.open) {
      w = appState.project.width;
      h = appState.project.height;
      mode = "scale";
      anchor = { ax: 0.5, ay: 0.5 };
    }
  });

  function close() {
    appState.sizeDialog.open = false;
  }
  function confirm() {
    const cw = Math.max(16, Math.min(8192, Math.round(w)));
    const ch = Math.max(16, Math.min(8192, Math.round(h)));
    if (appState.sizeDialog.mode === "new") {
      // The one remaining irreversible action reachable in a single tap: `replaceProject` clears
      // history, `clearAutosave` drops the only restorable copy, and `clearAllMedia` discards the
      // stored reference bytes — so there is nothing to undo it WITH afterwards. Until now this
      // dialog read as a size picker, and Create looked as harmless as Resize's. Native `confirm`
      // matches the existing destructive gate on shortening the animation (Playbar/Timeline), rather
      // than inventing a second pattern.
      if (
        !window.confirm(
          "Start a new project?\n\nThe current project, its autosave and any stored reference media are discarded. This can't be undone.",
        )
      )
        return; // dialog stays open — cancelling the guard must not also cancel the intent
      replaceProject(createProject({ width: cw, height: ch }));
      clearAutosave();
      void clearAllMedia();
    } else {
      resizeProject(cw, ch, mode, anchor);
    }
    close();
  }
</script>

{#if appState.sizeDialog.open}
  <div
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
    onclick={close}
    role="presentation"
  >
    <div
      class="w-80 p-4 rounded-lg bg-surface border border-border shadow-lg text-text text-sm flex flex-col gap-3"
      onclick={(e) => e.stopPropagation()}
      role="presentation"
    >
      <div class="font-semibold">
        {appState.sizeDialog.mode === "new" ? "New project" : "Resize canvas"}
      </div>

      <div class="flex flex-wrap gap-1">
        {#each PRESETS as p (p)}
          <button
            class="px-2 py-1 rounded border border-border text-xs hover:bg-surface-hover"
            class:bg-surface-active={w === p.w && h === p.h}
            onclick={() => {
              w = p.w;
              h = p.h;
            }}>{p.label}</button
          >
        {/each}
      </div>

      <div class="flex items-center gap-3">
        <label class="flex items-center gap-1 text-text-secondary"
          >W
          <input
            class="w-20 bg-surface border border-border text-text px-1"
            type="number"
            min="16"
            max="8192"
            bind:value={w}
          /></label
        >
        <label class="flex items-center gap-1 text-text-secondary"
          >H
          <input
            class="w-20 bg-surface border border-border text-text px-1"
            type="number"
            min="16"
            max="8192"
            bind:value={h}
          /></label
        >
      </div>

      {#if appState.sizeDialog.mode === "resize"}
        <div class="flex items-center gap-2">
          <span class="text-text-secondary w-14">Mode</span>
          <button
            class="px-2 py-1 rounded border border-border text-xs"
            class:bg-surface-active={mode === "scale"}
            onclick={() => (mode = "scale")}>Scale</button
          >
          <button
            class="px-2 py-1 rounded border border-border text-xs"
            class:bg-surface-active={mode === "crop"}
            onclick={() => (mode = "crop")}>Crop</button
          >
        </div>
        <div class="flex items-center gap-2">
          <span class="text-text-secondary w-14">Anchor</span>
          <div class="grid grid-cols-3 gap-px w-13">
            {#each ANCHORS as a (a)}
              <button
                class="h-4 border border-border hover:bg-surface-hover"
                class:bg-surface-active={a.ax === anchor.ax && a.ay === anchor.ay}
                onclick={() => (anchor = a)}
                aria-label="Anchor {a.ax},{a.ay}"
              ></button>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Forewarn here, ask once on Create — the same shape the destructive length drag uses, so the
           prompt is never a surprise. Amber, not red: red is reserved but unused in this codebase and
           would need its own contrast pass; the native confirm is the actual gate. -->
      {#if appState.sizeDialog.mode === "new"}
        <p class="text-xs/snug text-amber-500">
          Replaces the current project and clears its autosave. Save it first if you want to keep
          it.
        </p>
      {/if}

      <div class="flex justify-end gap-2 mt-1">
        <button class="px-3 py-1 rounded hover:bg-surface-hover text-text-secondary" onclick={close}
          >Cancel</button
        >
        <button class="px-3 py-1 rounded bg-surface-active text-text" onclick={confirm}
          >{appState.sizeDialog.mode === "new" ? "Create" : "Resize"}</button
        >
      </div>
    </div>
  </div>
{/if}
