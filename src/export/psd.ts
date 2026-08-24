/**
 * The PSD encoder: layer records, per-layer channel data, and the merged composite.
 *
 * Bytes in, bytes out — no canvas, no DOM. The driver renders each layer through its compose
 * chain and hands the result over as a THUNK, so exactly one full-size bitmap is live at a time
 * (ten layers held at once is ~83 MB at 1920x1080, which the 1x document-scale work exists to
 * avoid). Each thunk is called exactly once and the result is dropped as soon as its channels
 * are packed.
 *
 * Every length prefix goes through `len32`/`len32Even`, and every per-channel byte length is
 * MEASURED from the block it describes. Photoshop reports an off-by-N in any of them as
 * "could not complete your request", naming no section.
 */
import { packBits } from "./packbits";
import { Bytes, psdHeader } from "./psd-bytes";

export interface PsdRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export type PsdNode =
  | {
      kind: "layer";
      name: string;
      opacity: number;
      rect: PsdRect;
      pixels: () => Uint8ClampedArray;
    }
  | { kind: "group"; name: string; opacity: number; children: PsdNode[] };

/**
 * PSD's hard ceiling on either axis. Past this the format is PSB, which is an explicit non-goal
 * of the spec — and the failure is silent: the `u32` dimensions in the header still write fine,
 * so what ships is a well-formed file Photoshop refuses to open.
 */
export const PSD_MAX_DIMENSION = 30000;

export interface PsdDoc {
  width: number;
  height: number;
  /** BOTTOM-FIRST, matching both PSD's order and `project.layers`. */
  nodes: PsdNode[];
  composite: () => Uint8ClampedArray;
}

/**
 * A layer's channels are stored alpha-first; the merged composite stores them RGBA. Keeping the
 * two orders as named constants is the only thing standing between this and a colour-swapped
 * file, since every wrong ordering is the same size and structurally valid.
 */
const LAYER_CHANNEL_IDS = [-1, 0, 1, 2]; // alpha, R, G, B
const LAYER_CHANNEL_SOURCE = [3, 0, 1, 2]; // the RGBA byte each one reads
const MERGED_CHANNEL_SOURCE = [0, 1, 2, 3]; // R, G, B, A

/** PackBits every row of one channel, deinterleaved from an RGBA buffer. */
function packChannelRows(
  px: Uint8ClampedArray,
  width: number,
  height: number,
  source: number,
): Uint8Array[] {
  const rows: Uint8Array[] = [];
  const row = new Uint8Array(width);
  for (let y = 0; y < height; y++) {
    const base = y * width * 4 + source;
    for (let x = 0; x < width; x++) row[x] = px[base + x * 4];
    rows.push(packBits(row));
  }
  return rows;
}

/**
 * One layer channel: the compression id, that channel's own row-length table, then its rows.
 * A zero-area rect writes just the compression id — there are no rows to describe.
 */
function layerChannelBlock(
  px: Uint8ClampedArray,
  width: number,
  height: number,
  source: number,
): Uint8Array {
  const b = new Bytes().u16(1); // RLE
  if (width <= 0 || height <= 0) return b.build();
  const rows = packChannelRows(px, width, height, source);
  for (const r of rows) b.u16(r.length);
  for (const r of rows) b.bytes(r);
  return b.build();
}

interface EncodedLayer {
  record: Uint8Array;
  channels: Uint8Array[];
}

/**
 * Records for every layer precede channel data for every layer, so the compressed channels have
 * to be held until the records are written. Holding the COMPRESSED bytes rather than the raw
 * bitmaps is what keeps that affordable, and it is also what lets each record quote a measured
 * length instead of a predicted one.
 */
function encodeLayer(node: Extract<PsdNode, { kind: "layer" }>): EncodedLayer {
  const { rect } = node;
  const width = Math.max(0, rect.right - rect.left);
  const height = Math.max(0, rect.bottom - rect.top);

  const px = node.pixels();
  // The rect is what the record declares and what the channel loops index against, so a thunk
  // that returns a smaller buffer emits `undefined` — silently coerced to 0 — for every pixel
  // past its end, i.e. a mostly-transparent layer with no error anywhere. Loud for the same
  // reason the group node is: Task 5 is what pairs rects with real bitmaps.
  if (px.length < width * height * 4) {
    throw new Error(
      `encodePsd: layer "${node.name}" is ${width}x${height} but its thunk returned ` +
        `${px.length} bytes, not ${width * height * 4}`,
    );
  }
  const channels = LAYER_CHANNEL_SOURCE.map((source) =>
    layerChannelBlock(px, width, height, source),
  );

  const record = new Bytes()
    .i32(rect.top)
    .i32(rect.left)
    .i32(rect.bottom)
    .i32(rect.right)
    .u16(channels.length);
  channels.forEach((block, i) => {
    // The declared length INCLUDES the 2-byte compression id, i.e. the whole block.
    record.i16(LAYER_CHANNEL_IDS[i]).u32(block.length);
  });
  record
    .ascii("8BIM")
    .ascii("norm")
    .u8(node.opacity)
    .u8(0) // clipping
    .u8(0) // flags; bit 1 (value 2) would mean hidden, and visible layers write 0
    .u8(0) // filler
    .len32((extra) => {
      extra.u32(0); // layer mask data
      extra.u32(0); // layer blending ranges
      extra.pascal4(node.name);
      extra.unicodeName(node.name);
      // Task 4 adds the lsct section-divider block here.
    });

  return { record: record.build(), channels };
}

/**
 * The merged composite. Unlike a layer, this writes the row-length tables for ALL channels
 * consecutively and only then every packed row, in the same channel order (R, G, B, A).
 */
function writeMergedImage(out: Bytes, doc: PsdDoc) {
  out.u16(1); // RLE
  const px = doc.composite();
  const rows = MERGED_CHANNEL_SOURCE.flatMap((source) =>
    packChannelRows(px, doc.width, doc.height, source),
  );
  for (const r of rows) out.u16(r.length);
  for (const r of rows) out.bytes(r);
}

export function encodePsd(doc: PsdDoc): Uint8Array {
  if (doc.width > PSD_MAX_DIMENSION || doc.height > PSD_MAX_DIMENSION) {
    throw new Error(
      `encodePsd: ${doc.width}x${doc.height} exceeds PSD's ${PSD_MAX_DIMENSION} px limit (PSB territory)`,
    );
  }

  const layers = doc.nodes.map((node) => {
    if (node.kind === "group") {
      // Deliberately loud. A silently dropped group would produce a VALID psd that is merely
      // missing layers — nothing downstream flags that, and it would only surface as a
      // miscount in Photoshop. Task 4 replaces this with the lsct divider trio.
      throw new Error("encodePsd: group nodes are not implemented");
    }
    return encodeLayer(node);
  });

  const out = new Bytes();
  out.bytes(psdHeader(doc.width, doc.height));
  out.u32(0); // colour mode data
  out.u32(0); // image resources

  out.len32Even((lam) => {
    lam.len32Even((info) => {
      // Positive count, per the brief. The sign is not cosmetic: a NEGATIVE count is what
      // declares the merged composite's fourth channel to be transparency, where a positive
      // one leaves it a spare channel Photoshop surfaces as "Alpha 1". A transparent-background
      // project is therefore the input where this could disagree with the PNG export, which is
      // why it sits on the spec's owed-Photoshop-pass list.
      info.i16(layers.length);
      for (const l of layers) info.bytes(l.record);
      for (const l of layers) for (const c of l.channels) info.bytes(c);
    });
    lam.u32(0); // global layer mask info
  });

  writeMergedImage(out, doc);
  return out.build();
}
