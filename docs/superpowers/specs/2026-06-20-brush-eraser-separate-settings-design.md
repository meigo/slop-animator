# Independent Brush & Eraser Settings — Design

**Status:** Approved (design phase)
**Date:** 2026-06-20

## Goal

Give the **eraser** its own stroke settings, fully independent from the brush, so changing the eraser's
size/opacity/texture/etc. doesn't affect the brush and vice-versa. Switching between the brush and
eraser tools swaps which settings the toolbar shows and the canvas draws with.

## Decisions (from brainstorming)

- **Full independence (A):** the eraser holds its own `size, opacity, smoothing, taper, sizeRange
  (Press), streamline, brushType`. **Color, draw-behind, and alpha-lock stay brush-only** (the eraser
  ignores them; color is hidden in the toolbar while erasing).
- **Toolbar context-swap:** the existing controls bind to the *active tool's* settings; no separate
  eraser panel.
- **Pressure curve stays global/shared** (one bezier editor) — out of the per-tool split.

## State model (`src/state/appState.svelte.ts`)

Today `state.brush` is a `BrushSettings` and `sizeRange`/`streamline`/`brushType` are top-level
siblings. Consolidate the per-tool fields into one symmetric type so both tools share a shape:

```ts
// isEraser is NOT stored — it's derived from the active tool at draw time.
export type ToolSettings = Omit<BrushSettings, "isEraser"> & {
  sizeRange: number;
  streamline: number;
  brushType: BrushKind;
};
```

- `state.brush: ToolSettings` and **new** `state.eraser: ToolSettings`.
- **Remove** the top-level `state.sizeRange`, `state.streamline`, `state.brushType` (now inside each
  tool's object).
- Selector used everywhere the "current drawing settings" are needed:
  ```ts
  export function activeStroke(): ToolSettings {
    return state.tool === "eraser" ? state.eraser : state.brush;
  }
  ```
  (A plain function — reads the `state` proxy, so callers stay reactive. The eraser is the only
  non-brush tool with stroke settings; fill/select/lasso/transform fall through to `state.brush`,
  harmlessly, since they don't stroke.)

**Defaults:** `state.brush` keeps today's values + `sizeRange: 3, streamline: 50, brushType: "smooth"`.
`state.eraser` starts at a sensible eraser default: `size: 8, opacity: 100, smoothing: 50, taper:
false, sizeRange: 3, streamline: 50, brushType: "smooth"` (color/drawBehind/alphaLock present but
unused: color `"#000000"`, both flags false).

## Drawing path (`src/lib/Canvas.svelte`)

In `paintStroke`, derive the active settings once and build the render `BrushSettings` from them:
```ts
const stroke = activeStroke();
const sr = (curved[0]?.hasPressure ?? true) ? stroke.sizeRange : 1;
const kind = stroke.brushType;
const settings = {
  size: stroke.size, color: stroke.color, opacity: stroke.opacity, smoothing: stroke.smoothing,
  drawBehind: stroke.drawBehind, alphaLock: stroke.alphaLock, taper: stroke.taper,
  isEraser: state.tool === "eraser",
};
```
Other `state.brushType`/`state.sizeRange` reads update to `activeStroke()`:
- the stamp/ink reset on stroke start (`state.brushType === "ink"` …) → `activeStroke().brushType`.
- the input `streamline` getter (`() => state.streamline / 100`) → `() => activeStroke().streamline / 100`.
- `doFill` keeps using `state.brush.color`/`opacity` (fill is a brush-color tool, never the eraser).

## Toolbar (`src/lib/Toolbar.svelte`)

- Compute the active object once: `const stroke = $derived(state.tool === "eraser" ? state.eraser :
  state.brush);` (Toolbar is runes mode; `state` is imported as `appState`, so this is
  `appState.tool`/`appState.eraser`/`appState.brush`).
- Bind the **size** (slider + number + presets), **Press** (`sizeRange`), **brush-type** select,
  **opacity**, **smoothing**, **streamline**, and **taper** controls to `stroke.*` instead of
  `appState.brush.*` / `appState.sizeRange` / `appState.streamline` / `appState.brushType`.
  (`bind:value={stroke.size}` mutates the active tool's object; switching tools re-derives `stroke`
  and the controls show the other tool's values.)
- **Color** input binds to `appState.brush.color` and is shown only when `appState.tool !== "eraser"`.
- A small indicator (e.g. an "Eraser" chip/label next to the controls when `appState.tool ===
  "eraser"`) makes it obvious which tool's settings are being edited. The eraser tool button is
  already highlighted, so this stays minimal.

## Shortcuts (`src/App.svelte`)

The `[` / `]` size shortcuts operate on the active tool: replace `state.brush.size = …` with
`const s = state.tool === "eraser" ? state.eraser : state.brush; s.size = clamp(...)`. The pencil
double-tap `toggleEraser` only switches the tool — settings follow automatically, no change needed.

## Persistence (`src/persist/preferences.ts` + `appState`)

- `Preferences`: `brush: ToolSettings` (was `BrushSettings`), **add** `eraser: ToolSettings`. Keep
  `brushType?`, `sizeRange?`, `streamline?` as **optional legacy fields** (older saves wrote them at
  top level) for read-only back-compat. (Import `ToolSettings` from appState alongside the existing
  `Tool`/`BrushKind` type imports.)
- `gatherPreferences`: emit `brush: { ...state.brush }, eraser: { ...state.eraser }` (the brush object
  now already contains brushType/sizeRange/streamline; drop the separate top-level keys).
- `applyPreferences`: merge `p.brush` into `state.brush`, `p.eraser` into `state.eraser`; then apply
  any **legacy** top-level `p.brushType`/`p.sizeRange`/`p.streamline` onto `state.brush` (so old saved
  prefs still restore the brush's texture/pressure/streamline). Old prefs without `eraser` leave the
  eraser at its defaults.

## Testing

The change lives in `appState`/`Canvas`/`Toolbar`/`App` (runes/DOM — not node-renderable) and
`preferences.ts` (a permissive pass-through parser). So: **no new automated tests**; the existing
**209** must stay green and every build is **0/0**.

**Manual (browser):**
- With the brush: set size/opacity/texture; switch to the eraser → the controls show the *eraser's*
  values; change the eraser's size/opacity/texture; switch back → the brush is unchanged. Erase and
  draw confirm each uses its own settings.
- Color is hidden while erasing; the "Eraser" indicator shows; `[`/`]` resize the active tool; pencil
  double-tap toggles brush↔eraser and the controls swap.
- Reload: brush *and* eraser settings persist. Loading an **older** prefs blob (no `eraser`, legacy
  top-level `brushType`/`sizeRange`/`streamline`) restores the brush correctly and the eraser uses
  defaults (back-compat).

## Out of scope

- A per-tool **pressure curve** (stays shared).
- Per-tool **color** (eraser has no color); exposing draw-behind/alpha-lock in the UI.
- Independent settings for fill/select/lasso/transform (they don't stroke).

## Self-review notes

- Symmetric `ToolSettings` for both tools is what lets `activeStroke()` be a one-line selector the
  toolbar can bind to; the cost is consolidating three currently-top-level fields into the tool object
  (a mechanical rename across Canvas/Toolbar/App/persistence).
- `isEraser` is intentionally derived from the tool, not stored, so the two objects can share a type
  and there's a single source of truth for "is this stroke erasing."
- Back-compat is handled by keeping the legacy pref fields readable; the only behavior change for an
  existing user is that the eraser now starts at its own defaults instead of mirroring the brush.
