/** Bumped when the live document is replaced (New/Open/restore) or a newer persist starts.
 *  In-flight encode/put/prune that captured an older generation must drop their result. */
let gen = 0;

export function persistGeneration(): number {
  return gen;
}

export function bumpPersistGeneration(): void {
  gen++;
}
