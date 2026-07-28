# iPad memory reduction + home-screen install — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut iPad cell RAM and autosave encode cost 4× by fixing the document raster scale at 1×, make export dimensions device-independent, and add PWA manifest metadata so the app installs to the iPad Home Screen as a standalone window.

**Architecture:** Three independent changes, one commit each. (1) `appState.svelte.ts`'s exported `DPR` constant — consumed everywhere as "device pixels per logical pixel" — becomes the literal `1` instead of `devicePixelRatio`; the ~60 `* DPR` call sites stay and collapse correctly. (2) Two small autosave fixes in `project-file.ts` and `App.svelte`. (3) New `public/` with a manifest and four generated PNG icons, plus `<head>` tags in `index.html`.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vite, Vitest (node env, no DOM), fflate, Node built-ins (`zlib`, `fs`) for icon generation.

**Spec:** `docs/superpowers/specs/2026-07-28-ipad-memory-and-pwa-design.md`

## Global Constraints

- `npm run build` must end with **0 errors, 0 warnings** — this is the project bar for every change.
- `npm test` baseline is **339 passing**; it must not regress.
- Vitest runs in the **node environment with no DOM**. `document`, `window`, `HTMLCanvasElement`, and `CanvasRenderingContext2D` do not exist. Only pure logic is unit-testable; `src/state/appState.svelte.ts` is not node-importable at all (it touches `window` and audio at module load).
- **No new dependencies.** The icon generator uses Node built-ins only.
- Do **not** strip or rewrite the `* DPR` / `setTransform(DPR, …)` call sites (spec D2). They are correct at 1.
- Do **not** rename the `DPR` constant (spec D3).
- A pre-commit hook (husky + lint-staged) reformats staged files on commit. Expect reformatting; it is fine.
- Commit message trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- Work happens on the existing branch `ipad-memory-and-pwa`. One commit per task.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/persist/project-file.ts` | Zip writer — store frame PNGs uncompressed | 1 |
| `src/__tests__/persist.test.ts` | Test for the above | 1 |
| `src/App.svelte` | Autosave debounce + new flush-on-hide listener | 2 |
| `src/state/appState.svelte.ts` | The `DPR` constant | 3 |
| `tools/make-icons.mjs` | Dependency-free PNG icon generator (not wired into the build) | 4 |
| `eslint.config.js` | Register Node globals for `tools/**` so the generator lints | 4 |
| `public/icon-{180,192,512}.png`, `public/icon-512-maskable.png` | Generated, committed icon assets | 4 |
| `public/manifest.webmanifest` | PWA manifest | 5 |
| `index.html` | Manifest link, apple-touch icon, iOS meta tags, `viewport-fit=cover` | 5 |
| `CLAUDE.md` | Record shipped state + verification debt (project convention) | 6 |

---

### Task 1: Store frame PNGs uncompressed in the project zip

`saveProjectBlob` hands raw PNG bytes to `zipSync`, which DEFLATEs them. PNG is already DEFLATE-compressed internally, so this is a wasted CPU pass over every key cell — and autosave repeats it every 3s. The audio entry already avoids this with `{ level: 0 }` (`project-file.ts:218`); frame entries should match.

**Files:**
- Modify: `src/persist/project-file.ts:209-215`
- Test: `src/__tests__/persist.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: no signature changes. `saveProjectBlob(project: Project): Promise<Blob>` and `frameAssetPath(layerId: number, frameIndex: number): string` keep their existing signatures. The zip stays readable by the unchanged `loadProjectBlob` — `unzipSync` handles stored and deflated entries identically.

- [ ] **Step 1: Write the failing test**

Append this block to the end of `src/__tests__/persist.test.ts`. The file already imports `describe, it, expect` from `vitest`, `createProject` from `../anim/document`, and `saveProjectBlob` from `../persist/project-file` — do not re-import them.

```ts
describe("saveProjectBlob compression", () => {
  it("stores frame PNGs without re-compressing them", async () => {
    const project = createProject();
    // 20k of trivially compressible bytes standing in for the PNG a real canvas would produce.
    // Deflated, the whole archive collapses to a few hundred bytes; stored, it cannot be
    // smaller than the payload. Size is therefore a proxy for "the zip left these alone".
    const bytes = new Uint8Array(20000);
    project.layers[0].cells[0] = {
      kind: "key",
      canvas: {
        toBlob: (cb: BlobCallback) => cb(new Blob([bytes])),
      } as unknown as HTMLCanvasElement,
    };
    const blob = await saveProjectBlob(project);
    expect(blob.size).toBeGreaterThan(bytes.length);
  });
});
```

Why a fake canvas: vitest has no DOM, so there is no real `HTMLCanvasElement`. `canvasToPngBytes` only calls `canvas.toBlob(cb, "image/png")` and then `blob.arrayBuffer()`, both of which this stub satisfies (`Blob` is a Node built-in). This mirrors how the existing tests in this file fake canvases with `{} as HTMLCanvasElement`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/persist.test.ts -t "stores frame PNGs"`

Expected: **FAIL** — the assertion reports a received size in the hundreds of bytes, far below 20000, because the zip is deflating the payload.

- [ ] **Step 3: Write the minimal implementation**

In `src/persist/project-file.ts`, inside `saveProjectBlob`, change the frame entry assignment:

```ts
  for (const layer of project.layers) {
    if (!isDrawingLayer(layer)) continue;
    for (let i = 0; i < layer.cells.length; i++) {
      const cell = layer.cells[i];
      if (cell.kind !== "key") continue;
      // PNG is already DEFLATE-compressed internally; store it (level 0) so the zip doesn't burn
      // CPU re-compressing it for ~nothing — the same treatment the audio entry gets below.
      // Autosave re-encodes every key cell on a 3s debounce, so this pass is paid repeatedly.
      files[frameAssetPath(layer.id, i)] = [await canvasToPngBytes(cell.canvas), { level: 0 }];
    }
  }
```

The `files` record is already typed `Record<string, Uint8Array | [Uint8Array, ZipOptions]>`, so the tuple form needs no type change.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/persist.test.ts`

Expected: **PASS** — the new test plus every pre-existing test in the file.

- [ ] **Step 5: Verify the full suite and build**

Run: `npm test && npm run build`

Expected: **340** passing (the 339 baseline plus the new test), and a build with **0 errors, 0 warnings**.

- [ ] **Step 6: Commit**

```bash
git add src/persist/project-file.ts src/__tests__/persist.test.ts
git commit -m "$(cat <<'EOF'
perf: store frame PNGs uncompressed in the project zip

PNG is already DEFLATE-compressed, so zipSync re-deflating it burned CPU for
~no size win — a cost paid on every 3s autosave, over every key cell. Matches
the treatment the audio entry already gets.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Flush autosave when the page is hidden

Autosave runs on a 3s debounce (`App.svelte:179-187`). A backgrounded iPad tab can be killed by the OS at any time, so up to 3s of work — plus anything drawn during the debounce window — is lost. Flushing on hide shrinks that window to ~0.

**Files:**
- Modify: `src/App.svelte:179-187` (add a second `$effect` immediately after the existing autosave effect)

**Interfaces:**
- Consumes: `saveAutosave(project: Project): Promise<void>` from `./persist/autosave`, already imported at `App.svelte:32`. `state` is already imported in this file.
- Produces: nothing consumed by later tasks.

**No unit test.** `App.svelte` is a Svelte component wiring DOM lifecycle events; vitest runs with no DOM, so there is nothing node-testable here. Verification is by build plus the manual check in Step 3.

- [ ] **Step 1: Add the flush effect**

In `src/App.svelte`, immediately after the existing autosave `$effect` (the one ending `}, 3000);` followed by `});`), insert:

```svelte
  // A backgrounded tab can be killed by the OS at any moment (routinely, on iPad), so don't wait
  // out the debounce — flush as soon as the page is hidden. The write is async, so if the tab dies
  // mid-write this shrinks the loss window rather than closing it. `pagehide` and visibilitychange
  // are both needed: iOS Safari does not reliably fire both in every backgrounding path.
  $effect(() => {
    const flush = () => {
      clearTimeout(autosaveTimer);
      void saveAutosave(state.project);
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
```

`autosaveTimer` is the existing `let autosaveTimer: ReturnType<typeof setTimeout>;` declared just above — reuse it, do not declare a second one. Note this effect reads `state.project` only *inside* the callbacks, never during setup, so it registers no reactive dependency and runs its setup exactly once.

- [ ] **Step 2: Verify the build**

Run: `npm run build`

Expected: **0 errors, 0 warnings.** In particular, no `svelte-check` warning about the effect's return value or an unused variable.

- [ ] **Step 3: Verify by hand in the browser**

Run: `npm run dev`, then in the browser:

1. Draw a stroke.
2. **Within 3 seconds** (before the debounce fires), switch to another tab.
3. Switch back, reload the page.

Expected: the stroke is still there. Before this change the same sequence loses it. Confirm in DevTools → Application → IndexedDB → `slop-animator` → `kv` → `autosave` that the entry's timestamp moves when you switch away.

- [ ] **Step 4: Commit**

```bash
git add src/App.svelte
git commit -m "$(cat <<'EOF'
fix: flush autosave when the page is hidden

The 3s debounce meant a backgrounded tab killed by the OS — routine on iPad —
lost everything since the last save. Flush on pagehide/visibilitychange so the
loss window is ~0 rather than up to 3s.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Fix the document raster scale at 1×

This is the headline change: a one-line diff with a codebase-wide effect. `DPR` is a single exported constant used consistently as "device pixels per logical pixel" by cell allocation, the display and scratch canvases, hit-testing, fill, selection/pose lifts, gizmo box math, and export. On iPad it is currently `2`, which costs 33.2 MB per key cell at 1920×1080 and makes exports 4K.

**Files:**
- Modify: `src/state/appState.svelte.ts:163`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export const DPR: number` — same name, same type, same module. Every consumer (`App.svelte`, `Toolbar.svelte`, `Canvas.svelte`, `RefTransformGizmo.svelte`, `ExportDialog.svelte`) is unchanged.

**No unit test.** `src/state/appState.svelte.ts` reads `window` and constructs audio at module load, so it cannot be imported in the node test environment — this is a documented property of the codebase, not an oversight. The existing suite passes explicit `dpr` arguments to pure functions and is independent of this constant, so it will neither fail before nor prove correctness after. Verification is the build, the unchanged suite, and the browser pass in Step 3 — which is the actual gate for this task.

- [ ] **Step 1: Make the change**

In `src/state/appState.svelte.ts`, replace line 163:

```ts
export const DPR = Math.max(1, Math.floor(window.devicePixelRatio || 1));
```

with:

```ts
/**
 * Document raster scale: device pixels per logical pixel, for cell canvases, the display and
 * scratch canvases, hit-testing, and export. Deliberately FIXED AT 1 — it is not read from
 * `devicePixelRatio` — because this app is low-framerate monochrome ink where hi-res is a non-goal,
 * and the constant sets three costs at once: per-cell RAM (at 1920×1080, 8.3 MB here vs 33.2 MB at
 * 2×), the PNG encode work autosave repeats over every key cell, and export dimensions. At 2× on
 * iPad a "1920×1080" project also exported 4K, so output size depended on which device rendered it.
 * Trade: lines are softer past 100% zoom on a Retina display. See
 * docs/superpowers/specs/2026-07-28-ipad-memory-and-pwa-design.md.
 */
