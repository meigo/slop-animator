# Blend Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Blend tool (J, after the Eraser) that blurs/smudges/smears the drawing on the current frame, ported from slop-paint.

**Architecture:** slop-paint's self-contained incremental engine (`blend-brush.ts`) is copied into `src/core/`; the app gains a third stroke tool with its own settings slot and pressure curve, dispatched in `Canvas.svelte`'s existing stroke path (pinned cell, materialised keyframe on a hold, one undo step per stroke).

**Tech Stack:** Svelte 5 runes, TypeScript, Vite, Tailwind 4, Vitest, Playwright (WebKit smoke).

**Spec:** `docs/superpowers/specs/2026-10-26-blend-tool-design.md`

## Global Constraints

- Port slop-paint's CURRENT engine (`git -C ../slop-paint show HEAD:src/blend-brush.ts`, tests `HEAD:src/__tests__/blend-brush.test.ts`), changing only imports and what this app lacks.
- Read the cell with `getImageData`, never `drawImage`; blur in JS (`boxBlur3`), never canvas shrink+grow.
- Blend defaults: size 20, opacity (Strength) 100, Smear 30, Tip "soft"; its pressure curve falls back to the brush curve until saved.
- Shortcut J; toolbar button after the Eraser, title "Blend (J) — blur, smudge or smear the drawing", lucide `Droplet` icon.
- No brush-type menu, colour swatch, Paint behind, Smooth, Wobble or other brush-only option for Blend.
- `npm run build`: 0 errors, 0 warnings. `npm test`: all passing.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. One commit per task.

## Review Focus

- A tool switch (toolbar tap, J, double-tap eraser toggle) while a Blend stroke is open must commit it as Blend with Blend's settings and curve — not redraw it as a brush or eraser stroke (Task 3, `commitOpenStroke` pinned tool).
- A Blend stroke on a HOLD frame must change only the new keyframe; undo must take back the pixels and the ◆ (Task 3, reuses `ensureDrawableKeyframe` + `commitOpenStroke`; smoke test in Task 5).
- A Blend stroke over empty paper changes nothing → no undo step, no keyframe left behind (already true through `sameImageData` — Task 3 must not bypass it).
- Blend on a loop-played frame, locked/hidden layer, reference, audio or group row is refused with the same message as the brush (Task 2 status-hint tests; Task 3 `PIXEL_TOOLS`).
- The brush's and eraser's sizes and curves are untouched by Blend's (Task 2 preferences test; Task 5 smoke).

---

### Task 1: The engine

