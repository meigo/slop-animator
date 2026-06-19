# Independent Brush & Eraser Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the eraser its own stroke settings independent of the brush; the toolbar + canvas use the active tool's settings.

**Architecture:** Consolidate the per-tool fields into one `ToolSettings` type; `state.brush` and `state.eraser` are both that shape; an `activeStroke()` selector returns the active one. The currently top-level `state.sizeRange`/`streamline`/`brushType` move INTO the tool object — so this is one atomic change across appState + Canvas + Toolbar + App + preferences (removing those top-level fields breaks every consumer at compile time, so they all change together; the build only goes green at the end).

**Tech Stack:** Svelte 5 runes, TypeScript.

**Spec:** `docs/superpowers/specs/2026-06-20-brush-eraser-separate-settings-design.md`

**Branch:** execute on a new branch `brush-eraser-settings` (off `main`).

**No new automated tests** (appState/Canvas/Toolbar/App are runes/DOM, not node-renderable; `preferences.ts` is a permissive pass-through). The existing **209** tests must stay green and the build must be **0 errors / 0 warnings**. Verification is build + the manual checklist.

---

### Task 1: Independent brush & eraser settings (one atomic change)

**Files:** `src/state/appState.svelte.ts`, `src/persist/preferences.ts`, `src/lib/Canvas.svelte`, `src/lib/Toolbar.svelte`, `src/App.svelte`

- [ ] **Step 1 — appState: type + state shape + selector**

In `src/state/appState.svelte.ts`:

(a) After the `BrushKind` type, add the `ToolSettings` type:
```ts
/** Per-tool stroke settings (brush and eraser each hold one). `isEraser` is NOT stored — it's
 *  derived from the active tool at draw time. */
export type ToolSettings = Omit<BrushSettings, "isEraser"> & {
  sizeRange: number;
  streamline: number;
  brushType: BrushKind;
};
```

(b) In the `AnimState` interface, replace:
```ts
  brush: BrushSettings;
  sizeRange: number;
  streamline: number;
  brushType: BrushKind;
```
with:
```ts
  brush: ToolSettings;
  eraser: ToolSettings;
```

(c) In the `state = $state({...})` initializer, replace the `brush: {...}` object plus the
`sizeRange/streamline/brushType` lines:
```ts
  brush: {
    size: 4,
    color: "#1a1a1a",
    opacity: 100,
    smoothing: 50,
    isEraser: false,
    drawBehind: false,
    alphaLock: false,
    taper: false,
  },
  sizeRange: 3.0, // full pen pressure → 3× the base brush width (light pressure → base)
  streamline: 50,
  brushType: "smooth",
```
with (note: no `isEraser` field now; add `eraser`):
```ts
  brush: {
    size: 4,
    color: "#1a1a1a",
    opacity: 100,
    smoothing: 50,
    drawBehind: false,
    alphaLock: false,
    taper: false,
    sizeRange: 3.0, // full pen pressure → 3× the base width (light pressure → base)
    streamline: 50,
    brushType: "smooth",
  },
  eraser: {
    size: 8,
    color: "#000000", // unused (eraser composites destination-out)
    opacity: 100,
    smoothing: 50,
    drawBehind: false,
    alphaLock: false,
    taper: false,
    sizeRange: 3.0,
    streamline: 50,
    brushType: "smooth",
  },
```

(d) Add the selector (near `activeLayer()`):
```ts
/** The stroke settings for the active drawing tool (eraser has its own; everything else uses brush). */
export function activeStroke(): ToolSettings {
  return state.tool === "eraser" ? state.eraser : state.brush;
}
```

- [ ] **Step 2 — appState: persistence**

`gatherPreferences`: replace
```ts
    brush: { ...state.brush },
    brushType: state.brushType,
    sizeRange: state.sizeRange,
    streamline: state.streamline,
```
with
```ts
    brush: { ...state.brush },
    eraser: { ...state.eraser },
```

