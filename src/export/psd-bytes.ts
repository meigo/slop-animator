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
  // A GROWABLE Uint8Array, not a number[]. The difference is not stylistic at this feature's
  // sizes: a PSD of a 1920x1080 frame runs to tens of megabytes, and a number[] holds every byte
  // as a boxed element (~8x the memory) before `Uint8Array.from` copies the lot — hundreds of MB
  // transient on the device the 1x document-scale work exists to protect. `bytes()` matters most:
  // it is the path every packed channel row takes, and a bulk `set` replaces a push per byte.
  private buf = new Uint8Array(1024);
  private n = 0;

  /** Ensure room for `need` more bytes, doubling so appends stay amortised O(1). */
  private room(need: number) {
    if (this.n + need <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.n + need) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.n));
    this.buf = next;
  }

  u8(v: number) {
    this.room(1);
    this.buf[this.n++] = v & 0xff;
    return this;
  }
  u16(v: number) {
    this.room(2);
    this.buf[this.n++] = (v >> 8) & 0xff;
    this.buf[this.n++] = v & 0xff;
    return this;
  }
  u32(v: number) {
    this.room(4);
    this.buf[this.n++] = (v >>> 24) & 0xff;
    this.buf[this.n++] = (v >>> 16) & 0xff;
    this.buf[this.n++] = (v >>> 8) & 0xff;
    this.buf[this.n++] = v & 0xff;
    return this;
  }
  i16(v: number) {
    return this.u16(v < 0 ? v + 0x10000 : v);
  }
  i32(v: number) {
    return this.u32(v < 0 ? v + 0x100000000 : v);
  }
  ascii(s: string) {
    this.room(s.length);
    for (let i = 0; i < s.length; i++) this.buf[this.n++] = s.charCodeAt(i) & 0xff;
    return this;
  }
  bytes(b: Uint8Array) {
    this.room(b.length);
    this.buf.set(b, this.n);
    this.n += b.length;
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
    for (let i = 0; i < pad; i++) this.u8(0);
    return this;
  }

  /**
   * The 'luni' additional-info block: the real (UTF-16) layer name Photoshop shows.
   * Iterates UTF-16 CODE UNITS (`s.length`/`charCodeAt`), not code points — `for...of` over a
   * string yields code points, which would split an astral character's surrogate pair and write
   * only its high half while the declared count (`s.length`) still counted both units, corrupting
   * the block for any layer name containing one (e.g. an emoji, reachable from iPad's keyboard).
   */
  unicodeName(s: string) {
    this.ascii("8BIM").ascii("luni");
    this.len32Even((w) => {
      w.u32(s.length);
      for (let i = 0; i < s.length; i++) w.u16(s.charCodeAt(i));
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

  /** A COPY, not a view: callers keep the result while this writer may keep growing (every
   *  `len32` does exactly that), and a `subarray` would alias a buffer about to be reallocated. */
  build(): Uint8Array {
    return this.buf.slice(0, this.n);
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
