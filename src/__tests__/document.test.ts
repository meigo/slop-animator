import { describe, it, expect } from "vitest";
import {
  groupHasLockedLayer,
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
  defaultBoilConfig,
  isCrispFrame,
  resolveLayerName,
  resizeCells,
  countKeyframesPastLength,
  mediaIntrinsicSize,
  isLayerVisible,
  groupOf,
  nonEmptyGroups,
  IDENTITY_TRANSFORM,
  isIdentityTransform,
  transformBaseRect,
  type Cell,
  type Project,
  type DrawingLayer,
  type ReferenceMedia,
  type ReferenceLayer,
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

  it("returns null past the end of the track (blank after end)", () => {
    expect(resolveKeyframeIndex([makeKey(), makeHold()], 5)).toBeNull();
    expect(resolveKeyframeIndex([makeKey(), makeHold()], 2)).toBeNull();
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
    expect(isIdentityTransform(createDrawingLayer(3).transform)).toBe(true);
  });

  it("transformBaseRect: full document for a draw layer", () => {
    expect(transformBaseRect(createDrawingLayer(1), 100, 80)).toEqual({
      x: 0,
      y: 0,
      w: 100,
      h: 80,
    });
  });

  it("transformBaseRect: contain-fit for a ref, null when media unloaded", () => {
    const loaded = createReferenceLayer({
      type: "image",
      el: { naturalWidth: 50, naturalHeight: 50 } as unknown as HTMLImageElement,
    });
    const r = transformBaseRect(loaded, 100, 100);
    expect(r).not.toBeNull();
    expect(r!.w).toBeCloseTo(100, 5);
    const unloaded = createReferenceLayer({
      type: "image",
      el: { naturalWidth: 0, naturalHeight: 0 } as unknown as HTMLImageElement,
    });
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
