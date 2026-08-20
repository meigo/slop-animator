import { describe, expect, it } from "vitest";
import {
  audioRowSelected,
  groupHeaderSelected,
  groupRowSelected,
  layerRowSelected,
  resolveStaleTrackFocus,
  rowAdmitsTransform,
  targetLayerId,
  trackRowSelected,
  workingTarget,
  type ActiveRow,
} from "../anim/active-row";
import type { AudioTrack, Layer } from "../anim/document";

const layer = (id: number, groupId: number | null = null): Layer =>
  ({
    kind: "draw",
    id,
    name: `L${id}`,
    visible: true,
    cells: [],
    groupId,
  }) as unknown as Layer;

describe("workingTarget", () => {
  it("a layer row (or its own track) is that layer", () => {
    expect(workingTarget({ kind: "layer", id: 3 })).toEqual({ kind: "layer", id: 3 });
    expect(workingTarget({ kind: "track", owner: "layer", id: 3, prop: "opacity" })).toEqual({
      kind: "layer",
      id: 3,
    });
  });

  it("audio is audio — leftover draw memory is not a target", () => {
    expect(workingTarget({ kind: "audio" })).toEqual({ kind: "audio" });
  });

  it("a group-owned track is the group, same as the group header", () => {
    expect(workingTarget({ kind: "group", id: 10 })).toEqual({ kind: "group", id: 10 });
    expect(workingTarget({ kind: "track", owner: "group", id: 10, prop: "transform" })).toEqual({
      kind: "group",
      id: 10,
    });
    expect(workingTarget({ kind: "track", owner: "group", id: 10, prop: "opacity" })).toEqual({
      kind: "group",
      id: 10,
    });
  });
});

describe("targetLayerId", () => {
  it("is the layer when a layer row (or its own track) is selected", () => {
    expect(targetLayerId({ kind: "layer", id: 3 })).toBe(3);
    expect(targetLayerId({ kind: "track", owner: "layer", id: 3, prop: "opacity" })).toBe(3);
  });

  it("is null for audio, a group, or a group-owned track — leftover draw memory is not a target", () => {
    expect(targetLayerId({ kind: "audio" })).toBeNull();
    expect(targetLayerId({ kind: "group", id: 10 })).toBeNull();
    expect(targetLayerId({ kind: "track", owner: "group", id: 10, prop: "transform" })).toBeNull();
  });
});

describe("layerRowSelected", () => {
  it("matches a layer row", () => {
    const row: ActiveRow = { kind: "layer", id: 1 };
    expect(layerRowSelected(row, 1)).toBe(true);
    expect(layerRowSelected(row, 2)).toBe(false);
  });

  it("a layer-owned track keeps its OWNER layer selected", () => {
    const row: ActiveRow = { kind: "track", owner: "layer", id: 1, prop: "opacity" };
    expect(layerRowSelected(row, 1)).toBe(true);
    expect(layerRowSelected(row, 2)).toBe(false);
  });

  it("a group-owned track selects no layer row — only the track itself is lit", () => {
    const row: ActiveRow = { kind: "track", owner: "group", id: 10, prop: "transform" };
    expect(layerRowSelected(row, 1)).toBe(false);
    expect(layerRowSelected(row, 2)).toBe(false);
    expect(layerRowSelected(row, 3)).toBe(false);
  });

  it("audio selects no layer", () => {
    expect(layerRowSelected({ kind: "audio" }, 1)).toBe(false);
  });
});

