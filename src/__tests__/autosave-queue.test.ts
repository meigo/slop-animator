import { describe, it, expect, vi, beforeEach } from "vitest";

// Encoding is slow and resolved by hand; each write records which document state it stored.
const encodes: { project: { rev: number }; resolve: (b: Blob) => void }[] = [];
const writes: number[] = [];
vi.mock("../persist/project-file", () => ({
  saveProjectBlob: (project: { rev: number }) =>
    new Promise<Blob>((resolve) => encodes.push({ project, resolve })),
  loadProjectBlob: () => null,
  referencedMediaIds: () => new Set<string>(),
}));
// Only the latest slot's blob writes are recorded; meta and checkpoint keys are read back as empty.
vi.mock("../persist/db", () => ({
  KV_STORE: "kv",
  idbDo: (_s: string, _m: string, f: (s: unknown) => { result?: unknown }) =>
    Promise.resolve(
      f({
        put: (v: unknown, key: string) => {
          if (key === "autosave") writes.push(Number((v as Blob).type));
          return {};
        },
        get: () => ({ result: undefined }),
      }).result,
    ),
}));

const { saveAutosave } = await import("../persist/autosave");
const { bumpPersistGeneration } = await import("../persist/generation");
const META = { savedAt: 0, projectName: "p", layerCount: 1, inkedCount: 1 };
const flush = () => new Promise((r) => setTimeout(r, 0));
/** Finish the oldest pending encode, as a blob tagged with the document's revision AT THAT TIME. */
const finishEncode = async () => {
  const e = encodes.shift()!;
  e.resolve(new Blob([], { type: String(e.project.rev) }));
  await flush();
};

describe("autosave runs one save at a time", () => {
  beforeEach(async () => {
    while (encodes.length) await finishEncode();
    writes.length = 0;
  });

  it("an edit during a slow save queues a follow-up instead of dropping the save", async () => {
    const doc = { rev: 1 } as never as { rev: number };
    void saveAutosave(doc as never, META);
    doc.rev = 2;
    void saveAutosave(doc as never, META); // arrives mid-encode — used to supersede the first
    doc.rev = 3;
    void saveAutosave(doc as never, META); // coalesces with the queued follow-up
    expect(encodes.length).toBe(1); // nothing encodes in parallel
    await finishEncode();
    expect(writes).toEqual([3]); // the first save reached the store (the doc was at rev 3 by then)
    expect(encodes.length).toBe(1); // exactly one follow-up
    await finishEncode();
    expect(writes).toEqual([3, 3]);
    expect(encodes.length).toBe(0);
  });

  it("keeps writing while edits keep arriving faster than an encode", async () => {
    const doc = { rev: 0 };
    void saveAutosave(doc as never, META);
    for (let i = 1; i <= 5; i++) {
      doc.rev = i;
      void saveAutosave(doc as never, META);
      await finishEncode();
    }
    expect(writes.length).toBe(5); // every round stored something; nothing was starved
  });

  it("a document replace drops the in-flight save of the old one", async () => {
    const old = { rev: 1 };
    void saveAutosave(old as never, META);
    bumpPersistGeneration(); // what replaceProject / New do
    await finishEncode();
    expect(writes).toEqual([]);
  });

  it("a follow-up queued for the old document does not run for it after a replace", async () => {
    const old = { rev: 1 };
    const fresh = { rev: 100 };
    void saveAutosave(old as never, META);
    void saveAutosave(old as never, META); // queued
    bumpPersistGeneration();
    void saveAutosave(fresh as never, META); // queued separately, for the new document
    await finishEncode(); // the first (old) save: dropped
    // The old follow-up returns before encoding; only the new document's save encodes.
    expect(encodes.map((e) => e.project.rev)).toEqual([100]);
    await finishEncode();
    expect(writes).toEqual([100]);
  });
});