**Files:**
- Create: `src/core/blend-brush.ts` (copy of slop-paint `src/blend-brush.ts`)
- Create: `src/__tests__/blend-brush.test.ts` (copy of slop-paint's, import path `../core/blend-brush`)
- Modify: `src/core/brush-textures.ts` (add `BLEND_TIPS`, `BlendTip`, `blendTip()` from slop-paint's file, using this file's own `softRoundTip`/`hardRoundTip`/`pencilTip`/`charcoalTip`)
- Modify: `src/core/brush.ts` `BrushSettings` (add `blendSmear?: number` and `blendTip?: string` with slop-paint's doc comments)

**Interfaces:**
- Produces: `drawBlendStrokeIncremental(ctx: CanvasRenderingContext2D, points: InputPoint[], settings: BrushSettings, sizeRange = 1, done = false): void`, `resetBlendState(): void`, `releaseBlendState(): void`, `BLEND_TIPS`, `type BlendTip`.

- [ ] **Step 1:** Copy the test file; run `npx vitest run src/__tests__/blend-brush.test.ts` → FAIL (module not found).
- [ ] **Step 2:** Copy the engine. Imports: `./input` (InputPoint), `./brush` (widthRange, BrushSettings), `./brush-textures` (blendTip), `./stamp-brush` (spaceStamps, mipIndex). `releaseCanvas` does not exist in this app's `dry-brush.ts`: define it privately in `blend-brush.ts`, copied from slop-paint's `src/dry-brush.ts` (`releaseCanvas(c: HTMLCanvasElement | null)`: set width and height to 0). Add `blendTip` to brush-textures and the two `BrushSettings` fields.
- [ ] **Step 3:** Run the test → PASS. Run `npm run build` → 0 errors, 0 warnings.
- [ ] **Step 4:** Commit `feat: Blend engine (slop-paint's blend-brush.ts)`.

### Task 2: State, preferences, tool lists

**Files:**
- Modify: `src/state/appState.svelte.ts` — `Tool` adds `"blend"`; `AnimState.blend: ToolSettings`; its default (copy of the eraser's object with `size: 20`, `color` unused, `smoothing: 0`, `blendSmear: 30`, `blendTip: "soft"`); `export function isStrokeTool(tool: Tool): boolean` (brush | eraser | blend); `activeStroke()` returns `state.blend` for Blend; `pressureCurves.blend = new PressureCurve()`; `activePressureCurve()` returns it for Blend; `gatherPreferences` adds `blend: { ...state.blend }` and `blendPressureCurve`; `applyPreferences` merges `p.blend` like `p.eraser` and `applyCurve(pressureCurves.blend, blendCurvePref(p))`.
- Modify: `src/persist/preferences.ts` — `Preferences.blend?: ToolSettings`, `blendPressureCurve?: CurvePrefs`; `export function blendCurvePref(p: Partial<Preferences>): Partial<CurvePrefs>` (own when stored, else `p.pressureCurve` — same shape as `eraserCurvePref`); and wherever `parsePreferences` validates `eraser`, validate `blend` the same way.
- Modify: `src/lib/status-hint.ts` — add `"blend"` beside `"eraser"` in the audio-row, group-row and not-draw tool lists.
- Modify: `src/lib/StatusBar.svelte` `toolLabel` → "blend" for Blend (falls through to `appState.tool` already — verify; change only if not).
- Modify: `src/lib/LayerBoundsHint.svelte` `PAINT_TOOLS` add `"blend"`.
- Modify: `src/lib/BrushCursor.svelte` — `isStrokeTool` local replaced by the store's `isStrokeTool(appState.tool)`; `dashed` stays eraser-only.
- Modify: `src/App.svelte` — `letter === "j"` → `state.tool = "blend"`; `[`/`]` use `activeStroke()`.
- Modify: `src/lib/Toolbar.svelte` — Blend button after the Eraser (`Droplet`, `pixelTitle("Blend (J) — blur, smudge or smear the drawing")` or the equivalent the other buttons use, `class:opacity-40={toolsDimmed}`).
- Test: `src/__tests__/preferences.test.ts`, `src/__tests__/status-hint.test.ts`

**Interfaces:**
- Produces: `Tool` includes `"blend"`; `state.blend: ToolSettings`; `isStrokeTool(tool: Tool): boolean`; `pressureCurves.blend`; `blendCurvePref(p)`.

- [ ] **Step 1: Failing tests.** In preferences.test.ts: `blendCurvePref` returns `p.blendPressureCurve` when stored, `p.pressureCurve` when not (mirror the two existing `eraserCurvePref` cases); `parsePreferences` round-trips a `blend` object (size 20, blendSmear 30) and leaves `eraser` unchanged. In status-hint.test.ts: add `"blend"` to the loops at :40 (not-draw) and assert `contextHint(ctx({ tool: "blend", groupRow: true }))` and `({ tool: "blend", audioRow: true })` are `"Select a layer row to edit"`.
- [ ] **Step 2:** Run both files → FAIL.
- [ ] **Step 3:** Implement the list above.
- [ ] **Step 4:** Run both files → PASS; `npm run build` → 0/0 (exhaustive `Tool` switches/records will flag any spot needing `"blend"`; add it there with the brush/eraser behaviour).
- [ ] **Step 5:** Commit `feat: Blend tool state, preferences and tool lists`.

### Task 3: Stroke wiring in Canvas

**Files:**
- Modify: `src/lib/Canvas.svelte`
- Modify: `src/anim/document.ts` `cloneCanvas` — `getContext("2d", { willReadFrequently: true })`, with a one-line comment saying why (a Blend dab reads the cell; the flag only counts at the first `getContext`).

**Interfaces:**
- Consumes: Task 1's engine; Task 2's `isStrokeTool`, `state.blend`, `pressureCurves.blend`.

- [ ] **Step 1: Pin the stroke tool.** Replace the `asEraser: boolean` parameter of `paintStroke(pts, done, asEraser)` and `commitOpenStroke(pts, asEraser)` with `strokeTool: "brush" | "eraser" | "blend"` (default: the current tool when it is a stroke tool, else "brush"); `asEraser` becomes `strokeTool === "eraser"`. Settings: `state.eraser` / `state.blend` / `state.brush` by tool; curve: `pressureCurves[strokeTool]`. The tool-change effect (≈:2917) passes `prevTool` (narrowed to a stroke tool) instead of `prevTool === "eraser"`.
- [ ] **Step 2: Pin the kind.** At the stroke's first event (≈:1650), `strokeBrushType = tool === "blend" ? "blend" : activeStroke().brushType`; widen `strokeBrushType`'s type to `BrushKind | "blend"` locally (don't add "blend" to `BrushKind` — the brush-type menu binds to it). Call `resetBlendState()` for "blend" (and NOT `resetStampState()`).
- [ ] **Step 3: Dispatch.** In `paintStroke`, a `kind === "blend"` branch before the stamp `else`: same shape as the stamp branch (save, `setTransform(DPR…)`, `selection?.applyClip`, `drawBlendStrokeIncremental(strokeCtx, curved, settings, sr, done)`, restore in `finally`). Smooth path averaging stays off for it (it is gated on brushType smooth/watercolor already).
- [ ] **Step 4: Tool lists.** `PIXEL_TOOLS` add `"blend"`; `class:cursor-none` and the `setupInput` streamline option use `isStrokeTool(appState.tool)`. grep `Canvas.svelte` for other `"brush" || ... "eraser"` pairs and decide each: "a stroke tool" → `isStrokeTool`; "the eraser specifically" → leave.
- [ ] **Step 5:** `npm run build` → 0/0; `npm test` → all pass.
- [ ] **Step 6: Browser check** (`npm run dev`, desktop Chrome or the Playwright WebKit): draw a line, J, drag across it → it smears; ⌘Z restores; on a hold frame the blend lands on a new ◆ and the held frames are unchanged; ⌘Z removes the ◆; blend on empty paper → no undo step.
- [ ] **Step 7:** Commit `feat: Blend strokes in the canvas; copied cells read fast`.

### Task 4: Tool options row

**Files:**
- Modify: `src/lib/ToolOptions.svelte`

- [ ] **Step 1:** `stroke` derives `state.blend` for Blend. The stroke block shows for `isStrokeTool(appState.tool)`. For Blend: a `Blend` label like the Eraser's (`text-xs`, not warn-coloured); NO type `<select>`; Size + presets + Press as for the brush; the Opacity slider labelled **Strength** with title "Strength — how strongly it blends"; a **Smear** slider on the bar (0–100, `w-16 max-[960px]:w-12`, value readout, title "Smear — 0 blurs in place; higher carries the paint along the stroke: a smudge, then a long smear", bound to `stroke.blendSmear`); no colour swatch. Gear panel for Blend: Stream, a **Tip** button row (`BLEND_TIPS`: Soft / Hard / Grain / Rough, styled like the pencil Grade row, bound to `stroke.blendTip`), and the pressure curve labelled "Blend pressure curve"; none of the brush-type-specific rows and no Paint behind. `curveEditors` gains `blend: createCurveEditor(pressureCurves.blend, bumpCurve)` and the effect picks `curveEditors[tool]` for stroke tools. The gear's title for Blend: "Blend settings — stream, tip, pressure curve".
- [ ] **Step 2:** `npm run build` → 0/0.
- [ ] **Step 3: Browser check:** Blend row at 834 px wide is one line (40 px); Smear and Tip change the stroke; switching Brush ↔ Blend keeps each size.
- [ ] **Step 4:** Commit `feat: Blend tool options (Strength, Smear, Tip)`.

### Task 5: Smoke test and docs

**Files:**
- Modify: `tools/ipad-smoke.mjs`
- Modify: `README.md`, `docs/superpowers/CHANGELOG.md`, `CLAUDE.md` (Current state line; mark roadmap item (18) SHIPPED; architecture map: `blend-brush.ts`)

- [ ] **Step 1: Smoke.** Following slop-paint's `7449d2a` smoke change, adapted to this file's helpers: after a drawn stroke, tap "Blend (J)", check no brush-type `<select>` is shown, drag across the stroke → canvas pixels change and the undo count rises by one; ⌘Z → pixels restored; the brush's size readout unchanged. Add `"Blend"` to the portrait tool list (≈:969) so its row is checked for one line.
- [ ] **Step 2:** `npm run test:ipad` → all checks pass (needs local port binding).
- [ ] **Step 3: Docs.** README: Features bullet for Blend, Keyboard `J`, test count from `npm test`. CHANGELOG: a dated 2026-10-26 entry (what, the WebKit traps, the `cloneCanvas` change, owed iPad pass: long wide stroke for lag, Smear feel, playback with copied cells). CLAUDE.md: current-state paragraph, roadmap (18) marked SHIPPED with a pointer to the entry, test baseline.
- [ ] **Step 4:** Commit `docs: Blend tool in README, CHANGELOG and CLAUDE.md; smoke test`.