export const DPR = 1;
```

Do not touch any `* DPR` or `setTransform(DPR, …)` call site — they are all correct at 1, and rewriting them is a large refactor with zero runtime benefit (spec D2).

- [ ] **Step 2: Verify the build and suite**

Run: `npm run build && npm test`

Expected: **0 errors, 0 warnings**, 340 passing (339 baseline + Task 1's test). If `svelte-check` reports `window` is now unused in the file, check whether `window` is referenced elsewhere in `appState.svelte.ts` before removing anything — remove only imports/uses that *this* change orphaned.

- [ ] **Step 3: Browser verification pass — this is the real gate**

Run `npm run dev`. The diff is one line but the blast radius is the whole canvas, and no automated test covers it. Work through every item; a stray factor of 2 shows up as misalignment, not as an exception.

1. **Drawing** — each brush (smooth, ink, pencil, charcoal, airbrush) and the eraser: strokes land under the cursor, at the expected width.
2. **Brush cursor** — the size ring matches the actual stroke width drawn.
3. **Fill** — the bucket fills the region under the tap (`floodFill` receives `pt * DPR` coordinates).
4. **Selection + lasso** — marquee, lift, move, commit; then cut / copy / paste of pixels, including a lasso-shaped copy.
5. **Deform and Pose** — lift, warp/pin, bake; the pose handle reach dial and its tinted affected region track the handle.
6. **Transform gizmo** — box alignment at all three scopes (Frame / Layer / Group); grab a handle and confirm the box hugs the content.
7. **Onion skins** and the **WebGL boil** path render aligned with the current frame.
8. **Export** — a 1920×1080 project produces a **1920×1080** MP4/WebM and PNG sequence (previously 3840×2160 on a 2× display). Confirm the file dimensions, not just that export succeeds.
9. **Opening older work** — open a project saved at 2×; art downsamples cleanly and nothing shifts. Take a copy of the file first: re-saving replaces the stored PNGs at the lower resolution, and that is one-way.
10. **Memory** — on a multi-keyframe project, confirm the drop is real in DevTools → Memory.

If any item fails, this task is a single commit and is trivially revertible — revert rather than patching around it, and report what broke.

- [ ] **Step 4: Commit**

```bash
git add src/state/appState.svelte.ts
git commit -m "$(cat <<'EOF'
perf: fix the document raster scale at 1x instead of devicePixelRatio

