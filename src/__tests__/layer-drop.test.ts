import { describe, it, expect } from "vitest";
import { applyOrder, dropTarget, rowKey, type Drop, type RowBox } from "../anim/layer-drop";
import type { Layer, LayerGroup } from "../anim/document";

const layer = (id: number, groupId: number | null = null) =>
  ({ kind: "draw", id, name: `L${id}`, groupId }) as Layer;
const group = (id: number, collapsed = false) =>
  ({ id, name: `G${id}`, collapsed, visible: true }) as LayerGroup;
/** Row `i` of a 28px-row list, top first. */
const R = (kind: "layer" | "group", id: number, i: number): RowBox => ({
  kind,
  id,
  key: rowKey(kind, id),
  top: i * 28,
  bottom: (i + 1) * 28,
});
/** A drop's order in DISPLAY order (top first): "L4 L1 L2@10" = L2 is in group 10. */
const show = (d: Drop | null) =>
  d &&
  [...d.order]
    .reverse()
    .map((e) => (e.groupId == null ? `L${e.id}` : `L${e.id}@${e.groupId}`))
    .join(" ");

// Fixture A, top first: L1, G10 [L2, L3], L4. Data order is bottom-first.
const layersA = () => [layer(4), layer(3, 10), layer(2, 10), layer(1)];
const groupsA = [group(10)];
// L1 0-28, G10 28-56, L2 56-84, L3 84-112, L4 112-140
const rowsA = [
  R("layer", 1, 0),
  R("group", 10, 1),
  R("layer", 2, 2),
  R("layer", 3, 3),
  R("layer", 4, 4),
];
const dropA = (id: number, y: number, kind: "layer" | "group" = "layer") =>
  dropTarget(layersA(), groupsA, rowsA, y, { kind, id });

describe("rowKey", () => {
  it("keeps layer and group ids apart", () => {
    expect(rowKey("layer", 3)).toBe("l3");
    expect(rowKey("group", 3)).toBe("g3");
  });
});

describe("applyOrder", () => {
  it("returns the layers in the given order with their new groups", () => {
    const ls = layersA();
    const out = applyOrder(ls, [
      { id: 1, groupId: 10 },
      { id: 4, groupId: null },
      { id: 2, groupId: null },
      { id: 3, groupId: 10 },
    ]);
    expect(out.map((l) => l.id)).toEqual([1, 4, 2, 3]);
    expect(out.map((l) => l.groupId)).toEqual([10, null, null, 10]);
    expect(out[0]).toBe(ls[3]); // the same layer objects, not copies
  });
  it("skips ids it does not know", () => {
    const out = applyOrder(layersA(), [
      { id: 99, groupId: null },
      { id: 1, groupId: null },
    ]);
    expect(out.map((l) => l.id)).toEqual([1]);
  });
});