describe("groupHeaderSelected", () => {
  const members = [layer(1, 10), layer(2, 10), layer(3, null)];
  const folded = { id: 10, collapsed: true };
  const open = { id: 10, collapsed: false };

  it("lights the header when the group row itself is selected, expanded or folded", () => {
    expect(groupHeaderSelected({ kind: "group", id: 10 }, open, members)).toBe(true);
    expect(groupHeaderSelected({ kind: "group", id: 10 }, folded, members)).toBe(true);
    expect(groupHeaderSelected({ kind: "group", id: 99 }, open, members)).toBe(false);
  });

  it("is false when the group is expanded — the member row is the selection", () => {
    expect(groupHeaderSelected({ kind: "layer", id: 1 }, open, members)).toBe(false);
  });

  it("is true when folded and a member (or its track) is selected", () => {
    expect(groupHeaderSelected({ kind: "layer", id: 1 }, folded, members)).toBe(true);
    expect(
      groupHeaderSelected(
        { kind: "track", owner: "layer", id: 1, prop: "opacity" },
        folded,
        members,
      ),
    ).toBe(true);
  });

  it("is true when folded and this group's own track is focused", () => {
    expect(
      groupHeaderSelected(
        { kind: "track", owner: "group", id: 10, prop: "transform" },
        folded,
        members,
      ),
    ).toBe(true);
  });

  it("is true when this group's own track is focused, even if expanded — the panel has no track row to light", () => {
    expect(
      groupHeaderSelected(
        { kind: "track", owner: "group", id: 10, prop: "opacity" },
        open,
        members,
      ),
    ).toBe(true);
  });

  it("is false for a sibling layer, audio, or another group", () => {
    expect(groupHeaderSelected({ kind: "layer", id: 3 }, folded, members)).toBe(false);
    expect(groupHeaderSelected({ kind: "audio" }, folded, members)).toBe(false);
    expect(
      groupHeaderSelected(
        { kind: "track", owner: "group", id: 99, prop: "opacity" },
        folded,
        members,
      ),
    ).toBe(false);
  });
});

describe("groupRowSelected", () => {
  it("matches only the group row", () => {
    expect(groupRowSelected({ kind: "group", id: 10 }, 10)).toBe(true);
    expect(groupRowSelected({ kind: "group", id: 10 }, 11)).toBe(false);
    expect(groupRowSelected({ kind: "layer", id: 10 }, 10)).toBe(false);
  });
});

describe("trackRowSelected", () => {
  it("matches only the focused track", () => {
    const row: ActiveRow = { kind: "track", owner: "layer", id: 1, prop: "opacity" };
    expect(trackRowSelected(row, "layer", 1, "opacity")).toBe(true);
    expect(trackRowSelected(row, "layer", 1, "transform")).toBe(false);
    expect(trackRowSelected({ kind: "layer", id: 1 }, "layer", 1, "opacity")).toBe(false);
  });
});

describe("audioRowSelected", () => {
  it("is true only for the audio case", () => {
    expect(audioRowSelected({ kind: "audio" })).toBe(true);
    expect(audioRowSelected({ kind: "layer", id: 1 })).toBe(false);
  });
});

describe("rowAdmitsTransform", () => {
  const ref = (id: number, groupId: number | null = null) =>
    ({ kind: "ref", id, groupId }) as unknown as Layer;

  it("a layer row transforms at any scope — its own row is what is lit", () => {
    for (const scope of ["frame", "layer", "group"] as const)
      expect(rowAdmitsTransform({ kind: "layer", id: 1 }, scope, layer(1, 10))).toBe(true);
  });

  it("audio never transforms — activeLayerId under it is memory", () => {
    expect(rowAdmitsTransform({ kind: "audio" }, "layer", layer(1, 10))).toBe(false);
    expect(rowAdmitsTransform({ kind: "audio" }, "group", layer(1, 10))).toBe(false);
  });

  it("a group row admits only its OWN group, and only at group scope", () => {
    const row: ActiveRow = { kind: "group", id: 10 };
    expect(rowAdmitsTransform(row, "group", layer(1, 10))).toBe(true);
    // Layer/frame scope would move the member's own transform while only the group is lit.
    expect(rowAdmitsTransform(row, "layer", layer(1, 10))).toBe(false);
    expect(rowAdmitsTransform(row, "frame", layer(1, 10))).toBe(false);
    // The anchor left over in a DIFFERENT group would move THAT group.
    expect(rowAdmitsTransform(row, "group", layer(1, 11))).toBe(false);
    expect(rowAdmitsTransform(row, "group", layer(1, null))).toBe(false);
    // A ref anchor never reaches the group branch of transformTarget — it would move the ref.
    expect(rowAdmitsTransform(row, "group", ref(1, 10))).toBe(false);
  });

  it("a group TRACK row is the group, same rule", () => {
    const row: ActiveRow = { kind: "track", owner: "group", id: 10, prop: "transform" };
    expect(rowAdmitsTransform(row, "group", layer(1, 10))).toBe(true);
    expect(rowAdmitsTransform(row, "group", layer(1, 11))).toBe(false);
    expect(rowAdmitsTransform(row, "layer", layer(1, 10))).toBe(false);
  });

  it("a layer's own track row is that layer, so it transforms", () => {
    const row: ActiveRow = { kind: "track", owner: "layer", id: 1, prop: "transform" };
    expect(rowAdmitsTransform(row, "layer", layer(1, null))).toBe(true);
  });
});

