import { describe, it, expect } from "vitest";
import { buildSegments, timelineRows, type Segment } from "../anim/row-layout";
import type { Layer, LayerGroup, LayerTracks } from "../anim/document";

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
        : r.kind === "grouptrack"
          ? `GT${r.group.id}`
          : `${r.prop === "transform" ? "T" : "O"}${r.layer.id}`,
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
    tracks: {
      transform: {
        keys: [{ frame: 0, v: { dx: 0, dy: 0, scale: 1, rotation: 0 } }],
        box: null,
      },
    },
  }) as Layer;

describe("timelineRows — transform tracks", () => {
  it("emits a transform row directly under its layer", () => {
    const rows = timelineRows(buildSegments([animated(1)], []));
    expect(rows.map((r) => r.kind)).toEqual(["layer", "track"]);
  });

  it("emits nothing extra for a layer with no track", () => {
    expect(timelineRows(buildSegments([layer(1)], []))).toHaveLength(1);
  });

  it("emits the row for a grouped layer too", () => {
    const rows = timelineRows(buildSegments([animated(1, 10)], [group(10)]));
    expect(rows.map((r) => r.kind)).toEqual(["group", "layer", "track"]);
  });

  // One animated layer cannot tell "under its own layer" from "appended at the end", so pin the
  // interleaving with two. Data order is bottom-first, display order top-first.
  it("keeps each transform row under its OWN layer when several are animated", () => {
    const rows = timelineRows(buildSegments([animated(1), animated(2)], []));
    expect(ids(rows)).toEqual(["L2", "T2", "L1", "T1"]);
  });

  it("interleaves animated and static layers", () => {
    const rows = timelineRows(buildSegments([animated(1), layer(2), animated(3)], []));
    expect(ids(rows)).toEqual(["L3", "T3", "L2", "L1", "T1"]);
  });

  // A collapsed group hides its members, so their tracks go with them.
  it("hides a member's transform row when its group is collapsed", () => {
    const rows = timelineRows(buildSegments([animated(1, 10)], [group(10, true)]));
    expect(rows.map((r) => r.kind)).toEqual(["group"]);
  });
});

const T0 = { dx: 0, dy: 0, scale: 1, rotation: 0 };
const bothTracks = {
  transform: { keys: [{ frame: 0, v: T0 }], box: null },
  opacity: { keys: [{ frame: 0, v: 100 }] },
};
const withTracks = (id: number, tracks: LayerTracks, groupId: number | null = null) =>
  ({ kind: "draw", id, name: `L${id}`, groupId, tracks }) as Layer;

// Fixed order so rows never reorder under the artist as tracks are added.
describe("timelineRows — property rows", () => {
  it("emits one row per present track, transform before opacity", () => {
    const rows = timelineRows(buildSegments([withTracks(1, bothTracks)], []));
    expect(rows.map((r) => (r.kind === "track" ? r.prop : r.kind))).toEqual([
      "layer",
      "transform",
      "opacity",
    ]);
  });

  it("emits only the tracks that exist", () => {
    const rows = timelineRows(buildSegments([withTracks(1, { opacity: bothTracks.opacity })], []));
    expect(rows.map((r) => (r.kind === "track" ? r.prop : r.kind))).toEqual(["layer", "opacity"]);
  });

  it("omits every property row when the layer is collapsed", () => {
    const l = withTracks(1, bothTracks);
    (l as { tracksCollapsed?: boolean }).tracksCollapsed = true;
    expect(timelineRows(buildSegments([l], [])).map((r) => r.kind)).toEqual(["layer"]);
  });

  it("interleaves two animated layers rather than grouping all track rows at the end", () => {
    const rows = timelineRows(
      buildSegments([withTracks(1, bothTracks), withTracks(2, bothTracks)], []),
    );
    expect(ids(rows)).toEqual(["L2", "T2", "O2", "L1", "T1", "O1"]);
  });
});

const animatedGroup = (id: number, collapsed = false) =>
  ({
    id,
    name: `G${id}`,
    collapsed,
    visible: true,
    tracks: { transform: { keys: [{ frame: 0, v: T0 }], box: null } },
  }) as LayerGroup;

describe("timelineRows — group tracks", () => {
  it("emits the group's track row directly after its header row", () => {
    const rows = timelineRows(buildSegments([layer(1, 10)], [animatedGroup(10)]));
    expect(ids(rows)).toEqual(["G10", "GT10", "L1"]);
  });

  it("emits nothing extra for a static group", () => {
    const rows = timelineRows(buildSegments([layer(1, 10)], [group(10)]));
    expect(ids(rows)).toEqual(["G10", "L1"]);
  });

  // Collapse means "show me only this group's header row" — one collapse concept, not two.
  it("hides the group's own track row while the group is collapsed", () => {
    const rows = timelineRows(buildSegments([layer(1, 10)], [animatedGroup(10, true)]));
    expect(ids(rows)).toEqual(["G10"]);
  });
});
