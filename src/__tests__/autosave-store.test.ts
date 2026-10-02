import { describe, it, expect, vi, beforeEach } from "vitest";

// The KV store as a Map; a project "encodes" to a blob tagged with its revision.
const kv = new Map<string, unknown>();
const pruned: Set<string>[] = [];
vi.mock("../persist/project-file", () => ({
  saveProjectBlob: (p: { rev: number }) => Promise.resolve(new Blob([], { type: String(p.rev) })),
  loadProjectBlob: (b: Blob) => Promise.resolve({ rev: Number(b.type) }),
  referencedMediaIds: (layers: { mediaId?: string }[]) =>
    new Set(layers.filter((l) => l.mediaId).map((l) => l.mediaId as string)),
}));
vi.mock("../persist/db", () => ({
  KV_STORE: "kv",
  idbDo: (_s: string, _m: string, f: (s: unknown) => { result?: unknown }) =>
    Promise.resolve(
      f({
        put: (v: unknown, k: string) => (kv.set(k, v), {}),
        get: (k: string) => ({ result: kv.get(k) }),
        delete: (k: string) => (kv.delete(k), {}),
        count: (k: string) => ({ result: kv.has(k) ? 1 : 0 }),
      }).result,
    ),
}));
vi.mock("../persist/media-store", () => ({
  pruneMedia: (keep: Set<string>) => (pruned.push(keep), Promise.resolve()),
}));

const store = await import("../persist/autosave");
const MIN = 60_000;
const doc = (rev: number, ...mediaIds: string[]) =>
  ({ rev, layers: mediaIds.map((mediaId) => ({ mediaId })) }) as never;
const layersOf = (...mediaIds: string[]) => mediaIds.map((mediaId) => ({ mediaId })) as never;
const meta = (savedAt: number) => ({ savedAt, projectName: "p", layerCount: 2, inkedCount: 1 });
const blobRev = (k: string) => Number((kv.get(k) as Blob).type);

describe("autosave storage", () => {
  beforeEach(() => {
    kv.clear();
    pruned.length = 0;
  });

  it("stores the latest with its meta, media ids read from the project", async () => {
    await store.saveAutosave(doc(1, "m1"), meta(0));
    expect(blobRev("autosave")).toBe(1);
    expect(kv.get("autosave-meta")).toEqual({ ...meta(0), mediaIds: ["m1"] });
  });

  it("makes a checkpoint at the first save and every 5 minutes after, keeping 3", async () => {
    for (const [rev, t] of [
      [1, 0],
      [2, 2 * MIN], // too soon: latest only
      [3, 5 * MIN],
      [4, 10 * MIN],
      [5, 15 * MIN], // reuses the oldest's slot
    ])
      await store.saveAutosave(doc(rev), meta(t));
    expect(blobRev("autosave")).toBe(5);
    expect([0, 1, 2].map((i) => blobRev(`autosave-cp-${i}`))).toEqual([5, 3, 4]);
    const list = await store.listAutosaves();
    expect(list.map((e) => [e.key, e.savedAt / MIN])).toEqual([
      ["autosave", 15],
      ["autosave-cp-0", 15],
      ["autosave-cp-2", 10],
      ["autosave-cp-1", 5],
    ]);
  });

  it("loads any stored copy by key", async () => {
    await store.saveAutosave(doc(7), meta(0));
    await store.saveAutosave(doc(8), meta(MIN));
    expect(await store.loadAutosave(1, "autosave-cp-0")).toEqual({ rev: 7 });
    expect(await store.loadAutosave(1)).toEqual({ rev: 8 });
    expect(await store.loadAutosave(1, "autosave-kept")).toBeNull();
  });

  it("sets the latest aside as the kept copy, where later saves can't reach it", async () => {
    await store.saveAutosave(doc(1, "m1"), meta(0));
    await store.keepLatestAutosave();
    await store.saveAutosave(doc(2), meta(MIN));
    expect(blobRev("autosave-kept")).toBe(1);
    const kept = (await store.listAutosaves()).find((e) => e.key === "autosave-kept");
    expect(kept?.mediaIds).toEqual(["m1"]);
  });

  it("New forgets only the latest: the kept copy and the checkpoints stay", async () => {
    await store.saveAutosave(doc(1), meta(0));
    await store.keepLatestAutosave();
    await store.clearAutosave();
    expect(kv.has("autosave")).toBe(false);
    expect(kv.has("autosave-meta")).toBe(false);
    expect((await store.listAutosaves()).map((e) => e.key).sort()).toEqual([
      "autosave-cp-0",
      "autosave-kept",
    ]);
  });

  it("lists a latest saved before metas existed, without details", async () => {
    kv.set("autosave", new Blob([], { type: "1" }));
    expect(await store.listAutosaves()).toEqual([
      { key: "autosave", savedAt: 0, projectName: "", layerCount: 0, inkedCount: 0, mediaIds: [] },
    ]);
  });

  it("media pruning keeps what the project and every stored copy reference", async () => {
    await store.saveAutosave(doc(1, "old"), meta(0)); // latest + checkpoint
    await store.keepLatestAutosave();
    await store.saveAutosave(doc(2, "mid"), meta(MIN)); // latest only
    await store.pruneUnusedMedia(layersOf("live"));
    expect([...pruned[0]].sort()).toEqual(["live", "mid", "old"]);
  });

  it("media pruning stands down when the document is replaced while it reads the list", async () => {
    const { bumpPersistGeneration } = await import("../persist/generation");
    const p = store.pruneUnusedMedia(layersOf("live"));
    bumpPersistGeneration();
    await p;
    expect(pruned).toEqual([]);
  });
});
