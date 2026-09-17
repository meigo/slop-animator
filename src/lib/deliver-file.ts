import { state as appState } from "../state/appState.svelte";
import { canShareFile, shareFile } from "../export/share";
import { downloadBlob } from "../export/download";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A project file reached the user (share sheet or download). Same rule as a plain Save: retire the
 *  autosave warning, except the one saying autosave is off for the session. */
export function markProjectSaved(): void {
  if (!appState.autosaveOff) appState.persistAlert = "";
}

/**
 * Send a finished file toward Save to Files. The caller has already checked
 * `saveToFilesAvailable()`.
 *
 * - The browser won't share this file type → it downloads as before (`"downloaded"`).
 * - `tryDirect`: open the sheet now, riding the tap that started the build. That only works while
 *   Safari still counts the tap, so an expired one (or any other error) falls through to the ready
 *   dialog, where a fresh tap opens the sheet. Exports pass false: a render always outlasts the tap.
 *
 * `shared` means the sheet completed, NOT that the file reached Files — AirDrop and Copy complete it
 * too — so the status line says "sent to the share sheet", never "saved".
 */
export async function deliverToFiles(
  file: File,
  { isProject, tryDirect, note = "" }: { isProject: boolean; tryDirect: boolean; note?: string },
): Promise<"shared" | "dismissed" | "ready" | "downloaded"> {
  if (!canShareFile(file)) {
    downloadBlob(file, file.name);
    if (isProject) markProjectSaved();
    return "downloaded";
  }
  let error = "";
  if (tryDirect) {
    const r = await shareFile(file);
    if (r.outcome === "shared") {
      reportShared(file, isProject, note);
      return "shared";
    }
    if (r.outcome === "dismissed") {
      appState.statusHint = `Not saved — the share sheet was closed`;
      return "dismissed";
    }
    if (r.outcome === "failed") error = errText(r.error);
  }
  appState.statusHint = `${file.name} is ready`;
  appState.shareReady = { file, isProject, note, error };
  return "ready";
}

export function reportShared(file: File, isProject: boolean, note: string): void {
  if (isProject) markProjectSaved();
  appState.statusHint = `Sent ${file.name} to the share sheet${note ? ` — ${note}` : ""}`;
}