describe("dropTarget — a layer", () => {
  it("reorders at the top level", () => {
    expect(dropA(4, 5)).toEqual({ order: expect.any(Array), line: 0, into: null });
    expect(show(dropA(4, 5))).toBe("L4 L1 L2@10 L3@10");
    expect(show(dropA(1, 130))).toBe("L2@10 L3@10 L4 L1");
    expect(dropA(1, 130)?.line).toBe(140);
  });
  it("drops into an expanded group at the top, middle and end", () => {
    const top = dropA(4, 50); // lower half of the header
    expect(show(top)).toBe("L1 L4@10 L2@10 L3@10");
    expect(top?.line).toBe(56);
    expect(top?.into).toBe(10);
    const middle = dropA(4, 90); // upper half of L3
    expect(show(middle)).toBe("L1 L2@10 L4@10 L3@10");
    expect(middle?.line).toBe(84);
    expect(middle?.into).toBe(10);
    const end = dropA(1, 105); // lower half of the last member
    expect(show(end)).toBe("L2@10 L3@10 L1@10 L4");
    expect(end?.line).toBe(112);
    expect(end?.into).toBe(10);
  });
  it("drops out of a group above and below it", () => {
    const above = dropA(2, 30); // upper half of the header
    expect(show(above)).toBe("L1 L2 L3@10 L4");
    expect(above?.line).toBe(28);
    expect(above?.into).toBe(null);
    const below = dropA(3, 115); // upper half of L4
    expect(show(below)).toBe("L1 L2@10 L3 L4");
    expect(below?.into).toBe(null);
  });
  it("lands beside a collapsed group, never inside", () => {
    const groups = [group(10, true)];
    const rows = [R("layer", 1, 0), R("group", 10, 1), R("layer", 4, 2)]; // members hidden
    const lower = dropTarget(layersA(), groups, rows, 50, { kind: "layer", id: 1 });
    expect(show(lower)).toBe("L2@10 L3@10 L1 L4");
    expect(lower?.line).toBe(56);
    expect(lower?.into).toBe(null);
    const upper = dropTarget(layersA(), groups, rows, 30, { kind: "layer", id: 4 });
    expect(show(upper)).toBe("L1 L4 L2@10 L3@10");
  });
  it("is null where nothing would change", () => {
    expect(dropA(1, 10)).toBeNull(); // its own row, upper half
    expect(dropA(1, 20)).toBeNull(); // its own row, lower half
    expect(dropA(1, 30)).toBeNull(); // just above the group = where it is
    expect(dropA(2, 60)).toBeNull();
    expect(dropA(2, 50)).toBeNull(); // top of its own group = where it is
  });
  it("clamps a pointer above or below the list to the first or last row", () => {
    expect(show(dropA(4, -20))).toBe("L4 L1 L2@10 L3@10");
    expect(show(dropA(1, 500))).toBe("L2@10 L3@10 L4 L1");
  });
  it("takes the only member out, leaving no layer in the group", () => {
    const layers = [layer(2, 10), layer(1)];
    const rows = [R("layer", 1, 0), R("group", 10, 1), R("layer", 2, 2)];
    const d = dropTarget(layers, [group(10)], rows, 5, { kind: "layer", id: 2 });
    expect(show(d)).toBe("L2 L1");
    expect(d?.order.some((e) => e.groupId === 10)).toBe(false);
  });
  it("is null for an empty list", () => {
    expect(dropTarget(layersA(), groupsA, [], 10, { kind: "layer", id: 1 })).toBeNull();
  });
});

describe("dropTarget — a group", () => {
  it("moves the whole block above or below another block", () => {
    const above = dropA(10, 5, "group");
    expect(show(above)).toBe("L2@10 L3@10 L1 L4");
    expect(above?.line).toBe(0);
    expect(above?.into).toBe(null);
    const below = dropA(10, 130, "group");
    expect(show(below)).toBe("L1 L4 L2@10 L3@10");
    expect(below?.line).toBe(140);
  });
  it("is null over its own block or next to where it is", () => {
    expect(dropA(10, 70, "group")).toBeNull();
    expect(dropA(10, 20, "group")).toBeNull();
    expect(dropA(10, 120, "group")).toBeNull();
  });
  it("snaps to another group's edge instead of entering it", () => {
    // Fixture B, top first: G10 [L2, L3], L1, G20 [L5, L6].
    const layers = [layer(6, 20), layer(5, 20), layer(1), layer(3, 10), layer(2, 10)];
    const groups = [group(10), group(20)];
    const rows = [
      R("group", 10, 0),
      R("layer", 2, 1),
      R("layer", 3, 2),
      R("layer", 1, 3),
      R("group", 20, 4),
      R("layer", 5, 5),
      R("layer", 6, 6),
    ];
    // G20's block spans 112-196 (middle 154).
    const upper = dropTarget(layers, groups, rows, 150, { kind: "group", id: 10 });
    expect(show(upper)).toBe("L1 L2@10 L3@10 L5@20 L6@20");
    expect(upper?.line).toBe(112);
    const lower = dropTarget(layers, groups, rows, 190, { kind: "group", id: 10 });
    expect(show(lower)).toBe("L1 L5@20 L6@20 L2@10 L3@10");
    expect(lower?.line).toBe(196);
  });
});

describe("dropTarget — every result", () => {
  /** Each layer once, and each group's members one unbroken run. */
  const valid = (order: { id: number; groupId: number | null }[], ids: number[]) => {
    expect([...order.map((e) => e.id)].sort()).toEqual([...ids].sort());
    const seen = new Set<number>();
    let prev: number | null = null;
    for (const e of order) {
      if (e.groupId != null && e.groupId !== prev) {
        expect(seen.has(e.groupId)).toBe(false);
        seen.add(e.groupId);
      }
      prev = e.groupId;
    }
  };
  it("keeps groups contiguous for any pointer position and any drag", () => {
    const drags = [1, 2, 3, 4].map((id) => ({ kind: "layer" as const, id }));
    for (const drag of [...drags, { kind: "group" as const, id: 10 }])
      for (let y = -10; y <= 160; y += 2) {
        const d = dropTarget(layersA(), groupsA, rowsA, y, drag);
        if (d) valid(d.order, [1, 2, 3, 4]);
      }
  });
});
