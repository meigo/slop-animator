import { describe, it, expect } from "vitest";
import {
  groupHasLockedLayer,
  canRemoveLayer,
  rasterizeKeyframePlan,
  canDuplicateLayer,
  whyNotMergeDown,
  isLayerEditable,
  isLayerLocked,
  whyNotEditable,
  resolveKeyframeIndex,
  buildFrameDrawList,
  containRect,
  createReferenceLayer,
  documentLength,
  refreshLength,
  createProject,
  createDrawingLayer,
  setMinLayerId,
  nextLayerName,
  defaultBoilConfig,
  isCrispFrame,
  resolveLayerName,
  resizeCells,
  countKeyframesPastLength,
  countKeyframesPastLengthIn,
  mediaIntrinsicSize,
  isLayerVisible,
  groupOf,
  nonEmptyGroups,
  refVisibleSpan,
  isRefVisibleAtFrame,
  layerAcceptsPropertyTracks,
  layerOpacityTrack,
  layerTransformTrack,
  isLayerAnimated,
  transformAt,
  opacityAt,
  IDENTITY_TRANSFORM,
  isIdentityTransform,
  transformBaseRect,
  type Cell,
  type Project,
  type DrawingLayer,
  type ReferenceMedia,
  type ReferenceLayer,
  type Layer,
} from "../anim/document";

const makeKey = (): Cell => ({ kind: "key", canvas: {} as HTMLCanvasElement });
const makeHold = (): Cell => ({ kind: "hold" });

const hold = { kind: "hold" } as Cell;
const key = { kind: "key" } as unknown as Cell;

describe("resolveKeyframeIndex", () => {
  it("returns null when there is no keyframe at or before the frame", () => {
    expect(resolveKeyframeIndex([makeHold(), makeHold()], 1)).toBeNull();
    expect(resolveKeyframeIndex([], 0)).toBeNull();
  });

  it("returns the frame's own index when it is a keyframe", () => {
    expect(resolveKeyframeIndex([makeKey(), makeHold()], 0)).toBe(0);
  });

  it("walks back to the nearest prior keyframe across holds", () => {
    expect(resolveKeyframeIndex([makeKey(), makeHold(), makeHold()], 2)).toBe(0);
  });

  it("picks the most recent keyframe when several precede the frame", () => {
    expect(resolveKeyframeIndex([makeKey(), makeHold(), makeKey(), makeHold()], 3)).toBe(2);
  });

  it("holds the last key past the end of the track — only a later blank key stops a hold", () => {
    expect(resolveKeyframeIndex([makeKey(), makeHold()], 5)).toBe(0);
    expect(resolveKeyframeIndex([makeKey(), makeHold()], 2)).toBe(0);
  });
});

function layer(id: number, cells: Cell[], over: Partial<DrawingLayer> = {}): DrawingLayer {
  return {
    kind: "draw",
    id,
    name: `L${id}`,
    visible: true,
    locked: false,
    opacity: 100,
    boilStrength: 1,
    groupId: null,
    cells,
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
    ...over,
  };
}
function proj(layers: DrawingLayer[], frameCount: number): Project {
  return {
    name: "t",
    width: 100,
    height: 100,
    fps: 12,
    bgColor: "#fff",
    frameCount,
    boil: defaultBoilConfig(),
    groups: [],
    layers,
    audio: null,
  };
}

function refLayer(id: number, over: Partial<ReferenceLayer> = {}): ReferenceLayer {
  const media: ReferenceMedia = { type: "image", el: {} as HTMLImageElement };
  return {
    kind: "ref",
    id,
    name: `R${id}`,
    visible: true,
    opacity: 60,
    offsetFrames: 0,
    speed: 1,
    audioEnabled: false,
    groupId: null,
    media,
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
    ...over,
  };
}

