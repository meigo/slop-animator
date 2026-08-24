import { describe, it, expect } from "vitest";
import { encodePsd, PSD_MAX_DIMENSION, type PsdDoc, type PsdNode } from "../export/psd";

const str = (b: Uint8Array, o: number, n: number) =>
  String.fromCharCode(...Array.from(b.slice(o, o + n)));
const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const u32 = (b: Uint8Array, o: number) => dv(b).getUint32(o);
const u16 = (b: Uint8Array, o: number) => dv(b).getUint16(o);

/** First byte offset of `s` read as ASCII, or -1. Used to prove a name actually reached the file. */
function indexOfAscii(b: Uint8Array, s: string): number {
  const want = Array.from(s, (c) => c.charCodeAt(0));
  outer: for (let i = 0; i + want.length <= b.length; i++) {
    for (let k = 0; k < want.length; k++) if (b[i + k] !== want[k]) continue outer;
    return i;
  }
  return -1;
}

/**
 * The inverse of `packBits`, so channel CONTENT can be asserted rather than only its length.
 * That is what catches a channel-order swap (alpha where red should be), which is otherwise
 * invisible — every wrong ordering produces a same-sized, structurally valid file.
 */
function unpackBits(src: Uint8Array, expected: number): number[] {
  const out: number[] = [];
  let i = 0;
  while (out.length < expected && i < src.length) {
    const n = src[i++];
    if (n === 128) continue; // documented no-op
    if (n < 128) for (let k = 0; k <= n; k++) out.push(src[i++]);
    else {
      const v = src[i++];
      for (let k = 0; k < 257 - n; k++) out.push(v);
    }
  }
  return out;
}

interface ParsedChannel {
  id: number;
  /** The length declared in the layer record. */
  declared: number;
  compression: number;
  /** Per-row PackBits byte counts, as written in the channel's own table. */
  rowCounts: number[];
  /** Decompressed samples, row-major. */
  samples: number[];
}
interface ParsedLayer {
  top: number;
  left: number;
  bottom: number;
  right: number;
  opacity: number;
  clipping: number;
  flags: number;
  blend: string;
  name: string;
  /** The 'lsct' section-divider type, or null for an ordinary layer. */
  lsct: number | null;
  /** The additional-info block keys, in file order. */
  blockKeys: string[];
  channels: ParsedChannel[];
}

/**
 * Walks a layer record's additional-information area by its OWN length fields: mask data,
 * blending ranges, the Pascal name (padded so 1 + chars + pad is a multiple of 4), then a run of
 * '8BIM'-signed blocks. Nothing is skipped by a hardcoded offset, so a mis-measured 'luni' or
 * 'lsct' prefix desynchronises the walk and trips the closing `expect` instead of passing.
 */
function parseExtra(extra: Uint8Array) {
  const d = dv(extra);
  let o = 0;
  const maskLen = d.getUint32(o);
  o += 4 + maskLen;
  const rangesLen = d.getUint32(o);
  o += 4 + rangesLen;
  const nameLen = extra[o];
  const name = str(extra, o + 1, nameLen);
  o += 1 + nameLen;
  o += (4 - ((1 + nameLen) % 4)) % 4;

  const blocks: { key: string; body: Uint8Array }[] = [];
  while (o + 12 <= extra.length) {
    expect(str(extra, o, 4)).toBe("8BIM");
    const key = str(extra, o + 4, 4);
    const len = d.getUint32(o + 8);
    o += 12;
    blocks.push({ key, body: extra.slice(o, o + len) });
    o += len; // len32Even counts its own pad byte in the prefix
  }
  expect(o).toBe(extra.length); // the record's extra length covers exactly these fields

  const lsct = blocks.find((x) => x.key === "lsct");
  return {
    name,
    blockKeys: blocks.map((x) => x.key),
    lsct: lsct ? dv(lsct.body).getUint32(0) : null,
  };
}

/**
 * A deliberately literal reader: it walks the same section tree the encoder writes and trusts
 * only the length fields IN the file. Anything the encoder mis-measures desynchronises this
 * parser, so a wrong length prefix shows up as a failed assertion rather than as a valid-looking
 * file that only Photoshop would reject.
 */
