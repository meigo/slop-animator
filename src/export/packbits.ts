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
      const same = i + 2 < row.length && row[i] === row[i + 1] && row[i] === row[i + 2];
      if (same) break;
      i++;
      lit++;
    }
    out.push(lit - 1);
    for (let k = start; k < start + lit; k++) out.push(row[k]);
  }
  return Uint8Array.from(out);
}