describe("buildFrameDrawList", () => {
  it("emits a draw op per visible drawing layer with a resolved keyframe, bottom→top", () => {
    const p = proj([layer(1, [makeKey(), makeHold()]), layer(2, [makeHold(), makeKey()])], 2);
    expect(buildFrameDrawList(p, 1)).toEqual([
      { kind: "draw", layerId: 1, keyframeIndex: 0, opacity: 100 },
      { kind: "draw", layerId: 2, keyframeIndex: 1, opacity: 100 },
    ]);
  });

  it("skips invisible layers", () => {
    const p = proj([layer(1, [makeKey()], { visible: false }), layer(2, [makeKey()])], 1);
    expect(buildFrameDrawList(p, 0)).toEqual([
      { kind: "draw", layerId: 2, keyframeIndex: 0, opacity: 100 },
    ]);
  });

  it("skips drawing layers with no keyframe yet at this frame", () => {
    const p = proj([layer(1, [makeHold(), makeKey()])], 2);
    expect(buildFrameDrawList(p, 0)).toEqual([]);
  });

  it("emits a ref op for visible reference layers, in z-order with drawing layers", () => {
    const p: Project = {
      name: "t",
      width: 10,
      height: 10,
      fps: 12,
      bgColor: "#fff",
      frameCount: 1,
      boil: defaultBoilConfig(),
      groups: [],
      layers: [refLayer(1), layer(2, [makeKey()], { id: 2 })],
      audio: null,
    };
    expect(buildFrameDrawList(p, 0)).toEqual([
      { kind: "ref", layerId: 1, opacity: 60 },
      { kind: "draw", layerId: 2, keyframeIndex: 0, opacity: 100 },
    ]);
  });

  it("excludes reference layers when includeReference is false", () => {
    const p: Project = {
      name: "t",
      width: 10,
      height: 10,
      fps: 12,
      bgColor: "#fff",
      frameCount: 1,
      boil: defaultBoilConfig(),
      groups: [],
      layers: [refLayer(1), layer(2, [makeKey()], { id: 2 })],
      audio: null,
    };
    expect(buildFrameDrawList(p, 0, false)).toEqual([
      { kind: "draw", layerId: 2, keyframeIndex: 0, opacity: 100 },
    ]);
  });

  it("omits a reference outside its range, keeps it inside", () => {
    const ref = {
      kind: "ref",
      id: 9,
      name: "R",
      visible: true,
      opacity: 60,
      offsetFrames: 0,
      speed: 1,
      audioEnabled: false,
      groupId: null,
      media: { type: "image", el: {} as HTMLImageElement },
      transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
      range: { start: 2, end: 4 },
    } as unknown as Layer;
    const p = { layers: [ref], groups: [], fps: 12 } as unknown as Project;

    expect(buildFrameDrawList(p, 1).length).toBe(0);
    expect(buildFrameDrawList(p, 2).map((o) => o.kind)).toEqual(["ref"]);
    expect(buildFrameDrawList(p, 4).map((o) => o.kind)).toEqual(["ref"]);
    expect(buildFrameDrawList(p, 5).length).toBe(0);
  });

  it("an untrimmed reference still draws on every frame", () => {
    const ref = {
      kind: "ref",
      id: 9,
      name: "R",
      visible: true,
      opacity: 60,
      offsetFrames: 0,
      speed: 1,
      audioEnabled: false,
      groupId: null,
      media: { type: "image", el: {} as HTMLImageElement },
      transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
    } as unknown as Layer;
    const p = { layers: [ref], groups: [], fps: 12 } as unknown as Project;
    expect(buildFrameDrawList(p, 0).length).toBe(1);
    expect(buildFrameDrawList(p, 500).length).toBe(1);
  });

  it("multiplies member opacity by group opacity", () => {
    const member = layer(1, [makeKey()], { opacity: 50, groupId: 1 });
    const p = proj([member], 1);
    p.groups = [{ id: 1, name: "G", collapsed: false, visible: true, opacity: 50 }];
    expect(buildFrameDrawList(p, 0)[0].opacity).toBe(25);
  });

  it("uses 100 for an ungrouped layer and for a group with no opacity", () => {
    const p = proj([layer(1, [makeKey()], { opacity: 50 })], 1);
    expect(buildFrameDrawList(p, 0)[0].opacity).toBe(50);

    const member = layer(2, [makeKey()], { opacity: 50, groupId: 1 });
    const p2 = proj([member], 1);
    p2.groups = [{ id: 1, name: "G", collapsed: false, visible: true }];
    expect(buildFrameDrawList(p2, 0)[0].opacity).toBe(50);
  });

  it("resolves an animated group opacity at the frame", () => {
    const member = layer(1, [makeKey(), makeKey()], { opacity: 100, groupId: 1 });
    const p = proj([member], 2);
    p.groups = [
      {
        id: 1,
        name: "G",
        collapsed: false,
        visible: true,
        tracks: {
          opacity: {
            keys: [
              { frame: 0, v: 100 },
              { frame: 1, v: 0 },
            ],
          },
        },
      },
    ];
    expect(buildFrameDrawList(p, 0)[0].opacity).toBe(100);
    expect(buildFrameDrawList(p, 1)[0].opacity).toBe(0);
  });

  it("multiplies animated layer opacity by animated group opacity", () => {
    const member = layer(1, [makeKey(), makeKey()], {
      opacity: 100,
      groupId: 1,
      tracks: {
        opacity: {
          keys: [
            { frame: 0, v: 50 },
            { frame: 1, v: 50 },
          ],
        },
      },
    });
    const p = proj([member], 2);
    p.groups = [
      {
        id: 1,
        name: "G",
        collapsed: false,
        visible: true,
        tracks: {
          opacity: {
            keys: [
              { frame: 0, v: 100 },
              { frame: 1, v: 50 },
            ],
          },
        },
      },
    ];
    expect(buildFrameDrawList(p, 0)[0].opacity).toBe(50);
    expect(buildFrameDrawList(p, 1)[0].opacity).toBe(25);
  });
});

describe("containRect", () => {
  it("centres a wide source inside a square box (letterboxed top/bottom)", () => {
    expect(containRect(200, 100, 100, 100)).toEqual({ x: 0, y: 25, w: 100, h: 50 });
  });
  it("centres a tall source inside a square box (pillarboxed left/right)", () => {
    expect(containRect(100, 200, 100, 100)).toEqual({ x: 25, y: 0, w: 50, h: 100 });
  });
  it("fills exactly when aspect ratios match", () => {
    expect(containRect(50, 25, 100, 50)).toEqual({ x: 0, y: 0, w: 100, h: 50 });
  });
  it("returns the full box for a zero-sized source", () => {
    expect(containRect(0, 0, 100, 80)).toEqual({ x: 0, y: 0, w: 100, h: 80 });
  });
});

describe("createReferenceLayer", () => {
  it("creates a faint, visible ref layer with the given media", () => {
    const media: ReferenceMedia = { type: "image", el: {} as HTMLImageElement };
    const r = createReferenceLayer(media, "bg.png");
    expect(r.kind).toBe("ref");
    expect(r.visible).toBe(true);
    expect(r.opacity).toBe(60);
    expect(r.offsetFrames).toBe(0);
    expect(r.name).toBe("bg.png");
    expect(r.media).toBe(media);
  });
});

