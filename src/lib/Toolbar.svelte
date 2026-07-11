<script lang="ts">
  import {
    state as appState,
    undo,
    redo,
    bump,
    addLayerToProject,
    replaceProject,
    setAudioTrack,
    DPR,
    pasteImageReference,
    selectEyedropper,
  } from "../state/appState.svelte";
  import { loadImageLayer, loadVideoLayer } from "../anim/reference";
  import { loadAudioTrack } from "../audio/decode";
  import { saveProjectBlob, loadProjectBlob } from "../persist/project-file";
  import { downloadBlob } from "../export/download";
  import ToolbarMenu from "./ToolbarMenu.svelte";
  import {
    Paintbrush,
    Eraser,
    PaintBucket,
    BoxSelect,
    Lasso,
    Move,
    Undo2,
    Redo2,
    Workflow,
    PersonStanding,
    Pipette,
  } from "@lucide/svelte";

  const menuItem =
    "w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-hover flex items-center gap-2";

  let fileInput: HTMLInputElement;
  let pendingKind: "image" | "video" | "project" | "audio" = "image";

  function pick(kind: "image" | "video" | "project" | "audio") {
    pendingKind = kind;
    fileInput.accept =
      kind === "image"
        ? "image/*"
        : kind === "video"
          ? "video/*"
          : kind === "audio"
            ? "audio/*"
            : ".zip,application/zip";
    fileInput.value = "";
    fileInput.click();
  }

  async function onFile() {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (pendingKind === "project") {
      replaceProject(await loadProjectBlob(file, DPR));
      return;
    }
    if (pendingKind === "audio") {
      setAudioTrack(await loadAudioTrack(file));
      return;
    }
    const layer =
      pendingKind === "image"
        ? await loadImageLayer(file)
        : await loadVideoLayer(file, () => bump());
    addLayerToProject(layer);
  }

  async function pasteImage() {
    // The async Clipboard API is unavailable outside a secure context (e.g. the LAN dev server over
    // plain http on iPad), where navigator.clipboard is undefined. Say so instead of a vague error.
    if (!navigator.clipboard?.read) {
      alert(
        "Clipboard paste needs HTTPS. On iPad, open the app over https (npm run dev:lan), or use Cmd+V with a keyboard.",
      );
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith("image/"));
        if (type) {
          await pasteImageReference(await it.getType(type));
          return;
        }
      }
      alert("No image found in the clipboard.");
    } catch {
      alert("Couldn't read the clipboard (permission denied or unsupported).");
    }
  }

  async function saveProject() {
    downloadBlob(await saveProjectBlob(appState.project), "project.zip");
  }

  function toggleTheme() {
    appState.theme = appState.theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", appState.theme === "dark");
  }
</script>

<div class="flex items-center gap-1 p-2 border-b border-border bg-surface text-text">
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={appState.tool === "brush"}
    title="Brush"
    onclick={() => (appState.tool = "brush")}><Paintbrush size={18} /></button
  >
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={appState.tool === "eraser"}
    title="Eraser"
    onclick={() => (appState.tool = "eraser")}><Eraser size={18} /></button
  >
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={appState.tool === "fill"}
    title="Fill"
    onclick={() => (appState.tool = "fill")}><PaintBucket size={18} /></button
  >
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={appState.tool === "eyedropper"}
    title="Eyedropper (sample color)"
    onclick={selectEyedropper}><Pipette size={18} /></button
  >
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={appState.tool === "select"}
    title="Select"
    onclick={() => (appState.tool = "select")}><BoxSelect size={18} /></button
  >
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={appState.tool === "lasso"}
    title="Lasso"
    onclick={() => (appState.tool = "lasso")}><Lasso size={18} /></button
  >
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={appState.tool === "transform"}
    title="Transform layer (move/scale/rotate)"
    onclick={() => (appState.tool = "transform")}><Move size={18} /></button
  >
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={appState.tool === "deform"}
    title="Deform (warp the drawing)"
    onclick={() => (appState.tool = "deform")}><Workflow size={18} /></button
  >
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={appState.tool === "pose"}
    title="Pose (mesh deform)"
    onclick={() => (appState.tool = "pose")}><PersonStanding size={18} /></button
  >
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    title="Undo"
    onclick={() => undo()}><Undo2 size={18} /></button
  >
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    title="Redo"
    onclick={() => redo()}><Redo2 size={18} /></button
  >
  <span class="flex-1"></span>
  <ToolbarMenu label="File">
    {#snippet children(close)}
      <button
        class={menuItem}
        onclick={() => {
          pick("project");
          close();
        }}>Open…</button
      >
      <button
        class={menuItem}
        onclick={() => {
          saveProject();
          close();
        }}>Save</button
      >
      <button
        class={menuItem}
        onclick={() => {
          appState.sizeDialog.mode = "new";
          appState.sizeDialog.open = true;
          close();
        }}>New…</button
      >
      <button
        class={menuItem}
        onclick={() => {
          appState.sizeDialog.mode = "resize";
          appState.sizeDialog.open = true;
          close();
        }}>Resize canvas…</button
      >
    {/snippet}
  </ToolbarMenu>
  <ToolbarMenu label="Import/Export">
    {#snippet children(close)}
      <button
        class={menuItem}
        onclick={() => {
          pick("image");
          close();
        }}>Add image…</button
      >
      <button
        class={menuItem}
        onclick={() => {
          pasteImage();
          close();
        }}>Paste image from clipboard</button
      >
      <button
        class={menuItem}
        onclick={() => {
          pick("video");
          close();
        }}>Add video…</button
      >
      <button
        class={menuItem}
        onclick={() => {
          pick("audio");
          close();
        }}>Import audio…</button
      >
      <button
        class={menuItem}
        onclick={() => {
          appState.exportOpen = true;
          close();
        }}>Export…</button
      >
    {/snippet}
  </ToolbarMenu>
  <ToolbarMenu label="View">
    {#snippet children(close)}
      <button
        class={menuItem}
        onclick={() => {
          toggleTheme();
          close();
        }}>{appState.theme === "dark" ? "Light theme" : "Dark theme"}</button
      >
      <button
        class={menuItem}
        onclick={() => {
          appState.project.transparentBg = !appState.project.transparentBg;
          bump();
          close();
        }}>{appState.project.transparentBg ? "Opaque background" : "Transparent background"}</button
      >
      <button
        class={menuItem}
        onclick={() => {
          appState.settingsOpen = true;
          close();
        }}>Project settings…</button
      >
    {/snippet}
  </ToolbarMenu>
  <input bind:this={fileInput} type="file" class="hidden" onchange={onFile} />
</div>
