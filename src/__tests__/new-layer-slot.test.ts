import { describe, it, expect } from "vitest";
import { newLayerSlot, type ActiveRow } from "../anim/active-row";

// Data order is bottom → top (the panel shows it reversed). Display, top first:
//   B (root)  ·  group 10 [ M2, M1 ]  ·  A (root)
const layers = [
  { id: 1, groupId: null }, // A
  { id: 2, groupId: 10 }, // M1
  { id: 3, groupId: 10 }, // M2
  { id: 4, groupId: null }, // B
];

describe("newLayerSlot — a new layer goes directly above the selected row, as its sibling", () => {
  it("a group MEMBER selected → inside the group, just above that member", () => {
    expect(newLayerSlot({ kind: "layer", id: 2 }, layers)).toEqual({ index: 2, groupId: 10 });
  });

  // The case that had no answer: with a single group, no selection produced a root layer, because
  // placement read `activeLayerId` — which a selected GROUP ROW keeps as a remembered anchor.
  it("the GROUP ROW selected → at root, just above the group", () => {
    expect(newLayerSlot({ kind: "group", id: 10 }, layers)).toEqual({ index: 3, groupId: null });
  });

  it("a root layer selected → at root, just above IT, not at the very top", () => {
    expect(newLayerSlot({ kind: "layer", id: 1 }, layers)).toEqual({ index: 1, groupId: null });
    expect(newLayerSlot({ kind: "layer", id: 4 }, layers)).toEqual({ index: 4, groupId: null });
  });

  it("a track row resolves to its OWNER, via workingTarget", () => {
    const layerTrack: ActiveRow = { kind: "track", owner: "layer", id: 3, prop: "opacity" };
    const groupTrack: ActiveRow = { kind: "track", owner: "group", id: 10, prop: "transform" };
    expect(newLayerSlot(layerTrack, layers)).toEqual({ index: 3, groupId: 10 });
    expect(newLayerSlot(groupTrack, layers)).toEqual({ index: 3, groupId: null });
  });

  it("no layer anchor (audio lane, unknown id, empty group) → top of the stack", () => {
    expect(newLayerSlot({ kind: "audio" }, layers)).toEqual({ index: 4, groupId: null });
    expect(newLayerSlot({ kind: "layer", id: 99 }, layers)).toEqual({ index: 4, groupId: null });
    // An empty group has no members, so no position in the stack to be "above".
    expect(newLayerSlot({ kind: "group", id: 77 }, layers)).toEqual({ index: 4, groupId: null });
  });

  // The invariant that makes the rule safe: whatever is selected, inserting at the slot must leave
  // every group's members as ONE contiguous run — `buildSegments` would otherwise split a group into
  // two headers.
  it("never splits a group's run, whatever is selected", () => {
    const rows: ActiveRow[] = [
      { kind: "layer", id: 1 },
      { kind: "layer", id: 2 },
      { kind: "layer", id: 3 },
      { kind: "layer", id: 4 },
      { kind: "group", id: 10 },
      { kind: "audio" },
    ];
    for (const row of rows) {
      const slot = newLayerSlot(row, layers);
      const next = [...layers];
      next.splice(slot.index, 0, { id: 100, groupId: slot.groupId });
      const idx = next.flatMap((l, i) => (l.groupId === 10 ? [i] : []));
      expect(idx[idx.length - 1] - idx[0] + 1, JSON.stringify(row)).toBe(idx.length);
    }
  });
});
