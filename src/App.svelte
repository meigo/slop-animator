<script lang="ts">
  import Toolbar from "./lib/Toolbar.svelte";
  import ToolOptions from "./lib/ToolOptions.svelte";
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
    seekPlayhead,
    setActiveLayer,
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
  import { hydrateFromStore, pruneMedia } from "./persist/media-store";
  import { referencedMediaIds } from "./persist/project-file";

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

    const selActive = !!selectionRef.current?.active && !selectionRef.current.hasFloating;
    const selectTool = state.tool === "select" || state.tool === "lasso";

    if (e.key === "Delete" || e.key === "Backspace") {
      if (selActive) {
        e.preventDefault();
        selectionActions.del?.();
        return;
      }
      // (falls through to the existing timeline-selection delete below)
    }
    if (meta && e.key.toLowerCase() === "c" && selActive) {
      e.preventDefault();
      selectionActions.copy?.();
      return;
    }
    if (meta && e.key.toLowerCase() === "x" && selActive) {
      e.preventDefault();
      selectionActions.cut?.();
      return;
    }
    if (meta && e.key.toLowerCase() === "v" && selectTool) {
      if (selectionActions.paste?.()) {
        e.preventDefault();
        cellPasteHandled = true; // consume this Cmd+V so onPaste doesn't also image-paste
        return;
      }
      // pixel clipboard empty → fall through to the timeline/image paste below
    }

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
    } else if (e.key === ",") seekPlayhead(state.playhead - 1);
    else if (e.key === ".") seekPlayhead(state.playhead + 1);
    // Playback/navigation keys. Arrows are free globally (the timeline ruler handles its own only
    // while focused); Shift jumps 10 frames. preventDefault stops the page/panel from scrolling.
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const step = (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 1);
      seekPlayhead(state.playhead + step);
    } else if (e.key === "Home") {
      e.preventDefault();
      seekPlayhead(0);
    } else if (e.key === "End") {
      e.preventDefault();
      seekPlayhead(state.project.frameCount - 1);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      // Move the ACTIVE LAYER selection up/down the visual stack (layers[] is bottom-first, so the
      // display order is reversed): Up = toward the top of the layer list.
      e.preventDefault();
      const stack = state.project.layers;
      const i = stack.findIndex((l) => l.id === state.activeLayerId);
      const next = i + (e.key === "ArrowUp" ? 1 : -1);
      if (i >= 0 && next >= 0 && next < stack.length) setActiveLayer(stack[next].id);
    } else if (e.key === "[" || e.key === "]") {
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

  // Autosave must not write before the startup restore has settled: `state.project` is a blank
  // createProject() until loadAutosave resolves, and saveAutosave overwrites the single slot — so a
  // hide (or the 3s debounce) landing mid-restore would replace the user's work with an empty
  // project. `autosaveDirty` additionally keeps an unchanged project from being re-encoded on every
  // app switch, which is a full PNG pass over every key cell.
  let autosaveReady = false;
  let autosaveDirty = false;

  onMount(async () => {
    applyPreferences(loadPreferences());
    document.documentElement.classList.toggle("dark", state.theme === "dark");
    try {
      const restored = await loadAutosave(DPR);
      if (restored) {
        if (!restored.name) restored.name = "untitled"; // pre-name-field autosave
        replaceProject(restored);
      }
      if (await hydrateFromStore(state.project, () => bump())) bump();
      // Prune INSIDE the try: if restore threw, we don't know what's referenced — keep everything.
      void pruneMedia(referencedMediaIds(state.project.layers));
    } finally {
      autosaveReady = true;
    }
  });

  let autosaveTimer: ReturnType<typeof setTimeout>;
  $effect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- read to register the effect dependency
    state.version; // re-run whenever the document changes
    if (!autosaveReady) return; // restore still in flight — state.project is not the user's document yet
    autosaveDirty = true;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      autosaveDirty = false;
      // If the write fails (e.g., QuotaExceededError on iPad), restore the dirty flag so the
      // next hide-event can retry rather than skipping the save on a stale "clean" status.
      void saveAutosave(state.project).catch(() => (autosaveDirty = true));
    }, 3000);
  });

  // A backgrounded tab can be killed by the OS at any moment (routinely, on iPad), so don't wait
  // out the debounce — flush as soon as the page is hidden. The write is async, so if the tab dies
  // mid-write this shrinks the loss window rather than closing it. `pagehide` and visibilitychange
  // are both needed: iOS Safari does not reliably fire both in every backgrounding path.
  $effect(() => {
    const flush = () => {
      if (!autosaveReady || !autosaveDirty) return;
      clearTimeout(autosaveTimer);
      autosaveDirty = false;
      void saveAutosave(state.project).catch(() => (autosaveDirty = true));
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
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
  <ToolOptions />
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
