/** How long the object URL is kept alive after the click. Revoking it in the same tick is what the
 *  MDN example does, but the browser only has to have STARTED the fetch by then — on iPad, with a
 *  multi-hundred-MB project zip, an immediate revoke can kill the download it just began. This is
 *  the data lifeline path, so it holds the URL (and the blob's memory) for a minute instead. */
const REVOKE_DELAY_MS = 60_000;

/** Trigger a browser download of `blob` as `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