`applyPreferences`: replace
```ts
  if (p.brush && typeof p.brush === "object") state.brush = { ...state.brush, ...p.brush };
  if (p.brushType) state.brushType = p.brushType;
  if (typeof p.sizeRange === "number") state.sizeRange = p.sizeRange;
  if (typeof p.streamline === "number") state.streamline = p.streamline;
```
with
```ts
  if (p.brush && typeof p.brush === "object") state.brush = { ...state.brush, ...p.brush };
  if (p.eraser && typeof p.eraser === "object") state.eraser = { ...state.eraser, ...p.eraser };
  // Back-compat: older saves wrote brushType/sizeRange/streamline at the top level → onto the brush.
  if (p.brushType) state.brush.brushType = p.brushType;
  if (typeof p.sizeRange === "number") state.brush.sizeRange = p.sizeRange;
  if (typeof p.streamline === "number") state.brush.streamline = p.streamline;
```

- [ ] **Step 3 — preferences.ts: type**

In `src/persist/preferences.ts`:
- Add `ToolSettings` to the appState type import: `import type { Tool, BrushKind, ToolSettings } from "../state/appState.svelte";`
- Update the `Preferences` interface:
```ts
export interface Preferences {
  tool: Tool;
  brush: ToolSettings;
  eraser: ToolSettings;
  fill: { tolerance: number; expand: number };
  theme: "dark" | "light";
  loop: boolean;
  pressureCurve: { cp1: CurvePoint; cp2: CurvePoint };
  // Legacy (read-only back-compat; older versions wrote these at the top level).
  brushType?: BrushKind;
  sizeRange?: number;
  streamline?: number;
}
```
(The `BrushSettings` import may become unused — remove it if so to avoid a warning.)

- [ ] **Step 4 — Canvas: use the active tool's settings**

In `src/lib/Canvas.svelte`:
- Add `activeStroke` to the `../state/appState.svelte` import.
- In `paintStroke`, replace the settings/sr/kind block:
```ts
    const sr = (curved[0]?.hasPressure ?? true) ? state.sizeRange : 1;
    const settings = { ...state.brush, isEraser: state.tool === "eraser" };
    const kind = state.brushType; // local so TS narrows it across the branches
```
with:
```ts
    const stroke = activeStroke();
    const sr = (curved[0]?.hasPressure ?? true) ? stroke.sizeRange : 1;
    const settings = {
      size: stroke.size, color: stroke.color, opacity: stroke.opacity, smoothing: stroke.smoothing,
      drawBehind: stroke.drawBehind, alphaLock: stroke.alphaLock, taper: stroke.taper,
      isEraser: state.tool === "eraser",
    };
    const kind = stroke.brushType; // local so TS narrows it across the branches
```
- In the stroke-start reset, replace `state.brushType` (both lines):
```ts
      if (state.brushType === "ink") resetInkState();
      else if (state.brushType !== "smooth") resetStampState();
```
with `activeStroke().brushType`:
```ts
      if (activeStroke().brushType === "ink") resetInkState();
      else if (activeStroke().brushType !== "smooth") resetStampState();
```
- The input `streamline` getter: replace `() => state.streamline / 100` with
  `() => activeStroke().streamline / 100`.
- Leave `doFill`'s `hexToRgba(state.brush.color, state.brush.opacity)` as-is (fill is a brush-color
  tool, never the eraser).

- [ ] **Step 5 — Toolbar: bind to the active tool; hide color when erasing**

In `src/lib/Toolbar.svelte`:
- In the `<script>`, add a derived selector:
```ts
  const stroke = $derived(appState.tool === "eraser" ? appState.eraser : appState.brush);
```
- Rebind these controls from `appState.brush.*` / `appState.sizeRange` / `appState.streamline` /
  `appState.brushType` to `stroke.*`:
  - Size slider + number: `bind:value={stroke.size}` (both inputs).
  - Size presets: `class:bg-surface-active={stroke.size === preset}` and `onclick={() => (stroke.size = preset)}`.
  - Press: `bind:value={stroke.sizeRange}` and the readout `{stroke.sizeRange}×`.
  - Brush-type `<select>`: `bind:value={stroke.brushType}`.
  - Opacity: `bind:value={stroke.opacity}`.
  - Smooth: `bind:value={stroke.smoothing}`.
  - Stream: `bind:value={stroke.streamline}`.
  - Taper: `bind:checked={stroke.taper}`.
- The **color** input stays `bind:value={appState.brush.color}` but wrap it so it only shows for the
  brush: `{#if appState.tool !== "eraser"}<input type="color" bind:value={appState.brush.color} />{/if}`.