describe("documentLength / refreshLength", () => {
  const draw = (len: number): DrawingLayer => ({
    kind: "draw",
    id: 1,
    name: "L",
    visible: true,
    locked: false,
    opacity: 100,
    boilStrength: 1,
    groupId: null,
    cells: Array.from({ length: len }, () => ({ kind: "hold" }) as Cell),
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
  });
  const ref = (): ReferenceLayer => ({
    kind: "ref",
    id: 9,
    name: "R",
    visible: true,
    opacity: 60,
    offsetFrames: 0,
    speed: 1,
    audioEnabled: false,
    groupId: null,
    media: { type: "image", el: {} as HTMLImageElement },
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
  });

  it("documentLength is the longest drawing layer, ignoring reference layers", () => {
    const p: Project = {
      name: "t",
      width: 1,
      height: 1,
      fps: 12,
      bgColor: "#fff",
      frameCount: 0,
      boil: defaultBoilConfig(),
      groups: [],
      layers: [draw(7), draw(3), ref()],
      audio: null,
    };
    expect(documentLength(p)).toBe(7);
  });

  it("documentLength floors at 1", () => {
    const p: Project = {
      name: "t",
      width: 1,
      height: 1,
      fps: 12,
      bgColor: "#fff",
      frameCount: 0,
      boil: defaultBoilConfig(),
      groups: [],
      layers: [ref()],
      audio: null,
    };
    expect(documentLength(p)).toBe(1);
  });

  it("documentLength floors at 1 even for a zero-length draw layer", () => {
    const p: Project = {
      name: "t",
      width: 1,
      height: 1,
      fps: 12,
      bgColor: "#fff",
      frameCount: 0,
      boil: defaultBoilConfig(),
      groups: [],
      layers: [draw(0)],
      audio: null,
    };
    expect(documentLength(p)).toBe(1);
  });

  it("refreshLength writes documentLength into frameCount", () => {
    const p: Project = {
      name: "t",
      width: 1,
      height: 1,
      fps: 12,
      bgColor: "#fff",
      frameCount: 99,
      boil: defaultBoilConfig(),
      groups: [],
      layers: [draw(4)],
      audio: null,
    };
    refreshLength(p);
    expect(p.frameCount).toBe(4);
  });
});

describe("isCrispFrame", () => {
  it("holds-only: a frame that is its own keyframe stays crisp", () => {
    expect(isCrispFrame([makeKey(), makeHold()], 0, true)).toBe(true); // own key → crisp
    expect(isCrispFrame([makeKey(), makeHold()], 1, true)).toBe(false); // hold → boil
  });
  it("holds-only off: nothing is crisp", () => {
    expect(isCrispFrame([makeKey(), makeHold()], 0, false)).toBe(false);
    expect(isCrispFrame([makeKey(), makeHold()], 1, false)).toBe(false);
  });
  it("past the track end is not crisp (no own keyframe there)", () => {
    expect(isCrispFrame([makeKey()], 5, true)).toBe(false);
  });
});

describe("boil config defaults", () => {
  it("a new project starts with disabled boil + tuned defaults", () => {
    expect(createProject().boil).toEqual({
      enabled: false,
      amount: 1,
      cols: 20,
      rate: 3,
      weight: 0.4,
      holdsOnly: true,
    });
  });
  it("defaultBoilConfig returns a fresh copy each call", () => {
    const a = defaultBoilConfig();
    a.amount = 99;
    expect(defaultBoilConfig().amount).toBe(1);
  });
  it("a new drawing layer has boilStrength 1", () => {
    expect(createDrawingLayer(1, "L").boilStrength).toBe(1);
  });
});

describe("createProject transparentBg", () => {
  it("defaults to false (opaque)", () => {
    expect(createProject().transparentBg).toBe(false);
  });
});

describe("resolveLayerName", () => {
  it("returns the new name when non-empty", () => {
    expect(resolveLayerName("Old", "Hero")).toBe("Hero");
  });
  it("trims surrounding whitespace", () => {
    expect(resolveLayerName("Old", "  Hero  ")).toBe("Hero");
  });
  it("keeps the current name for empty input", () => {
    expect(resolveLayerName("Old", "")).toBe("Old");
  });
  it("keeps the current name for whitespace-only input", () => {
    expect(resolveLayerName("Old", "   ")).toBe("Old");
  });
});

describe("resizeCells", () => {
  it("grows by appending holds to the target length", () => {
    expect(resizeCells([key, hold], 5)).toHaveLength(5);
  });
  it("appended cells are holds", () => {
    const out = resizeCells([key], 3);
    expect(out.slice(1).every((c) => c.kind === "hold")).toBe(true);
  });
  it("shrinks by slicing to the target length", () => {
    expect(resizeCells([key, hold, key, hold], 2).map((c) => c.kind)).toEqual(["key", "hold"]);
  });
  it("returns the same contents when n equals the current length", () => {
    expect(resizeCells([key, hold], 2).map((c) => c.kind)).toEqual(["key", "hold"]);
  });
  it("does not mutate the input array", () => {
    const cells = [key];
    resizeCells(cells, 4);
    expect(cells).toHaveLength(1);
  });
});

function drawLayers(...layerCells: Cell[][]): Project {
  return {
    layers: layerCells.map((cells, i) => ({
      kind: "draw",
      id: i + 1,
      name: "",
      visible: true,
      locked: false,
      opacity: 100,
      boilStrength: 1,
      cells,
    })),
  } as unknown as Project;
}