Cells were allocated at width*devicePixelRatio, so on iPad (2x) a 1920x1080
key cell cost 33.2 MB and autosave PNG-encoded 4x the pixels. Hi-res is a
non-goal for this app, so fix the scale at 1: 4x less RAM and encode work.

Also makes export deterministic — a 1920x1080 project now exports 1920x1080
on every device instead of 4K from iPad and 1080p from a 1x display.

Existing projects downsample once on open; the save format is scale-agnostic.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Generate the icon assets

No SVG rasterizer is installed (`magick`, `convert`, `rsvg-convert` are all absent) and the spec adds no dependency, so the mark is rasterized analytically and encoded as PNG with Node's built-in `zlib`. The script is committed for regeneration but is **not** wired into the build; its outputs are committed.

**Files:**
- Create: `tools/make-icons.mjs`
- Modify: `eslint.config.js` (add a Node-globals block for `tools/**`)
- Create (generated): `public/icon-180.png`, `public/icon-192.png`, `public/icon-512.png`, `public/icon-512-maskable.png`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the four PNG files at those exact paths. Task 5 references them by those filenames from `index.html` and `manifest.webmanifest`.

**No unit test.** This is a one-time asset generator, not shipped application code — it never runs in the browser and nothing imports it. Verification is by execution: the script must produce four files at the correct pixel dimensions that macOS can decode (Step 3). A vitest test would have to import a `.mjs` file from a `.ts` test, which fights the project's `tsc --noEmit` config for no benefit.

