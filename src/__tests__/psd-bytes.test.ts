import { describe, it, expect } from "vitest";
import { Bytes, psdHeader } from "../export/psd-bytes";

const str = (b: Uint8Array, o: number, n: number) =>
  String.fromCharCode(...Array.from(b.slice(o, o + n)));
const u32 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset).getUint32(o);
const u16 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset).getUint16(o);
const i16 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset).getInt16(o);
const i32 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset).getInt32(o);

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

  it("does not transpose width and height for a non-square document", () => {
    // A square or swapped-round-number canvas wouldn't catch a transposition bug; this would.
    const h = psdHeader(37, 501);
    expect(u32(h, 14)).toBe(501); // height
    expect(u32(h, 18)).toBe(37); // width
  });

  it("reserved 6 bytes after the signature/version are all zero", () => {
    const h = psdHeader(10, 10);
    for (let i = 6; i < 12; i++) expect(h[i]).toBe(0);
  });
});

describe("Bytes primitives", () => {
  it("u8/u16/u32 write big-endian", () => {
    const b = new Bytes().u8(0xab).u16(0x1234).u32(0x89abcdef);
    const out = b.build();
    expect(Array.from(out)).toEqual([0xab, 0x12, 0x34, 0x89, 0xab, 0xcd, 0xef]);
  });

  it("i16 writes a negative value as its two's-complement big-endian bytes", () => {
    const out = new Bytes().i16(-1).build();
    expect(Array.from(out)).toEqual([0xff, 0xff]);
    expect(i16(out, 0)).toBe(-1);
  });

  it("i32 writes a negative value as its two's-complement big-endian bytes", () => {
    const out = new Bytes().i32(-2).build();
    expect(i32(out, 0)).toBe(-2);
  });

  it("ascii and bytes append raw content in order", () => {
    const out = new Bytes()
      .ascii("hi")
      .bytes(Uint8Array.from([1, 2, 3]))
      .build();
    expect(Array.from(out)).toEqual([0x68, 0x69, 1, 2, 3]);
  });

  it("chains and accumulates across calls", () => {
    const out = new Bytes().u8(1).u8(2).u8(3).build();
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });
});

describe("Bytes.len32", () => {
  it("prefixes the MEASURED length, not a predicted one", () => {
    const b = new Bytes();
    b.len32((w) => {
      w.ascii("abcd");
      w.u16(1);
    });
    const out = b.build();
    expect(u32(out, 0)).toBe(6);
    expect(out.length).toBe(10);
  });

  it("measures a body whose length is not a round number, so an off-by-one shows", () => {
    const b = new Bytes();
    b.len32((w) => w.ascii("a".repeat(37)));
    const out = b.build();
    expect(u32(out, 0)).toBe(37);
    expect(out.length).toBe(41);
    expect(str(out, 4, 37)).toBe("a".repeat(37));
  });

  it("nests correctly — an outer len32 measures an inner len32's full prefixed size", () => {
    const b = new Bytes();
    b.len32((w) => {
      w.u8(0xff);
      w.len32((inner) => inner.ascii("xyz")); // 4-byte prefix + 3 bytes = 7
    });
    const out = b.build();
    expect(u32(out, 0)).toBe(8); // 1 (u8) + 7 (inner len32 block)
    expect(u32(out, 5)).toBe(3); // inner length prefix
    expect(str(out, 9, 3)).toBe("xyz");
  });

  it("nests three deep, matching how later tasks actually nest sections (layer-and-mask -> layer info -> per-layer extra data)", () => {
    const b = new Bytes();
    b.len32((outer) => {
      outer.u8(0x01);
      outer.len32((mid) => {
        mid.u8(0x02);
        mid.len32((inner) => inner.ascii("nested")); // 4-byte prefix + 6 bytes = 10
      });
    });
    const out = b.build();
    // outer body = 1 (u8) + [4 (mid's own prefix) + mid body]
    // mid body = 1 (u8) + 10 (inner len32 block) = 11
    expect(u32(out, 0)).toBe(1 + 4 + 11); // outer prefix = 16
    expect(u32(out, 5)).toBe(11); // mid prefix
    expect(u32(out, 10)).toBe(6); // inner prefix
    expect(str(out, 14, 6)).toBe("nested");
    expect(out.length).toBe(4 + 16); // outer prefix + outer body
  });

  it("writes a zero length prefix for an empty body, with no trailing bytes", () => {
    const b = new Bytes();
    b.len32(() => {});
    const out = b.build();
    expect(u32(out, 0)).toBe(0);
    expect(out.length).toBe(4);
  });

  it("leaves the outer writer untouched by mutations inside fn's own writer only", () => {
    const b = new Bytes().u8(0x11);
    b.len32((w) => w.ascii("q"));
    b.u8(0x22);
    const out = b.build();
    expect(Array.from(out)).toEqual([0x11, 0, 0, 0, 1, 0x71, 0x22]);
  });
});

describe("Bytes.len32Even", () => {
  it("pads an odd body to an even length and counts the pad in the prefix", () => {
    const b = new Bytes();
    b.len32Even((w) => w.ascii("abc"));
    const out = b.build();
    expect(u32(out, 0)).toBe(4); // 3 real bytes + 1 pad byte
    expect(out.length).toBe(8);
    expect(out[7]).toBe(0); // the pad byte itself
  });

  it("does not pad a body that is already even, and the length stays exact", () => {
    const b = new Bytes();
    b.len32Even((w) => w.ascii("abcd"));
    const out = b.build();
    expect(u32(out, 0)).toBe(4);
    expect(out.length).toBe(8);
  });

  it("pads a non-round odd length correctly, not just the 3-byte case", () => {
    const b = new Bytes();
    b.len32Even((w) => w.ascii("a".repeat(41)));
    const out = b.build();
    expect(u32(out, 0)).toBe(42); // 41 + 1 pad
    expect(out.length).toBe(46); // 4-byte prefix + 42
    expect(out[45]).toBe(0);
  });
});