function parse(b: Uint8Array) {
  const d = dv(b);
  let o = 26;
  const colorLen = d.getUint32(o);
  o += 4 + colorLen;
  const resLen = d.getUint32(o);
  o += 4 + resLen;
  const lamLen = d.getUint32(o);
  o += 4;
  const lamStart = o;
  const layerInfoLen = d.getUint32(o);
  o += 4;
  const layerInfoStart = o;
  const layerCount = d.getInt16(o);
  o += 2;

  const layers: ParsedLayer[] = [];
  for (let i = 0; i < Math.abs(layerCount); i++) {
    const top = d.getInt32(o);
    const left = d.getInt32(o + 4);
    const bottom = d.getInt32(o + 8);
    const right = d.getInt32(o + 12);
    o += 16;
    const channelCount = d.getUint16(o);
    o += 2;
    const decl: { id: number; declared: number }[] = [];
    for (let c = 0; c < channelCount; c++) {
      decl.push({ id: d.getInt16(o), declared: d.getUint32(o + 2) });
      o += 6;
    }
    const sig = str(b, o, 4);
    expect(sig).toBe("8BIM");
    const blend = str(b, o + 4, 4);
    o += 8;
    const opacity = b[o];
    const clipping = b[o + 1];
    const flags = b[o + 2];
    o += 4; // + filler
    const extraLen = d.getUint32(o);
    o += 4;
    const extra = b.slice(o, o + extraLen);
    o += extraLen;
    const { name, lsct, blockKeys } = parseExtra(extra);
    layers.push({
      top,
      left,
      bottom,
      right,
      opacity,
      clipping,
      flags,
      blend,
      name,
      lsct,
      blockKeys,
      channels: decl.map((x) => ({ ...x, compression: 0, rowCounts: [], samples: [] })),
    });
  }

  for (const L of layers) {
    const w = Math.max(0, L.right - L.left);
    const h = Math.max(0, L.bottom - L.top);
    for (const ch of L.channels) {
      const block = b.slice(o, o + ch.declared);
      o += ch.declared;
      ch.compression = block.length >= 2 ? dv(block).getUint16(0) : -1;
      let p = 2;
      // Bounded by the block as well as by h, so an over-short block is caught by the
      // `p === block.length` invariant below rather than by a RangeError here.
      for (let y = 0; y < h && p + 2 <= block.length; y++) {
        ch.rowCounts.push(dv(block).getUint16(p));
        p += 2;
      }
      for (const n of ch.rowCounts) {
        ch.samples.push(...unpackBits(block.slice(p, p + n), w));
        p += n;
      }
      expect(p).toBe(block.length); // the declared length covers exactly this channel
    }
  }

  const merged = lamStart + lamLen;
  return {
    colorLen,
    resLen,
    lamLen,
    lamStart,
    layerInfoLen,
    layerInfoStart,
    layerCount,
    layers,
    merged,
  };
}

/** Decodes the merged composite section: R, G, B, A, all row tables first, then all rows. */
function parseMerged(b: Uint8Array, at: number, width: number, height: number) {
  const compression = u16(b, at);
  let p = at + 2;
  const counts: number[] = [];
  for (let i = 0; i < 4 * height; i++) {
    counts.push(u16(b, p));
    p += 2;
  }
  const channels: number[][] = [[], [], [], []];
  for (let i = 0; i < counts.length; i++) {
    channels[Math.floor(i / height)].push(...unpackBits(b.slice(p, p + counts[i]), width));
    p += counts[i];
  }
  return { compression, counts, channels, end: p };
}

// A 2x1 layer, fully opaque red, on a 2x1 document.
const red = () => Uint8ClampedArray.from([255, 0, 0, 255, 255, 0, 0, 255]);
const doc: PsdDoc = {
  width: 2,
  height: 1,
  nodes: [
    {
      kind: "layer",
      name: "Ink",
      opacity: 128,
      rect: { top: 0, left: 0, bottom: 1, right: 2 },
      pixels: red,
    },
  ],
  composite: red,
};

