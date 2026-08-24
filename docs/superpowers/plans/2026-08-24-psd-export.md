# PSD export (current frame) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export the current frame as a layered `.psd` — real groups, live opacity, baked transforms — for paint-up in Photoshop.

**Architecture:** A pure `bytes in → bytes out` PSD writer with no canvas in it (so it is genuinely unit-testable, unlike the rest of this export path), plus a thin canvas driver that renders each visible drawing layer through its compose chain and hands the writer a lazy tree. The writer owns every format detail including the group section-divider ordering; the driver owns pixels.

**Tech Stack:** TypeScript, Vitest (node-only), no new dependencies. PSD's RLE is part of the format, so `fflate` is not applicable.

**Spec:** `docs/superpowers/specs/2026-08-24-psd-export-design.md` — read it first; it records the decisions and the one trap that matters most.

## Global Constraints

- The gate for every change: `npm run build` (`svelte-check && tsc --noEmit && vite build`) at **0 errors, 0 warnings**, plus `npm test` and `npm run lint` clean. Baseline entering Task 1: **948 passing**.
- All multi-byte integers in PSD are **big-endian**.
- Sections carry a length prefix covering the bytes written after it. **Always build a section into a buffer and prefix its measured length — never predict it.** An off-by-N produces "could not complete your request" in Photoshop with no indication which section.
- **Do not source layer opacity from `buildFrameDrawList`.** It pre-multiplies group opacity, which double-applies once the group is also a real folder. Use `opacityAt(layer, frame)` and `groupOpacityAt(group, frame)` directly. This is the single most likely thing to get subtly wrong.
- Visibility is read through `isLayerVisible(layer, groups)`, never a raw `.visible` flag — a layer inside a hidden group must be dropped too.
- The writer must never hold every layer's pixels at once. Pixels arrive as thunks; encode one, release it, move on.
- No `CLAUDE.md` entry until Task 7 — the controller may adjust the record.

---

### Task 1: PackBits (RLE) encoder

**Files:**
- Create: `src/export/packbits.ts`
- Test: `src/__tests__/packbits.test.ts`

**Interfaces:**
- Produces: `packBits(row: Uint8Array): Uint8Array`

PSD compresses each channel **one scanline at a time** with PackBits. Per-row, not per-channel: the format stores a table of per-row byte counts, so rows must be encoded independently.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { packBits } from "../export/packbits";

/** Decoder written only for the tests — the app never reads PSD, so shipping one would be dead code. */
function unpack(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < src.length; ) {
    const n = src[i++];
    if (n === 128) continue; // no-op
    if (n < 128) for (let k = 0; k <= n; k++) out.push(src[i++]);
    else {
      const b = src[i++];
      for (let k = 0; k < 257 - n; k++) out.push(b);
    }
  }
  return Uint8Array.from(out);
}

