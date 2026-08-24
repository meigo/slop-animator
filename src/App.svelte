<script lang="ts">
  import Toolbar from "./lib/Toolbar.svelte";
  import ToolOptions from "./lib/ToolOptions.svelte";
  import Canvas from "./lib/Canvas.svelte";
  import LayerList from "./lib/LayerList.svelte";
  import Timeline from "./lib/Timeline.svelte";
  import StatusBar from "./lib/StatusBar.svelte";
  import ExportDialog from "./lib/ExportDialog.svelte";
  import SizeDialog from "./lib/SizeDialog.svelte";
  import ProjectSettingsDialog from "./lib/ProjectSettingsDialog.svelte";
  import { onMount } from "svelte";
  import {
    activeLayer,
    seekPlayhead,
    setActiveLayer,
    repaint,
    state,
    undo,
    redo,
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
  import { pasteRoute, type PasteRoute } from "./anim/paste-precedence";
  import { workingTarget } from "./anim/active-row";
  import { isLayerEditable } from "./anim/document";

  /** Which handler owns a paste RIGHT NOW, derived from clipboard + target state rather than
   *  latched across events. `keydown` uses it to decide what to do; the window `paste` event uses
   *  it to decide whether the keystroke it is following was already consumed. See
   *  `paste-precedence.ts` for why the old `cellPasteHandled` flag could not be made correct. */
  function currentPasteRoute(): PasteRoute {
    return pasteRoute({
      selectTool: state.tool === "select" || state.tool === "lasso",
      // Mirrors `Canvas.activeDrawableCtx()`'s preconditions exactly, so a "pixels" answer is one
      // `pasteSelection()` will honour. `hasPixelClipboard` tracks Canvas's `selectionClipboard`.
      pixelPasteReady:
        state.hasPixelClipboard &&
        workingTarget(state.activeRow).kind === "layer" &&
        isLayerEditable(activeLayer(), state.project.groups),
      hasCellClipboard: !!state.cellClipboard,
    });
  }

  function onKey(e: KeyboardEvent) {
    // An export renders every frame from the LIVE project, one awaited frame at a time. Undoing (or
    // restarting playback onto the shared boil GL surface) between frames splices two documents into
    // one file with no warning, so no shortcut is live for the duration of the render — including
    // ⌘Z, which is handled above the INPUT/TEXTAREA guard below.
    if (state.exportBusy) return;
    const meta = e.ctrlKey || e.metaKey;
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
    // ONE Cmd+V branch for all three routes (the pixel float, timeline cells, an OS image), so the
    // precedence lives in exactly one place — `currentPasteRoute()` — that `onPaste` can ask again
    // without anything being carried between the two events. Consuming the keystroke means
    // preventDefault(), which suppresses the `paste` event that would otherwise follow.
    if (meta && e.key.toLowerCase() === "v") {
      const route = currentPasteRoute();
      if (route === "pixels") {
        // The predicate mirrors pasteSelection()'s own preconditions, so this is expected to be
        // true; on a false (state moved under us) fall through rather than eating the keystroke.
        if (selectionActions.paste?.()) {
          e.preventDefault();
          return;
        }
      } else if (route === "cells") {
        e.preventDefault();
        pasteCells(e.shiftKey);
        return;
      }
      // route === "image" → do NOT preventDefault: the browser's `paste` event follows and onPaste
      // turns an image file on the clipboard into a reference layer.
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
      repaint();
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
    // Normally unreachable when an app paste happened: onKey called preventDefault() for those,
    // which suppresses this event. The check is the defensive half — a browser that fires `paste`
    // anyway would otherwise image-paste the same keystroke a second time. Asking
    // `currentPasteRoute()` again (rather than reading a flag set during the keydown) is what fixes
    // the old bug: the flag could never be cleared by the very event its own preventDefault
    // suppressed, so it stayed armed and swallowed the NEXT Cmd+V.
    if (currentPasteRoute() !== "image") return;
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

  function errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  // A write that succeeds retires the warning — otherwise one transient quota blip would nag for
  // the rest of the session.
  function onAutosaveOk() {
    if (state.persistAlert) state.persistAlert = "";
  }

  // Autosave failures used to be swallowed entirely (`.catch(() => (autosaveDirty = true))`), so a
  // DETERMINISTIC failure — iPad quota exhaustion, or the documented stale-tab VersionError after a
  // deploy — let the user work for hours believing they were saved. Restoring the dirty flag (so a
  // later hide-flush retries) is kept; the message is the new part. `persistReferenceMedia` already
  // reports its own quota failures this way.
  function onAutosaveFailed(e: unknown) {
    autosaveDirty = true;
    console.error("autosave failed", e);
    state.persistAlert = `Autosave is failing (${errText(e)}) — save to a file (File ▸ Save Project) so this work isn't lost.`;
  }

  onMount(async () => {
    applyPreferences(loadPreferences());
    document.documentElement.classList.toggle("dark", state.theme === "dark");
    try {
      const restored = await loadAutosave(DPR);
      if (restored) {
        if (!restored.name) restored.name = "untitled"; // pre-name-field autosave
        replaceProject(restored);
      }
      if (await hydrateFromStore(state.project, () => repaint())) repaint();
      // Prune INSIDE the try: if restore threw, we don't know what's referenced — keep everything.
      void pruneMedia(referencedMediaIds(state.project.layers));
    } catch (e) {
      // The restore failed (a truncated blob, a decode OOM on a large project, an IndexedDB open
      // that never settled). `state.project` is still the BLANK startup document while the single
      // autosave slot still holds the user's work — so arming autosave here would let the first
      // stroke's 3s debounce overwrite it with nothing. Leave the gate shut for the session and say
      // so; a manual "Save Project" and a reload are both still available.
      console.error("startup restore failed", e);
      state.autosaveOff = true; // stops a later manual save retiring the warning below
      state.persistAlert = `Couldn't load your saved project (${errText(e)}). Autosave is OFF so the saved copy isn't overwritten — reload to retry, or use File ▸ Open.`;
      return; // autosaveReady stays false — deliberately NOT a `finally`
    }
    // A CONDITION, not a control's tooltip — so `persistAlert`, not `statusHint`, which the
    // window-level title writer wipes on the next pointer move. There is no UI for an undecoded
    // track (the lane renders only a decoded one), so this line is its only announcement.
    if (state.project.audioUndecoded)
      state.persistAlert =
        "The audio track couldn't be decoded on this device — it's kept in the project and re-saved unchanged, but won't play or export here.";
    autosaveReady = true;
  });

  let autosaveTimer: ReturnType<typeof setTimeout>;
  $effect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- read to register the effect dependency
    state.persistTick; // document edits only — play/onion/layer-switch must not encode every key PNG
    if (!autosaveReady) return; // restore still in flight — state.project is not the user's document yet
    autosaveDirty = true;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      autosaveDirty = false;
      // If the write fails (e.g., QuotaExceededError on iPad), restore the dirty flag so the
      // next hide-event can retry rather than skipping the save on a stale "clean" status.
      void saveAutosave(state.project).then(onAutosaveOk, onAutosaveFailed);
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
      void saveAutosave(state.project).then(onAutosaveOk, onAutosaveFailed);
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
  <Timeline />
  <StatusBar />
</div>
<ExportDialog />
<SizeDialog />
<ProjectSettingsDialog />