describe("encodePsd — sections", () => {
  it("starts with a valid header and empty colour-mode/resource sections", () => {
    const b = encodePsd(doc);
    expect(str(b, 0, 4)).toBe("8BPS");
    expect(u32(b, 26)).toBe(0); // colour mode data length
    expect(u32(b, 30)).toBe(0); // image resources length
  });

  it("writes one layer record with the name, opacity and rect", () => {
    const b = encodePsd(doc);
    // Layer count sits after: header(26) + 4 + 4 + layerAndMask len(4) + layerInfo len(4)
    expect(u16(b, 42)).toBe(1);
    expect(indexOfAscii(b, "Ink")).toBeGreaterThan(0);

    const p = parse(b);
    expect(p.layers).toHaveLength(1);
    expect(p.layers[0]).toMatchObject({
      top: 0,
      left: 0,
      bottom: 1,
      right: 2,
      opacity: 128,
      clipping: 0,
      flags: 0,
      blend: "norm",
      name: "Ink",
    });
  });

  it("writes the UTF-16 name alongside the legacy Pascal one", () => {
    const b = encodePsd(doc);
    expect(indexOfAscii(b, "luni")).toBeGreaterThan(0);
    // "Ink" as UTF-16BE code units, which the Pascal copy cannot produce.
    expect(indexOfAscii(b, "\0I\0n\0k")).toBeGreaterThan(0);
  });

  it("layer-and-mask and layer-info lengths cover exactly the bytes written after them", () => {
    const b = encodePsd(doc);
    const p = parse(b);
    // The layer-and-mask section runs to the start of the merged image data.
    expect(p.lamStart + p.lamLen).toBe(p.merged);
    // Layer info is followed only by the 4-byte global layer mask info (plus any even pad).
    expect(p.layerInfoStart + p.layerInfoLen + 4).toBeGreaterThanOrEqual(p.merged - 1);
    expect(p.layerInfoStart + p.layerInfoLen + 4).toBeLessThanOrEqual(p.merged);
    expect(u32(b, p.layerInfoStart + p.layerInfoLen)).toBe(0); // global layer mask info
  });

  it("declares RLE compression for layer channels and the composite", () => {
    const b = encodePsd(doc);
    const p = parse(b);
    for (const ch of p.layers[0].channels) expect(ch.compression).toBe(1);
    expect(u16(b, p.merged)).toBe(1);
  });

  it("ends exactly at the end of the merged image data", () => {
    const b = encodePsd(doc);
    const p = parse(b);
    const m = parseMerged(b, p.merged, doc.width, doc.height);
    expect(m.end).toBe(b.length);
  });
});

describe("encodePsd — channels", () => {
  it("orders layer channels alpha, R, G, B with the PSD channel ids", () => {
    const b = encodePsd(doc);
    const p = parse(b);
    expect(p.layers[0].channels.map((c) => c.id)).toEqual([-1, 0, 1, 2]);
    // Red on opaque: alpha 255, R 255, G 0, B 0. A swapped order fails here and nowhere else.
    expect(p.layers[0].channels.map((c) => c.samples)).toEqual([
      [255, 255],
      [255, 255],
      [0, 0],
      [0, 0],
    ]);
  });

  it("orders merged composite channels R, G, B, A — the reverse of a layer's", () => {
    const b = encodePsd(doc);
    const p = parse(b);
    const m = parseMerged(b, p.merged, doc.width, doc.height);
    expect(m.channels).toEqual([
      [255, 255],
      [0, 0],
      [0, 0],
      [255, 255],
    ]);
  });

  it("writes all merged row counts consecutively before any packed row", () => {
    // Two rows of two pixels: 4 channels x 2 rows = 8 counts, then 8 packed rows.
    const px = () =>
      Uint8ClampedArray.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const b = encodePsd({ width: 2, height: 2, nodes: [], composite: px });
    const p = parse(b);
    const m = parseMerged(b, p.merged, 2, 2);
    expect(m.counts).toHaveLength(8);
    expect(m.channels[0]).toEqual([1, 5, 9, 13]); // R over both rows
    expect(m.channels[3]).toEqual([4, 8, 12, 16]); // A over both rows
  });

  it("declares per-channel byte lengths that match the channel blocks actually written", () => {
    // A tall, run-heavy layer: analytically-computed lengths would disagree with PackBits here.
    const w = 5;
    const h = 300;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      px[i * 4] = i % 7 === 0 ? 200 : 10; // R varies, so its rows compress differently from A's
      px[i * 4 + 3] = 255;
    }
    const b = encodePsd({
      width: w,
      height: h,
      nodes: [
        {
          kind: "layer",
          name: "L",
          opacity: 255,
          rect: { top: 0, left: 0, bottom: h, right: w },
          pixels: () => px,
        },
      ],
      composite: () => px,
    });
    const p = parse(b); // parse() asserts each declared length consumes its block exactly
    const ch = p.layers[0].channels;
    // 2 (compression) + 2*h (row table) + the packed rows themselves.
    for (const c of ch) {
      expect(c.declared).toBe(2 + 2 * h + c.rowCounts.reduce((a, n) => a + n, 0));
    }
    // The R channel is genuinely less compressible than the constant alpha channel, so this
    // would catch "every channel got the same analytically-derived length".
    expect(ch[1].declared).toBeGreaterThan(ch[0].declared);
    expect(ch[0].samples).toHaveLength(w * h);
  });
});

