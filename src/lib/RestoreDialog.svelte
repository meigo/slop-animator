<script lang="ts">
  // File ▸ Restore autosave… (port of slop-paint's, 2c53625). Also opened by the blank-layers guard
  // in App.svelte, with `blanked` set: autosave is paused until a copy is restored or the blank
  // layers are kept. Listed in `modalOpen`, so app shortcuts stand aside while it is up.
  import { state as appState, autosaveActions } from "../state/appState.svelte";

  const dialog = $derived(appState.restoreDialog);

  function when(t: number): string {
    if (!t) return "time unknown (saved by an older version)";
    const d = new Date(t);
    const mins = Math.round((Date.now() - t) / 60_000);
    const ago = mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : "";
    const sameDay = d.toDateString() === new Date().toDateString();
    const at = sameDay
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleString();
    return ago ? `${at} · ${ago}` : at;
  }

  function close() {
    appState.restoreDialog = null;
  }

  function onKeydown(e: KeyboardEvent) {
    if (!dialog) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  const btn =
    "h-7 shrink-0 rounded border border-border px-2 text-xs text-text hover:bg-surface-hover";
</script>

<svelte:window onkeydown={onKeydown} />

{#if dialog}
  <div
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
    onclick={close}
    role="presentation"
  >
    <div
      class="restore-dialog flex w-96 max-w-[calc(100vw-32px)] flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-sm text-text shadow-lg"
      onclick={(e) => e.stopPropagation()}
      role="presentation"
    >
      <span class="font-semibold">Restore autosave</span>
      {#if dialog.blanked}
        <p class="text-xs/snug text-warn">
          Your drawings went blank — most likely the iPad reclaimed the app's memory while it was in
          the background. Autosave is paused, so the copies below are untouched.
        </p>
      {/if}
      {#if dialog.entries.length === 0}
        <p class="text-xs text-text-secondary">No autosaved copies yet.</p>
      {:else}
        <ul class="flex flex-col gap-1">
          {#each dialog.entries as entry (entry.key)}
            <li class="flex items-center gap-2 rounded border border-border px-2 py-1.5">
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-xs text-text">
                  {entry.projectName || "Autosave"}{entry.key === "autosave"
                    ? " — latest"
                    : entry.key === "autosave-kept"
                      ? " — set aside when the drawings went blank"
                      : ""}
                </span>
                <span class="text-[11px] text-text-muted">
                  {when(entry.savedAt)}{entry.layerCount
                    ? ` · ${entry.inkedCount} of ${entry.layerCount} layers with drawings`
                    : ""}
                </span>
              </div>
              <button
                class={btn}
                title="Replace the project with this copy (the current one isn't kept — use File ▸ Save first if you want it)"
                onclick={() => autosaveActions.restore?.(entry)}>Restore</button
              >
            </li>
          {/each}
        </ul>
      {/if}
      <p class="text-[11px] text-text-muted">
        Restoring replaces the current project and clears undo.
      </p>
      <div class="flex justify-end gap-2">
        {#if dialog.blanked}
          <button
            class={btn}
            title="Keep working on the blank layers; the last good copy is set aside and stays in this list"
            onclick={() => autosaveActions.keep?.()}>Keep the blank layers</button
          >
        {/if}
        <button
          class={btn}
          title={dialog.blanked
            ? "Close — autosave stays paused until you restore or keep"
            : "Close"}
          onclick={close}>Close</button
        >
      </div>
    </div>
  </div>
{/if}
