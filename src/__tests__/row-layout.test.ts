import { describe, it, expect } from "vitest";
import { buildSegments, timelineRows, type Segment } from "../anim/row-layout";
import type { Layer, LayerGroup } from "../anim/document";

const layer = (id: number, groupId: number | null = null) =>
  ({ kind: "draw", id, name: `L${id}`, groupId }) as Layer;
const group = (id: number, collapsed = false) =>
  ({ id, name: `G${id}`, collapsed, visible: true }) as LayerGroup;

// Data order is bottom-first; display order is top-first, so everything below reads reversed.
const ids = (rows: ReturnType<typeof timelineRows>) =>
  rows.map((r) =>
    r.kind === "layer"
      ? `L${r.layer.id}`
      : r.kind === "group"
        ? `G${r.group.id}`
        : `T${r.layer.id}`,
  );

describe("buildSegments", () => {
  it("returns bare layers top-first when there are no groups", () => {
    const segs = buildSegments([layer(1), layer(2)], []);
    expect(segs.map((s) => ("layer" in s ? s.layer.id : -1))).toEqual([2, 1]);
  });

  it("collects contiguous members into one block", () => {
    const segs = buildSegments([layer(1), layer(2, 10), layer(3, 10), layer(4)], [group(10)]);
    expect(segs).toHaveLength(3);
    const block = segs[1] as Extract<Segment, { group: LayerGroup }>;
    expect(block.group.id).toBe(10);
    expect(block.layers.map((l) => l.id)).toEqual([3, 2]); // top-first within the block
  });

  it("keeps two groups apart", () => {
    const segs = buildSegments([layer(1, 10), layer(2, 20)], [group(10), group(20)]);
    expect(segs).toHaveLength(2);
  });

  // Not enforced anywhere, so pin the fallback: a split group renders as two blocks rather than
  // throwing on a corrupt-but-openable project.
  it("renders a non-contiguous group as separate blocks", () => {
    const segs = buildSegments([layer(1, 10), layer(2), layer(3, 10)], [group(10)]);
    expect(segs).toHaveLength(3);
  });

  it("treats a dangling groupId as no group", () => {
    const segs = buildSegments([layer(1, 99)], []);
    expect(segs).toEqual([{ layer: expect.objectContaining({ id: 1 }) }]);
  });
});

describe("timelineRows", () => {
  it("gives an expanded group a row of its own, above its members", () => {
    const rows = timelineRows(buildSegments([layer(1, 10), layer(2, 10)], [group(10)]));
    expect(ids(rows)).toEqual(["G10", "L2", "L1"]);
  });

  // The gap this closes: collapsing a group used to remove its content from the timeline entirely,
  // leaving nothing to say it was there.
  it("a collapsed group keeps one row standing in for its hidden members", () => {
    const rows = timelineRows(buildSegments([layer(1, 10), layer(2, 10)], [group(10, true)]));
    expect(ids(rows)).toEqual(["G10"]);
    expect(rows[0].kind === "group" && rows[0].hiddenCount).toBe(2);
  });

  it("reports no hidden members while expanded", () => {
    const rows = timelineRows(buildSegments([layer(1, 10)], [group(10)]));
    expect(rows[0].kind === "group" && rows[0].hiddenCount).toBe(0);
  });

  it("interleaves grouped and ungrouped layers in display order", () => {
    const rows = timelineRows(
      buildSegments([layer(1), layer(2, 10), layer(3, 10), layer(4)], [group(10)]),
    );
    expect(ids(rows)).toEqual(["L4", "G10", "L3", "L2", "L1"]);
  });

  it("is empty for an empty project", () => {
    expect(timelineRows(buildSegments([], []))).toEqual([]);
  });
});

const animated = (id: number, groupId: number | null = null) =>
  ({
    kind: "draw",
    id,
    name: `L${id}`,
    groupId,
    transformTrack: {
      keys: [{ frame: 0, t: { dx: 0, dy: 0, scale: 1, rotation: 0 } }],
      box: null,
    },
  }) as Layer;

describe("timelineRows — transform tracks", () => {
  it("emits a transform row directly under its layer", () => {
    const rows = timelineRows(buildSegments([animated(1)], []));
    expect(rows.map((r) => r.kind)).toEqual(["layer", "transform"]);
  });

  it("emits nothing extra for a layer with no track", () => {
    expect(timelineRows(buildSegments([layer(1)], []))).toHaveLength(1);
  });

  it("emits the row for a grouped layer too", () => {
    const rows = timelineRows(buildSegments([animated(1, 10)], [group(10)]));
    expect(rows.map((r) => r.kind)).toEqual(["group", "layer", "transform"]);
  });

  // A collapsed group hides its members, so their tracks go with them.
  it("hides a member's transform row when its group is collapsed", () => {
    const rows = timelineRows(buildSegments([animated(1, 10)], [group(10, true)]));
    expect(rows.map((r) => r.kind)).toEqual(["group"]);
  });
});