describe("encodePsd — layers", () => {
  it("renders each pixel thunk exactly once", () => {
    let calls = 0;
    encodePsd({
      ...doc,
      nodes: [
        {
          ...(doc.nodes[0] as Extract<PsdNode, { kind: "layer" }>),
          pixels: () => {
            calls++;
            return red();
          },
        },
      ],
    });
    expect(calls).toBe(1);
  });

  it("resolves each layer's pixels only when that layer is encoded, not up front", () => {
    // Counting calls catches "twice" but never "too early", and EARLY is the failure the thunk
    // API exists to prevent — an eager pass that resolves every thunk before encoding holds N
    // full-size bitmaps at once, which is exactly what the spec's Memory section forbids and
    // what a call count cannot see. So: two layers whose thunks fill and return the SAME
    // buffer with different values. Encoded one at a time, each layer sees its own colour;
    // resolved eagerly, the second fill overwrites the first and both layers come out
    // identical. Nothing about the call count changes either way.
    const shared = new Uint8ClampedArray(8);
    const fill = (r: number) => () => {
      shared.set([r, 0, 0, 255, r, 0, 0, 255]);
      return shared;
    };
    const mk = (name: string, r: number): PsdNode => ({
      kind: "layer",
      name,
      opacity: 255,
      rect: { top: 0, left: 0, bottom: 1, right: 2 },
      pixels: fill(r),
    });
    const b = encodePsd({ ...doc, nodes: [mk("first", 10), mk("second", 200)] });
    const p = parse(b);
    // Channel index 1 is red (order is alpha, R, G, B).
    expect(p.layers.map((l) => l.channels[1].samples)).toEqual([
      [10, 10],
      [200, 200],
    ]);
  });

  it("renders the composite thunk exactly once", () => {
    let calls = 0;
    encodePsd({
      ...doc,
      composite: () => {
        calls++;
        return red();
      },
    });
    expect(calls).toBe(1);
  });

  it("writes layers in the given bottom-first order", () => {
    const mk = (name: string): PsdNode => ({
      kind: "layer",
      name,
      opacity: 255,
      rect: { top: 0, left: 0, bottom: 1, right: 2 },
      pixels: red,
    });
    const b = encodePsd({ ...doc, nodes: [mk("bottom"), mk("top")] });
    const p = parse(b);
    expect(p.layerCount).toBe(2);
    expect(p.layers.map((l) => l.name)).toEqual(["bottom", "top"]);
    // and the channel data blocks follow in the same order, which parse() relies on.
    expect(indexOfAscii(b, "bottom")).toBeLessThan(indexOfAscii(b, "top"));
  });

  it("accepts a zero-area layer rect without emitting channel rows", () => {
    const b = encodePsd({
      ...doc,
      nodes: [
        {
          kind: "layer",
          name: "Empty",
          opacity: 255,
          rect: { top: 4, left: 4, bottom: 4, right: 9 },
          pixels: () => new Uint8ClampedArray(0),
        },
      ],
    });
    const p = parse(b);
    for (const ch of p.layers[0].channels) {
      expect(ch.declared).toBe(2); // just the compression id
      expect(ch.rowCounts).toEqual([]);
      expect(ch.compression).toBe(1);
    }
  });

  it("accepts a zero-WIDTH layer rect without emitting an empty row table", () => {
    // left === right, so there are h rows of nothing. Guarding only on height would emit a
    // row table full of zero-length rows here.
    const b = encodePsd({
      ...doc,
      nodes: [
        {
          kind: "layer",
          name: "Sliver",
          opacity: 255,
          rect: { top: 0, left: 5, bottom: 3, right: 5 },
          pixels: () => new Uint8ClampedArray(0),
        },
      ],
    });
    const p = parse(b);
    for (const ch of p.layers[0].channels) {
      expect(ch.declared).toBe(2);
      expect(ch.rowCounts).toEqual([]);
    }
  });

  it("writes a zero layer count for a document with no nodes", () => {
    const b = encodePsd({ ...doc, nodes: [] });
    const p = parse(b);
    expect(p.layerCount).toBe(0);
    expect(p.layers).toEqual([]);
    expect(u16(b, p.merged)).toBe(1);
  });
});

