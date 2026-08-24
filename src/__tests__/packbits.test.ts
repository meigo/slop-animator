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
  it("round-trips a repeat run", () =>
    expect(rt(new Array(10).fill(7))).toEqual(new Array(10).fill(7)));
  it("round-trips a single byte", () => expect(rt([9])).toEqual([9]));
  it("round-trips an empty row", () => expect(rt([])).toEqual([]));

  // The awkward cases: a repeat run encodes at most 128 bytes, a literal run at most 128.
  it("splits a repeat longer than 128", () =>
    expect(rt(new Array(300).fill(3))).toEqual(new Array(300).fill(3)));
  it("splits a literal longer than 128", () => {
    const a = Array.from({ length: 300 }, (_, i) => i % 251); // no run of 3+
    expect(rt(a)).toEqual(a);
  });
  it("round-trips exactly 128 identical bytes", () =>
    expect(rt(new Array(128).fill(1))).toEqual(new Array(128).fill(1)));
  it("round-trips a full-width alpha row of zeros", () =>
    expect(rt(new Array(1920).fill(0))).toEqual(new Array(1920).fill(0)));

  it("actually compresses a flat row", () => {
    expect(packBits(Uint8Array.from(new Array(1920).fill(0))).length).toBeLessThan(64);
  });
  it("never emits the 128 no-op byte", () => {
    // i % 256 would legitimately hit the data value 128 at i=128/384 — a real byte value
    // (e.g. mid-gray) that a correct encoder must reproduce in its output. The assertion below
    // is about the CONTROL byte (no PackBits op header may be 128), not about data, so the
    // generator swaps that one colliding value out to keep the two concerns from tangling.
    const a = Array.from({ length: 500 }, (_, i) =>
      i % 7 === 0 ? 5 : i % 256 === 128 ? 200 : i % 256,
    );
    expect(Array.from(packBits(Uint8Array.from(a)))).not.toContain(128);
  });
});
