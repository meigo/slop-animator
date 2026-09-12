<script lang="ts">
  import { state as appState, activeLayer, transformScope } from "../state/appState.svelte";
  import { whyRowRefusesTransform, workingTarget } from "../anim/active-row";
  import { layerTransformTrack, resolvedDisplayKeyCell, whyNotEditable } from "../anim/document";
  import { isCellEmpty } from "./cell-ink";
  import { contextHint } from "./status-hint";
  import { animateTargetGroup, animateTargetLayer } from "./transform-target";

  // Ambient readout: frame, tool (brush/eraser show their stroke type), and the active layer.
  // `tabular-nums` stays and is the whole stabiliser now: it equalizes digit WIDTH, so scrubbing
  // within a digit count moves nothing at all.
  // The RESERVED WIDTH that used to sit with it is gone (2026-09-12). It was `frameDigits` ch on an
  // `inline-block text-right` box around the frame number, added on 2026-08-11 against a 9 → 10
  // reflow, and the cost was a gap: on a 100-frame project frame 9 rendered its digit at the right
  // of three digits' worth of space, leaving ~15px of hole after the label. Reserving bought less
  // than it looked. This readout is the LAST flex item in a `justify-between` row, so its right edge
  // is pinned and everything after the number — `/N · tool · layer` — holds still whatever the
  // number does; only the label and the number itself shift, by one digit, at a digit boundary. And
  // the left edge is not stable anyway: switching tool or layer changes this string's width on every
  // press. Measured before/after in the 2026-09-12 changelog entry.
  const toolLabel = $derived(
    appState.tool === "eraser"
      ? "eraser"
      : appState.tool === "brush"
        ? appState.brush.brushType
        : appState.tool,
  );

  // Idle hint: the non-obvious gestures for the current tool + context. A real hover/press hint
  // (sourced from any title=) always wins; this only fills the gap, which on touch is always.
  const idleHint = $derived.by(() => {
    const l = activeLayer();
    // The SAME predicates the Animate controls use (shared, so the two cannot drift): a track alone
    // is not enough, because on a GROUP row a drag writes the group's transform, not this layer's
    // track — a different target rather than none, hence the second call below.
    const target = animateTargetLayer(
      l,
      appState.project.groups,
      appState.tool,
      transformScope(),
      appState.playhead,
      appState.project.fps,
    );
    // Group scope keys the GROUP, so the layer predicate correctly declines there and this one
    // answers instead. Without it auto-key at group scope would happen silently — the very hazard
    // this hint exists to mitigate, in the one scope where ToolOptions' own caption is the only
    // other thing on screen.
    const group = animateTargetGroup(
      l,
      appState.project.groups,
      appState.project.layers,
      appState.tool,
      transformScope(),
    );
    const wt = workingTarget(appState.activeRow);
    const audioOn = wt.kind === "audio";
    const groupOn = wt.kind === "group";
    // A group (header or track) can still auto-key — don't drop the frame hint just because
    // the working target is the group. Audio has no transform, so leftover tracks stay silent.
    const keys =
      !audioOn &&
      ((!!target && layerTransformTrack(target) != null) || group?.tracks?.transform != null);
    // Alpha lock, and whether the drawing at the playhead has anything to paint over.
    const alphaLock = l.kind === "draw" && l.alphaLock === true;
    const rk = l.kind === "draw" && alphaLock ? resolvedDisplayKeyCell(l, appState.playhead) : null;
    const frameEmpty = alphaLock && (!rk || isCellEmpty(rk.cell.canvas, appState.version));
    return contextHint({
      tool: appState.tool,
      // The SAME function the canvas overlay and the selection bar ask, so the three cannot
      // disagree about why an edit is refused — they used to, because this one re-derived it from
      // isLayerLocked/isLayerVisible, which cannot see whether the LAYER or its GROUP is at fault.
      editBlock: audioOn || groupOn ? null : whyNotEditable(l, appState.project.groups),
      notDraw: l.kind !== "draw",
      audioRow: audioOn,
      groupRow: groupOn,
      // The SAME predicate the gizmo and the canvas drag ask — a hint derived from anything else
      // could describe a gesture those two refuse.
      groupTransformBlock: groupOn ? whyRowRefusesTransform(appState.activeRow, l) : null,
      selectionActive: appState.selectionActive,
      selectionFloating: appState.selectionFloating,
      poseActive: appState.poseActive,
      // A held drag keys its GRAB frame, not wherever the playhead has since moved to.
      animatedFrame: keys ? (appState.transformDragFrame ?? appState.playhead) : null,
      alphaLock,
      frameEmpty,
    });
  });
  const targetName = $derived.by(() => {
    const wt = workingTarget(appState.activeRow);
    if (wt.kind === "audio") return appState.project.audio?.name ?? "audio";
    if (wt.kind === "group") {
      return appState.project.groups.find((g) => g.id === wt.id)?.name ?? activeLayer().name;
    }
    return activeLayer().name;
  });
</script>

<!-- `px-5`, not the app's usual 8px: this is the ONLY element on the window's bottom edge, and iPadOS
     rounds the bottom corners of a browser window (and of a standalone web app), clipping whatever the
     page paints into them. At 8px both ends of this row ran under the curve — the right-hand
     frame/tool/target readout lost its last characters, reported from an iPad in landscape. A ~24px
     corner radius eats roughly 8px of horizontal room at the height this text's descenders sit, so 20px
     clears it with margin to spare.
     `env(safe-area-inset-*)` CANNOT do this job here, which is why the number is hard-coded: the insets
     are zero in a browser tab (the window's own rounding is not a safe-area inset, and index.html
     deliberately omits `viewport-fit=cover` — see the note there), so the OS never reports the space
     this text needs. The cost is 24px less room for the hint, which already truncates. -->
<div
  class="flex items-center justify-between gap-3 border-t border-border bg-surface px-5 h-6 text-xs text-text-secondary select-none"
>
  {#if appState.persistAlert}
    <!-- Amber, per the read-only/state-signalling convention: this is a condition to act on, not a
         momentary error. It keeps its own slot rather than replacing the hint, so hovering a control
         still explains that control while the warning stays put. -->
    <span class="truncate text-warn shrink-2" title={appState.persistAlert}
      >⚠ {appState.persistAlert}</span
    >
  {/if}
  <span class="truncate">{appState.statusHint || idleHint}</span>
  <!-- "frame", not "f": there is room for the word at every width this bar is used at, and the
       abbreviation only ever existed to keep the line short. -->
  <span class="shrink-0 tabular-nums"
    >frame {appState.playhead + 1}/{appState.project.frameCount} · {toolLabel} · {targetName}</span
  >
</div>