describe("encodePsd — loud failures", () => {
  it("throws when a thunk returns fewer pixels than its rect declares", () => {
    // Without the check the missing bytes read back as `undefined` -> 0, so the layer ships
    // 99% transparent with no error anywhere. This is a Task 5 wiring mistake, not a user one.
    const short: PsdNode = {
      kind: "layer",
      name: "Short",
      opacity: 255,
      rect: { top: 0, left: 0, bottom: 10, right: 10 },
      pixels: () => new Uint8ClampedArray(4 * 4), // a 2x2 buffer for a 10x10 rect
    };
    expect(() => encodePsd({ ...doc, nodes: [short] })).toThrow(/Short.*10x10.*16 bytes/);
  });

  it("accepts a thunk buffer that is exactly the declared size", () => {
    const exact: PsdNode = {
      kind: "layer",
      name: "Exact",
      opacity: 255,
      rect: { top: 0, left: 0, bottom: 3, right: 3 },
      pixels: () => new Uint8ClampedArray(3 * 3 * 4),
    };
    expect(() => encodePsd({ ...doc, nodes: [exact] })).not.toThrow();
  });

  it("throws above the PSD dimension limit on either axis", () => {
    const at = PSD_MAX_DIMENSION;
    const bare = { nodes: [], composite: () => new Uint8ClampedArray(0) };
    expect(() => encodePsd({ ...bare, width: at + 1, height: 1 })).toThrow(/exceeds/);
    expect(() => encodePsd({ ...bare, width: 1, height: at + 1 })).toThrow(/exceeds/);
    // The limit itself is legal, so the guard must not be off by one. (Encoding a 30000-row
    // composite would be slow, so this asserts the guard alone via a zero-width document.)
    expect(() => encodePsd({ ...bare, width: 0, height: at })).not.toThrow();
  });
});

