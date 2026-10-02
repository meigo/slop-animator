import { describe, it, expect } from "vitest";
import {
  comparableLayers,
  formatBytes,
  layerMemoryBytes,
  looksBlanked,
  planCheckpoint,
  type AutosaveEntry,
} from "../persist/autosave-plan";

const meta = (savedAt: number) => ({
  savedAt,
  projectName: "p",
  layerCount: 2,
  inkedCount: 2,
  mediaIds: ["m1"],
});
const MIN = 60_000;

describe("planCheckpoint", () => {
  it("makes the first save a checkpoint", () => {
    const p = planCheckpoint([], meta(0), 5 * MIN, 3);
    expect(p.write).toBe("autosave-cp-0");
    expect(p.list.map((e) => e.key)).toEqual(["autosave-cp-0"]);
  });

  it("carries the meta, media ids included, into the list", () => {
    const p = planCheckpoint([], meta(0), 5 * MIN, 3);
    expect(p.list[0]).toEqual({ ...meta(0), key: "autosave-cp-0" });
  });

  it("skips saves closer than the interval to the newest", () => {
    const list: AutosaveEntry[] = [{ ...meta(0), key: "autosave-cp-0" }];
    expect(planCheckpoint(list, meta(4 * MIN), 5 * MIN, 3).write).toBeNull();
    expect(planCheckpoint(list, meta(5 * MIN), 5 * MIN, 3).write).toBe("autosave-cp-1");
  });

  it("reuses the oldest's key once all are taken", () => {
    const list: AutosaveEntry[] = [
      { ...meta(10 * MIN), key: "autosave-cp-2" },
      { ...meta(0), key: "autosave-cp-0" },
      { ...meta(5 * MIN), key: "autosave-cp-1" },
    ];
    const p = planCheckpoint(list, meta(15 * MIN), 5 * MIN, 3);
    expect(p.write).toBe("autosave-cp-0");
    expect(p.list.map((e) => [e.key, e.savedAt / MIN])).toEqual([
      ["autosave-cp-1", 5],
      ["autosave-cp-2", 10],
      ["autosave-cp-0", 15],
    ]);
  });
});

describe("looksBlanked", () => {
  const ids = (...n: number[]) => new Set(n);

  it("flags layers emptied with no undo step to explain it", () => {
    expect(looksBlanked(ids(1, 2, 3), ids(), ids(1, 2, 3), 0)).toBe(true);
    // Even one, when nothing was done (a one-layer document blanked in the background).
    expect(looksBlanked(ids(1), ids(), ids(1), 0)).toBe(true);
  });

  it("allows one emptied layer per undo step (clear, erase, undo)", () => {
    expect(looksBlanked(ids(1, 2), ids(2), ids(1, 2), 1)).toBe(false);
    expect(looksBlanked(ids(1, 2, 3), ids(), ids(1, 2, 3), 1)).toBe(true);
  });

  it("ignores deleted layers and layers that gained pixels", () => {
    expect(looksBlanked(ids(1, 2), ids(2, 5), ids(2, 5), 0)).toBe(false);
  });
});

describe("comparableLayers", () => {
  const a = { name: "a" };
  const b = { name: "b" };
  const c = { name: "c" };
  const key = (canvas: object) => ({ kind: "key", canvas });
  const hold = { kind: "hold" };

  it("keeps a drawing layer that still holds the cell found inked at the save", () => {
    const layers = [{ id: 1, kind: "draw", cells: [hold, key(b), key(a)] }];
    expect(comparableLayers(layers, new Map([[1, a]]))).toEqual(new Set([1]));
  });

  it("drops a layer whose inked cell was deleted or replaced — an edit, not the iPad", () => {
    // A timeline delete across three layers is ONE undo step; their cells are gone, not blank.
    const layers = [
      { id: 1, kind: "draw", cells: [] },
      { id: 2, kind: "draw", cells: [key(c)] },
    ];
    expect(
      comparableLayers(
        layers,
        new Map([
          [1, a],
          [2, b],
        ]),
      ),
    ).toEqual(new Set());
  });

  it("ignores deleted layers, reference layers and layers that had no ink", () => {
    const layers = [
      { id: 2, kind: "ref" },
      { id: 3, kind: "draw", cells: [key(c)] },
    ];
    expect(
      comparableLayers(
        layers,
        new Map([
          [1, a],
          [2, b],
        ]),
      ),
    ).toEqual(new Set());
  });
});

describe("layer memory", () => {
  it("counts 4 bytes a device pixel", () => {
    expect(layerMemoryBytes(40, 1920, 1080, 2)).toBe(40 * 3840 * 2160 * 4);
    expect(formatBytes(layerMemoryBytes(40, 1920, 1080, 2))).toBe("1.2 GB");
    expect(formatBytes(300 * 1024 * 1024)).toBe("300 MB");
  });
});
