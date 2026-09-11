<script lang="ts">
  import { sliderFill } from "./slider-fill";
  import { onMount } from "svelte";
  import {
    state as appState,
    pressureCurve,
    bumpCurve,
    activeLayer,
    selectionActions,
    transformActions,
    fillActions,
  } from "../state/appState.svelte";
  import { workingTarget } from "../anim/active-row";

  import { createCurveEditor } from "../core/pressure-curve";
  import { clickOutside } from "./click-outside";
  import {
    Settings,
    Copy,
    Scissors,
    ClipboardPaste,
    Trash2,
    MousePointerBan,
    Lock,
    LockOpen,
    FlipHorizontal2,
    FlipVertical2,
  } from "@lucide/svelte";
  import { MAX_GAP } from "../core/fill-holes";
  import { MAX_NIB_FLATNESS } from "../core/calligraphy-brush";
  import { whyNotEditable } from "../anim/document";
  import { editBlockLabel } from "./status-hint";

  // Nine. This was four (1/4/16/60) because the brush row overran the iPad's right edge; the gear
  // panel (bbd272d) took Stream/Taper/Behind/curve off the bar and bought the room back. Dense
  // where a step is visible — 1→2 is a 100% change, 16→24 is not worth a button — with the default
  // (4) present and the fat end left to the slider and the number field beside them.
  const SIZE_PRESETS = [1, 2, 3, 4, 6, 8, 12, 16, 60];

  const stroke = $derived(appState.tool === "eraser" ? appState.eraser : appState.brush);
  // Smooth and Taper are read ONLY by brush.ts (the perfect-freehand path). The ink and stamp
  // engines receive them in `settings` and never look at them, so on those brushes the two controls
  // are inert. They used to be DIMMED with a title explaining why; they are now HIDDEN, because on
  // iPad ~175px spent explaining that a control does nothing pushed the controls that DO something
  // off the right edge. It also makes the bar self-consistent: Angle/Flatness already hide when they
  // do not apply. Stream is NOT one of these — it is applied in input.ts, upstream of every engine,
  // so it stays live on every brush. See CLAUDE.md 2026-08-29.
  const smoothOnly = $derived(stroke.brushType === "smooth");
  const isCalligraphy = $derived(stroke.brushType === "calligraphy");
  const isInk = $derived(stroke.brushType === "ink");
  // Brush *settings* stay live (session prefs). Actions and instructional copy must not
  // promise a stroke that will not land — same split as the toolbar's dimmed pixel tools.
  const editBlock = $derived(whyNotEditable(activeLayer(), appState.project.groups));
  // Non-layer working row (audio / group / group track) is not a drawing target
  // even though activeLayerId still names a leftover member.
  const paintBlock = $derived(
    workingTarget(appState.activeRow).kind !== "layer" ? ("not-layer-row" as const) : editBlock,
  );
  const canPaint = $derived(paintBlock === null);

  let brushSettingsOpen = $state(false);
  let curvePopupEl: HTMLDivElement = $state()!;
  let curveEditor: (HTMLElement & { redraw: () => void }) | null = null;

  onMount(() => {
    curveEditor = createCurveEditor(pressureCurve, bumpCurve);
  });

  // Re-attach the curve editor whenever the panel's host div is (re)created — the editor is a single
  // imperative canvas made once in onMount, and appendChild MOVES it, so opening the panel adopts it
  // and closing simply detaches it. Redraw on the same pass, so it reflects a restored curve.
  $effect(() => {
    if (brushSettingsOpen && curvePopupEl && curveEditor) {
      curvePopupEl.appendChild(curveEditor);
      curveEditor.redraw();
    }
  });
</script>

<!-- WRAPS, never scrolls — same rule as the timeline bar. `overflow-x-auto` computes `overflow-y`
     from visible to auto (CSS Overflow 3), turning this into a ~40px scroll box that clips any
     popover anchored to it; the pressure curve needed `position: fixed` to escape it. Wrapping also
     keeps every control REACHABLE on a portrait iPad, where the brush row overruns the viewport —
     which scrolling never did, it just hid them behind a swipe. -->