describe("countKeyframesPastLengthIn (snapshot-based count)", () => {
  it("counts keys past the length in a bare layer list", () => {
    const layers = [layer(1, [makeKey(), makeHold(), makeKey(), makeKey()])];
    expect(countKeyframesPastLengthIn(layers, 2)).toBe(2);
    expect(countKeyframesPastLengthIn(layers, 4)).toBe(0);
  });

  it("is what makes a LIVE shrink able to warn at all", () => {
    // The drag applies each step immediately, and resizeCells SLICES, so by the time it asks
    // "how many would this drop?" the live cells no longer have them — counting there returns 0
    // and the warning never fires. The grab-time snapshot still holds the originals.
    const original = [layer(1, [makeKey(), makeHold(), makeKey(), makeKey()])];
    const afterLiveShrink = [layer(1, resizeCells(original[0].cells, 2))];

    expect(countKeyframesPastLengthIn(afterLiveShrink, 2)).toBe(0); // the trap
    expect(countKeyframesPastLengthIn(original, 2)).toBe(2); // the answer the user needs
  });

  it("ignores reference layers, which have no cells to drop", () => {
    const ref = {
      kind: "ref",
      id: 9,
      name: "R",
      visible: true,
      opacity: 60,
      offsetFrames: 0,
      speed: 1,
      audioEnabled: false,
      groupId: null,
      media: { type: "missing", was: "image", name: "x" },
      transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
    } as unknown as Layer;
    expect(countKeyframesPastLengthIn([ref], 0)).toBe(0);
  });
});

describe("countKeyframesPastLength", () => {
  it("counts keyframes at index >= n across layers", () => {
    const p = drawLayers([key, hold, key, key], [hold, key, hold, key]);
    expect(countKeyframesPastLength(p, 2)).toBe(3);
  });
  it("returns 0 when all keyframes are within [0, n)", () => {
    expect(countKeyframesPastLength(drawLayers([key, key, hold, hold]), 2)).toBe(0);
  });
  it("ignores trailing holds", () => {
    expect(countKeyframesPastLength(drawLayers([key, hold, hold, hold]), 1)).toBe(0);
  });
  it("ignores reference layers", () => {
    const p = {
      layers: [{ kind: "ref" }, { kind: "draw", cells: [key, key] }],
    } as unknown as Project;
    expect(countKeyframesPastLength(p, 1)).toBe(1);
  });
});

describe("mediaIntrinsicSize (missing media)", () => {
  it("returns {0,0} for a missing placeholder", () => {
    expect(mediaIntrinsicSize({ type: "missing", was: "image", name: "x.png" })).toEqual({
      w: 0,
      h: 0,
    });
  });
});

describe("layer groups", () => {
  const grp = (over = {}) => ({ id: 10, name: "G", collapsed: false, visible: true, ...over });
  const dlayer = (id: number, cells: Cell[], over: Partial<DrawingLayer> = {}) =>
    layer(id, cells, over);
  it("ungrouped visible layer is visible", () => {
    expect(isLayerVisible(dlayer(1, [makeKey()]), [])).toBe(true);
  });
  it("layer in a visible group is visible", () => {
    expect(isLayerVisible(dlayer(1, [makeKey()], { groupId: 10 }), [grp()])).toBe(true);
  });
  it("layer in a hidden group is not visible", () => {
    expect(isLayerVisible(dlayer(1, [makeKey()], { groupId: 10 }), [grp({ visible: false })])).toBe(
      false,
    );
  });
  it("a hidden layer is never visible", () => {
    expect(isLayerVisible(dlayer(1, [makeKey()], { visible: false }), [])).toBe(false);
  });
  it("dangling groupId → treated as ungrouped", () => {
    expect(groupOf(dlayer(1, [makeKey()], { groupId: 99 }), [grp()])).toBe(null);
    expect(isLayerVisible(dlayer(1, [makeKey()], { groupId: 99 }), [grp({ visible: false })])).toBe(
      true,
    );
  });
  it("nonEmptyGroups drops member-less groups", () => {
    expect(
      nonEmptyGroups(
        [grp({ id: 10 }), grp({ id: 11 })],
        [dlayer(1, [makeKey()], { groupId: 10 })],
      ).map((g) => g.id),
    ).toEqual([10]);
  });
  it("buildFrameDrawList omits layers in a hidden group", () => {
    const p = {
      groups: [{ id: 10, name: "G", collapsed: false, visible: false }],
      layers: [dlayer(1, [makeKey()], { groupId: 10 }), dlayer(2, [makeKey()])],
    } as unknown as Project;
    expect(buildFrameDrawList(p, 0).map((o) => o.layerId)).toEqual([2]);
  });
});

describe("layer transform helpers", () => {
  it("isIdentityTransform detects identity", () => {
    expect(isIdentityTransform(IDENTITY_TRANSFORM)).toBe(true);
    expect(isIdentityTransform({ dx: 1, dy: 0, scale: 1, rotation: 0 })).toBe(false);
    expect(isIdentityTransform({ dx: 0, dy: 0, scale: 2, rotation: 0 })).toBe(false);
  });

  it("createDrawingLayer starts at identity", () => {
    expect(isIdentityTransform(createDrawingLayer(3, "L").transform)).toBe(true);
  });

  it("transformBaseRect: full document for a draw layer", () => {
    expect(transformBaseRect(createDrawingLayer(1, "L"), 100, 80)).toEqual({
      x: 0,
      y: 0,
      w: 100,
      h: 80,
    });
  });

  it("transformBaseRect: contain-fit for a ref, null when media unloaded", () => {
    const loaded = createReferenceLayer(
      {
        type: "image",
        el: { naturalWidth: 50, naturalHeight: 50 } as unknown as HTMLImageElement,
      },
      "R",
    );
    const r = transformBaseRect(loaded, 100, 100);
    expect(r).not.toBeNull();
    expect(r!.w).toBeCloseTo(100, 5);
    const unloaded = createReferenceLayer(
      {
        type: "image",
        el: { naturalWidth: 0, naturalHeight: 0 } as unknown as HTMLImageElement,
      },
      "R",
    );
    expect(transformBaseRect(unloaded, 100, 100)).toBeNull();
  });
});

