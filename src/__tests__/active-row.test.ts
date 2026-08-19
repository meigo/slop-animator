import { describe, expect, it } from "vitest";
import {
  audioRowSelected,
  collapsedGroupSelected,
  layerRowSelected,
  resolveStaleTrackFocus,
  trackRowSelected,
  type ActiveRow,
} from "../anim/active-row";
import type { Layer } from "../anim/document";

const layer = (id: number, groupId: number | null = null): Layer =>
  ({
    kind: "draw",
    id,
    name: `L${id}`,
    visible: true,
    cells: [],
    groupId,
  }) as unknown as Layer;

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

describe("collapsedGroupSelected", () => {
  const members = [layer(1, 10), layer(2, 10), layer(3, null)];
  const folded = { id: 10, collapsed: true };
  const open = { id: 10, collapsed: false };

  it("is false when the group is expanded — the member row is the selection", () => {
    expect(collapsedGroupSelected({ kind: "layer", id: 1 }, open, members)).toBe(false);
  });

  it("is true when folded and a member (or its track) is selected", () => {
    expect(collapsedGroupSelected({ kind: "layer", id: 1 }, folded, members)).toBe(true);
    expect(
      collapsedGroupSelected(
        { kind: "track", owner: "layer", id: 1, prop: "opacity" },
        folded,
        members,
      ),
    ).toBe(true);
  });

  it("is true when folded and this group's own track is focused", () => {
    expect(
      collapsedGroupSelected(
        { kind: "track", owner: "group", id: 10, prop: "transform" },
        folded,
        members,
      ),
    ).toBe(true);
  });

  it("is false for a sibling layer, audio, or another group", () => {
    expect(collapsedGroupSelected({ kind: "layer", id: 3 }, folded, members)).toBe(false);
    expect(collapsedGroupSelected({ kind: "audio" }, folded, members)).toBe(false);
    expect(
      collapsedGroupSelected(
        { kind: "track", owner: "group", id: 99, prop: "opacity" },
        folded,
        members,
      ),
    ).toBe(false);
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

  it("leaves layer and audio rows alone", () => {
    expect(resolveStaleTrackFocus({ kind: "layer", id: 1 }, project, 2)).toEqual({
      kind: "layer",
      id: 1,
    });
    expect(resolveStaleTrackFocus({ kind: "audio" }, project, 1)).toEqual({ kind: "audio" });
  });
});
