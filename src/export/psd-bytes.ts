/**
 * A small big-endian byte writer for PSD's nested, length-prefixed section format.
 *
 * PSD is a tree of "length, then that many bytes of body" sections. Predicting a section's
 * length by hand is the largest source of unopenable PSD files — Photoshop reports "could not
 * complete your request" with no indication of which section is wrong. `len32`/`len32Even` are
 * the defence: they run the section's writer against a fresh `Bytes`, MEASURE the result, and
 * only then write length-then-body. Every section in the PSD export goes through one of them.
 */
export class Bytes {
  private a: number[] = [];

  u8(v: number) {
    this.a.push(v & 0xff);
    return this;
  }
  u16(v: number) {
    this.a.push((v >> 8) & 0xff, v & 0xff);
    return this;
  }
  u32(v: number) {
    this.a.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
    return this;
  }
  i16(v: number) {
    return this.u16(v < 0 ? v + 0x10000 : v);
  }
  i32(v: number) {
    return this.u32(v < 0 ? v + 0x100000000 : v);
  }
  ascii(s: string) {
    for (const c of s) this.a.push(c.charCodeAt(0) & 0xff);
    return this;
  }
  bytes(b: Uint8Array) {
    for (let i = 0; i < b.length; i++) this.a.push(b[i]);
    return this;
  }

  /**
   * Pascal string (length byte + chars) padded so the TOTAL field length — 1 + chars + pad —
   * is a multiple of 4. This is the layer-record name field's format.
   */
  pascal4(s: string) {
    const t = s.slice(0, 255);
    this.u8(t.length).ascii(t);
    const pad = (4 - ((1 + t.length) % 4)) % 4;
    for (let i = 0; i < pad; i++) this.a.push(0);
    return this;
  }

  /** The 'luni' additional-info block: the real (UTF-16) layer name Photoshop shows. */
  unicodeName(s: string) {
    this.ascii("8BIM").ascii("luni");
    this.len32Even((w) => {
      w.u32(s.length);
      for (const c of s) w.u16(c.charCodeAt(0));
    });
    return this;
  }

  /** Runs `fn` against a fresh writer, measures the result, then writes length-then-body. */
  len32(fn: (w: Bytes) => void) {
    const inner = new Bytes();
    fn(inner);
    const body = inner.build();
    return this.u32(body.length).bytes(body);
  }

  /** Same as `len32`, but pads the body to an even length and counts the pad in the prefix. */
  len32Even(fn: (w: Bytes) => void) {
    const inner = new Bytes();
    fn(inner);
    const body = inner.build();
    const pad = body.length % 2;
    this.u32(body.length + pad).bytes(body);
    if (pad) this.u8(0);
    return this;
  }

  build(): Uint8Array {
    return Uint8Array.from(this.a);
  }
}

/** The 26-byte PSD file header. */
export function psdHeader(width: number, height: number): Uint8Array {
  return new Bytes()
    .ascii("8BPS")
    .u16(1) // version
    .bytes(new Uint8Array(6)) // reserved, must be zero
    .u16(4) // channels: R, G, B, A
    .u32(height) // height BEFORE width — the classic transposition bug
    .u32(width)
    .u16(8) // depth
    .u16(3) // colour mode: RGB
    .build();
}
