# PSD export (current frame) — design

**Date:** 2026-08-24
**Status:** Draft — awaiting review
**Builds on:** the existing exporters (`src/export/png-sequence.ts`, `video.ts`, `frames.ts`), the
render chain (`compositeFrameLayers`, `drawCellComposed`), and the multi-property animation model
(`opacityAt` / `groupOpacityAt` / `transformAt`, 2026-08-18 → 08-20 entries in `CLAUDE.md`).

## Goal

Export the **current frame** as a layered `.psd` for **paint-up in Photoshop** — the artist hands a
cleaned frame to a colourist, who fills flats and shades on separate layers.

That target settles most of the design. It is not an archive format, not a round-trip format, and not
an animation format: it is one frame, opened once, painted on.

## Requirements (user-confirmed)

1. **Current frame only.**
2. **Real PSD groups**, mirroring this project's groups — not a flat stack.
3. **Hidden layers are dropped.**

## Non-goals

Multi-frame export (Photoshop's timeline is not a target); reading `.psd` back in; reference layers;
line boil; PSB (>30,000 px); 16-bit; layer masks; blend modes other than Normal; adjustment layers;
text layers; vector paths. Each of these is a real PSD feature this app has no source for.

## What becomes what

| animator | PSD |
| --- | --- |
| visible drawing layer with ink at this frame | one layer, Normal, 8-bit RGBA |
| layer name | layer name (UTF-16 via `luni`, plus the legacy Pascal name) |
| resolved layer opacity at this frame | layer opacity byte — **not baked into pixels** |
| group | a real group (open folder), named, with its own opacity |
| `group ∘ layer ∘ cell` transform | **baked into the layer's pixels** |
| hidden layer or hidden group | omitted entirely |
| reference layer | omitted |
| project background | the merged composite only (see below) |

**Opacity stays live and transforms bake.** A colourist re-tunes opacity constantly and never wants
it fused into the pixels; PSD stores it as a byte, so it costs nothing to preserve. Transforms have
no PSD equivalent — there is no per-layer affine that survives a paint stroke — so the layer is
rendered through its full compose chain and the result is what ships.

**Do NOT source opacity from `buildFrameDrawList`.** That is the obvious move and it is wrong here:
the drawlist already multiplies group opacity into each layer's number (`opacityAt(layer, frame) *
groupOpacityAt(g, frame) / 100`), which is exactly right for a flat export and **double-applies** the
moment the group also becomes a real folder carrying its own opacity. Read `opacityAt(layer, frame)`
for the layer and `groupOpacityAt(group, frame)` for the folder, directly.

## What is dropped, and why each

- **Hidden layers and hidden groups** — user-confirmed, and it matches both existing exporters, so
  "what exports" means one thing across the app. Visibility is read through `isLayerVisible(layer,
  groups)`, never the raw flag, so a layer inside a hidden group goes too.
- **Layers with no ink at this frame.** A layer whose `contentBounds` is empty would become a
  zero-area PSD layer: legal, but clutter in a panel the colourist has to navigate. A group left with
  no surviving members is dropped with them, rather than shipping an empty folder.
- **Reference layers**, consistent with the other two exporters and with what the Export dialog
  already tells the user.
- **Line boil.** It is a render-time wobble produced by compositing every drawing layer inside ONE
  GL surface and reading it back exactly once — the code notes iOS Safari cannot do that per-layer,
  so a per-layer boil would mean N readbacks. Excluding it is also right on the merits for paint-up,
  where the clean line is what you want. **This is the one place a PSD will not match a PNG of the
  same frame, so the Export dialog must say so** — a silent difference is the defect, not the
  difference itself.

## File structure

Standard PSD, five sections in order: header, colour mode data (empty), image resources (empty),
layer and mask information, merged image data.

**Layers are written bottom-up** — PSD's order is the reverse of the panel — which happens to match
`project.layers` (already bottom-first), so the ordering is a straight walk rather than a reversal.

**Groups are `lsct` section dividers, and this is the fiddliest part of the format.** A group is not
a container; it is three things in file order:

1. a hidden layer with `lsct` type **3** (bounding section divider) — the group's *closing* marker,
   written **first** because file order is bottom-up,
2. the group's member layers,
3. a layer named for the group with `lsct` type **1** (open folder), carrying the group's opacity.

Get the order or the types wrong and Photoshop opens the file flat, or refuses it. It cannot corrupt
the pixels — every layer's channel data is independent of the dividers — so the failure mode is
visible and safe, but it is the part that needs a real round-trip through Photoshop to trust.

**Groups here are single-level.** `LayerGroup` has no parent field and layers carry a `groupId`, so
there is exactly one level of nesting to emit. If nested groups ever land, this is the code that has
to learn recursion.

**Channels** are stored per layer as alpha, red, green, blue, each `2 + rows × 2` bytes of PackBits
row lengths followed by the compressed rows.

**Per-layer bounds are tight**, taken from the existing `contentBounds` after the transform bake. A
full-frame rect per layer at 1920×1080 is ~8 MB of raw channel data before compression; line art on a
tight rect is a small fraction of that.

**Compression is RLE (PackBits)**, compression id 1, not raw. Raw is simpler and legal, but ten
full-size layers would produce a file in the hundreds of megabytes. Line art is mostly flat runs —
especially the alpha channel — so RLE crushes it. `fflate` is already a dependency but is the wrong
tool here: PSD's RLE is part of the format, not a wrapper around it.

**The merged composite ships too.** Photoshop's "maximize compatibility" expects it and every
non-layer-aware reader needs it. It honours `transparentBg` the same way the PNG export does.

## Memory

Render one layer through its compose chain, read its pixels, encode its channels, release it, move
on. Holding every layer as full-size `ImageData` at once is ~8 MB × N — around 83 MB for ten layers
at 1920×1080, on a device where the 1× document-scale work went to some length to avoid exactly that.
The encoder therefore takes layers as a sequence and appends bytes, never an array of bitmaps.

## Testing — unusually good for this codebase

The writer is **pure: bytes in, bytes out**, with no canvas in it. That makes it properly
unit-testable, which most of this app's export path is not (Vitest is node-only here, so canvas work
is review-verified only).

Unit-test: the 26-byte header; PackBits round-trip including the awkward cases (a run of exactly 128,
a row that is entirely one value, a row of length 1); section length fields agreeing with the bytes
actually written; layer records in bottom-up order; and — the part most likely to be wrong — the
divider layers around a group, asserted as an explicit expected sequence for a two-layers-in-one-group
document.

The canvas side (rendering each layer through its compose chain) is DOM-coupled and stays
build + review verified, per project convention.

**The test that matters most cannot be written in node: opening the result in Photoshop.** That is
the acceptance check, and the spec should say so rather than implying the unit tests cover it.

## UI

A fourth button in the Export dialog beside MP4 / WebM / PNG sequence: **"PSD (current frame) —
`<name>-f<NNN>.psd`"**, using the existing `sanitizeFilename` and the same 1-based frame numbering the
PNG sequence uses. It needs no progress reporting or cancel — one frame is effectively instant next
to a video render — but it goes through the same `download.ts` path as everything else.

The dialog's existing "references are guides and are not exported" line gains the boil caveat.

## Risks, honestly

- **`lsct` ordering is the one part likely to be wrong first time**, and no unit test can prove
  Photoshop agrees. Mitigation: assert the byte sequence against a hand-derived expectation, then open
  a real export in Photoshop before calling it done.
- **Photoshop is strict about section lengths.** Every section writes a length prefix covering bytes
  written after it; an off-by-N there produces "could not complete your request" with no clue which
  section. Mitigation: build sections into buffers and prefix the measured length, never predict it.
- **A big document is still a big file.** A 4K frame with fifteen layers will be tens of megabytes
  even with RLE. Acceptable — it is one frame, saved deliberately — but worth not being surprised by.

## Owed a browser pass

Export a frame and open it in Photoshop: layers present with the right names, in the right order,
inside the right groups; opacity live rather than baked; a transformed layer's pixels where the editor
shows them; hidden layers absent; a group's opacity on the folder; the merged composite correct when
opened by something that ignores layers; and a transparent-background project arriving with alpha.