describe("packBits", () => {
  const rt = (a: number[]) => Array.from(unpack(packBits(Uint8Array.from(a))));

  it("round-trips a literal run", () => expect(rt([1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4, 5]));
  it("round-trips a repeat run", () => expect(rt(new Array(10).fill(7))).toEqual(new Array(10).fill(7)));
  it("round-trips a single byte", () => expect(rt([9])).toEqual([9]));
  it("round-trips an empty row", () => expect(rt([])).toEqual([]));

  // The awkward cases: a repeat run encodes at most 128 bytes, a literal run at most 128.
  it("splits a repeat longer than 128", () => expect(rt(new Array(300).fill(3))).toEqual(new Array(300).fill(3)));
  it("splits a literal longer than 128", () => {
    const a = Array.from({ length: 300 }, (_, i) => i % 251); // no run of 3+
    expect(rt(a)).toEqual(a);
  });
  it("round-trips exactly 128 identical bytes", () => expect(rt(new Array(128).fill(1))).toEqual(new Array(128).fill(1)));
  it("round-trips a full-width alpha row of zeros", () => expect(rt(new Array(1920).fill(0))).toEqual(new Array(1920).fill(0)));

  it("actually compresses a flat row", () => {
    expect(packBits(Uint8Array.from(new Array(1920).fill(0))).length).toBeLessThan(64);
  });
  it("never emits the 128 no-op byte", () => {
    const a = Array.from({ length: 500 }, (_, i) => (i % 7 === 0 ? 5 : i % 256));
    expect(Array.from(packBits(Uint8Array.from(a)))).not.toContain(128);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/__tests__/packbits.test.ts` — Expected: FAIL, `packBits` is not exported.

- [ ] **Step 3: Implement**

```ts
/**
 * PackBits, one PSD scanline. Literal runs carry `n` in 0..127 meaning "the next n+1 bytes";
 * repeat runs carry `n` in 129..255 meaning "the next byte, 257-n times" (so 2..128). 128 is a
 * documented no-op that some readers mishandle, so it is never emitted.
 *
 * Runs cap at 128 bytes, which is why the two "longer than 128" tests exist: a 300-byte flat row
 * must split into three repeat runs, not overflow one.
 */
export function packBits(row: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < row.length) {
    // A repeat run needs 3 equal bytes to beat a literal; with 2 it merely ties and costs a switch.
    let run = 1;
    while (run < 128 && i + run < row.length && row[i + run] === row[i]) run++;
    if (run >= 3) {
      out.push(257 - run, row[i]);
      i += run;
      continue;
    }
    // Literal: absorb bytes until a run of 3 starts, or 128 bytes are taken.
    const start = i;
    let lit = 0;
    while (i < row.length && lit < 128) {
      const same =
        i + 2 < row.length && row[i] === row[i + 1] && row[i] === row[i + 2];
      if (same) break;
      i++;
      lit++;
    }
    out.push(lit - 1);
    for (let k = start; k < start + lit; k++) out.push(row[k]);
  }
  return Uint8Array.from(out);
}
```

- [ ] **Step 4: Run to verify they pass, then the gate**

Run: `npx vitest run src/__tests__/packbits.test.ts`, then `npm run build && npm test && npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: PackBits encoder for PSD scanlines"
```

---

### Task 2: Byte writer and the PSD header

**Files:**
- Create: `src/export/psd-bytes.ts`
- Test: `src/__tests__/psd-bytes.test.ts`

**Interfaces:**
- Produces: `class Bytes` with `u8/u16/u32/i16/i32/ascii/bytes/pascal4/unicodeName/len32(fn)/len32Even(fn)/build()`; `psdHeader(width, height): Uint8Array`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { Bytes, psdHeader } from "../export/psd-bytes";

const str = (b: Uint8Array, o: number, n: number) =>
  String.fromCharCode(...Array.from(b.slice(o, o + n)));
const u32 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset).getUint32(o);
const u16 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset).getUint16(o);

describe("psdHeader", () => {
  it("is 26 bytes with the documented fields", () => {
    const h = psdHeader(1920, 1080);
    expect(h.length).toBe(26);
    expect(str(h, 0, 4)).toBe("8BPS");
    expect(u16(h, 4)).toBe(1); // version
    expect(u16(h, 12)).toBe(4); // channels: RGBA
    expect(u32(h, 14)).toBe(1080); // HEIGHT precedes width — the classic transposition bug
    expect(u32(h, 18)).toBe(1920);
    expect(u16(h, 22)).toBe(8); // depth
    expect(u16(h, 24)).toBe(3); // colour mode: RGB
  });
});

describe("Bytes", () => {
  it("len32 prefixes the MEASURED length, not a predicted one", () => {
    const b = new Bytes();
    b.len32((w) => { w.ascii("abcd"); w.u16(1); });
    const out = b.build();
    expect(u32(out, 0)).toBe(6);
    expect(out.length).toBe(10);
  });

  it("len32Even pads the body to an even length and counts the pad", () => {
    const b = new Bytes();
    b.len32Even((w) => w.ascii("abc"));
    const out = b.build();
    expect(u32(out, 0)).toBe(4);
    expect(out.length).toBe(8);
  });

  it("pascal4 pads name + length byte to a multiple of 4", () => {
    const b = new Bytes();
    b.pascal4("ab"); // 1 + 2 = 3 -> pad to 4
    expect(b.build().length).toBe(4);
  });

  it("unicodeName writes a UTF-16BE luni block", () => {
    const b = new Bytes();
    b.unicodeName("hi");
    const out = b.build();
    expect(str(out, 0, 4)).toBe("8BIM");
    expect(str(out, 4, 4)).toBe("luni");
    expect(u32(out, 12)).toBe(2); // char count
    expect(u16(out, 16)).toBe(0x0068); // 'h'
  });
});
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement**

`Bytes` accumulates into a growing array and returns `Uint8Array`. `len32(fn)` runs `fn` against a fresh `Bytes`, measures the result, writes the length then the body — that is the whole defence against the length-prefix class of bug, so every section must go through it.

```ts
export class Bytes {
  private a: number[] = [];
  u8(v: number) { this.a.push(v & 0xff); return this; }
  u16(v: number) { this.a.push((v >> 8) & 0xff, v & 0xff); return this; }
  u32(v: number) { this.a.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff); return this; }
  i16(v: number) { return this.u16(v < 0 ? v + 0x10000 : v); }
  i32(v: number) { return this.u32(v < 0 ? v + 0x100000000 : v); }
  ascii(s: string) { for (const c of s) this.a.push(c.charCodeAt(0) & 0xff); return this; }
  bytes(b: Uint8Array) { for (let i = 0; i < b.length; i++) this.a.push(b[i]); return this; }
  /** Pascal string padded so (1 + length) is a multiple of 4 — the layer-record name field. */
  pascal4(s: string) {
    const t = s.slice(0, 255);
    this.u8(t.length).ascii(t);
    while ((1 + t.length + this.padCount) % 4 !== 0) { this.a.push(0); this.padCount++; }
    this.padCount = 0;
    return this;
  }
  private padCount = 0;
  /** The 'luni' additional-info block: the real (UTF-16) layer name Photoshop shows. */
  unicodeName(s: string) {
    this.ascii("8BIM").ascii("luni");
    this.len32Even((w) => { w.u32(s.length); for (const c of s) w.u16(c.charCodeAt(0)); });
    return this;
  }
  len32(fn: (w: Bytes) => void) {
    const inner = new Bytes(); fn(inner); const body = inner.build();
    return this.u32(body.length).bytes(body);
  }
  len32Even(fn: (w: Bytes) => void) {
    const inner = new Bytes(); fn(inner); const body = inner.build();
    const pad = body.length % 2;
    this.u32(body.length + pad).bytes(body);
    if (pad) this.u8(0);
    return this;
  }
  build(): Uint8Array { return Uint8Array.from(this.a); }
}

export function psdHeader(width: number, height: number): Uint8Array {
  return new Bytes()
    .ascii("8BPS").u16(1).bytes(new Uint8Array(6))
    .u16(4)          // channels: R,G,B,A
    .u32(height)     // height BEFORE width
    .u32(width)
    .u16(8).u16(3)   // 8-bit, RGB
    .build();
}
```

Fix `pascal4`'s padding loop if the counter approach is awkward — the requirement is only that the field's total length (length byte + chars + padding) is a multiple of 4.

- [ ] **Step 4: Verify and gate. Step 5: Commit**

```bash
git add -A && git commit -m "feat: PSD byte writer with measured length prefixes"
```

---

### Task 3: `encodePsd` — flat layers and the merged composite

**Files:**
- Create: `src/export/psd.ts`
- Test: `src/__tests__/psd.test.ts`

**Interfaces:**
- Consumes: `packBits`, `Bytes`, `psdHeader`
- Produces:
```ts
export interface PsdRect { top: number; left: number; bottom: number; right: number }
export type PsdNode =
  | { kind: "layer"; name: string; opacity: number; rect: PsdRect; pixels: () => Uint8ClampedArray }
  | { kind: "group"; name: string; opacity: number; children: PsdNode[] };
export interface PsdDoc {
  width: number; height: number;
  /** BOTTOM-FIRST, matching both PSD's order and `project.layers`. */
  nodes: PsdNode[];
  composite: () => Uint8ClampedArray;
}
export function encodePsd(doc: PsdDoc): Uint8Array;
```

`pixels`/`composite` are **thunks** so the driver can render one layer at a time and the encoder can release each after use — the memory constraint from the spec. `opacity` is 0..255 (PSD's unit), converted by the driver.

This task implements layers only; `kind: "group"` may throw "not implemented" until Task 4.

- [ ] **Step 1: Write the failing tests**

```ts
// A 2x1 layer, fully opaque red, on a 2x1 document.
const red = () => Uint8ClampedArray.from([255, 0, 0, 255, 255, 0, 0, 255]);
const doc = {
  width: 2, height: 1,
  nodes: [{ kind: "layer" as const, name: "Ink", opacity: 128, rect: { top: 0, left: 0, bottom: 1, right: 2 }, pixels: red }],
  composite: red,
};

it("starts with a valid header and empty colour-mode/resource sections", () => {
  const b = encodePsd(doc);
  expect(str(b, 0, 4)).toBe("8BPS");
  expect(u32(b, 26)).toBe(0); // colour mode data length
  expect(u32(b, 30)).toBe(0); // image resources length
});

it("writes one layer record with the name, opacity and rect", () => {
  const b = encodePsd(doc);
  expect(Array.from(b).length).toBeGreaterThan(26);
  // Layer count sits after: header(26) + 4 + 4 + layerAndMask len(4) + layerInfo len(4)
  expect(u16(b, 42)).toBe(1);
  expect(indexOfAscii(b, "Ink")).toBeGreaterThan(0);
});

it("renders each pixel thunk exactly once", () => {
  let calls = 0;
  encodePsd({ ...doc, nodes: [{ ...doc.nodes[0], pixels: () => { calls++; return red(); } }] });
  expect(calls).toBe(1);
});

it("declares RLE compression for layer channels and the composite", () => { /* compression id 1 */ });
it("accepts a zero-area layer rect without emitting channel rows", () => { /* top===bottom */ });
```

Write `indexOfAscii` as a small helper in the test file.

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement**

Structure, in order. Every length goes through `len32`/`len32Even`.

1. `psdHeader(width, height)`
2. colour mode data: `u32(0)`
3. image resources: `u32(0)`
4. **layer and mask information**, `len32Even`:
   - **layer info**, `len32Even`:
     - `i16` layer count (positive; Photoshop accepts positive with an alpha-bearing composite)
     - one **layer record** per layer, bottom-first
     - one **channel data** block per layer, in the same order
   - global layer mask info: `u32(0)`
5. **merged image data**: `u16(1)` (RLE), then the row-count table for **all** channels consecutively (R, G, B, A — every row of R, then every row of G, …), then all the packed rows in the same order.

**Layer record:**
```
i32 top, left, bottom, right
u16 channelCount = 4
per channel: i16 id (-1 alpha, 0 R, 1 G, 2 B), u32 byteLength  // INCLUDES the 2-byte compression id
'8BIM' 'norm'
u8 opacity, u8 clipping = 0, u8 flags, u8 filler = 0
len32(extra):
  u32 0   // layer mask data
  u32 0   // layer blending ranges
  pascal4(name)
  unicodeName(name)
  [Task 4 adds the lsct block here]
```
`flags` bit 1 (value 2) means **hidden**. Visible layers write 0.

**Channel data**, per channel, in the order alpha, R, G, B: `u16(1)` then the per-row `u16` byte counts for that channel, then that channel's packed rows. Deinterleave from the RGBA thunk. A zero-area rect writes just the compression id.

The channel byte lengths in the record must equal what the channel block actually writes — build each channel block first, then the record. **Do not compute them analytically.**

- [ ] **Step 4: Verify and gate. Step 5: Commit**

```bash
git add -A && git commit -m "feat: PSD encoder for flat layers and the merged composite"
```

---

### Task 4: Real groups — `lsct` section dividers

**Files:**
- Modify: `src/export/psd.ts`
- Test: `src/__tests__/psd.test.ts`

**This is the task most likely to be wrong, and no unit test can prove Photoshop agrees.** Assert the emitted sequence against a hand-derived expectation, and flag in your report that a real Photoshop open is the acceptance check.

A group flattens, **bottom-first**, to three things:

1. a layer named `</Layer group>`, **hidden**, rect all-zero, no pixels, with `lsct` type **3** (bounding section divider) — the group's CLOSING marker, emitted FIRST because file order is bottom-up;
2. the group's children, recursively;
3. a layer named for the group, visible, rect all-zero, no pixels, with `lsct` type **1** (open folder), carrying the group's opacity.

**`lsct` block:** `'8BIM' 'lsct'` then `len32Even(w => w.u32(type))`.

- [ ] **Step 1: Write the failing test**

```ts
it("brackets a group's children with divider layers, bottom-first", () => {
  const b = encodePsd({
    width: 1, height: 1,
    nodes: [{ kind: "group", name: "Head", opacity: 200, children: [
      { kind: "layer", name: "A", opacity: 255, rect: r, pixels: px },
      { kind: "layer", name: "B", opacity: 255, rect: r, pixels: px },
    ] }],
    composite: px,
  });
  expect(u16(b, 42)).toBe(4); // 2 real + 2 dividers
  const names = asciiNamesInOrder(b);
  expect(names).toEqual(["</Layer group>", "A", "B", "Head"]);
  expect(lsctTypesInOrder(b)).toEqual([3, 1]);
});

it("nests a group inside a group", () => { /* single-level today, but the flatten is recursive */ });
```

- [ ] **Step 2-5: fail, implement the flatten, verify, commit**

```bash
git add -A && git commit -m "feat: PSD groups as lsct section dividers"
```

---

### Task 5: The canvas driver

**Files:**
- Create: `src/export/psd-frame.ts`
- Modify: none

**Interfaces:**
- Consumes: `encodePsd`, `PsdNode`; `opacityAt`, `groupOpacityAt`, `isLayerVisible`, `isDrawingLayer`, `drawCellComposed`, `contentBounds`, `renderFrame`
- Produces: `exportPsdFrame(project: Project, frame: number, dpr: number): Uint8Array`

- [ ] **Step 1: Build the node tree**

Walk `project.layers` (already bottom-first). For each **drawing** layer that `isLayerVisible(layer, project.groups)` and that has ink at `frame`:
- render it ALONE through its full compose chain into a document-sized scratch canvas at `globalAlpha = 1` (opacity is carried by the PSD layer, not baked);
- take `contentBounds` of that result for a tight rect; skip the layer if empty;
- `pixels` is a thunk that reads that rect's `ImageData` on demand.

Group membership comes from `layer.groupId`. Emit a `kind: "group"` node per group with `groupOpacityAt(group, frame)`, containing its surviving members in order. Drop a group whose members all dropped, and drop a group that is not `visible`.

**Opacity:** `Math.round(opacityAt(layer, frame) * 2.55)` for layers, the same for groups from `groupOpacityAt`. Read them directly — **not** from `buildFrameDrawList`, per the Global Constraints.

- [ ] **Step 2: The composite**

`renderFrame` into a document-sized canvas with `includeReference: false`, `boil: undefined`, `drawBg: !project.transparentBg` — matching the PNG exporter minus boil — and hand its `ImageData` as the composite thunk.

- [ ] **Step 3: Memory**

Reuse ONE scratch canvas across layers; do not allocate per layer. Resolve each thunk immediately before encoding and let it fall out of scope after.

- [ ] **Step 4: Gate and commit**

```bash
git add -A && git commit -m "feat: render a frame's layers into a PSD tree"
```

---

### Task 6: Export dialog

**Files:**
- Modify: `src/lib/ExportDialog.svelte`, `src/export/download.ts` (only if a bytes path is missing)

- [ ] **Step 1: Add the button**

A fourth format beside MP4 / WebM / PNG sequence: `PSD (current frame) — <stem>-f<NNN>.psd`, using `sanitizeFilename` and the same 1-based frame numbering the PNG sequence uses. Route through `run(kind)` and the existing download path. No progress or cancel — one frame is effectively instant — but keep `exportBusy` handling consistent with its siblings if that is what the other formats do.

- [ ] **Step 2: The boil caveat**

Extend the dialog's existing "references are guides and are not exported" line to say line boil is not applied to a PSD either. A silent difference from a PNG of the same frame is the defect; the difference itself is intended.

- [ ] **Step 3: Gate and commit**

```bash
git add -A && git commit -m "feat: PSD (current frame) in the export dialog"
```

---

### Task 7: Documentation

**Files:** `CLAUDE.md`, `README.md`

- [ ] **Step 1: The CLAUDE.md entry**

A dated 2026-08-24 entry in the house style — WHY and what it cost. Cover: opacity live vs transforms baked and why each; that `buildFrameDrawList`'s pre-multiplied opacity is the wrong source once groups are real folders; the `lsct` three-part group shape and its bottom-up order; hidden layers and boil dropped, with boil being the one place a PSD differs from a PNG of the same frame; RLE and tight bounds as the reason files stay reasonable; and that the writer is pure and therefore unit-tested where the rest of this export path is not.

- [ ] **Step 2: README**

Add PSD to the Features export bullet. Run `npm test` and use the real count — do not guess.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "docs: PSD export"
```

---

## Self-review notes

**Spec coverage.** Header/sections → 2, 3. PackBits → 1. Layers, opacity, tight bounds → 3, 5. Groups → 4. Hidden/empty/reference/boil exclusions → 5, 6. Composite → 3, 5. Memory → 3 (thunks), 5. UI + caveat → 6. Docs → 7.

**Ordering.** Strictly linear: 1 → 2 → 3 → 4 → 5 → 6 → 7. Each task consumes the previous one's output; there is no parallelism worth taking.

**The risk to watch.** Task 4. The divider ordering is hand-derived from the format, and a unit test can only prove the bytes match what we *believe* Photoshop wants. Task 4's report must say explicitly that a Photoshop round-trip is still owed, and Task 7 must not describe the feature as verified until that happens.
