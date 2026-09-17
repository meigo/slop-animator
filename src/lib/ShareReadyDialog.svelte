<script lang="ts">
  import { state as appState } from "../state/appState.svelte";
  import { shareFile } from "../export/share";
  import { downloadBlob } from "../export/download";
  import { markProjectSaved, reportShared } from "./deliver-file";

  const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

  // Held while the share sheet is up: a second tap would throw InvalidStateError ("already open").
  let sharing = $state(false);
  // Why the last attempt did not complete. The dialog stays open on anything but success, so the
  // artist can try again or fall back to a download.
  let dismissed = $state(false);

  const ready = $derived(appState.shareReady);

  function close() {
    if (sharing) return;
    if (ready?.isProject) appState.statusHint = "Not saved";
    appState.shareReady = null;
    dismissed = false;
  }

  async function share() {
    if (!ready || sharing) return;
    sharing = true;
    dismissed = false;
    // THIS tap is the fresh activation the direct attempt lacked — call share() before any await.
    const r = await shareFile(ready.file);
    sharing = false;
    if (r.outcome === "shared") {
      reportShared(ready.file, ready.isProject, ready.note);
      appState.shareReady = null;
    } else if (r.outcome === "dismissed") {
      dismissed = true;
      ready.error = "";
    } else {
      ready.error =
        r.outcome === "needs-tap"
          ? "The browser refused to open the share sheet."
          : errText(r.error);
    }
  }

  function download() {
    if (!ready || sharing) return;
    downloadBlob(ready.file, ready.file.name);
    if (ready.isProject) markProjectSaved();
    appState.statusHint = `Downloaded ${ready.file.name}${ready.note ? ` — ${ready.note}` : ""}`;
    appState.shareReady = null;
    dismissed = false;
  }
</script>

{#if ready}
  <div
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
    onclick={close}
    role="presentation"
  >
    <div
      class="bg-surface text-text border border-border rounded-lg p-4 w-80 flex flex-col gap-2 text-sm"
      onclick={(e) => e.stopPropagation()}
      role="presentation"
    >
      <span class="font-semibold">{ready.file.name} is ready</span>
      {#if ready.note}<span class="text-xs text-text-secondary">{ready.note}</span>{/if}
      <button
        class="border border-border rounded py-1 hover:bg-surface-hover disabled:opacity-40"
        disabled={sharing}
        onclick={share}>Save to Files…</button
      >
      <button
        class="border border-border rounded py-1 hover:bg-surface-hover disabled:opacity-40"
        disabled={sharing}
        title="Download to the browser's Downloads, as before"
        onclick={download}>Download instead</button
      >
      <button
        class="border border-border rounded py-1 hover:bg-surface-hover disabled:opacity-40"
        disabled={sharing}
        onclick={close}>Cancel</button
      >
      {#if dismissed}
        <span class="text-xs text-text-secondary">Not saved — the share sheet was closed.</span>
      {/if}
      {#if ready.error}
        <span class="text-xs text-warn">Couldn't share: {ready.error}</span>
      {/if}
      <span class="text-xs text-text-secondary">
        In the share sheet, choose “Save to Files” and pick a folder.
      </span>
    </div>
  </div>
{/if}