describe("isLayerEditable", () => {
  it("requires a drawing layer that is unlocked AND visible", () => {
    const base = layer(1, [makeKey()]);
    expect(isLayerEditable(base, [])).toBe(true);
    expect(isLayerEditable({ ...base, locked: true }, [])).toBe(false);
    expect(isLayerEditable({ ...base, visible: false }, [])).toBe(false);
    expect(isLayerEditable({ ...base, locked: true, visible: false }, [])).toBe(false);
  });

  it("reference layers are never content-editable", () => {
    const ref = {
      kind: "ref" as const,
      id: 9,
      name: "R",
      visible: true,
      opacity: 60,
      offsetFrames: 0,
      speed: 1,
      audioEnabled: false,
      groupId: null,
      media: { type: "missing" as const, was: "image" as const, name: "x" },
      transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
    };
    expect(isLayerEditable(ref, [])).toBe(false);
    expect(whyNotEditable(ref, [])).toBe("not-draw");
  });

  it("whyNotEditable names the block, lock before hidden", () => {
    const base = layer(1, [makeKey()]);
    expect(whyNotEditable(base, [])).toBeNull();
    expect(whyNotEditable({ ...base, locked: true }, [])).toBe("locked");
    expect(whyNotEditable({ ...base, visible: false }, [])).toBe("hidden");
    expect(whyNotEditable({ ...base, locked: true, visible: false }, [])).toBe("locked");
  });
});

describe("rasterizeKeyframePlan", () => {
  it("an untrimmed ref keeps the old behaviour — one key at frame 0, no blank", () => {
    expect(rasterizeKeyframePlan(null, 48)).toEqual({ imageFrame: 0, blankFrame: null });
  });

  it("a trimmed ref puts the image at the range start and a blank one past its end", () => {
    // The reported bug: frames 11..47 used to keep showing the image.
    expect(rasterizeKeyframePlan({ start: 0, end: 10 }, 48)).toEqual({
      imageFrame: 0,
      blankFrame: 11,
    });
  });

  it("frames before the range are left to leading holds, which resolve to nothing", () => {
    expect(rasterizeKeyframePlan({ start: 6, end: 14 }, 48)).toEqual({
      imageFrame: 6,
      blankFrame: 15,
    });
  });

  it("writes no blank key when the range runs to the last frame", () => {
    expect(rasterizeKeyframePlan({ start: 4, end: 47 }, 48)).toEqual({
      imageFrame: 4,
      blankFrame: null,
    });
  });

  it("writes no blank key when the range runs PAST the last frame", () => {
    expect(rasterizeKeyframePlan({ start: 4, end: 900 }, 48)).toEqual({
      imageFrame: 4,
      blankFrame: null,
    });
  });

  it("a range starting past the project yields a wholly blank layer", () => {
    expect(rasterizeKeyframePlan({ start: 48, end: 60 }, 48)).toEqual({
      imageFrame: null,
      blankFrame: null,
    });
  });

  it("clamps a negative start rather than writing an out-of-bounds key", () => {
    expect(rasterizeKeyframePlan({ start: -5, end: 10 }, 48)).toEqual({
      imageFrame: 0,
      blankFrame: 11,
    });
  });

  it("a single-frame range blanks the very next frame", () => {
    expect(rasterizeKeyframePlan({ start: 7, end: 7 }, 48)).toEqual({
      imageFrame: 7,
      blankFrame: 8,
    });
  });
});