describe("encodePsd — groups as lsct section dividers", () => {
  // A 1x1 opaque dot, so a group's children carry real channel data and the dividers' empty
  // records sit between blocks that actually have bytes in them.
  const dot = () => Uint8ClampedArray.from([9, 9, 9, 255]);
  const unit = (name: string): PsdNode => ({
    kind: "layer",
    name,
    opacity: 255,
    rect: { top: 0, left: 0, bottom: 1, right: 1 },
    pixels: dot,
  });
  const tiny = (nodes: PsdNode[]): PsdDoc => ({ width: 1, height: 1, nodes, composite: dot });
  const head = (): PsdDoc =>
    tiny([{ kind: "group", name: "Head", opacity: 200, children: [unit("A"), unit("B")] }]);

  it("brackets a group's children with divider layers, bottom-first", () => {
    const b = encodePsd(head());
    expect(u16(b, 42)).toBe(4); // 2 real layers + 2 dividers
    const p = parse(b);
    // The whole risk of this feature is the ORDER, so it is pinned as a sequence, not a set.
    expect(p.layers.map((l) => l.name)).toEqual(["</Layer group>", "A", "B", "Head"]);
    expect(p.layers.map((l) => l.lsct)).toEqual([3, null, null, 1]);
    expect(p.layers.map((l) => l.lsct).filter((t) => t !== null)).toEqual([3, 1]);
  });

  it("hides the closing divider and gives the folder the group's opacity", () => {
    const p = parse(encodePsd(head()));
    // flags bit 1 (value 2) is hidden. The closer must never be visible; the folder must.
    expect(p.layers[0]).toMatchObject({
      name: "</Layer group>",
      flags: 2,
      blend: "norm",
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
    });
    expect(p.layers[3]).toMatchObject({
      name: "Head",
      flags: 0,
      opacity: 200,
      blend: "norm",
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
    });
    // and the members keep their own opacity — the group's must not leak onto them.
    expect(p.layers.slice(1, 3).map((l) => l.opacity)).toEqual([255, 255]);
  });

  it("gives each divider a full layer record with four empty channels", () => {
    const p = parse(encodePsd(head()));
    for (const i of [0, 3]) {
      expect(p.layers[i].channels.map((c) => c.id)).toEqual([-1, 0, 1, 2]);
      for (const ch of p.layers[i].channels) {
        expect(ch.declared).toBe(2); // the compression id alone
        expect(ch.rowCounts).toEqual([]);
        expect(ch.compression).toBe(1);
      }
    }
  });

  it("attaches lsct only to dividers, after the luni name", () => {
    const p = parse(encodePsd(head()));
    expect(p.layers.map((l) => l.blockKeys)).toEqual([
      ["luni", "lsct"],
      ["luni"],
      ["luni"],
      ["luni", "lsct"],
    ]);
  });

  it("nests a group inside a group", () => {
    // Single-level is all this app can currently produce, but a flatten that only handles one
    // level is a silent trap: it would emit 3/1 here and lose the inner folder entirely.
    const b = encodePsd(
      tiny([
        {
          kind: "group",
          name: "Outer",
          opacity: 255,
          children: [
            unit("A"),
            { kind: "group", name: "Inner", opacity: 128, children: [unit("B")] },
          ],
        },
      ]),
    );
    expect(u16(b, 42)).toBe(6);
    const p = parse(b);
    expect(p.layers.map((l) => l.name)).toEqual([
      "</Layer group>",
      "A",
      "</Layer group>",
      "B",
      "Inner",
      "Outer",
    ]);
    expect(p.layers.map((l) => l.lsct)).toEqual([3, null, 3, null, 1, 1]);
    expect(p.layers[4].opacity).toBe(128);
  });

  it("keeps ordinary layers around a group in their given bottom-first order", () => {
    const b = encodePsd(
      tiny([
        unit("below"),
        { kind: "group", name: "G", opacity: 255, children: [unit("in")] },
        unit("above"),
      ]),
    );
    const p = parse(b);
    expect(p.layerCount).toBe(5);
    expect(p.layers.map((l) => l.name)).toEqual(["below", "</Layer group>", "in", "G", "above"]);
    expect(p.layers.map((l) => l.lsct)).toEqual([null, 3, null, 1, null]);
  });

  it("emits an empty group as its two dividers and nothing else", () => {
    const b = encodePsd(tiny([{ kind: "group", name: "Empty", opacity: 255, children: [] }]));
    expect(u16(b, 42)).toBe(2);
    const p = parse(b);
    expect(p.layers.map((l) => l.name)).toEqual(["</Layer group>", "Empty"]);
    expect(p.layers.map((l) => l.lsct)).toEqual([3, 1]);
  });

  it("keeps every section length intact with dividers present", () => {
    // parse() already asserts each declared channel length; these pin the outer sections, which
    // is where a divider record of the wrong size would surface.
    const b = encodePsd(head());
    const p = parse(b);
    expect(p.lamStart + p.lamLen).toBe(p.merged);
    expect(u32(b, p.layerInfoStart + p.layerInfoLen)).toBe(0); // global layer mask info
    expect(parseMerged(b, p.merged, 1, 1).end).toBe(b.length);
  });

  it("throws on an unrecognised node kind rather than dropping it", () => {
    // A silently skipped node produces a VALID psd that is merely missing layers — nothing
    // downstream catches that, which is why the group throw existed in the first place.
    const bogus = { kind: "sublayer", name: "?", opacity: 255, children: [] } as unknown as PsdNode;
    expect(() => encodePsd({ ...doc, nodes: [bogus] })).toThrow(/node kind/i);
  });
});
