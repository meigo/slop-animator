<script module lang="ts">
  /** Keep ratio, remembered for the session (as slop-paint's): off at first. */
  let keepRatioSession = false;
</script>

<script lang="ts">
  import { Link, Unlink } from "@lucide/svelte";
  import {
    state as appState,
    replaceProject,
    resizeProject,
    autosaveActions,
  } from "../state/appState.svelte";
  import NumberField from "./NumberField.svelte";
  import { createProject } from "../anim/document";
  import { clearAutosave, pruneUnusedMedia } from "../persist/autosave";
  import { linkedSize, type ResizeMode, type Anchor } from "../anim/resize";

  const PRESETS = [
    { label: "1920×1080", w: 1920, h: 1080 },
    { label: "1280×720", w: 1280, h: 720 },
    { label: "1080×1080", w: 1080, h: 1080 },
    { label: "1080×1920", w: 1080, h: 1920 },
    { label: "1024×768", w: 1024, h: 768 },
  ];
  /** Keep the document's width : height while typing one side (2026-10-02, slop-paint bb3ef4e):
   *  the other side follows from the DOCUMENT's current ratio, so it never drifts as you type. */
  let locked = $state(keepRatioSession);
  const linking = () => locked && appState.sizeDialog.mode === "resize";
  function setW(v: number) {
    w = v;
    if (linking() && Number.isFinite(v))
      h = linkedSize(v, appState.project.width, appState.project.height);
  }
  function setH(v: number) {
    h = v;
    if (linking() && Number.isFinite(v))
      w = linkedSize(v, appState.project.height, appState.project.width);
  }
  function toggleLocked() {
    locked = !locked;
    keepRatioSession = locked;
    // Locking takes the ratio from the document: bring the height in line with the width.
    if (locked) h = linkedSize(w, appState.project.width, appState.project.height);
  }

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
  async function confirm() {
    const cw = Math.max(16, Math.min(8192, Math.round(w)));
    const ch = Math.max(16, Math.min(8192, Math.round(h)));
    if (appState.sizeDialog.mode === "new") {
      // The one remaining irreversible action reachable in a single tap: `replaceProject` clears
      // history and `clearAutosave` drops the latest autosave — so there is nothing to undo it WITH
      // afterwards but File ▸ Restore autosave…, whose older copies (and the reference media they
      // point at: `pruneUnusedMedia`, no longer a clear-all) New leaves in place. Until now this
      // dialog read as a size picker, and Create looked as harmless as Resize's. Native `confirm`
      // matches the existing destructive gate on shortening the animation (Playbar/Timeline), rather
      // than inventing a second pattern.
      if (
        !window.confirm(
          "Start a new project?\n\nThe current project is discarded and its latest autosave cleared. Undo can't bring it back — only an older copy in File ▸ Restore autosave… might.",
        )
      )
        return; // dialog stays open — cancelling the guard must not also cancel the intent
      // Before the latest copy is cleared below. If it can't be set aside, New stops here (the
      // message is up): clearing it would delete the only good copy.
      if (!((await autosaveActions.setAsideIfPaused?.()) ?? true)) {
        close();
        return;
      }
      replaceProject(createProject({ width: cw, height: ch }));
      clearAutosave()
        .then(() => pruneUnusedMedia(appState.project.layers))
        .catch((e) => console.error("clearing the autosave failed", e));
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
            class:ui-on={w === p.w && h === p.h}
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
          <NumberField
            class="w-20 bg-surface border border-border text-text px-1"
            value={w}
            min={16}
            max={8192}
            step={8}
            pxPerStep={4}
            title="Canvas width in pixels"
            ariaLabel="Canvas width"
            onInput={setW}
            onCommit={setW}
          /></label
        >
        <label class="flex items-center gap-1 text-text-secondary"
          >H
          <NumberField
            class="w-20 bg-surface border border-border text-text px-1"
            value={h}
            min={16}
            max={8192}
            step={8}
            pxPerStep={4}
            title="Canvas height in pixels"
            ariaLabel="Canvas height"
            onInput={setH}
            onCommit={setH}
          /></label
        >
      </div>

      {#if appState.sizeDialog.mode === "resize"}
        <button
          class="flex w-fit items-center gap-1 rounded px-1.5 py-0.5 text-xs text-text-secondary hover:bg-surface-hover"
          class:ui-on={locked}
          aria-pressed={locked}
          title={locked
            ? "Ratio locked — typing one side sets the other; tap to unlock"
            : "Lock the ratio: keep the document's width to height while typing one side"}
          onclick={toggleLocked}
        >
          {#if locked}<Link size={14} />{:else}<Unlink size={14} />{/if}
          Keep ratio
        </button>
        <div class="flex items-center gap-2">
          <span class="text-text-secondary w-14">Mode</span>
          <button
            class="px-2 py-1 rounded border border-border text-xs"
            class:ui-on={mode === "scale"}
            onclick={() => (mode = "scale")}>Scale</button
          >
          <button
            class="px-2 py-1 rounded border border-border text-xs"
            class:ui-on={mode === "crop"}
            onclick={() => (mode = "crop")}>Crop</button
          >
        </div>
        <div class="flex items-center gap-2">
          <span class="text-text-secondary w-14">Anchor</span>
          <div class="grid grid-cols-3 gap-px w-13">
            {#each ANCHORS as a (a)}
              <button
                class="h-4 border border-border hover:bg-surface-hover"
                class:ui-on={a.ax === anchor.ax && a.ay === anchor.ay}
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
        <p class="text-xs/snug text-warn">
          Replaces the current project and clears its autosave. Save it first if you want to keep
          it.
        </p>
      {/if}

      <div class="flex justify-end gap-2 mt-1">
        <button class="px-3 py-1 rounded hover:bg-surface-hover text-text-secondary" onclick={close}
          >Cancel</button
        >
        <button class="px-3 py-1 rounded bg-accent text-accent-text" onclick={confirm}
          >{appState.sizeDialog.mode === "new" ? "Create" : "Resize"}</button
        >
      </div>
    </div>
  </div>
{/if}