describe("layer-action availability (what the LayerList buttons dim on)", () => {
  const ref = (id: number, over = {}): ReferenceLayer => ({
    kind: "ref",
    id,
    name: `R${id}`,
    visible: true,
    opacity: 60,
    offsetFrames: 0,
    speed: 1,
    audioEnabled: false,
    groupId: null,
    media: { type: "missing", was: "image", name: "x" },
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
    ...over,
  });

  describe("canRemoveLayer", () => {
    it("refuses the LAST drawing layer, allows it once a second exists", () => {
      const a = layer(1, [makeKey()]);
      expect(canRemoveLayer([a], 1)).toBe(false);
      expect(canRemoveLayer([a, layer(2, [makeKey()])], 1)).toBe(true);
    });

    it("a reference layer does not count toward the one-drawing-layer minimum", () => {
      const a = layer(1, [makeKey()]);
      expect(canRemoveLayer([a, ref(2)], 1)).toBe(false); // still the only DRAWING layer
      expect(canRemoveLayer([a, ref(2)], 2)).toBe(true); // the ref itself is removable
    });

    it("a reference layer is removable even as the only layer left", () => {
      expect(canRemoveLayer([ref(9)], 9)).toBe(true);
    });

    it("false for an unknown id", () => {
      expect(canRemoveLayer([layer(1, [makeKey()])], 99)).toBe(false);
    });
  });

  describe("canDuplicateLayer", () => {
    it("drawing layers only — duplication clones pixels", () => {
      expect(canDuplicateLayer([layer(1, [makeKey()])], 1)).toBe(true);
      expect(canDuplicateLayer([ref(2)], 2)).toBe(false);
      expect(canDuplicateLayer([layer(1, [makeKey()])], 99)).toBe(false);
    });

    it("does not care about lock or visibility (management, not content)", () => {
      const l = layer(1, [makeKey()], { locked: true, visible: false });
      expect(canDuplicateLayer([l], 1)).toBe(true);
    });
  });

  describe("whyNotMergeDown", () => {
    const g = (over = {}) => ({ id: 7, name: "G", collapsed: false, visible: true, ...over });

    it("allows a merge into an editable drawing layer below", () => {
      const layers = [layer(1, [makeKey()]), layer(2, [makeKey()])];
      expect(whyNotMergeDown(layers, [], 2)).toBeNull();
    });

    it("names the bottom layer and an unknown id as having nothing below", () => {
      const layers = [layer(1, [makeKey()]), layer(2, [makeKey()])];
      expect(whyNotMergeDown(layers, [], 1)).toBe("no-layer-below");
      expect(whyNotMergeDown(layers, [], 99)).toBe("no-layer-below");
    });

    it("refuses when either side is a reference layer", () => {
      expect(whyNotMergeDown([ref(1), layer(2, [makeKey()])], [], 2)).toBe("not-drawing");
      expect(whyNotMergeDown([layer(1, [makeKey()]), ref(2)], [], 2)).toBe("not-drawing");
    });

    it("refuses when either side is locked or hidden — merge rewrites both tracks", () => {
      const below = layer(1, [makeKey()]);
      const upper = layer(2, [makeKey()]);
      expect(whyNotMergeDown([{ ...below, locked: true }, upper], [], 2)).toBe("read-only");
      expect(whyNotMergeDown([below, { ...upper, locked: true }], [], 2)).toBe("read-only");
      expect(whyNotMergeDown([{ ...below, visible: false }, upper], [], 2)).toBe("read-only");
    });

    it("honors GROUP-derived lock and visibility, not just the layer's own flags", () => {
      const below = { ...layer(1, [makeKey()]), groupId: 7 };
      const upper = layer(2, [makeKey()]);
      expect(whyNotMergeDown([below, upper], [g()], 2)).toBeNull();
      expect(whyNotMergeDown([below, upper], [g({ locked: true })], 2)).toBe("read-only");
      expect(whyNotMergeDown([below, upper], [g({ visible: false })], 2)).toBe("read-only");
    });

    it("refuses when either side is ANIMATED — merge bakes a transform that varies", () => {
      const track = {
        keys: [{ frame: 0, v: { dx: 0, dy: 0, scale: 1, rotation: 0 } }],
        box: null,
      };
      const below = layer(1, [makeKey()]);
      const upper = layer(2, [makeKey()]);
      expect(whyNotMergeDown([{ ...below, tracks: { transform: track } }, upper], [], 2)).toBe(
        "animated",
      );
      expect(whyNotMergeDown([below, { ...upper, tracks: { transform: track } }], [], 2)).toBe(
        "animated",
      );
    });

    // Same argument, one property over: the merge composites at the STATIC `upper.opacity`, which on
    // an animated layer is retained but ignored, so a fade would be burned in at its seed alpha and
    // the track would vanish with the merged layer.
    it("refuses when either side has an OPACITY track too", () => {
      const opacity = { keys: [{ frame: 0, v: 100 }] };
      const below = layer(1, [makeKey()]);
      const upper = layer(2, [makeKey()]);
      expect(whyNotMergeDown([{ ...below, tracks: { opacity } }, upper], [], 2)).toBe("animated");
      expect(whyNotMergeDown([below, { ...upper, tracks: { opacity } }], [], 2)).toBe("animated");
    });

    // `isLayerAnimated` reads the LAYER's own bag, so a group opacity track was invisible to it —
    // and a merge across a group boundary drops the upper layer's group contribution entirely.
    it("refuses across a group boundary when the owning GROUP is animated", () => {
      const opacity = { keys: [{ frame: 0, v: 100 }] };
      const below = layer(1, [makeKey()]);
      const upper = { ...layer(2, [makeKey()]), groupId: 7 };
      expect(whyNotMergeDown([below, upper], [g({ tracks: { opacity } })], 2)).toBe("animated");
      // ...and the other way: the upper layer's pixels would GAIN the lower's group animation.
      const belowIn = { ...layer(1, [makeKey()]), groupId: 7 };
      expect(
        whyNotMergeDown([belowIn, layer(2, [makeKey()])], [g({ tracks: { opacity } })], 2),
      ).toBe("animated");
    });

    it("allows a merge INSIDE an animated group — the contribution is unchanged either way", () => {
      const opacity = { keys: [{ frame: 0, v: 100 }] };
      const below = { ...layer(1, [makeKey()]), groupId: 7 };
      const upper = { ...layer(2, [makeKey()]), groupId: 7 };
      expect(whyNotMergeDown([below, upper], [g({ tracks: { opacity } })], 2)).toBeNull();
    });

    it("reports the structural block before the read-only one", () => {
      // A locked BOTTOM layer has nothing below it either — the more fundamental reason wins.
      const layers = [layer(1, [makeKey()], { locked: true }), layer(2, [makeKey()])];
      expect(whyNotMergeDown(layers, [], 1)).toBe("no-layer-below");
    });
  });
});

describe("group lock/visibility are DERIVED onto members", () => {
  const g = (over = {}) => ({ id: 7, name: "G", collapsed: false, visible: true, ...over });

  it("a locked group locks its members without touching their own flags", () => {
    const child = { ...layer(1, [makeKey()]), groupId: 7 };
    expect(isLayerEditable(child, [g()])).toBe(true);
    expect(isLayerEditable(child, [g({ locked: true })])).toBe(false);
    expect(child.locked).toBe(false); // nothing cascaded — unlocking the group restores it for free
    expect(isLayerLocked(child, [g({ locked: true })])).toBe(true);
  });

  it("a HIDDEN group makes members uneditable too (was editable-but-invisible)", () => {
    const child = { ...layer(2, [makeKey()]), groupId: 7 };
    expect(isLayerEditable(child, [g({ visible: false })])).toBe(false);
  });

  it("a member's own lock still applies inside an unlocked group", () => {
    const child = { ...layer(3, [makeKey()]), groupId: 7, locked: true };
    expect(isLayerEditable(child, [g()])).toBe(false);
  });

  it("layers outside the group are unaffected", () => {
    const outside = { ...layer(4, [makeKey()]), groupId: null };
    expect(isLayerEditable(outside, [g({ locked: true, visible: false })])).toBe(true);
  });
});