<div
  class="flex min-h-10 flex-wrap items-center gap-2 border-b border-border bg-surface px-2 text-text *:shrink-0"
>
  {#if appState.tool === "brush" || appState.tool === "eraser"}
    {#if appState.tool === "eraser"}<span class="text-xs text-warn">Eraser</span>{/if}
    <label class="flex items-center gap-1 text-sm text-text-secondary"
      >Size
      <input
        type="range"
        min="0.5"
        max="60"
        step="0.5"
        class="w-24"
        bind:value={stroke.size}
        style={sliderFill(stroke.size, 0.5, 60)}
      />
      <input
        class="w-12 text-xs bg-surface border border-border rounded px-1 text-text"
        type="number"
        min="0.5"
        max="60"
        step="0.5"
        bind:value={stroke.size}
        title="Brush size"
      />
    </label>
    <!-- Fixed SQUARE, not padding: the presets are 1-2 digits, so padding alone makes each button
         a different width and the on-state fill a different shape per preset ("12" a wide pill,
         "4" a narrow one). SLOP-TIMELINE-UI.md §6 makes the same call for its flag rows — a fixed
         square so the row does not reflow as the glyphs differ in width. 24px is §3's shared
         control height, and it roughly doubles the touch target these had at text height. -->
    <div class="flex items-center gap-px" title="Size presets">
      {#each SIZE_PRESETS as preset (preset)}
        <button
          class="size-6 shrink-0 flex items-center justify-center text-xs rounded text-text-secondary hover:bg-surface-hover tabular-nums"
          class:ui-on={stroke.size === preset}
          onclick={() => (stroke.size = preset)}>{preset}</button
        >
      {/each}
    </div>
    <label
      class="flex items-center gap-1 text-sm text-text-secondary"
      title="How much pen pressure widens the stroke"
      >Press
      <input
        type="range"
        min="1"
        max="8"
        step="0.5"
        class="w-24"
        bind:value={stroke.sizeRange}
        style={sliderFill(stroke.sizeRange, 1, 8)}
      />
      <span class="text-xs text-text-secondary w-6">{stroke.sizeRange}×</span>
    </label>
    <select
      class="h-7 border border-border rounded bg-surface text-text-secondary text-xs px-1"
      bind:value={stroke.brushType}
      title="Brush type"
    >
      <option value="smooth">Smooth</option>
      <option value="ink">Ink</option>
      <option value="pencil">Pencil</option>
      <option value="charcoal">Charcoal</option>
      <option value="airbrush">Airbrush</option>
      <option value="calligraphy">Calligraphy</option>
    </select>
    <label class="flex items-center gap-1 text-xs text-text-secondary"
      >Opacity
      <input
        type="range"
        min="1"
        max="100"
        class="w-16"
        bind:value={stroke.opacity}
        style={sliderFill(stroke.opacity, 1, 100)}
      />
    </label>
    <!-- Set-and-forget params live behind the gear, the pattern onion/boil/playback already use:
         what you adjust mid-stroke stays on the bar, what you calibrate once does not. On iPad the
         brush row was overrunning the viewport and the far controls were out of comfortable reach. -->
    <div class="relative" use:clickOutside={() => (brushSettingsOpen = false)}>
      <button
        class="size-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
        class:ui-on={brushSettingsOpen}
        title="Brush settings — streamline, smoothing, pooling, nib angle and flatness, taper, paint behind, pressure curve"
        onclick={() => (brushSettingsOpen = !brushSettingsOpen)}
      >
        <Settings size={18} />
      </button>
      {#if brushSettingsOpen}
        <div
          class="absolute right-0 top-full z-30 mt-2 flex w-56 flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-xs shadow-md"
        >
          <label class="flex items-center gap-2" title="Smooth the incoming pointer path"
            ><span class="w-14 text-text-secondary">Stream</span>
            <input
              type="range"
              min="0"
              max="100"
              class="flex-1"
              bind:value={stroke.streamline}
              style={sliderFill(stroke.streamline, 0, 100)}
            />
            <span class="w-8 text-right text-text-muted tabular-nums">{stroke.streamline}</span>
          </label>
          {#if isInk}
            <label
              class="flex items-center gap-2"
              title="Swell the mark where the pen lingers, the way ink soaks in — 0 is off"
              ><span class="w-14 text-text-secondary">Pool</span>
              <input
                type="range"
                min="0"
                max="100"
                class="flex-1"
                bind:value={stroke.dwellPool}
                style={sliderFill(stroke.dwellPool ?? 0, 0, 100)}
              />
              <span class="w-8 text-right text-text-muted tabular-nums"
                >{stroke.dwellPool ?? 0}</span
              >
            </label>
          {/if}
          <!-- Nib angle/flatness are set per nib, not per stroke, so they follow the gear's rule.
               Measured on the deployed build: with them on the bar, Calligraphy ends at 1234px
               against a 12.9" iPad's 1024px portrait viewport and three controls wrap; in here it
               ends at ~835. -->
          {#if isCalligraphy}
            <label class="flex items-center gap-2" title="Fixed nib angle"
              ><span class="w-14 text-text-secondary">Angle</span>
              <input
                type="range"
                min="0"
                max="180"
                step="1"
                class="flex-1"
                bind:value={stroke.nibAngle}
                style={sliderFill(stroke.nibAngle ?? 0, 0, 180)}
              />
              <span class="w-8 text-right text-text-muted tabular-nums">{stroke.nibAngle}°</span>
            </label>
            <label
              class="flex items-center gap-2"
              title="How elongated the nib is — 0% is a round tip"
              ><span class="w-14 text-text-secondary">Flatness</span>
              <input
                type="range"
                min="0"
                max={MAX_NIB_FLATNESS}
                step="0.01"
                class="flex-1"
                bind:value={stroke.nibFlatness}
                style={sliderFill(stroke.nibFlatness ?? 0, 0, MAX_NIB_FLATNESS)}
              />
              <span class="w-8 text-right text-text-muted tabular-nums"
                >{Math.round((stroke.nibFlatness ?? 0) * 100)}%</span
              >
            </label>
          {/if}
          {#if smoothOnly}
            <!-- Moved off the bar 2026-09-08 when the size presets became 24px squares: Smooth was
                 the only control that pushed the row past a 12.9" iPad's portrait width. It belongs
                 here anyway by the gear's own rule — you calibrate it once, like Stream, rather
                 than riding it mid-stroke. -->
            <label class="flex items-center gap-2" title="Smooth the perfect-freehand outline"
              ><span class="w-14 text-text-secondary">Smooth</span>
              <input
                type="range"
                min="0"
                max="100"
                class="flex-1"
                bind:value={stroke.smoothing}
                style={sliderFill(stroke.smoothing, 0, 100)}
              />
              <span class="w-8 text-right text-text-muted tabular-nums">{stroke.smoothing}</span>
            </label>
            <label class="flex items-center gap-2" title="Taper stroke ends">
              <input type="checkbox" bind:checked={stroke.taper} /> Taper
            </label>
          {/if}
          {#if appState.tool !== "eraser"}
            <label
              class="flex items-center gap-2"
              title="Paint behind existing pixels (e.g. white fill under a black outline)"
            >
              <input type="checkbox" bind:checked={stroke.drawBehind} /> Behind
            </label>
          {/if}
          <span class="text-text-secondary">Pressure curve</span>
          <div class="flex justify-center" bind:this={curvePopupEl}></div>
        </div>
      {/if}
    </div>
    {#if appState.tool !== "eraser"}<input type="color" bind:value={appState.brush.color} />{/if}
  {:else if appState.tool === "fill"}
    <label class="flex items-center gap-1 text-xs text-text-secondary" title="Fill color tolerance"
      >Tolerance
      <input
        type="range"
        min="0"
        max="128"
        class="w-24"
        bind:value={appState.fill.tolerance}
        style={sliderFill(appState.fill.tolerance, 0, 128)}
      />
      <span class="text-xs w-6 tabular-nums">{appState.fill.tolerance}</span>
    </label>
    <label
      class="flex items-center gap-1 text-xs text-text-secondary"
      title="Grow the filled region (px)"
      >Expand
      <input
        type="range"
        min="0"
        max="8"
        class="w-16"
        bind:value={appState.fill.expand}
        style={sliderFill(appState.fill.expand, 0, 8)}
      />
      <span class="text-xs w-4 tabular-nums">{appState.fill.expand}</span>
    </label>
    <label
      class="flex items-center gap-1 text-xs text-text-secondary"
      title="Bridge breaks in the outline before filling, up to about twice this many pixels"
      >Gap
      <input
        type="range"
        min="0"
        max={MAX_GAP}
        class="w-16"
        bind:value={appState.fill.gap}
        style={sliderFill(appState.fill.gap, 0, MAX_GAP)}
      />
      <span class="text-xs w-4 tabular-nums">{appState.fill.gap}</span>
    </label>
    <label class="flex items-center gap-1 text-xs text-text-secondary" title="Fill opacity"
      >Opacity
      <input
        type="range"
        min="1"
        max="100"
        class="w-16"
        bind:value={appState.fill.opacity}
        style={sliderFill(appState.fill.opacity, 1, 100)}
      />
    </label>
    <!-- The bucket's OWN swatch. This control was always labelled "Fill color" while writing
         `brush.color`, so the label is now true rather than aspirational. -->
    <input type="color" bind:value={appState.fill.color} title="Fill color" />
    <!-- PARAMETERS then the ACTION, split by the bar language's divider. "Fill enclosed" sat
         mid-row before, which broke the params into two unrelated halves. The swatch stays LAST of
         the params, matching the brush branch, which also ends on its colour. -->
    <span class="mx-1 h-5 w-px bg-border"></span>
    <button
      class="h-7 px-2 rounded border border-border bg-surface text-text-secondary text-xs hover:bg-surface-hover hover:text-text aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-surface"
      title={paintBlock
        ? `Fill enclosed — ${editBlockLabel(paintBlock)}`
        : "Fill every area enclosed by the outline, behind the strokes"}
      aria-disabled={!canPaint}
      onclick={() => {
        if (canPaint) fillActions.allEnclosed?.();
      }}>Fill enclosed</button
    >
  {:else if appState.tool === "select" || appState.tool === "lasso"}
    <!-- aria-disabled, NOT disabled: a disabled button dispatches no pointer events, so the status
         bar's delegated title= hint can never reach it — see CLAUDE.md's 2026-08-12 entry. Handlers
         are guarded to match, since the button stays clickable and keyboard-activatable. -->
    {@const btn =
      "w-9 h-9 rounded border border-border bg-surface text-text-secondary flex items-center justify-center hover:bg-surface-hover aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-surface"}
    {@const canDeselect = appState.selectionActive || appState.selectionFloating}
    {@const canCopy =
      appState.selectionActive &&
      activeLayer().kind === "draw" &&
      workingTarget(appState.activeRow).kind === "layer"}
    {@const canCut = appState.selectionActive && canPaint}
    <!-- Asked of Canvas (the owner of pasteSelection) rather than re-derived from
         hasPixelClipboard + canPaint: three independent spellings of one predicate is how the
         button's enable-state and the keyboard's Cmd+V routing drift apart. It reads appState
         proxies internally, so it stays reactive here. `whyPaste` below still uses the local
         paintBlock — that is MESSAGING, and only renders when this is already false. -->
    {@const canPaste = selectionActions.canPaste?.() ?? false}
    {@const whyCopy = !appState.selectionActive
      ? " — select an area first"
      : workingTarget(appState.activeRow).kind !== "layer"
        ? ` — ${editBlockLabel("not-layer-row")}`
        : activeLayer().kind !== "draw"
          ? ` — ${editBlockLabel("not-draw")}`
          : ""}
    {@const whyWrite = paintBlock
      ? ` — ${editBlockLabel(paintBlock)}`
      : !appState.selectionActive
        ? " — select an area first"
        : ""}
    {@const whyPaste = paintBlock
      ? ` — ${editBlockLabel(paintBlock)}`
      : !appState.hasPixelClipboard
        ? " — nothing copied yet"
        : ""}
    <button
      class={btn}
      title={"Copy (Cmd/Ctrl+C)" + whyCopy}
      aria-disabled={!canCopy}
      onclick={() => {
        if (canCopy) selectionActions.copy?.();
      }}><Copy size={16} /></button
    >
    <button
      class={btn}
      title={"Cut (Cmd/Ctrl+X)" + whyWrite}
      aria-disabled={!canCut}
      onclick={() => {
        if (canCut) selectionActions.cut?.();
      }}><Scissors size={16} /></button
    >
    <button
      class={btn}
      title={"Paste (Cmd/Ctrl+V)" + whyPaste}
      aria-disabled={!canPaste}
      onclick={() => {
        if (canPaste) selectionActions.paste?.();
      }}><ClipboardPaste size={16} /></button
    >
    <button
      class={btn}
      title={"Delete (Del)" + whyWrite}
      aria-disabled={!canCut}
      onclick={() => {
        if (canCut) selectionActions.del?.();
      }}><Trash2 size={16} /></button
    >
    <button
      class={btn}
      title={canDeselect
        ? "Deselect (Esc) — drops the selection; reverts an in-progress move"
        : "Deselect (Esc) — nothing selected"}
      aria-disabled={!canDeselect}
      onclick={() => {
        if (canDeselect) selectionActions.deselect?.();
      }}><MousePointerBan size={16} /></button
    >
  {:else if appState.tool === "transform"}
    {@const flipBtn =
      "w-9 h-9 rounded border border-border bg-surface text-text-secondary flex items-center justify-center hover:bg-surface-hover aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-surface"}
    {#each [{ axis: "h", title: "Flip horizontal" }, { axis: "v", title: "Flip vertical" }] as const as f (f.axis)}
      <!-- aria-disabled, NOT disabled — see the select/lasso branch above for why. -->
      <button
        class={flipBtn}
        title={appState.canFlipTransform
          ? `${f.title} — in place`
          : `${f.title} — nothing to flip here`}
        aria-disabled={!appState.canFlipTransform}
        onclick={() => {
          if (appState.canFlipTransform) transformActions.flip?.(f.axis);
        }}
        >{#if f.axis === "h"}<FlipHorizontal2 size={16} />{:else}<FlipVertical2
            size={16}
          />{/if}</button
      >
    {/each}
    <span class="mx-1 h-5 w-px bg-border"></span>
    <button
      class="h-7 px-2 rounded border border-border bg-surface text-text-secondary text-xs flex items-center gap-1 hover:bg-surface-hover hover:text-text"
      class:ui-on={appState.keepProportions}
      aria-pressed={appState.keepProportions}
      title={appState.keepProportions
        ? "Keep proportions — on: corners keep the shape (sides always stretch)"
        : "Keep proportions — off: corners stretch freely"}
      onclick={() => (appState.keepProportions = !appState.keepProportions)}
      >{#if appState.keepProportions}<Lock size={14} />{:else}<LockOpen size={14} />{/if}
      Keep proportions</button
    >
  {:else if appState.tool === "deform" || appState.tool === "pose"}
    <!-- No blocked-edit reason here. Canvas.svelte's stage overlay already says it for EVERY tool,
         and the status bar says it a third time — this branch was the only place that repeated it,
         written as "swap the instructions for the reason" without noticing the overlay. The
         instructions are gated on NOT blocked, or a hidden layer would be told to drag handles it
         cannot move. -->
    {#if !paintBlock && appState.tool === "deform"}
      <span class="text-xs text-text-muted"
        >Drag the grid handles on the canvas · FFD/Rigid in the selection bar</span
      >
    {/if}
  {:else}
    <span class="text-xs text-text-muted"></span>
  {/if}
  <!-- Outside the per-tool branches on purpose: a REFERENCE layer's gizmo is live under EVERY tool,
       so gating this on the Transform tool would leave a moved reference unresettable. It appears
       only when a gizmo is up AND its transform is non-identity — a Reset that would do nothing is
       worse than no button (2026-08-15). -->
  {#if appState.canResetTransform}
    <button
      class="h-7 px-2 rounded border border-border bg-surface text-text-secondary text-xs hover:bg-surface-hover hover:text-text"
      title="Reset the current transform back to fit"
      onclick={() => transformActions.reset?.()}>Reset to fit</button
    >
  {/if}
</div>
