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
    pixelToolsBlock,
    selectToolsBlock,
    outlineActions,
    selectOutline,
    selectionActions,
    editActions,
  } from "../state/appState.svelte";
  import { editBlockLabel } from "./status-hint";
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
  import { saveToFilesAvailable } from "../export/share";
  import { deliverToFiles } from "./deliver-file";
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
    SquareMinus,
    Check,
  } from "@lucide/svelte";

  // As slop-paint's: the label left, a key chip (or the check) pushed right.
  const menuItem =
    "w-full text-left px-3 py-1.5 text-sm whitespace-nowrap text-text-secondary hover:bg-surface-hover flex items-center justify-between gap-6";
  const menuDivider = "my-1 h-px bg-border";
  const kbd = "text-[11px] text-text-muted";
  const dimmable =
    "aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent";
  const toolBtn =
    "size-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover";
  // Pixel tools do nothing on a reference. Dim them, still clickable — so `b` can arm the brush
  // before switching back to a drawing layer. Don't hide: that shoves the remaining icons.
  // The REASON, not just a boolean: a group or audio row refuses because it is not a layer row,
  // not because the active layer is the wrong kind (it usually is not).
  // A PLAIN CLASS, deliberately NOT `aria-disabled`: these buttons still ACT, and arming a tool
  // ahead of switching layers is the point. `aria-disabled` here was the app's only instance of a
  // control announcing itself unavailable and then working — a lie to a screen reader, and the
  // pattern the next control would have copied. The title carries the reason either way.
  const toolsBlock = $derived(pixelToolsBlock());
  const toolsDimmed = $derived(toolsBlock !== null);
  // Select/lasso dim on a REFERENCE row only (nothing to lift or copy there); a locked or hidden
  // drawing layer keeps them — copying is a read. Same still-clickable dimming as the pixel tools.
  const selectBlock = $derived(selectToolsBlock());
  const selectTitle = (name: string) =>
    selectBlock ? `${name} — ${editBlockLabel(selectBlock)}` : name;
  const pixelTitle = (name: string) =>
    toolsBlock ? `${name} — ${editBlockLabel(toolsBlock)}` : name;

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

  const canSaveToFiles = saveToFilesAvailable();

  async function saveProject(toFiles = false) {
    // This is the user's backup. A failure here (OOM zipping a large project on iPad) used to be an
    // unhandled rejection with no message at all — no file appeared and nothing said why, which is
    // exactly the state in which someone closes the tab believing they are saved.
    try {
      appState.statusHint = "Saving…";
      const name = `${sanitizeFilename(appState.project.name)}.zip`;
      let embedFailed = false; // latched, not written straight to the hint: the success line below
      const blob = await saveProjectBlob(appState.project, true, () => (embedFailed = true));
      if (toFiles) {
        const note = embedFailed
          ? "a reference couldn't be embedded, so it's saved without it"
          : "";
        const r = await deliverToFiles(new File([blob], name, { type: blob.type }), {
          isProject: true,
          tryDirect: true,
          note,
        });
        if (r !== "downloaded") return; // the helper / ready dialog reports the rest
      } else downloadBlob(blob, name);
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
</script>

<div
  class="flex flex-wrap items-center gap-1 p-2 border-b border-border bg-surface text-text [&>button]:shrink-0"
>
  <button
    class={toolBtn}
    class:opacity-40={toolsDimmed}
    class:ui-on={appState.tool === "brush"}
    title={pixelTitle("Brush")}
    onclick={() => (appState.tool = "brush")}><Paintbrush size={18} /></button
  >
  <button
    class={toolBtn}
    class:opacity-40={toolsDimmed}
    class:ui-on={appState.tool === "eraser"}
    title={pixelTitle("Eraser")}
    onclick={() => (appState.tool = "eraser")}><Eraser size={18} /></button
  >
  <button
    class={toolBtn}
    class:opacity-40={toolsDimmed}
    class:ui-on={appState.tool === "fill"}
    title={pixelTitle("Fill")}
    onclick={() => (appState.tool = "fill")}><PaintBucket size={18} /></button
  >
  <button
    class={toolBtn}
    class:ui-on={appState.tool === "eyedropper"}
    title="Eyedropper (sample color)"
    onclick={selectEyedropper}><Pipette size={18} /></button
  >
  <button
    class={toolBtn}
    class:ui-on={appState.tool === "select"}
    class:opacity-40={selectBlock !== null}
    title={selectTitle("Select")}
    onclick={() => (appState.tool = "select")}><BoxSelect size={18} /></button
  >
  <button
    class={toolBtn}
    class:ui-on={appState.tool === "lasso"}
    class:opacity-40={selectBlock !== null}
    title={selectTitle("Lasso")}
    onclick={() => (appState.tool = "lasso")}><Lasso size={18} /></button
  >
  <button
    class={toolBtn}
    class:ui-on={appState.tool === "transform"}
    title="Transform layer (move/scale/rotate)"
    onclick={() => (appState.tool = "transform")}><Move size={18} /></button
  >
  <button
    class={toolBtn}
    class:opacity-40={toolsDimmed}
    class:ui-on={appState.tool === "deform"}
    title={pixelTitle("Deform (warp the drawing)")}
    onclick={() => (appState.tool = "deform")}><Workflow size={18} /></button
  >
  <button
    class={toolBtn}
    class:opacity-40={toolsDimmed}
    class:ui-on={appState.tool === "pose"}
    title={pixelTitle("Pose (mesh deform)")}
    onclick={() => (appState.tool = "pose")}><PersonStanding size={18} /></button
  >
  <button
    class={toolBtn}
    class:opacity-40={toolsDimmed}
    class:ui-on={appState.tool === "outline"}
    title={pixelTitle("Outline (hollow the drawing to a line)")}
    onclick={() => {
      // Re-tapping the already-lit button re-arms the tool: assigning the same string to
      // appState.tool notifies nothing, so Canvas's tool-change effect never re-fires enterOutline.
      if (appState.tool === "outline") outlineActions.reenter();
      else selectOutline(); // remembers the tool to hand back to when Outline is done
    }}><SquareMinus size={18} /></button
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
    <!-- File / Edit / Document / View, in slop-paint's order and wording (2026-09-26): what a menu
         holds says what it acts on — the project's files, the selection and clipboard, the
         document itself, or only the view. -->
    <ToolbarMenu label="File">
      {#snippet children(close)}
        <button
          class={menuItem}
          role="menuitem"
          title="Start a new project at a size you pick"
          onclick={() => {
            appState.sizeDialog.mode = "new";
            appState.sizeDialog.open = true;
            close();
          }}>New…</button
        >
        <button
          class={menuItem}
          role="menuitem"
          title="Open a saved project .zip"
          onclick={() => {
            pick("project");
            close();
          }}>Open…</button
        >
        <button
          class={menuItem}
          role="menuitem"
          title="Save the project as a .zip — drawings, references and audio"
          onclick={() => {
            saveProject();
            close();
          }}>Save</button
        >
        {#if canSaveToFiles}
          <!-- iPad/iPhone: the share sheet's Save to Files instead of a numbered download. -->
          <button
            class={menuItem}
            role="menuitem"
            title="Save the project zip to a folder you pick in Files"
            onclick={() => {
              saveProject(true);
              close();
            }}>Save to Files…</button
          >
        {/if}
        <div class={menuDivider}></div>
        <button
          class={menuItem}
          role="menuitem"
          title="Add an image as a new reference layer"
          onclick={() => {
            pick("image");
            close();
          }}>Import image…</button
        >
        <button
          class={menuItem}
          role="menuitem"
          title="Add the image on the clipboard as a new reference layer"
          onclick={() => {
            pasteImage();
            close();
          }}>Import image from clipboard</button
        >
        <button
          class={menuItem}
          role="menuitem"
          title="Add a video as a new reference layer"
          onclick={() => {
            pick("video");
            close();
          }}>Import video…</button
        >
        <button
          class={menuItem}
          role="menuitem"
          title="Set the project's audio track (replaces the current one)"
          onclick={() => {
            pick("audio");
            close();
          }}>Import audio…</button
        >
        <div class={menuDivider}></div>
        <button
          class={menuItem}
          role="menuitem"
          title="Export as a PNG sequence or frame, a PSD frame, MP4, WebM or an animated GIF"
          onclick={() => {
            appState.exportOpen = true;
            close();
          }}>Export…</button
        >
      {/snippet}
    </ToolbarMenu>
    <ToolbarMenu label="Edit">
      {#snippet children(close)}
        <!-- aria-disabled, never disabled: a disabled button dispatches no pointer events, so the
             status bar could not show the reason on iPad (CLAUDE.md, 2026-08-12). The copy/cut/delete
             target mirrors the keys: a pixel selection first, else the timeline selection. -->
        {@const hasSel = appState.selectionActive && !appState.selectionFloating}
        {@const canClip = hasSel || !!appState.timelineSelection}
        {@const nothing = " — nothing selected"}
        <!-- As the options bar's Deselect: a lifted float can be dropped too. -->
        {@const canDeselect = appState.selectionActive || appState.selectionFloating}
        <button
          class="{menuItem} {dimmable}"
          role="menuitem"
          aria-disabled={!appState.canUndo}
          title={appState.canUndo ? "Undo" : "Undo — nothing to undo"}
          onclick={() => {
            if (appState.canUndo) undo();
            close();
          }}>Undo <span class={kbd}>Ctrl+Z</span></button
        >
        <button
          class="{menuItem} {dimmable}"
          role="menuitem"
          aria-disabled={!appState.canRedo}
          title={appState.canRedo ? "Redo" : "Redo — nothing to redo"}
          onclick={() => {
            if (appState.canRedo) redo();
            close();
          }}>Redo <span class={kbd}>Ctrl+Shift+Z</span></button
        >
        <div class={menuDivider}></div>
        <button
          class="{menuItem} {dimmable}"
          role="menuitem"
          aria-disabled={!canClip}
          title={canClip ? "Cut the selection" : "Cut" + nothing}
          onclick={() => {
            if (canClip) editActions.cut?.();
            close();
          }}>Cut <span class={kbd}>Ctrl+X</span></button
        >
        <button
          class="{menuItem} {dimmable}"
          role="menuitem"
          aria-disabled={!canClip}
          title={canClip ? "Copy the selection" : "Copy" + nothing}
          onclick={() => {
            if (canClip) editActions.copy?.();
            close();
          }}>Copy <span class={kbd}>Ctrl+C</span></button
        >
        <button
          class={menuItem}
          role="menuitem"
          title="Paste copied pixels or frames — or, with nothing copied here, the clipboard image as a reference layer"
          onclick={() => {
            if (!editActions.paste?.()) pasteImage();
            close();
          }}>Paste <span class={kbd}>Ctrl+V</span></button
        >
        <button
          class="{menuItem} {dimmable}"
          role="menuitem"
          aria-disabled={!canClip}
          title={canClip ? "Delete the selection" : "Delete" + nothing}
          onclick={() => {
            if (canClip) editActions.del?.();
            close();
          }}>Delete <span class={kbd}>Del</span></button
        >
        <div class={menuDivider}></div>
        <button
          class="{menuItem} {dimmable}"
          role="menuitem"
          aria-disabled={!canDeselect}
          title={canDeselect
            ? "Drop the selection (a moved float goes back)"
            : "Deselect" + nothing}
          onclick={() => {
            if (canDeselect) selectionActions.deselect?.();
            close();
          }}>Deselect <span class={kbd}>Esc</span></button
        >
      {/snippet}
    </ToolbarMenu>
    <ToolbarMenu label="Document">
      {#snippet children(close)}
        <button
          class={menuItem}
          role="menuitem"
          title="Name, background colour and transparency, frame rate"
          onclick={() => {
            appState.settingsOpen = true;
            close();
          }}>Project settings…</button
        >
        <button
          class={menuItem}
          role="menuitem"
          title="Change the canvas size"
          onclick={() => {
            appState.sizeDialog.mode = "resize";
            appState.sizeDialog.open = true;
            close();
          }}
          >Resize canvas… <span class={kbd}
            >{appState.project.width} × {appState.project.height}</span
          ></button
        >
        <!-- One fixed label with an on-state, not a label that flips between "Transparent" and
             "Opaque": a flipping label leaves you working out whether it names the state or the
             action. -->
        <button
          class={menuItem}
          role="menuitemcheckbox"
          aria-checked={appState.project.transparentBg}
          title={appState.project.transparentBg
            ? "Transparent background — on: exports keep alpha; tap to turn off"
            : "Transparent background — off: the background colour fills behind the drawing"}
          onclick={() => {
            appState.project.transparentBg = !appState.project.transparentBg;
            bump();
            close();
          }}
          >Transparent background <Check
            size={14}
            class={appState.project.transparentBg ? "text-accent" : "invisible"}
          /></button
        >
      {/snippet}
    </ToolbarMenu>
    <ToolbarMenu label="View">
      {#snippet children(close)}
        <button
          class={menuItem}
          role="menuitem"
          title="Fit the canvas to the window and re-centre it"
          onclick={() => {
            viewActions.fitView?.();
            close();
          }}>Fit to view <span class={kbd}>0</span></button
        >
        <button
          class={menuItem}
          role="menuitem"
          title="Show the canvas at 100% — one canvas pixel per screen pixel"
          onclick={() => {
            viewActions.actualSize?.();
            close();
          }}>Actual size <span class={kbd}>1</span></button
        >
      {/snippet}
    </ToolbarMenu>
  </div>
  <input bind:this={fileInput} type="file" class="hidden" onchange={onFile} />
</div>