- [ ] **Step 1: Write the generator**

Create `tools/make-icons.mjs`:

```js
#!/usr/bin/env node
// Generates the PWA / home-screen icons into public/.
//
// Dependency-free on purpose: no SVG rasterizer is installed and the project adds none, so the
// mark is rasterized analytically (signed distance to a tapered line segment) and encoded as PNG
// with Node's zlib. Not wired into the build — outputs are committed. Regenerate with:
//   node tools/make-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BG = [0x1e, 0x1e, 0x1e]; // app.css .dark --color-surface
const INK = [0xe0, 0xe0, 0xe0]; // app.css .dark --color-text

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encode a square RGBA8 buffer (length = size*size*4) as a PNG. */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // bytes 10-12 (compression, filter, interlace) stay 0
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    const o = y * (stride + 1);
    raw[o] = 0; // filter: none
    rgba.copy(raw, o + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * The mark: one tapered ink stroke, light on the dark app surface. `inset` (0..1) scales it toward
 * the centre — 1 is full-bleed for the square icons, ~0.6 keeps the maskable variant inside
 * Android's safe zone crop.
 */
function render(size, inset) {
  const rgba = Buffer.alloc(size * size * 4);
  const toCentre = (v) => lerp(0.5, v, inset);
  const x0 = toCentre(0.24) * size,
    y0 = toCentre(0.78) * size;
  const x1 = toCentre(0.76) * size,
    y1 = toCentre(0.22) * size;
  const r0 = 0.115 * size * inset, // thick at the start
    r1 = 0.028 * size * inset; // tapering to a point
  const dx = x1 - x0,
    dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5,
        py = y + 0.5;
      const t = clamp01(((px - x0) * dx + (py - y0) * dy) / len2);
      const d = Math.hypot(px - (x0 + dx * t), py - (y0 + dy * t));
      const a = clamp01(lerp(r0, r1, t) - d + 0.5); // 1px antialiased edge
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(lerp(BG[0], INK[0], a));
      rgba[i + 1] = Math.round(lerp(BG[1], INK[1], a));
      rgba[i + 2] = Math.round(lerp(BG[2], INK[2], a));
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
mkdirSync(outDir, { recursive: true });

for (const [name, size, inset] of [
  ["icon-180.png", 180, 1],
  ["icon-192.png", 192, 1],
  ["icon-512.png", 512, 1],
  ["icon-512-maskable.png", 512, 0.6],
]) {
  writeFileSync(join(outDir, name), encodePng(size, render(size, inset)));
  console.log(`wrote public/${name} (${size}x${size})`);
}
```

