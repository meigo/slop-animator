# Global Preferences Persistence — Design

**Status:** Approved (design phase)
**Date:** 2026-06-17

## Goal

Persist the user's cross-project tool/UI preferences to `localStorage` and restore them on startup, so
brush settings, the current tool, theme, etc. survive a reload and carry across projects. Per-project
and transient state (playhead, active layer, viewport zoom/pan, play range) is **not** persisted.

## Context

`state` (in `src/state/appState.svelte.ts`) holds both the document (`state.project`, persisted via the
IndexedDB **autosave**) and top-level tool/UI fields that currently **reset on every reload** (tool,
brush, theme, onion, etc.). This feature persists a defined subset of those top-level fields to
`localStorage` — independent of the project autosave and of the exported project file. `App.svelte`'s
`onMount` already restores the project autosave; preferences load/save sit alongside it.

This is the separate, smaller sibling of the deferred reference-layer persistence
(`2026-06-17-reference-persistence-notes.md`) — no media, just a small JSON of settings.

## Scope

Persisted preferences (cross-project):
- `tool` (current tool)
- `brush` (the whole `BrushSettings`: size, color, opacity, smoothing, isEraser, drawBehind, alphaLock, taper)
- `brushType` (smooth / ink / stamp)
- `sizeRange`, `streamline`
- `fill` (tolerance, expand)
- `theme` (dark / light)
- `loop` (from `state.playback.loop`)

Explicitly NOT persisted (per-project / transient): `playhead`, `activeLayerId`, viewport
zoom/pan/rotation, `playback.isPlaying`, `playback.range`, `exportOpen`, `sizeDialog`, `version`,
`state.project`.

Deferred (not in this spec): onion-skin settings and the pressure curve (the latter needs its own
serialization). They can be added to the preferences set later.

## Decisions

1. **`localStorage`, not IndexedDB.** Preferences are tiny JSON; `localStorage` is synchronous and
   simple. (The project autosave keeps using IndexedDB for the larger blob.)
2. **Independent of the project.** Loading/applying preferences does not touch `state.project`; the
   autosave restore does not touch these fields. Order between them doesn't matter.
3. **Defensive apply.** A corrupt/tampered `localStorage` must not crash or corrupt state — each field
   is applied only if present and of the expected type; anything else falls back to the default.
4. **Debounced save.** Preferences save ~400 ms after the last change (so dragging a brush slider
   doesn't thrash `localStorage`).

## Components & data flow

### `src/persist/preferences.ts` (new)

```ts
import type { Tool, BrushKind } from "../state/appState.svelte"; // both exported there
import type { BrushSettings } from "../core/brush";

export interface Preferences {
  tool: Tool;
  brush: BrushSettings;
  brushType: BrushKind;
  sizeRange: number;
  streamline: number;
  fill: { tolerance: number; expand: number };
  theme: "dark" | "light";
  loop: boolean;
}

const KEY = "slop-animator:prefs";

/** Pure parse: null/garbage → {}, a JSON object → its (partial) contents. Node-testable. */
export function parsePreferences(raw: string | null): Partial<Preferences> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Partial<Preferences>) : {};
  } catch {
    return {};
  }
}

export function loadPreferences(): Partial<Preferences> {
  try { return parsePreferences(localStorage.getItem(KEY)); } catch { return {}; }
}

export function savePreferences(p: Preferences): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* quota / unavailable — ignore */ }
}
```

### `appState.svelte.ts` — gather + apply

```ts
/** Snapshot the persisted-preference fields from live state. */
export function gatherPreferences(): Preferences {
  return {
    tool: state.tool,
    brush: { ...state.brush },
    brushType: state.brushType,
    sizeRange: state.sizeRange,
    streamline: state.streamline,
    fill: { ...state.fill },
    theme: state.theme,
    loop: state.playback.loop,
  };
}

/** Apply stored preferences over the current state, field-by-field with type guards. */
export function applyPreferences(p: Partial<Preferences>): void {
  if (p.tool) state.tool = p.tool;
  if (p.brush && typeof p.brush === "object") state.brush = { ...state.brush, ...p.brush };
  if (p.brushType) state.brushType = p.brushType;
  if (typeof p.sizeRange === "number") state.sizeRange = p.sizeRange;
  if (typeof p.streamline === "number") state.streamline = p.streamline;
  if (p.fill && typeof p.fill === "object") state.fill = { ...state.fill, ...p.fill };
  if (p.theme === "dark" || p.theme === "light") state.theme = p.theme;
  if (typeof p.loop === "boolean") state.playback.loop = p.loop;
}
```

The `{ ...state.brush, ...p.brush }` merge means a future new `BrushSettings` field still gets its
default when an older stored blob lacks it.

### `App.svelte` — wire load on startup + debounced save

- In `onMount` (after the autosave restore is fine), `applyPreferences(loadPreferences())`, then apply
  the theme to the DOM: `document.documentElement.classList.toggle("dark", state.theme === "dark")`
  (so a restored theme takes effect; reuse however the app currently sets the dark class on boot).
- A debounced save `$effect`:
  ```ts
  let prefsTimer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const prefs = gatherPreferences(); // reads every tracked field → re-runs when any changes
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(() => savePreferences(prefs), 400);
  });
  ```
  Reading the fields inside `gatherPreferences()` establishes reactivity, so the effect re-runs on any
  preference change and schedules a debounced write.

## Testing

Vitest runs in **Node** (no `localStorage`). Unit-test the pure parser; the `localStorage` wrappers,
`gatherPreferences`/`applyPreferences` (store-coupled), and the `App.svelte` wiring are
build-/manual-verified.

**Unit (`src/__tests__/preferences.test.ts`):**
- `parsePreferences(null)` → `{}`.
- `parsePreferences("not json")` → `{}`.
- `parsePreferences('{"theme":"light","sizeRange":2}')` → `{ theme: "light", sizeRange: 2 }`.
- `parsePreferences('5')` (valid JSON, not an object) → `{}`.
- `parsePreferences('[1,2]')` (array) → `{}`.

**Manual (browser):**
- Change brush size/color/opacity/type, sizeRange, streamline, fill, tool, theme, loop → reload → all
  restored.
- Excluded state still resets (playhead 0, zoom reset, no play range, etc.).
- A second project opened in the same browser inherits the same preferences.
- Corrupt the `localStorage` value by hand → reload → app loads with defaults, no crash.

## Self-review notes

- One pure parser (Node-tested) + thin `localStorage` wrappers + two store helpers + small `App.svelte`
  wiring. No new deps.
- Defensive per-field apply + the brush merge keep a stale/corrupt blob from breaking startup and keep
  it forward-compatible when fields are added.
- Cleanly separated from the project autosave (different storage, different fields), so neither can
  clobber the other.