describe("groupHasLockedLayer", () => {
  it("true only when a draw member of the group is locked", () => {
    const inGroup = { ...layer(1, [makeKey()]), groupId: 7, locked: true };
    const outside = { ...layer(2, [makeKey()]), groupId: null, locked: true };
    const unlockedMember = { ...layer(3, [makeKey()]), groupId: 7 };
    const g = { id: 7, name: "G", collapsed: false, visible: true };
    expect(groupHasLockedLayer(g, [unlockedMember, outside])).toBe(false);
    expect(groupHasLockedLayer(g, [inGroup, unlockedMember])).toBe(true);
  });
});

describe("groupHasLockedLayer covers reference members", () => {
  it("a locked REF member pins the group (render applies group transforms to refs)", () => {
    const g = { id: 9, name: "G", collapsed: false, visible: true };
    const ref = { kind: "ref", id: 1, groupId: 9, locked: true };
    const draw = { kind: "draw", id: 2, groupId: 9, locked: false };
    expect(groupHasLockedLayer(g, [ref, draw])).toBe(true);
    expect(groupHasLockedLayer(g, [{ ...ref, locked: false }, draw])).toBe(false);
  });
});

describe("refVisibleSpan / isRefVisibleAtFrame", () => {
  const imageRef = (over: Partial<ReferenceLayer> = {}): ReferenceLayer =>
    ({
      kind: "ref",
      id: 1,
      name: "R",
      visible: true,
      opacity: 60,
      offsetFrames: 0,
      speed: 1,
      audioEnabled: false,
      groupId: null,
      media: { type: "image", el: {} as HTMLImageElement },
      transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
      ...over,
    }) as ReferenceLayer;

  const videoRef = (duration: number, over: Partial<ReferenceLayer> = {}): ReferenceLayer =>
    imageRef({
      media: { type: "video", el: { duration } as HTMLVideoElement },
      ...over,
    });

  it("an untrimmed image is ALWAYS visible (null span)", () => {
    const l = imageRef();
    expect(refVisibleSpan(l, 12)).toBeNull();
    expect(isRefVisibleAtFrame(l, 0, 12)).toBe(true);
    expect(isRefVisibleAtFrame(l, 9999, 12)).toBe(true);
  });

  it("a trimmed image uses its stored range, inclusive on both ends", () => {
    const l = imageRef({ range: { start: 6, end: 14 } });
    expect(refVisibleSpan(l, 12)).toEqual({ start: 6, end: 14 });
    expect(isRefVisibleAtFrame(l, 5, 12)).toBe(false);
    expect(isRefVisibleAtFrame(l, 6, 12)).toBe(true); // boundary
    expect(isRefVisibleAtFrame(l, 14, 12)).toBe(true); // boundary
    expect(isRefVisibleAtFrame(l, 15, 12)).toBe(false);
  });

  it("a video's span is DERIVED from its footage", () => {
    // 2s at 12fps, speed 1, no offset -> 24 frames, 0..23
    expect(refVisibleSpan(videoRef(2), 12)).toEqual({ start: 0, end: 23 });
  });

  it("a video's derived span honours offsetFrames and speed", () => {
    // offset -12 shifts the visible start to frame 12; 2s at 2x -> 12 frames, 12..23
    expect(refVisibleSpan(videoRef(2, { offsetFrames: -24, speed: 2 }), 12)).toEqual({
      start: 12,
      end: 23,
    });
  });

  it("a video with no duration yet is ALWAYS visible, not blank", () => {
    // preload="metadata" is lazy; blinking out on first paint would look like a bug
    expect(refVisibleSpan(videoRef(NaN), 12)).toBeNull();
    expect(refVisibleSpan(videoRef(0), 12)).toBeNull();
    expect(refVisibleSpan(videoRef(Infinity), 12)).toBeNull();
  });

  it("a video IGNORES a stored range (its span is its footage)", () => {
    const l = videoRef(2, { range: { start: 100, end: 200 } });
    expect(refVisibleSpan(l, 12)).toEqual({ start: 0, end: 23 });
  });

  it("missing media is always (nothing to draw either way)", () => {
    const l = imageRef({
      media: { type: "missing", was: "image", name: "x" },
      range: { start: 3, end: 5 },
    });
    expect(refVisibleSpan(l, 12)).toBeNull();
  });

  it("a sub-frame video still spans exactly one frame", () => {
    // An EMPTY span is unreachable: dur <= 0 returns null before deriving, and ceil() of any
    // positive duration is >= 1. So the floor is one frame, not zero.
    const l = videoRef(0.0001);
    expect(refVisibleSpan(l, 12)).toEqual({ start: 0, end: 0 });
    expect(isRefVisibleAtFrame(l, 0, 12)).toBe(true);
    expect(isRefVisibleAtFrame(l, 1, 12)).toBe(false);
  });

  it("a trimmed video's span is its KEPT footage, not the whole file", () => {
    // 2s at 12fps = 24 source frames. Skip 6, keep 12 → 12 project frames at 1×, still starting at 0
    // because a head trim also moves offsetFrames so the kept picture stays put.
    const l = videoRef(2, { trimInFrames: 6, trimLenFrames: 12, offsetFrames: -6 });
    expect(refVisibleSpan(l, 12)).toEqual({ start: 6, end: 17 });
    expect(isRefVisibleAtFrame(l, 5, 12)).toBe(false);
    expect(isRefVisibleAtFrame(l, 6, 12)).toBe(true);
    expect(isRefVisibleAtFrame(l, 17, 12)).toBe(true);
    expect(isRefVisibleAtFrame(l, 18, 12)).toBe(false);
  });

  it("drawing layers can carry transform/opacity tracks; references cannot", () => {
    expect(layerAcceptsPropertyTracks(layer(1, [makeKey()]))).toBe(true);
    expect(layerAcceptsPropertyTracks(imageRef())).toBe(false);
    expect(layerAcceptsPropertyTracks(videoRef(2))).toBe(false);
    expect(
      layerAcceptsPropertyTracks(imageRef({ media: { type: "missing", was: "video", name: "x" } })),
    ).toBe(false);
  });

  // A project saved by the PREVIOUS release can carry an animated reference (that build had no kind
  // gate). Every READER already ignored it; the WRITERS read the bag raw, so the gizmo kept keying a
  // track nothing resolved and the reference could not be moved at all, with no route out. The gate
  // lives on the accessors so both drag sites, `animated` and both Apply/Reset refusals agree.
  it("a leftover reference track reads as absent through the accessors — but is NOT destroyed", () => {
    const ref = imageRef() as Layer;
    ref.tracks = {
      transform: { keys: [{ frame: 3, v: { dx: 5, dy: 0, scale: 1, rotation: 0 } }], box: null },
      opacity: { keys: [{ frame: 3, v: 40 }] },
    };
    expect(layerTransformTrack(ref)).toBeUndefined();
    expect(layerOpacityTrack(ref)).toBeUndefined();
    expect(isLayerAnimated(ref)).toBe(false);
    // The readers agree: the STATIC values are what render, at every frame.
    expect(transformAt(ref, 3)).toEqual(ref.transform);
    expect(opacityAt(ref, 3)).toBe(ref.opacity);
    // Inert, not stripped — the bytes are the only copy of that data.
    expect(ref.tracks?.transform?.keys).toHaveLength(1);
    expect(ref.tracks?.opacity?.keys).toHaveLength(1);
  });

  it("a drawing layer's tracks still read through", () => {
    const l = layer(1, [makeKey()]);
    l.tracks = { opacity: { keys: [{ frame: 0, v: 20 }] } };
    expect(layerOpacityTrack(l)?.keys).toHaveLength(1);
    expect(opacityAt(l, 0)).toBe(20);
  });
});