- Add a small **Eraser** indicator before the Size label:
  `{#if appState.tool === "eraser"}<span class="text-xs text-amber-500">Eraser</span>{/if}`.

  **Binding note:** `bind:value={stroke.X}` (X a property of the `$derived` object) mutates the active
  tool's `$state` object — this is allowed (binding to a member expression, not to the derived itself).
  If the Svelte compiler rejects binding to a derived member, fall back to two control blocks
  `{#if appState.tool === "eraser"} …bind appState.eraser.*… {:else} …bind appState.brush.*… {/if}` and
  report that you did.

- [ ] **Step 6 — App: `[` / `]` resize the active tool**

In `src/App.svelte`, replace:
```ts
    else if (e.key === "[") state.brush.size = Math.max(0.5, state.brush.size - 1);
    else if (e.key === "]") state.brush.size = Math.min(60, state.brush.size + 1);
```
with:
```ts
    else if (e.key === "[" || e.key === "]") {
      const s = state.tool === "eraser" ? state.eraser : state.brush;
      s.size = e.key === "[" ? Math.max(0.5, s.size - 1) : Math.min(60, s.size + 1);
    }
```

- [ ] **Step 7 — Build + tests**

Run: `npm run build` → 0 errors, 0 warnings. (TS will flag any missed `state.sizeRange`/`streamline`/`brushType` reference — fix each by routing through `activeStroke()` / the tool object. If the compiler flags one in a file not listed above, STOP and report it.)
Run: `npm test` → 209 pass (unchanged).
Run: `npm run lint` → clean.

- [ ] **Step 8 — Manual verification (browser)**

Run `npm run dev`:
- Brush: set size/opacity/texture. Switch to the eraser → the controls now show the *eraser's* values; change the eraser's size/opacity/texture. Switch back → the brush is unchanged. Draw and erase confirm each uses its own settings.
- The color swatch is hidden while erasing; the "Eraser" indicator shows.
- `[` / `]` resize whichever tool is active; pencil double-tap toggles brush↔eraser and the controls swap; the size presets + Press + brush-type all target the active tool.
- Reload the page: brush *and* eraser settings both persist.
- Back-compat: with an older prefs blob in localStorage (key `slop-animator:prefs`, a `brush` without
  sizeRange + top-level `brushType`/`sizeRange`/`streamline`, no `eraser`), the brush restores its
  texture/pressure/streamline and the eraser shows defaults.

- [ ] **Step 9 — Commit**
```bash
git add src/state/appState.svelte.ts src/persist/preferences.ts src/lib/Canvas.svelte src/lib/Toolbar.svelte src/App.svelte
git commit -m "feat: independent brush and eraser stroke settings"
```

---

## Final verification

- [ ] `npm run build` → 0 errors, 0 warnings.
- [ ] `npm test` → 209 pass; `npm run lint` clean.
- [ ] Manual checklist (Step 8) confirmed — especially that brush and eraser settings are truly
      independent, and old prefs still load.

## Self-Review (completed by plan author)

**Spec coverage:** `ToolSettings` + symmetric `state.brush`/`state.eraser` + `activeStroke()` (Step 1) ✅; consolidation of `sizeRange`/`streamline`/`brushType` into the tool object (Steps 1,3–6) ✅; Canvas draws with the active tool's settings, fill stays brush-color (Step 4) ✅; toolbar context-swap + color hidden when erasing + Eraser indicator (Step 5) ✅; `[`/`]` on the active tool, double-tap unchanged (Step 6) ✅; persistence of both + legacy back-compat (Steps 2–3) ✅; pressure curve stays shared (untouched) ✅; no new tests, 209 green (Steps 7,9) ✅.

**Placeholder scan:** No TBD/TODO; every step shows the exact before/after. The one conditional (the bind-to-derived-member fallback) is an explicit instruction with a concrete alternative, not a placeholder.

**Consistency:** `ToolSettings = Omit<BrushSettings,"isEraser"> & {sizeRange,streamline,brushType}` defined once (Step 1) and used in `state` (1), `Preferences` (3), `activeStroke()` (1), Canvas (4), Toolbar `$derived` (5). `isEraser` is added only at draw time (Step 4), never stored — consistent with omitting it from `ToolSettings`. Persistence reads `p.brush`/`p.eraser` (new) plus legacy top-level fields (3) matching what `gatherPreferences` (old) wrote.
