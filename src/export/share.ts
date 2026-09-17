/**
 * Save to Files, via the share sheet (`navigator.share` with files). The only way a web page on
 * iPad can put a file somewhere the user picks — Safari has no save picker, and a download always
 * lands in Downloads as a new, possibly renumbered copy. It is still a NEW file each time: whether
 * Files offers to replace a same-named one is up to iPadOS, not this code.
 */

/** Why a share did not complete. `needs-tap`: Safari only opens the sheet during a recent tap, and
 *  building the file took long enough for the tap to expire, so a fresh one is needed. */
export type ShareFailure = "dismissed" | "needs-tap" | "failed";
export type ShareOutcome = "shared" | ShareFailure;

/** iPhone / iPad. iPadOS Safari reports a Mac user agent and `MacIntel`, so a Mac platform with
 *  touch points is an iPad (no Mac has a touch screen). Desktop share sheets have no Save to Files,
 *  which is why the feature is limited to these. */
export function isAppleTouch(ua: string, platform: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1);
}

export function classifyShareError(e: unknown): ShareFailure {
  const name = typeof e === "object" && e !== null ? (e as { name?: unknown }).name : undefined;
  if (name === "AbortError") return "dismissed";
  if (name === "NotAllowedError") return "needs-tap";
  return "failed";
}

/** Whether this device gets the Save to Files option at all. */
export function saveToFilesAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    isAppleTouch(navigator.userAgent, navigator.platform, navigator.maxTouchPoints)
  );
}

/** Whether the share sheet accepts this particular file (type support varies by browser). */
export function canShareFile(file: File): boolean {
  try {
    return navigator.canShare?.({ files: [file] }) ?? false;
  } catch {
    return false;
  }
}

export async function shareFile(file: File): Promise<{ outcome: ShareOutcome; error?: unknown }> {
  try {
    await navigator.share({ files: [file] });
    return { outcome: "shared" };
  } catch (error) {
    return { outcome: classifyShareError(error), error };
  }
}