- [ ] **Step 2: Teach ESLint about Node globals in `tools/`**

`eslint.config.js` registers only `globals.browser`, so `Buffer` in the generator fails `no-undef`. The pre-commit hook runs `eslint --fix` on staged `.mjs` files, so without this the Step 5 commit is blocked.

In `eslint.config.js`, add this block immediately **before** the final `{ ignores: ["dist/"] }` entry:

```js
  {
    // Build-time Node scripts (icon generation) — Node globals, not browser ones.
    files: ["tools/**/*.mjs"],
    languageOptions: { globals: { ...globals.node } },
  },
```

`globals` is already imported at the top of the file. Verify with:

Run: `npx eslint tools/make-icons.mjs`

Expected: no output (clean). Before this block it reports `'Buffer' is not defined  no-undef`.

- [ ] **Step 3: Run it**

Run: `node tools/make-icons.mjs`

Expected output, exactly four lines:

```
wrote public/icon-180.png (180x180)
wrote public/icon-192.png (192x192)
wrote public/icon-512.png (512x512)
wrote public/icon-512-maskable.png (512x512)
```

- [ ] **Step 4: Verify the PNGs are valid and correctly sized**

Run: `sips -g pixelWidth -g pixelHeight public/icon-180.png public/icon-192.png public/icon-512.png public/icon-512-maskable.png`

Expected: `sips` decodes all four without error and reports 180×180, 192×192, 512×512, 512×512. A malformed CRC or IHDR makes `sips` fail here — that is the point of this step.

Then open `public/icon-512.png` (`open public/icon-512.png`) and confirm by eye: a light tapered diagonal stroke, bottom-left to top-right, on a near-black square, with smooth (not stair-stepped) edges. Confirm `icon-512-maskable.png` shows the same mark noticeably smaller with more surrounding margin.

- [ ] **Step 5: Commit**