describe("resolveStaleTrackFocus", () => {
  const project = {
    layers: [{ ...layer(1), tracks: { opacity: { keys: [{ frame: 0, v: 100 }] } } }, layer(2)],
    groups: [
      {
        id: 10,
        name: "G",
        collapsed: false,
        visible: true,
        tracks: { transform: { keys: [], box: null } },
      },
    ],
  } as Parameters<typeof resolveStaleTrackFocus>[1];

  it("keeps a live layer track", () => {
    const row: ActiveRow = { kind: "track", owner: "layer", id: 1, prop: "opacity" };
    expect(resolveStaleTrackFocus(row, project, 1)).toEqual(row);
  });

  it("falls back when the layer track is gone", () => {
    const row: ActiveRow = { kind: "track", owner: "layer", id: 1, prop: "transform" };
    expect(resolveStaleTrackFocus(row, project, 1)).toEqual({ kind: "layer", id: 1 });
  });

  it("falls back when the layer itself is gone, using the draw target", () => {
    const row: ActiveRow = { kind: "track", owner: "layer", id: 99, prop: "opacity" };
    expect(resolveStaleTrackFocus(row, project, 2)).toEqual({ kind: "layer", id: 2 });
  });

  it("keeps a live group track", () => {
    const row: ActiveRow = { kind: "track", owner: "group", id: 10, prop: "transform" };
    expect(resolveStaleTrackFocus(row, project, 1)).toEqual(row);
  });

  it("keeps a live group opacity track", () => {
    const row: ActiveRow = { kind: "track", owner: "group", id: 10, prop: "opacity" };
    const withOpacity = {
      ...project,
      groups: [
        {
          id: 10,
          name: "G",
          collapsed: false,
          visible: true,
          tracks: { opacity: { keys: [{ frame: 0, v: 100 }] } },
        },
      ],
    };
    expect(resolveStaleTrackFocus(row, withOpacity as typeof project, 1)).toEqual(row);
  });

  it("falls back when only the group transform remains", () => {
    const row: ActiveRow = { kind: "track", owner: "group", id: 10, prop: "opacity" };
    expect(resolveStaleTrackFocus(row, project, 1)).toEqual({ kind: "layer", id: 1 });
  });

  it("falls back when the group track is gone", () => {
    const row: ActiveRow = { kind: "track", owner: "group", id: 10, prop: "transform" };
    const gone = {
      ...project,
      groups: [{ id: 10, name: "G", collapsed: false, visible: true }],
    };
    expect(resolveStaleTrackFocus(row, gone as typeof project, 1)).toEqual({
      kind: "layer",
      id: 1,
    });
  });

  it("leaves a layer row alone, and keeps an audio row while the track exists", () => {
    expect(resolveStaleTrackFocus({ kind: "layer", id: 1 }, project, 2)).toEqual({
      kind: "layer",
      id: 1,
    });
    const withAudio = { ...project, audio: { name: "take" } as unknown as AudioTrack };
    expect(resolveStaleTrackFocus({ kind: "audio" }, withAudio, 1)).toEqual({ kind: "audio" });
  });

  // Was pinned the other way: an audio row was passed through unchanged against a fixture with no
  // audio at all. Removing the track (or undoing the import) then left the lane unrendered with the
  // row still selected — every pixel tool refusing on every layer, an uncaptioned not-allowed
  // cursor, and nothing lit anywhere to point at the way out.
  it("falls the audio row back to the draw target once the track is gone", () => {
    expect(resolveStaleTrackFocus({ kind: "audio" }, project, 3)).toEqual({ kind: "layer", id: 3 });
  });

  it("keeps a live group row and falls back when the group is gone", () => {
    expect(resolveStaleTrackFocus({ kind: "group", id: 10 }, project, 1)).toEqual({
      kind: "group",
      id: 10,
    });
    const gone = { ...project, groups: [] };
    expect(resolveStaleTrackFocus({ kind: "group", id: 10 }, gone, 1)).toEqual({
      kind: "layer",
      id: 1,
    });
  });
});
