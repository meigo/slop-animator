/**
 * The contract both exporters share for reporting progress and being stopped.
 *
 * `AbortSignal` rather than a bespoke flag: it is the platform idiom, it composes with anything
 * else that might want to stop a render later, and `signal.aborted` is a free check inside a loop.
 */
export interface ExportProgress {
  signal?: AbortSignal;
  /** Called once per finished frame, 1-based. Both exporters also report the finalising phase by
   *  calling with `done === total` before the container is assembled. */
  onProgress?: (done: number, total: number) => void;
}

/** The rejection a cancelled export throws. `name` is what callers branch on, so a cancel reads as
 *  "Cancelled" rather than a failure — the two mean very different things to whoever pressed it. */
export function abortError(): DOMException {
  return new DOMException("Export cancelled", "AbortError");
}

export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

/**
 * Hand the event loop a turn between frames.
 *
 * Without this the export is invisible and uncancellable, however good the rest of the plumbing is:
 * awaiting a promise that settles on a MICROTASK never lets the browser paint or deliver a click,
 * so the progress bar would jump straight from 0 to 100 at the end and the Cancel button could not
 * be pressed. `setTimeout` is a macrotask, which yields both. Its ~4ms clamp is small beside the
 * tens of ms a 1920×1080 frame costs to render and encode, so the overhead stays proportionally
 * small and — unlike a rAF-based yield — does not scale with the display's refresh rate.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}
