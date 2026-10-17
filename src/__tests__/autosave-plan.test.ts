import { describe, it, expect } from "vitest";
import {
  formatBytes,
  keyCellMemoryBytes,
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
  const a = { name: "a" };
  const b = { name: "b" };
  const c = { name: "c" };
  const key = (canvas: object) => ({ kind: "key", canvas });
  const hold = { kind: "hold" };
  /** Layer id → [canvas, its ink revision at the save]. */
  const base = (...e: [number, [object, number][]][]) =>
    new Map(e.map(([id, cs]) => [id, new Map(cs)]));
  const revs = (m: Map<object, number>) => (cv: object) => m.get(cv) ?? 0;
  const empty =
    (...cs: object[]) =>
    (cv: object) =>
      cs.includes(cv);

  it("flags a cell inked at the save, never edited since, and empty now (the iPad's blanking)", () => {
    const layers = [{ id: 1, kind: "draw", cells: [key(a), hold, key(b)] }];
    const at = base([
      1,
      [
        [a, 3],
        [b, 0],
      ],
    ]);
    expect(looksBlanked(layers, at, revs(new Map([[a, 3]])), empty(a, b))).toBe(true);
  });

  it("an edit to one cell excuses only that cell, whatever its order or ink", () => {
    // A stroke on blanked cell a after the blanking (a inked again, revision moved): b, untouched
    // and empty, still tells.
    const layers = [{ id: 1, kind: "draw", cells: [key(a), key(b)] }];
    const at = base([
      1,
      [
        [a, 3],
        [b, 0],
      ],
    ]);
    expect(looksBlanked(layers, at, revs(new Map([[a, 4]])), empty(b))).toBe(true);
    // …and with the edited cell second.
    const flipped = [{ id: 1, kind: "draw", cells: [key(b), key(a)] }];
    expect(looksBlanked(flipped, at, revs(new Map([[a, 4]])), empty(b))).toBe(true);
  });

  it("allows cells the user emptied: each one was edited (erase, clear, undo)", () => {
    const layers = [{ id: 1, kind: "draw", cells: [key(a), key(b)] }];
    const at = base([
      1,
      [
        [a, 3],
        [b, 0],
      ],
    ]);
    const now = revs(
      new Map([
        [a, 4],
        [b, 2],
      ]),
    );
    expect(looksBlanked(layers, at, now, empty(a, b))).toBe(false);
  });

  it("passes untouched cells that still have their ink", () => {
    const layers = [{ id: 1, kind: "draw", cells: [key(a), key(b)] }];
    const at = base([
      1,
      [
        [a, 0],
        [b, 0],
      ],
    ]);
    expect(looksBlanked(layers, at, revs(new Map()), empty())).toBe(false);
  });

  it("ignores inked cells that were deleted or replaced — an edit, not the iPad", () => {
    // A timeline delete across rows, or a resize giving every cell a new canvas, is ONE step and
    // leaves no canvas from the save behind: gone, not blank.
    const layers = [
      { id: 1, kind: "draw", cells: [] },
      { id: 2, kind: "draw", cells: [key(c)] },
    ];
    const at = base([1, [[a, 0]]], [2, [[b, 0]]]);
    expect(looksBlanked(layers, at, revs(new Map()), empty(a, b, c))).toBe(false);
  });

  it("ignores deleted layers, references and layers that had no ink", () => {
    const layers = [
      { id: 2, kind: "ref" },
      { id: 3, kind: "draw", cells: [key(c)] },
    ];
    const at = base([2, [[b, 0]]], [4, [[b, 0]]]);
    expect(looksBlanked(layers, at, revs(new Map()), empty(b, c))).toBe(false);
  });

  it("probes one untouched cell per layer, not every cell", () => {
    const layers = [{ id: 1, kind: "draw", cells: [key(a), key(b), key(c)] }];
    const at = base([
      1,
      [
        [a, 0],
        [b, 0],
        [c, 0],
      ],
    ]);
    const probed: object[] = [];
    looksBlanked(layers, at, revs(new Map()), (cv) => (probed.push(cv), false));
    expect(probed).toEqual([a]);
  });
});

describe("layer memory", () => {
  it("counts 4 bytes a device pixel", () => {
    expect(layerMemoryBytes(40, 1920, 1080, 2)).toBe(40 * 3840 * 2160 * 4);
    expect(formatBytes(layerMemoryBytes(40, 1920, 1080, 2))).toBe("1.2 GB");
    expect(formatBytes(300 * 1024 * 1024)).toBe("300 MB");
  });
});

describe("keyCellMemoryBytes", () => {
  it("counts each drawing layer's key-cell canvas once, at the document's size", () => {
    const a = {};
    const b = {};
    const layers = [
      { id: 1, kind: "draw", cells: [{ kind: "key", canvas: a }, { kind: "hold" }] },
      // A canvas two cells share (none do today) is one canvas's memory.
      {
        id: 2,
        kind: "draw",
        cells: [
          { kind: "key", canvas: b },
          { kind: "key", canvas: b },
        ],
      },
      { id: 3, kind: "ref" },
    ];
    expect(keyCellMemoryBytes(layers, 1920, 1080, 1)).toBe(2 * 1920 * 1080 * 4);
  });
});
