import { describe, it, expect, vi, beforeEach } from "vitest";

// The KV store as a Map; a project "encodes" to a blob tagged with its revision.
const kv = new Map<string, unknown>();
const pruned: Set<string>[] = [];
/** The keys each IndexedDB transaction wrote, in order. */
const txs: string[][] = [];
/** Puts to these keys throw (a full disk, say). */
const failing = new Set<string>();
const order: string[] = [];
vi.mock("../persist/project-file", () => ({
  saveProjectBlob: (p: { rev: number }) => {
    order.push("encode");
    return Promise.resolve(new Blob([], { type: String(p.rev) }));
  },
  loadProjectBlob: (b: Blob) => Promise.resolve({ rev: Number(b.type) }),
  referencedMediaIds: (layers: { mediaId?: string }[]) =>
    new Set(layers.filter((l) => l.mediaId).map((l) => l.mediaId as string)),
}));
vi.mock("../persist/db", () => ({
  KV_STORE: "kv",
  // One call = one transaction: its writes land together, or (a put throws) none of them do.
  idbDo: (_s: string, _m: string, f: (s: unknown) => { result?: unknown }) =>
    Promise.resolve().then(() => {
      const staged = new Map<string, unknown>();
      const DEL = Symbol("del");
      const wrote: string[] = [];
      const r = f({
        put: (v: unknown, k: string) => {
          if (failing.has(k)) throw new Error(`put ${k} failed`);
          wrote.push(k);
          return (staged.set(k, v), {});
        },
        get: (k: string) => ({ result: kv.get(k) }),
        delete: (k: string) => (wrote.push(k), staged.set(k, DEL), {}),
        count: (k: string) => ({ result: kv.has(k) ? 1 : 0 }),
      }).result;
      for (const [k, v] of staged)
        if (v === DEL) kv.delete(k);
        else kv.set(k, v);
      if (wrote.length) txs.push(wrote);
      return r;
    }),
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
/** A save whose description is fixed (the guard always passes). */
const save = (d: never, m: ReturnType<typeof meta>) => store.saveAutosave(d, { describe: () => m });

describe("autosave storage", () => {
  beforeEach(() => {
    kv.clear();
    pruned.length = 0;
    txs.length = 0;
    failing.clear();
    order.length = 0;
  });

  it("stores the latest with its meta, media ids read from the project", async () => {
    await save(doc(1, "m1"), meta(0));
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
      await save(doc(rev), meta(t));
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
    await save(doc(7), meta(0));
    await save(doc(8), meta(MIN));
    expect(await store.loadAutosave(1, "autosave-cp-0")).toEqual({ rev: 7 });
    expect(await store.loadAutosave(1)).toEqual({ rev: 8 });
    expect(await store.loadAutosave(1, "autosave-kept")).toBeNull();
  });

  it("sets the latest aside as the kept copy, where later saves can't reach it", async () => {
    await save(doc(1, "m1"), meta(0));
    await store.keepLatestAutosave([] as never);
    await save(doc(2), meta(MIN));
    expect(blobRev("autosave-kept")).toBe(1);
    const kept = (await store.listAutosaves()).find((e) => e.key === "autosave-kept");
    expect(kept?.mediaIds).toEqual(["m1"]);
  });

  it("New forgets only the latest: the kept copy and the checkpoints stay", async () => {
    await save(doc(1), meta(0));
    await store.keepLatestAutosave([] as never);
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
    await save(doc(1, "old"), meta(0)); // latest + checkpoint
    await store.keepLatestAutosave([] as never);
    await save(doc(2, "mid"), meta(MIN)); // latest only
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

  // ── Fix pass (final review of the branch) ──

  it("C1: the guard is asked AFTER the encode, and a 'no' writes nothing", async () => {
    const r = store.saveAutosave(doc(1), {
      describe: () => (order.push("describe"), null),
    });
    await r;
    expect(order).toEqual(["encode", "describe"]);
    expect([...kv.keys()]).toEqual([]); // no latest, meta or checkpoint
  });

  it("C1: the meta (inked count) is the one described at write time", async () => {
    let inked = 3;
    const p = store.saveAutosave(doc(1), {
      describe: () => ({ ...meta(0), inkedCount: inked }),
    });
    inked = 0; // the drawings changed while it encoded
    await p;
    expect((kv.get("autosave-meta") as { inkedCount: number }).inkedCount).toBe(0);
  });

  it("I5: a blob and its meta, and a checkpoint and its list, land in one transaction", async () => {
    await save(doc(1), meta(0));
    expect(txs).toContainEqual(["autosave", "autosave-meta"]);
    expect(txs).toContainEqual(["autosave-cp-0", "autosave-checkpoints"]);
  });

  it("I5: a failed checkpoint is reported on its own; the latest still counts as saved", async () => {
    failing.add("autosave-cp-0");
    const errors: unknown[] = [];
    await store.saveAutosave(doc(1), {
      describe: () => meta(0),
      onCheckpointError: (e) => errors.push(e),
    });
    expect(blobRev("autosave")).toBe(1);
    expect(errors.length).toBe(1);
    expect(kv.has("autosave-checkpoints")).toBe(false); // not listed without its blob
  });

  it("C3: shelving the latest puts it in the rotation now, dropping only the oldest", async () => {
    for (const t of [0, 5, 10]) await save(doc(t), meta(t * MIN));
    await save(doc(12), meta(12 * MIN)); // latest only: too soon for a checkpoint
    await store.shelveLatestAutosave([] as never);
    const list = await store.listAutosaves();
    expect(
      list.filter((e) => e.key.startsWith("autosave-cp-")).map((e) => e.savedAt / MIN),
    ).toEqual([12, 10, 5]);
    const shelved = list.find((e) => e.key.startsWith("autosave-cp-") && e.savedAt === 12 * MIN)!;
    expect(blobRev(shelved.key)).toBe(12);
  });

  it("C3: a latest that already is the newest checkpoint is not stored twice", async () => {
    await save(doc(1), meta(MIN)); // latest + cp-0, same save
    await store.shelveLatestAutosave([] as never);
    expect((await store.listAutosaves()).map((e) => e.key)).toEqual(["autosave", "autosave-cp-0"]);
  });

  it("C3/C4: a latest from before metas is shelved too, with a placeholder meta", async () => {
    kv.set("autosave", new Blob([], { type: "7" }));
    await store.shelveLatestAutosave(layersOf("m1"));
    const cp = (await store.listAutosaves()).find((e) => e.key === "autosave-cp-0");
    expect(cp).toMatchObject({ savedAt: 0, projectName: "", layerCount: 0, mediaIds: ["m1"] });
    expect(blobRev("autosave-cp-0")).toBe(7);
  });

  it("C4: keeping a latest from before metas copies it anyway, listed and protected", async () => {
    kv.set("autosave", new Blob([], { type: "7" }));
    await store.keepLatestAutosave(layersOf("m1"));
    expect(blobRev("autosave-kept")).toBe(7);
    const kept = (await store.listAutosaves()).find((e) => e.key === "autosave-kept");
    expect(kept).toMatchObject({ savedAt: 0, inkedCount: 0, mediaIds: ["m1"] });
  });

  it("I1: a second set-aside moves the first kept copy into the rotation instead of losing it", async () => {
    await save(doc(1), meta(0)); // cp-0
    await store.keepLatestAutosave([] as never); // kept = rev 1
    await save(doc(2), meta(MIN)); // latest only
    await store.keepLatestAutosave([] as never); // kept = rev 2; rev 1 must survive
    expect(blobRev("autosave-kept")).toBe(2);
    const cps = (await store.listAutosaves()).filter((e) => e.key.startsWith("autosave-cp-"));
    expect(cps.map((e) => blobRev(e.key)).sort()).toEqual([1, 1]);
  });
});
