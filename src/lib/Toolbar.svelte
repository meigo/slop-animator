<script lang="ts">
  import {
    state as appState,
    viewActions,
    undo,
    redo,
    bump,
    repaint,
    addLayerToProject,
    replaceProject,
    setAudioTrack,
    DPR,
    pasteImageReference,
    persistReferenceMedia,
    selectEyedropper,
  } from "../state/appState.svelte";
  import { loadImageLayer, loadVideoLayer } from "../anim/reference";
  import { loadAudioTrack } from "../audio/decode";
  import {
    saveProjectBlob,
    loadProjectBlob,
    referencedMediaIds,
    sanitizeFilename,
  } from "../persist/project-file";
  import { pruneMedia } from "../persist/media-store";
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
            ? "audio/*,.mp3,.m4a,.aac,.wav,.aif,.aiff,.caf,.flac,.opus,.ogg"
            : ".zip,application/zip";
    fileInput.value = "";
    fileInput.click();
  }

  function errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  async function onFile() {
    const file = fileInput.files?.[0];
    if (!file) return;
    // Every branch awaits a decode that can fail on real input (a corrupt/truncated zip, an
    // unsupported codec, an OOM on a large project). Unhandled, that produced ZERO user-visible
    // feedback — the file simply never opened.
    try {
      if (pendingKind === "project") {
        const project = await loadProjectBlob(
          file,
          DPR,
          () => repaint(),
          () => (appState.statusHint = "Storage full — references won't survive a reload"),
        );
        // Pre-name-field saves carry no name — adopt the picked file's basename.
        if (!project.name) project.name = file.name.replace(/\.zip$/i, "");
        replaceProject(project);
        void pruneMedia(referencedMediaIds(appState.project.layers));
        // Sticky slot, not the hover hint — see the matching note in App.svelte's startup path.
        if (appState.project.audioUndecoded)
          appState.persistAlert =
            "The audio track couldn't be decoded on this device — it's kept in the project and re-saved unchanged, but won't play or export here.";
        return;
      }
      if (pendingKind === "audio") {
        setAudioTrack(await loadAudioTrack(file));
        return;
      }
      const layer =
        pendingKind === "image"
          ? await loadImageLayer(file)
          : await loadVideoLayer(file, () => repaint());
      if (pendingKind === "image") persistReferenceMedia(layer, file, file.name);
      addLayerToProject(layer);
    } catch (e) {
      console.error("open failed", e);
      appState.statusHint = `Couldn't open ${file.name}: ${errText(e)}`;
    }
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
    // This is the user's backup. A failure here (OOM zipping a large project on iPad) used to be an
    // unhandled rejection with no message at all — no file appeared and nothing said why, which is
    // exactly the state in which someone closes the tab believing they are saved.
    try {
      appState.statusHint = "Saving…";
      const name = `${sanitizeFilename(appState.project.name)}.zip`;
      let embedFailed = false; // latched, not written straight to the hint: the success line below
      const blob = await saveProjectBlob(appState.project, true, () => (embedFailed = true));
      downloadBlob(blob, name);
      // The work is on disk, so retire any autosave warning — EXCEPT the one saying autosave is off
      // for the session, which a save does not fix: everything drawn after this is still unprotected.
      if (!appState.autosaveOff) appState.persistAlert = "";
      appState.statusHint = embedFailed
        ? `Saved ${name} — a reference couldn't be embedded, so it's saved without it`
        : `Saved ${name}`;
    } catch (e) {
      console.error("save failed", e);
      // Sticky, not a hover hint: "no file appeared" is precisely the state in which someone closes
      // the tab believing they are saved.
      appState.persistAlert = `Save failed: ${errText(e)} — the project was NOT written to a file.`;
    }
  }

  function toggleTheme() {
    appState.theme = appState.theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", appState.theme === "dark");
  }
</script>

<div
  class="flex flex-wrap items-center gap-1 p-2 border-b border-border bg-surface text-text [&>button]:shrink-0"
>
  <button
    class="size-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={appState.tool === "brush"}
    title="Brush"
    onclick={() => (appState.tool = "brush")}><Paintbrush size={18} /></button
  >
  <button
    class="size-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={appState.tool === "eraser"}
    title="Eraser"
    onclick={() => (appState.tool = "eraser")}><Eraser size={18} /></button
  >
  <button
    class="size-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={appState.tool === "fill"}
    title="Fill"
    onclick={() => (appState.tool = "fill")}><PaintBucket size={18} /></button
  >
  <button
    class="size-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={appState.tool === "eyedropper"}
    title="Eyedropper (sample color)"
    onclick={selectEyedropper}><Pipette size={18} /></button
  >
  <button
    class="size-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={appState.tool === "select"}
    title="Select"
    onclick={() => (appState.tool = "select")}><BoxSelect size={18} /></button
  >
  <button
    class="size-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={appState.tool === "lasso"}
    title="Lasso"
    onclick={() => (appState.tool = "lasso")}><Lasso size={18} /></button
  >
  <button
    class="size-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={appState.tool === "transform"}
    title="Transform layer (move/scale/rotate)"
    onclick={() => (appState.tool = "transform")}><Move size={18} /></button
  >
  <button
    class="size-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={appState.tool === "deform"}
    title="Deform (warp the drawing)"
    onclick={() => (appState.tool = "deform")}><Workflow size={18} /></button
  >
  <button
    class="size-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={appState.tool === "pose"}
    title="Pose (mesh deform)"
    onclick={() => (appState.tool = "pose")}><PersonStanding size={18} /></button
  >
  <!-- aria-disabled, not disabled: the title explains the refusal, and a disabled button dispatches
       no pointer events, so the status bar's delegated hint could never read it (CLAUDE.md,
       2026-08-12). Handlers are guarded to match; `undo()`/`redo()` also refuse on their own. -->
  <button
    class="size-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent"
    title={appState.canUndo ? "Undo" : "Undo — nothing to undo"}
    aria-disabled={!appState.canUndo}
    onclick={() => {
      if (appState.canUndo) undo();
    }}><Undo2 size={18} /></button
  >
  <button
    class="size-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent"
    title={appState.canRedo ? "Redo" : "Redo — nothing to redo"}
    aria-disabled={!appState.canRedo}
    onclick={() => {
      if (appState.canRedo) redo();
    }}><Redo2 size={18} /></button
  >
  <div class="ml-auto flex max-w-full flex-wrap items-center gap-1 shrink-0">
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
          title="Fit the canvas to the window and re-centre it"
          onclick={() => {
            viewActions.fitView?.();
            close();
          }}>Fit to view (0)</button
        >
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
          }}
          >{appState.project.transparentBg ? "Opaque background" : "Transparent background"}</button
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
  </div>
  <input bind:this={fileInput} type="file" class="hidden" onchange={onFile} />
</div>
