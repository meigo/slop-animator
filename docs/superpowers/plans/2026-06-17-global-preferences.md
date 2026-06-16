# Global Preferences Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist cross-project tool/UI preferences (tool, brush, brushType, sizeRange, streamline, fill, theme, loop) to `localStorage`, restore them on startup.

**Architecture:** A `preferences.ts` module with a pure `parsePreferences` (Node-tested) plus thin `localStorage` load/save wrappers. `appState` gains `gatherPreferences`/`applyPreferences` (store-coupled). `App.svelte` applies prefs on mount (and toggles the theme class) and saves them via a debounced `$effect`. Independent of the project autosave.

**Tech Stack:** TypeScript, Svelte 5 (runes), Vitest (Node — no `localStorage`).

**Spec:** `docs/superpowers/specs/2026-06-17-global-preferences-design.md`

**Branch:** execute on a new branch `global-preferences` (off `main`).

**Key constraints (verified against the codebase):**
- Vitest runs in **Node** — no `localStorage`. Only the pure `parsePreferences` is unit-tested; the `localStorage` wrappers, the store helpers, and the `App.svelte` wiring are build-/manual-verified.
- `Tool` and `BrushKind` are exported from `src/state/appState.svelte.ts`; `BrushSettings` from `src/core/brush.ts`. `preferences.ts` imports them **type-only** (a type-only circular import with appState is fine — types are erased).
- The initial theme comes from a hardcoded `<html class="dark">` in `index.html`. Startup must `classList.toggle("dark", state.theme === "dark")` after applying prefs so a restored `light` theme takes effect.
- `state.brush` is the whole `BrushSettings` object; `loop` lives at `state.playback.loop`. `replaceProject` (autosave restore) does not touch tool/brush/theme/loop, so prefs and the project restore are order-independent.

---

### Task 1: preferences module + pure parser

**Files:**
- Create: `src/persist/preferences.ts`
- Test: `src/__tests__/preferences.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/preferences.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parsePreferences } from "../persist/preferences";

describe("parsePreferences", () => {
  it("null → {}", () => {
    expect(parsePreferences(null)).toEqual({});
  });
  it("invalid JSON → {}", () => {
    expect(parsePreferences("not json")).toEqual({});
  });
  it("a JSON object → its contents", () => {
    expect(parsePreferences('{"theme":"light","sizeRange":2}')).toEqual({ theme: "light", sizeRange: 2 });
  });
  it("valid JSON that isn't an object → {}", () => {
    expect(parsePreferences("5")).toEqual({});
  });
  it("a JSON array → {}", () => {
    expect(parsePreferences("[1,2]")).toEqual({});
  });
});
```

- [ ] **Step 2: Verify FAIL**

Run: `npx vitest run src/__tests__/preferences.test.ts` → FAIL (module `../persist/preferences` not found).

- [ ] **Step 3: Implement `src/persist/preferences.ts`**

```ts
import type { Tool, BrushKind } from "../state/appState.svelte";
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

/** Pure parse: null/garbage → {}, a JSON object → its (partial) contents. */
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

- [ ] **Step 4: Verify PASS + build**

Run: `npx vitest run src/__tests__/preferences.test.ts` → PASS.
Run: `npm run build` → 0 errors, 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add src/persist/preferences.ts src/__tests__/preferences.test.ts
git commit -m "feat: preferences module + pure parsePreferences"
```

---

### Task 2: gather + apply in the store

**Files:**
- Modify: `src/state/appState.svelte.ts`

No unit test (store-coupled). Verification = build + suite.

- [ ] **Step 1: Import the Preferences type**

Add to `src/state/appState.svelte.ts`:

```ts
import type { Preferences } from "../persist/preferences";
```

- [ ] **Step 2: Add gather + apply**

Add (near the other top-level exported functions):

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

- [ ] **Step 3: Build + tests**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → all pass (168 baseline + Task 1's 5 = 173; unchanged here).

- [ ] **Step 4: Commit**

```bash
git add src/state/appState.svelte.ts
git commit -m "feat: gather/apply preferences in the store"
```

---

### Task 3: load on startup + debounced save (App.svelte)

**Files:**
- Modify: `src/App.svelte`

No automated test. Verification = build + manual.

- [ ] **Step 1: Imports**

In `src/App.svelte`, add `gatherPreferences, applyPreferences` to the existing import from `./state/appState.svelte`, and add:

```ts
  import { loadPreferences, savePreferences } from "./persist/preferences";
```

- [ ] **Step 2: Apply on mount + theme class**

The current `onMount` is:

```ts
  onMount(async () => {
    const restored = await loadAutosave(DPR);
    if (restored) replaceProject(restored);
  });
```

Change it to apply preferences first (synchronously, so the theme/tool/brush are right before paint), then restore the project:

```ts
  onMount(async () => {
    applyPreferences(loadPreferences());
    document.documentElement.classList.toggle("dark", state.theme === "dark");
    const restored = await loadAutosave(DPR);
    if (restored) replaceProject(restored);
  });
```

- [ ] **Step 3: Debounced save effect**

After the existing autosave `$effect`, add a second effect for preferences:

```ts
  let prefsTimer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const prefs = gatherPreferences(); // reads every tracked field → re-runs on any pref change
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(() => savePreferences(prefs), 400);
  });
```

(`gatherPreferences()` reads `state.tool`, `state.brush.*`, `state.brushType`, `state.sizeRange`, `state.streamline`, `state.fill.*`, `state.theme`, `state.playback.loop` — establishing reactivity on each, so the effect re-runs when any changes.)

- [ ] **Step 4: Build**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → all pass (173, unchanged).

- [ ] **Step 5: Manual verification (browser)**

Run `npm run dev`:
- Change brush size/color/opacity, brushType, sizeRange, streamline, fill tolerance/expand, current tool, theme (dark↔light), and the loop toggle → reload → all restored.
- Excluded state still resets on reload: playhead at 0, viewport zoom/pan reset, no play range, no dialogs open.
- Open/create a different project in the same browser → it inherits the same preferences.
- Set `localStorage["slop-animator:prefs"]` to garbage in devtools → reload → app loads with defaults, no crash.
- Theme: set light, reload → loads light (not the hardcoded dark).

- [ ] **Step 6: Commit**

```bash
git add src/App.svelte
git commit -m "feat: load preferences on startup + debounced save"
```

---

## Final verification

- [ ] `npm run build` → 0 errors, 0 warnings.
- [ ] `npm test` → all pass (168 + 5 = 173).
- [ ] Manual checklist in Task 3 Step 5 confirmed.

## Self-Review (completed by plan author)

**Spec coverage:**
- `Preferences` shape + pure `parsePreferences` + `localStorage` load/save → Task 1. ✅
- `gatherPreferences`/`applyPreferences` (defensive per-field apply, brush merge) → Task 2. ✅
- Startup load + theme-class apply + debounced save effect, independent of the project autosave → Task 3. ✅
- Excluded fields never persisted (gather only reads the chosen fields) ✅; deferred onion/pressure-curve absent ✅.

**Placeholder scan:** No TBD/TODO; complete code in every code step. ✅

**Type consistency:** `Preferences` defined in Task 1 (`preferences.ts`), imported by `appState` (Task 2) and used by `gatherPreferences`/`applyPreferences`, which `App.svelte` (Task 3) calls; `loadPreferences`/`savePreferences` (Task 1) used in Task 3. `parsePreferences(raw: string | null): Partial<Preferences>` is defined and called consistently. The fields gathered match the fields applied match the spec's set. ✅
