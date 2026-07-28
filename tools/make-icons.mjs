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