describe("Bytes.pascal4", () => {
  it("pads name + length byte to a multiple of 4 (2-char case)", () => {
    const b = new Bytes();
    b.pascal4("ab"); // 1 + 2 = 3 -> pad to 4
    const out = b.build();
    expect(out.length).toBe(4);
    expect(out[0]).toBe(2); // length byte
    expect(str(out, 1, 2)).toBe("ab");
    expect(out[3]).toBe(0); // pad byte
  });

  it("adds no padding when 1 + length is already a multiple of 4 (3-char case)", () => {
    const b = new Bytes();
    b.pascal4("abc"); // 1 + 3 = 4 -> no pad
    const out = b.build();
    expect(out.length).toBe(4);
    expect(out[0]).toBe(3);
    expect(str(out, 1, 3)).toBe("abc");
  });

  it("pads a longer name correctly, not just the short cases (5-char case)", () => {
    const b = new Bytes();
    b.pascal4("abcde"); // 1 + 5 = 6 -> pad to 8
    const out = b.build();
    expect(out.length).toBe(8);
    expect(out[0]).toBe(5);
    expect(str(out, 1, 5)).toBe("abcde");
    expect(out[6]).toBe(0);
    expect(out[7]).toBe(0);
  });

  it("handles an empty name (1 + 0 = 1 -> pad to 4)", () => {
    const b = new Bytes();
    b.pascal4("");
    const out = b.build();
    expect(out.length).toBe(4);
    expect(out[0]).toBe(0);
  });

  it("three consecutive calls with DIFFERENT pad amounts (2, 1, 0 bytes) each pad independently — a carried-over pad counter would compound and misplace every field after the first", () => {
    const b = new Bytes();
    b.pascal4("a"); // 1 + 1 = 2 -> pad 2 -> 4 bytes
    b.pascal4("ab"); // 1 + 2 = 3 -> pad 1 -> 4 bytes
    b.pascal4("abc"); // 1 + 3 = 4 -> pad 0 -> 4 bytes
    const out = b.build();
    expect(out.length).toBe(12);
    expect(out[0]).toBe(1);
    expect(str(out, 1, 1)).toBe("a");
    expect(out[4]).toBe(2);
    expect(str(out, 5, 2)).toBe("ab");
    expect(out[8]).toBe(3);
    expect(str(out, 9, 3)).toBe("abc");
  });

  it("truncates a name past 255 chars, and the field length stays a multiple of 4 at the boundary (never negative padding)", () => {
    const b = new Bytes();
    b.pascal4("x".repeat(300)); // truncated to 255; 1 + 255 = 256, already a multiple of 4
    const out = b.build();
    expect(out.length).toBe(256);
    expect(out[0]).toBe(255); // length byte reflects the TRUNCATED length, not 300
    expect(str(out, 1, 255)).toBe("x".repeat(255));

    const b2 = new Bytes();
    b2.pascal4("y".repeat(254)); // truncation not needed here, but 1 + 254 = 255 -> pad 1
    const out2 = b2.build();
    expect(out2.length).toBe(256);
    expect(out2[0]).toBe(254);
    expect(out2[255]).toBe(0); // the single pad byte
  });
});

describe("Bytes.unicodeName", () => {
  it("writes a UTF-16BE luni block", () => {
    const b = new Bytes();
    b.unicodeName("hi");
    const out = b.build();
    expect(str(out, 0, 4)).toBe("8BIM");
    expect(str(out, 4, 4)).toBe("luni");
    expect(u32(out, 12)).toBe(2); // char count
    expect(u16(out, 16)).toBe(0x0068); // 'h'
    expect(u16(out, 18)).toBe(0x0069); // 'i'
  });

  it("the len32Even length prefix covers exactly the char-count field plus the UTF-16 chars", () => {
    const b = new Bytes();
    b.unicodeName("odd"); // 3 chars: 4 (count) + 6 (utf16) = 10, even already
    const out = b.build();
    // "8BIM" (4) + "luni" (4) + len32Even prefix (4) + body
    expect(u32(out, 8)).toBe(10);
    expect(out.length).toBe(8 + 4 + 10);
  });

  it("writes an astral character as a surrogate PAIR, not a single truncated halfword", () => {
    // "hi\u{1F600}" is 4 UTF-16 code units (h, i, and a surrogate pair for the emoji) but
    // only 3 code points. A `for...of` loop over the string iterates code points, dropping the
    // low surrogate, while `s.length` (used for the declared count) still counts both halves.
    // That mismatch is the bug: the count and the data must agree, and the surrogate pair must
    // survive intact.
    const s = "hi\u{1F600}";
    expect(s.length).toBe(4); // 'h', 'i', high surrogate, low surrogate
    const b = new Bytes();
    b.unicodeName(s);
    const out = b.build();
    const count = u32(out, 12);
    expect(count).toBe(4); // declared count matches code UNITS, not code points
    expect(u16(out, 16)).toBe(0x0068); // 'h'
    expect(u16(out, 18)).toBe(0x0069); // 'i'
    expect(u16(out, 20)).toBe(0xd83d); // high surrogate
    expect(u16(out, 22)).toBe(0xde00); // low surrogate
    // The number of halfwords actually written after the count field matches the declared count.
    // body = 4 (count) + count * 2 bytes; the len32Even prefix at offset 8 covers that whole body.
    const bodyLen = u32(out, 8);
    expect(bodyLen).toBe(4 + count * 2);
  });
});
