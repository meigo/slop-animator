<script lang="ts">
  import Toolbar from "./lib/Toolbar.svelte";
  import Canvas from "./lib/Canvas.svelte";
  import LayerList from "./lib/LayerList.svelte";
  import Playbar from "./lib/Playbar.svelte";
  import Timeline from "./lib/Timeline.svelte";
  import StatusBar from "./lib/StatusBar.svelte";
  import ExportDialog from "./lib/ExportDialog.svelte";
  import SizeDialog from "./lib/SizeDialog.svelte";
  import ProjectSettingsDialog from "./lib/ProjectSettingsDialog.svelte";
  import { onMount } from "svelte";
  import {
    state,
    undo,
    redo,
    bump,
    playbackController,
    selectionRef,
    selectionActions,
    poseActions,
    DPR,
    replaceProject,
    gatherPreferences,
    applyPreferences,
    pasteImageReference,
    copyTimelineSelection,
    cutTimelineSelection,
    pasteCells,
    deleteTimelineSelection,
  } from "./state/appState.svelte";
  import { loadAutosave, saveAutosave } from "./persist/autosave";
  import { loadPreferences, savePreferences } from "./persist/preferences";

  // Set when a Cmd+V is consumed as a cell paste, so the window `paste` event (onPaste) skips
  // its image-file handling for the same keystroke. keydown fires before paste.
  let cellPasteHandled = false;

  function onKey(e: KeyboardEvent) {
    const meta = e.ctrlKey || e.metaKey;
    // Never leave the cell-paste guard stuck true if a `paste` event didn't follow a prior Cmd+V
    // (browser/platform variance) — reset it on any keydown that isn't itself a Cmd+V.
    if (!(meta && e.key.toLowerCase() === "v")) cellPasteHandled = false;
    if (meta && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    // Don't hijack single-key shortcuts while typing in a field (e.g. the fps input).
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (meta && e.key.toLowerCase() === "c" && state.timelineSelection) {
      e.preventDefault();
      copyTimelineSelection();
      return;
    }
    if (meta && e.key.toLowerCase() === "x" && state.timelineSelection) {
      e.preventDefault();
      cutTimelineSelection();
      return;
    }
    if (meta && e.key.toLowerCase() === "v" && state.cellClipboard) {
      e.preventDefault();
      cellPasteHandled = true; // tell onPaste to skip this keystroke
      pasteCells(e.shiftKey);
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && state.timelineSelection) {
      e.preventDefault();
      deleteTimelineSelection();
      return;
    }

    if (e.key === "b") state.tool = "brush";
    else if (e.key === "e") state.tool = "eraser";
    else if (e.key === "g") state.tool = "fill";
    else if (e.key === "s") state.tool = "select";
    else if (e.key === "l") state.tool = "lasso";
    else if (e.key === "w") {
      if (selectionRef.current?.active) {
        e.preventDefault();
        selectionActions.enterWarp?.(2, 2);
      }
    } else if (e.key === "m") {
      if (selectionRef.current?.active) {
        e.preventDefault();
        selectionActions.enterWarp?.(3, 3);
      }
    } else if (e.key === "Escape") {
      if (selectionRef.current?.active) selectionRef.current.cancel();
      else if (poseActions.active()) poseActions.cancel();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectionRef.current?.active) selectionRef.current.commit();
      else if (poseActions.active()) poseActions.apply();
      else playbackController.toggle();
    } else if (e.key === "k") {
      e.preventDefault();
      playbackController.toggle();
    } else if (e.key === "o") {
      state.onion.enabled = !state.onion.enabled;
      bump();
    } else if (e.key === ",") state.playhead = Math.max(0, state.playhead - 1);
    else if (e.key === ".")
      state.playhead = Math.min(state.project.frameCount - 1, state.playhead + 1);
    else if (e.key === "[" || e.key === "]") {
      const s = state.tool === "eraser" ? state.eraser : state.brush;
      s.size = e.key === "[" ? Math.max(0.5, s.size - 1) : Math.min(60, s.size + 1);
    }
  }

  // Instant status hint: mirror the hovered/pressed control's title= into the status bar. pointerover
  // covers desktop hover; pointerdown covers touch/Pencil (iPad has no hover). Moving onto an untitled
  // element sets "" (natural clear). No pointerup clear — a tapped control's hint persists until the
  // next hover/press, which is the readable behavior on touch.
  function onPointerHint(e: PointerEvent) {
    const el = (e.target as Element | null)?.closest("[title]");
    state.statusHint = el?.getAttribute("title") ?? "";
  }

  function onPaste(e: ClipboardEvent) {
    if (cellPasteHandled) {
      cellPasteHandled = false;
      return; // this Cmd+V was a cell paste; don't also handle it as an image paste
    }
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const blob = it.getAsFile();
        if (blob) {
          e.preventDefault();
          void pasteImageReference(blob);
        }
        return;
      }
    }
  }

  onMount(async () => {
    applyPreferences(loadPreferences());
    document.documentElement.classList.toggle("dark", state.theme === "dark");
    const restored = await loadAutosave(DPR);
    if (restored) replaceProject(restored);
  });

  let autosaveTimer: ReturnType<typeof setTimeout>;
  $effect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- read to register the effect dependency
    state.version; // re-run whenever the document changes
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      void saveAutosave(state.project);
    }, 3000);
  });

  let prefsTimer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const prefs = gatherPreferences(); // reads every tracked field → re-runs on any pref change
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(() => savePreferences(prefs), 400);
  });
</script>

<svelte:window
  onkeydown={onKey}
  onpaste={onPaste}
  onpointerover={onPointerHint}
  onpointerdown={onPointerHint}
/>

<div class="h-full flex flex-col bg-surface text-text">
  <Toolbar />
  <div class="flex-1 flex min-h-0">
    <Canvas />
    <LayerList />
  </div>
  <Playbar />
  <Timeline />
  <StatusBar />
</div>
<ExportDialog />
<SizeDialog />
<ProjectSettingsDialog />