describe("nextLayerName", () => {
  const named = (...names: string[]) => names.map((name) => ({ name }) as Layer);

  it("starts at 1 for an empty project", () => {
    expect(nextLayerName([])).toBe("Layer 1");
  });

  it("continues the series from the highest existing number", () => {
    expect(nextLayerName(named("Layer 1", "Layer 2"))).toBe("Layer 3");
  });

  // MAX + 1, not lowest-unused: a name that was just in use is never immediately recycled onto
  // different content.
  it("does not reuse a deleted number", () => {
    expect(nextLayerName(named("Layer 1", "Layer 3"))).toBe("Layer 4");
  });

  it("ignores renamed layers, which have left the series", () => {
    expect(nextLayerName(named("Harry", "Dale"))).toBe("Layer 1");
    expect(nextLayerName(named("Layer 2", "Background"))).toBe("Layer 3");
  });

  // The regression test for the reported bug. `setMinLayerId` pushes the session-wide id counter
  // past every id in a loaded project, and the name used to be built from that id — so a brand-new
  // project's next layer came out as "Layer 501". Identity must still climb; the LABEL must not.
  it("names a new layer from the project, never from the session-wide id", () => {
    setMinLayerId(500);
    const layer = createDrawingLayer(1, nextLayerName([]));
    expect(layer.name).toBe("Layer 1");
    expect(layer.id).toBeGreaterThanOrEqual(500);
  });

  it("only counts exact `<prefix> <digits>` names", () => {
    expect(nextLayerName(named("Layer 2 copy", "Layer", "Layer 1a", "layer 9"))).toBe("Layer 1");
  });

  it("takes a prefix, so other series number independently", () => {
    expect(nextLayerName(named("Layer 7", "Reference 2"), "Reference")).toBe("Reference 3");
  });
});

// Opacity enters the render at exactly ONE site, and that site is pure — so unlike the transform
// track, an animated fade can be asserted end to end with no canvas at all. These are the cheapest
// confidence in the whole feature; write them properly.
describe("animated opacity through buildFrameDrawList", () => {
  function animatedLayer() {
    // 11 cells (index 0 a key, the rest holds) so `resolveKeyframeIndex` resolves for every frame
    // 0..10 these tests scrub through — `buildFrameDrawList` looks up the draw op's keyframe
    // independently of the opacity track, and a too-short `cells` array would make it return no op
    // at all for a frame past the array's end, which is not what these tests are about.
    const l = createDrawingLayer(11, "L");
    l.cells[0] = { kind: "key", canvas: {} as HTMLCanvasElement };
    l.opacity = 100;
    l.tracks = {
      opacity: {
        keys: [
          { frame: 0, v: 0 },
          { frame: 10, v: 100 },
        ],
      },
    };
    return l;
  }

  it("stamps the RESOLVED opacity onto the draw op", () => {
    const p = createProject();
    p.layers = [animatedLayer()];
    p.frameCount = 11;
    expect(buildFrameDrawList(p, 0)[0].opacity).toBe(0);
    expect(buildFrameDrawList(p, 5)[0].opacity).toBeCloseTo(50, 10);
    expect(buildFrameDrawList(p, 10)[0].opacity).toBe(100);
  });

  it("a hold segment is a hard cut, not a fade", () => {
    const p = createProject();
    const l = animatedLayer();
    l.tracks!.opacity!.keys[0].interp = "hold";
    p.layers = [l];
    p.frameCount = 11;
    expect(buildFrameDrawList(p, 9)[0].opacity).toBe(0);
    expect(buildFrameDrawList(p, 10)[0].opacity).toBe(100);
  });

  it("falls back to the static field with no track", () => {
    const p = createProject();
    const l = animatedLayer();
    l.tracks = undefined;
    l.opacity = 42;
    p.layers = [l];
    expect(buildFrameDrawList(p, 5)[0].opacity).toBe(42);
  });
});