```bash
git add tools/make-icons.mjs eslint.config.js public/icon-180.png public/icon-192.png public/icon-512.png public/icon-512-maskable.png
git commit -m "$(cat <<'EOF'
feat: generate home-screen / PWA icons

A single tapered ink stroke on the dark app surface, matching the monochrome
ink identity. Rasterized analytically and PNG-encoded with node:zlib — no SVG
rasterizer is installed and the project adds no dependency for this. The
script is committed for regeneration but is not wired into the build.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Add the manifest and install metadata

Manifest-only — no service worker (spec D10). This gets the standalone window and takes the app's storage out of Safari's unused-site-data eviction; offline launch is a separate, additive change later.

**Files:**
- Create: `public/manifest.webmanifest`
- Modify: `index.html`

**Interfaces:**
- Consumes: the four PNGs from Task 4, by exact filename.
- Produces: nothing consumed by later tasks.

**No unit test.** These are static assets with no logic. Verification is that the manifest parses, Vite copies `public/` to the dist root, and the browser reports no manifest errors (Steps 3-4).

- [ ] **Step 1: Create the manifest**

Create `public/manifest.webmanifest`:

```json
{
  "name": "slop-animator",
  "short_name": "slop",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#1e1e1e",
  "theme_color": "#1e1e1e",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    {
      "src": "/icon-512-maskable.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

Colors match `app.css`'s `.dark` `--color-surface: #1e1e1e`, which is the default (`index.html` sets `class="dark"` on `<html>`). `orientation: "any"` because an iPad drawing app must rotate. Paths are root-absolute, matching the default Vite `base`.

- [ ] **Step 2: Add the `<head>` tags**

In `index.html`, replace the existing `<meta name="viewport" …>` line and add the new tags, so `<head>` reads:

```html
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover"
    />
    <title>slop-animator</title>
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" sizes="180x180" href="/icon-180.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black" />
    <meta name="apple-mobile-web-app-title" content="slop" />
    <meta name="theme-color" content="#1e1e1e" />
  </head>
```

`apple-mobile-web-app-status-bar-style` is `black` (opaque) on purpose: iOS then reserves the status bar, so no `env(safe-area-inset-*)` layout work is needed (spec D11). Do not change it to `black-translucent` without also adding safe-area padding to the root shell.

- [ ] **Step 3: Verify the manifest parses and the build ships it**

Run: `node -e "JSON.parse(require('fs').readFileSync('public/manifest.webmanifest','utf8')); console.log('manifest ok')"`

Expected: `manifest ok`

Run: `npm run build && ls dist`

Expected: **0 errors, 0 warnings**, and `dist/` contains `manifest.webmanifest` plus all four `icon-*.png` files at the top level (Vite copies `public/` to the dist root).

- [ ] **Step 4: Verify in the browser**

Run `npm run dev`, then DevTools → Application → Manifest.

Expected: name `slop-animator`, short name `slop`, display `standalone`, both theme and background `#1e1e1e`, all three manifest icons resolving with previews shown, and **no errors or warnings** in the panel.

- [ ] **Step 5: Verify on the iPad**

Run `npm run dev:lan` and open the app on the iPad over https (accept the self-signed cert once). Then Share → **Add to Home Screen**.

Expected:
- The icon and the title "slop" appear correctly on the Home Screen.
- Launching from the Home Screen opens **standalone** — no Safari address bar or toolbar, so the canvas and timeline get that vertical space back.
- Rotating the iPad rotates the app.
- The status bar is opaque and does not overlap the app's own UI.

Note for the report, not a code change: the installed app has its **own storage bucket**, separate from the Safari tab, so existing autosaved work will not appear inside it. To carry work over: save to Files from Safari first, then Open that file once inside the installed app (spec D13).

- [ ] **Step 6: Commit**

```bash
git add public/manifest.webmanifest index.html
git commit -m "$(cat <<'EOF'
feat: install to the iPad Home Screen (PWA manifest)

Manifest + iOS meta tags so the app installs standalone: the canvas gets back
the space Safari's toolbars were taking, and the app's storage is no longer
subject to WebKit's eviction of unused site data. Manifest-only — no service
worker, so offline launch is a separate additive change later.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Record the change in CLAUDE.md

Project convention: `CLAUDE.md` is the handoff index, and shipped work plus its outstanding verification debt is recorded there.

**Files:**
- Modify: `CLAUDE.md` — the "Verification debt" section

**Interfaces:**
- Consumes: nothing. Documentation only.
- Produces: nothing.

- [ ] **Step 1: Append to the Verification debt section**

Add this at the end of the **Verification debt** section of `CLAUDE.md`, following the style of the existing dated entries:

```markdown
**1× document scale + Home Screen install (2026-07-28):** `DPR` is now the literal **1**, not
`devicePixelRatio` — cells, display/scratch canvases, hit-testing and export all render at document
resolution. On iPad that is **4× less RAM per key cell** (8.3 MB vs 33.2 MB at 1920×1080) and 4× less
autosave PNG encode work. **Export is now device-independent**: a 1920×1080 project exports
1920×1080 everywhere, where it previously produced 4K from a 2× display. Old projects downsample
once on open (the save format is scale-agnostic) — **one-way**, so keep a copy of anything whose
original pixels matter. The ~60 `* DPR` call sites were deliberately left in place (correct at 1).
Also: frame PNGs are now stored in the zip at level 0 (no wasted re-DEFLATE), and autosave flushes on
`pagehide`/`visibilitychange` so a killed tab doesn't cost the 3s debounce window. Plus a PWA
manifest + iOS meta tags + generated icons (`tools/make-icons.mjs`) for Add to Home Screen —
manifest-only, no service worker, so **no offline launch**. Note an installed web app has its own
storage bucket: existing autosave does not carry over (save to Files, then Open inside the installed
app). **Owed a pass:** the scale change is a one-line diff with canvas-wide effect and no unit test
can cover it — drawing/brush-cursor width, fill, selection+lasso lift/cut/copy/paste, deform, pose
(incl. the reach dial), the transform gizmo at all three scopes, onion skins, the WebGL boil path,
export dimensions, and opening a 2×-era project all need eyeballing. Deferred: incremental
(dirty-cell-only) autosave encoding, and LRU cell eviction — revisit only if measurement shows the 4×
cut wasn't enough. Spec/plan: `…/2026-07-28-ipad-memory-and-pwa*.md`.
```

- [ ] **Step 2: Verify formatting**

Run: `npx prettier --check CLAUDE.md`

Expected: pass. If it reports a formatting difference, run `npx prettier --write CLAUDE.md`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: CLAUDE.md — 1x document scale, autosave fixes, Home Screen install

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Done criteria

- [ ] `npm run build` — 0 errors, 0 warnings
- [ ] `npm test` — 340 passing (339 baseline + Task 1's test), no regression
- [ ] The Task 3 Step 3 browser pass completed, with any failure reported rather than worked around
- [ ] The Task 5 Step 5 iPad install verified
- [ ] Six commits on `ipad-memory-and-pwa`, one per task
