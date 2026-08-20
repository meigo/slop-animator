import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import {
  setMinLayerId,
  createDrawingLayer,
  defaultBoilConfig,
  createProject,
  createReferenceLayer,
} from "../anim/document";
import {
  projectToJson,
  frameAssetPath,
  migrateBoil,
  insertReferencesByIndex,
  saveProjectBlob,
  loadProjectBlob,
  referencedMediaIds,
  mediaIdsToEmbed,
  shouldRestoreMedia,
  sanitizeFilename,
  collectFrameAssets,
} from "../persist/project-file";
import type { Project, Cell, DrawingLayer, ReferenceLayer } from "../anim/document";

function key(): Cell {
  return { kind: "key", canvas: {} as HTMLCanvasElement };
}
function hold(): Cell {
  return { kind: "hold" };
}
function dlayer(id: number, cells: Cell[]): DrawingLayer {
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
  };
}
function rlayer(id: number): ReferenceLayer {
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
    media: { type: "image", el: {} as HTMLImageElement },
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
  };
}

describe("projectToJson", () => {
  it("serializes settings (incl. boil) and drawing layers, excluding reference layers", () => {
    const p: Project = {
      name: "t",
      width: 800,
      height: 600,
      fps: 8,
      bgColor: "#eee",
      frameCount: 2,
      boil: { enabled: true, amount: 2, cols: 16, rate: 2, weight: 0.4, holdsOnly: true },
      groups: [],
      layers: [dlayer(1, [key(), hold()]), rlayer(2)],
      audio: null,
    };
    expect(projectToJson(p)).toEqual({
      version: 1,
      name: "t",
      width: 800,
      height: 600,
      fps: 8,
      bgColor: "#eee",
      transparentBg: false,
      frameCount: 2,
      boil: { enabled: true, amount: 2, cols: 16, rate: 2, weight: 0.4, holdsOnly: true },
      groups: [],
      layers: [
        {
          id: 1,
          name: "L1",
          visible: true,
          locked: false,
          opacity: 100,
          boilStrength: 1,
          groupId: null,
          cells: ["key", "hold"],
          transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
          cellTransforms: {},
        },
      ],
      references: [
        {
          index: 1,
          id: 2,
          name: "R2",
          visible: true,
          opacity: 60,
          offsetFrames: 0,
          speed: 1,
          audioEnabled: false,
          groupId: null,
          was: "image",
          transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
        },
      ],
      audio: null,
    });
  });

  it("serializes transparentBg when set", () => {
    const p: Project = {
      name: "t",
      width: 800,
      height: 600,
      fps: 8,
      bgColor: "#eee",
      transparentBg: true,
      frameCount: 1,
      boil: { enabled: false, amount: 0, cols: 12, rate: 1, weight: 0, holdsOnly: false },
      groups: [],
      layers: [dlayer(1, [key()])],
      audio: null,
    };
    expect(projectToJson(p).transparentBg).toBe(true);
  });

  it("uses defaultBoilConfig() shape", () => {
    expect(Object.keys(defaultBoilConfig()).sort()).toEqual([
      "amount",
      "cols",
      "enabled",
      "holdsOnly",
      "rate",
      "weight",
    ]);
  });
});

describe("audio trim persistence", () => {
  const audio = (over = {}) =>
    ({
      name: "take.wav",
      bytes: new Uint8Array(0),
      buffer: { duration: 10 } as unknown as AudioBuffer,
      offsetFrames: 0,
      muted: false,
      ...over,
    }) as unknown as Project["audio"];

  it("round-trips a trimmed clip", () => {
    const p = {
      name: "t",
      width: 800,
      height: 600,
      fps: 8,
      bgColor: "#eee",
      frameCount: 2,
      boil: defaultBoilConfig(),
      groups: [],
      layers: [dlayer(1, [key(), hold()])],
      audio: audio({ trimInFrames: 24, trimLenFrames: 96 }),
    } as unknown as Project;
    expect(projectToJson(p).audio).toMatchObject({ trimInFrames: 24, trimLenFrames: 96 });
  });

  it("an untrimmed clip writes no trim fields", () => {
    const p = {
      name: "t",
      width: 800,
      height: 600,
      fps: 8,
      bgColor: "#eee",
      frameCount: 2,
      boil: defaultBoilConfig(),
      groups: [],
      layers: [dlayer(1, [key(), hold()])],
      audio: audio(),
    } as unknown as Project;
    const j = projectToJson(p).audio!;
    expect(j.trimInFrames).toBeUndefined();
    expect(j.trimLenFrames).toBeUndefined();
  });
});

describe("migrateBoil", () => {
  it("an old save with `scale` loads with a default weight (scale dropped)", () => {
    const m = migrateBoil({
      enabled: true,
      amount: 2,
      cols: 16,
      rate: 2,
      scale: 0.005,
      holdsOnly: true,
    });
    expect(m.weight).toBe(0.4);
    expect("scale" in m).toBe(false);
    expect(m.amount).toBe(2);
  });
  it("a save with weight keeps it; missing boil → full default", () => {
    expect(
      migrateBoil({ enabled: true, amount: 3, cols: 8, rate: 1, weight: 0.7, holdsOnly: false })
        .weight,
    ).toBe(0.7);
    expect(migrateBoil(undefined).enabled).toBe(false);
  });
});

describe("insertReferencesByIndex", () => {
  it("splices a reference into the middle", () => {
    expect(insertReferencesByIndex(["a", "b", "c"], [{ index: 1, value: "R" }])).toEqual([
      "a",
      "R",
      "b",
      "c",
    ]);
  });
  it("reconstructs interleaved order (ascending index)", () => {
    expect(
      insertReferencesByIndex(
        ["a", "b"],
        [
          { index: 2, value: "R2" },
          { index: 0, value: "R0" },
        ],
      ),
    ).toEqual(["R0", "a", "R2", "b"]);
  });
  it("clamps an out-of-range index to the end", () => {
    expect(insertReferencesByIndex(["a"], [{ index: 9, value: "R" }])).toEqual(["a", "R"]);
  });
});

describe("frameAssetPath", () => {
  it("builds frames/<layerId>/<frameIndex>.png", () => {
    expect(frameAssetPath(2, 5)).toBe("frames/2/5.png");
  });
});

describe("setMinLayerId", () => {
  it("ensures subsequent created layers get ids at or above the floor", () => {
    setMinLayerId(500);
    expect(createDrawingLayer(1, "L").id).toBeGreaterThanOrEqual(500);
  });
  it("never lowers the counter", () => {
    setMinLayerId(500);
    const a = createDrawingLayer(1, "L").id;
    setMinLayerId(10);
    const b = createDrawingLayer(1, "L").id;
    expect(b).toBeGreaterThan(a);
  });
});

describe("group transform persistence", () => {
  it("round-trips a non-identity group transform + frozen box", async () => {
    const project = createProject();
    const g = {
      id: 42,
      name: "G",
      collapsed: false,
      visible: true,
      transform: { dx: 12, dy: -3, scale: 1.4, rotation: 0.2 },
      transformBox: { x: 5, y: 6, w: 30, h: 20 },
    };
    project.groups = [g];
    // Place an existing layer into the group so it survives the round-trip.
    project.layers[0].groupId = 42;
    const blob = await saveProjectBlob(project);
    const loaded = await loadProjectBlob(blob, 1);
    expect(loaded.groups).toHaveLength(1);
    expect(loaded.groups[0].id).toBe(42);
    expect(loaded.groups[0].transform).toEqual(g.transform);
    expect(loaded.groups[0].transformBox).toEqual(g.transformBox);
  });

  it("legacy saves (no group transform fields) load with identity / null", async () => {
    const project = createProject();
    project.groups = [{ id: 7, name: "L", collapsed: false, visible: true }]; // no transform
    project.layers[0].groupId = 7;
    const blob = await saveProjectBlob(project);
    const loaded = await loadProjectBlob(blob, 1);
    expect(loaded.groups[0].transform).toBeUndefined();
    expect(loaded.groups[0].transformBox ?? null).toBeNull();
  });

  it("identity group transform is NOT serialized (sparse map)", async () => {
    const project = createProject();
    project.groups = [
      {
        id: 1,
        name: "I",
        collapsed: false,
        visible: true,
        transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
      },
    ];
    const blob = await saveProjectBlob(project);
    // Inspect project.json directly.
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const json = JSON.parse(strFromU8(zip["project.json"]));
    expect(json.groups[0].transform).toBeUndefined();
  });
});

describe("saveProjectBlob compression", () => {
  it("stores frame PNGs without re-compressing them", async () => {
    const project = createProject();
    // 20k of trivially compressible bytes standing in for the PNG a real canvas would produce.
    // Deflated, the whole archive collapses to a few hundred bytes; stored, it cannot be
    // smaller than the payload. Size is therefore a proxy for "the zip left these alone".
    const bytes = new Uint8Array(20000);
    const layer = project.layers[0] as DrawingLayer;
    layer.cells[0] = {
      kind: "key",
      canvas: {
        toBlob: (cb: BlobCallback) => cb(new Blob([bytes])),
      } as unknown as HTMLCanvasElement,
    };
    const blob = await saveProjectBlob(project);
    expect(blob.size).toBeGreaterThan(bytes.length);
  });
});

describe("reference media persistence fields", () => {
  it("round-trips mediaId/mediaMime/embedMedia through save/load", async () => {
    const project = createProject();
    const ref = createReferenceLayer({ type: "missing", was: "video", name: "clip.mp4" }, "clip");
    ref.mediaId = "abc-123";
    ref.mediaMime = "video/mp4";
    ref.embedMedia = true;
    project.layers.push(ref);
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    const lref = loaded.layers.find((l) => l.kind === "ref")!;
    expect(lref.kind === "ref" && lref.mediaId).toBe("abc-123");
    expect(lref.kind === "ref" && lref.mediaMime).toBe("video/mp4");
    expect(lref.kind === "ref" && lref.embedMedia).toBe(true);
  });

  it("layers without the fields round-trip as undefined (old saves)", async () => {
    const project = createProject();
    project.layers.push(
      createReferenceLayer({ type: "missing", was: "image", name: "a.png" }, "R"),
    );
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    const lref = loaded.layers.find((l) => l.kind === "ref")!;
    expect(lref.kind === "ref" && lref.mediaId).toBeUndefined();
    expect(lref.kind === "ref" && lref.embedMedia).toBeUndefined();
  });
});

describe("zip media entries", () => {
  it("includeMedia=true writes no media/ entry for missing media; =false never writes any", async () => {
    const project = createProject();
    const ref = createReferenceLayer({ type: "missing", was: "image", name: "a.png" }, "R");
    ref.mediaId = "gone-1";
    project.layers.push(ref);
    for (const include of [true, false]) {
      const blob = await saveProjectBlob(project, include);
      const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
      expect(Object.keys(zip).filter((k) => k.startsWith("media/"))).toEqual([]);
    }
  });
});

describe("media selection helpers", () => {
  const img = { kind: "ref", mediaId: "i1", media: { type: "image" } };
  const vidOn = { kind: "ref", mediaId: "v1", embedMedia: true, media: { type: "video" } };
  const vidOff = { kind: "ref", mediaId: "v2", media: { type: "video" } };
  const missing = { kind: "ref", mediaId: "m1", media: { type: "missing", was: "image" as const } };
  const noId = { kind: "ref", media: { type: "image" } };
  const draw = { kind: "draw" }; // drawing layers have no media property

  it("referencedMediaIds: every ref with a mediaId, live or missing", () => {
    expect(referencedMediaIds([img, vidOn, vidOff, missing, noId, draw])).toEqual(
      new Set(["i1", "v1", "v2", "m1"]),
    );
  });

  it("mediaIdsToEmbed: live images always, live videos only when embedMedia; never missing", () => {
    expect(mediaIdsToEmbed([img, vidOn, vidOff, missing, noId, draw])).toEqual(["i1", "v1"]);
  });

  it("shouldRestoreMedia: missing + mediaId; videos gated on embedMedia", () => {
    expect(shouldRestoreMedia(missing)).toBe(true);
    expect(shouldRestoreMedia({ ...missing, media: { type: "missing", was: "video" } })).toBe(
      false,
    );
    expect(
      shouldRestoreMedia({
        ...missing,
        embedMedia: true,
        media: { type: "missing", was: "video" },
      }),
    ).toBe(true);
    expect(shouldRestoreMedia(img)).toBe(false); // already live
    expect(shouldRestoreMedia({ kind: "ref", media: { type: "missing", was: "image" } })).toBe(
      false,
    ); // no id
  });
});

describe("project name", () => {
  it("round-trips through save/load", async () => {
    const project = createProject();
    project.name = "walk cycle v2";
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    expect(loaded.name).toBe("walk cycle v2");
  });

  it("absent name (old saves) loads as empty string for the caller's fallback", async () => {
    const project = createProject();
    const blob = await saveProjectBlob(project);
    // Simulate an old save: strip the name from project.json before reloading.
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const json = JSON.parse(strFromU8(zip["project.json"]));
    expect(json.name).toBe("untitled"); // new saves carry the default
    delete json.name;
    const { zipSync, strToU8 } = await import("fflate");
    const rezipped = new Blob([zipSync({ ...zip, "project.json": strToU8(JSON.stringify(json)) })]);
    const loaded = await loadProjectBlob(rezipped, 1);
    expect(loaded.name).toBe("");
  });
});

describe("sanitizeFilename", () => {
  it("passes ordinary names through", () => {
    expect(sanitizeFilename("walk cycle v2")).toBe("walk cycle v2");
  });
  it("strips filesystem-hostile characters", () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe("abcdefghij");
  });
  it("trims and falls back to untitled when empty", () => {
    expect(sanitizeFilename("   ")).toBe("untitled");
    expect(sanitizeFilename("")).toBe("untitled");
    expect(sanitizeFilename('///"""')).toBe("untitled");
  });
});

describe("reference layer lock", () => {
  it("round-trips the locked flag", async () => {
    const project = createProject();
    const ref = createReferenceLayer({ type: "missing", was: "image", name: "a.png" }, "ref");
    ref.locked = true;
    project.layers.push(ref);
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    const lref = loaded.layers.find((l) => l.kind === "ref")!;
    expect(lref.kind === "ref" && lref.locked).toBe(true);
  });

  it("old saves (no locked field) load unlocked", async () => {
    const project = createProject();
    project.layers.push(
      createReferenceLayer({ type: "missing", was: "image", name: "a.png" }, "R"),
    );
    const blob = await saveProjectBlob(project);
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const json = JSON.parse(strFromU8(zip["project.json"]));
    delete json.references[0].locked;
    const { zipSync, strToU8 } = await import("fflate");
    const rezipped = new Blob([zipSync({ ...zip, "project.json": strToU8(JSON.stringify(json)) })]);
    const loaded = await loadProjectBlob(rezipped, 1);
    const lref = loaded.layers.find((l) => l.kind === "ref")!;
    expect(lref.kind === "ref" && lref.locked).toBe(false);
  });
});

describe("group lock persistence", () => {
  it("round-trips a locked group, and old saves load unlocked", async () => {
    const project = createProject();
    project.groups = [{ id: 3, name: "G", collapsed: false, visible: true, locked: true }];
    project.layers[0].groupId = 3;
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    expect(loaded.groups[0].locked).toBe(true);

    const legacy = createProject();
    legacy.groups = [{ id: 4, name: "L", collapsed: false, visible: true }]; // no locked field
    legacy.layers[0].groupId = 4;
    const loaded2 = await loadProjectBlob(await saveProjectBlob(legacy), 1);
    expect(loaded2.groups[0].locked).toBe(false);
  });
});

describe("reference range persistence", () => {
  const projWith = (ref: ReferenceLayer): Project => ({
    name: "t",
    width: 800,
    height: 600,
    fps: 8,
    bgColor: "#eee",
    frameCount: 2,
    boil: { enabled: true, amount: 2, cols: 16, rate: 2, weight: 0.4, holdsOnly: true },
    groups: [],
    layers: [dlayer(1, [key(), hold()]), ref],
    audio: null,
  });

  it("round-trips a trimmed image range", () => {
    const l = rlayer(2);
    l.range = { start: 6, end: 14 };
    expect(projectToJson(projWith(l)).references[0].range).toEqual({ start: 6, end: 14 });
  });

  it("an untrimmed reference writes no range", () => {
    expect(projectToJson(projWith(rlayer(2))).references[0].range).toBeUndefined();
  });

  it("round-trips a video source trim", () => {
    const l = rlayer(2);
    l.trimInFrames = 6;
    l.trimLenFrames = 12;
    const j = projectToJson(projWith(l)).references[0];
    expect(j.trimInFrames).toBe(6);
    expect(j.trimLenFrames).toBe(12);
  });

  it("an untrimmed video writes no trim fields", () => {
    const j = projectToJson(projWith(rlayer(2))).references[0];
    expect(j.trimInFrames).toBeUndefined();
    expect(j.trimLenFrames).toBeUndefined();
  });
});

// ── Audit wave (2026-08-16) ───────────────────────────────────────────────────────────────────

describe("collectFrameAssets", () => {
  // A canvas that is distinguishable by identity, which is what the path→canvas mapping is about.
  const cv = (tag: string) => ({ tag }) as unknown as HTMLCanvasElement;
  const keyed = (tag: string): Cell => ({ kind: "key", canvas: cv(tag) });

  const proj = (layers: DrawingLayer[]) =>
    ({
      name: "t",
      width: 8,
      height: 8,
      fps: 8,
      bgColor: "#eee",
      frameCount: 3,
      boil: defaultBoilConfig(),
      groups: [],
      layers,
      audio: null,
    }) as unknown as Project;

  it("emits one entry per KEY cell, at that cell's frame path", () => {
    const p = proj([dlayer(1, [keyed("a"), hold(), keyed("b")])]);
    expect(collectFrameAssets(p).map((f) => f.path)).toEqual([
      frameAssetPath(1, 0),
      frameAssetPath(1, 2),
    ]);
  });

  it("skips reference layers and covers every drawing layer", () => {
    const p = proj([dlayer(1, [keyed("a")]), rlayer(2), dlayer(3, [hold(), keyed("c")])] as never);
    expect(collectFrameAssets(p).map((f) => f.path)).toEqual([
      frameAssetPath(1, 0),
      frameAssetPath(3, 1),
    ]);
  });

  it("agrees exactly with the cell KINDS projectToJson records", () => {
    const p = proj([dlayer(1, [keyed("a"), hold(), keyed("b")]), dlayer(2, [keyed("c")])]);
    const fromJson = projectToJson(p).layers.flatMap((l) =>
      l.cells.flatMap((k, i) => (k === "key" ? [frameAssetPath(l.id, i)] : [])),
    );
    expect(collectFrameAssets(p).map((f) => f.path)).toEqual(fromJson);
  });
});

describe("saveProjectBlob captures the model in one tick", () => {
  /** A canvas whose encode YIELDS — the point at which a real user edit can land mid-save. */
  const encodingCanvas = (onEncode?: () => void) =>
    ({
      toBlob: (cb: BlobCallback) => {
        onEncode?.();
        cb(new Blob([new Uint8Array(4)]));
      },
    }) as unknown as HTMLCanvasElement;

  it("a frame deleted DURING the PNG pass cannot desync project.json from the PNG set", async () => {
    const project = createProject();
    const layer = project.layers[0] as DrawingLayer;
    layer.cells = [
      { kind: "key", canvas: encodingCanvas() },
      // Encoding cell 1 deletes cell 2 — the shape of "autosave started, then the user deleted a
      // frame". Before the fix, the JSON (10 cells) and the PNG walk (9 cells) disagreed.
      { kind: "key", canvas: encodingCanvas(() => layer.cells.splice(2, 1)) },
      { kind: "key", canvas: encodingCanvas() },
    ];
    const zip = unzipSync(new Uint8Array(await (await saveProjectBlob(project)).arrayBuffer()));
    const json = JSON.parse(strFromU8(zip["project.json"]));
    const declared = json.layers[0].cells.flatMap((k: string, i: number) =>
      k === "key" ? [frameAssetPath(layer.id, i)] : [],
    );
    expect(declared).toHaveLength(3);
    for (const path of declared) expect(zip[path]).toBeDefined(); // no key left without its PNG
    const written = Object.keys(zip).filter((p) => p.startsWith("frames/"));
    expect(written.sort()).toEqual(declared.sort()); // …and no PNG the JSON doesn't declare
  });

  it("a not-yet-encoded LAYER deleted during the PNG pass still gets its PNGs written", async () => {
    const project = createProject();
    const first = project.layers[0] as DrawingLayer;
    const second = dlayer(99, []);
    second.cells = [{ kind: "key", canvas: encodingCanvas() }];
    project.layers.push(second);
    // Encoding the FIRST layer removes the second — which the old walk had not reached yet, so it
    // wrote none of its PNGs while project.json still described it: a layer restoring fully blank.
    first.cells = [{ kind: "key", canvas: encodingCanvas(() => project.layers.splice(1, 1)) }];
    const zip = unzipSync(new Uint8Array(await (await saveProjectBlob(project)).arrayBuffer()));
    const json = JSON.parse(strFromU8(zip["project.json"]));
    expect(json.layers.map((l: { id: number }) => l.id)).toEqual([first.id, 99]);
    expect(zip[frameAssetPath(first.id, 0)]).toBeDefined();
    expect(zip[frameAssetPath(99, 0)]).toBeDefined();
  });
});

describe("undecodable audio survives a re-save", () => {
  const undecoded = {
    name: "take.m4a",
    bytes: new Uint8Array([1, 2, 3, 4]),
    offsetFrames: 5,
    muted: true,
    trimInFrames: 2,
    trimLenFrames: 9,
  };

  it("projectToJson writes the kept metadata when there is no decoded track", () => {
    const p = { ...createProject(), audio: null, audioUndecoded: undecoded } as Project;
    expect(projectToJson(p).audio).toEqual({
      name: "take.m4a",
      offsetFrames: 5,
      muted: true,
      trimInFrames: 2,
      trimLenFrames: 9,
    });
  });

  it("a decoded track always wins over kept bytes", () => {
    const p = {
      ...createProject(),
      audio: {
        name: "live.wav",
        bytes: new Uint8Array(0),
        buffer: {} as AudioBuffer,
        offsetFrames: 0,
        muted: false,
      },
      audioUndecoded: undecoded,
    } as Project;
    expect(projectToJson(p).audio?.name).toBe("live.wav");
  });

  it("saveProjectBlob re-writes the original bytes unchanged", async () => {
    const p = { ...createProject(), audio: null, audioUndecoded: undecoded } as Project;
    const zip = unzipSync(new Uint8Array(await (await saveProjectBlob(p)).arrayBuffer()));
    expect(Array.from(zip["audio/track"])).toEqual([1, 2, 3, 4]);
  });
});

describe("tracksCollapsed persistence", () => {
  it("round-trips a collapsed layer's folded property rows", async () => {
    const project = createProject();
    project.layers[0].tracksCollapsed = true;
    const blob = await saveProjectBlob(project);
    const loaded = await loadProjectBlob(blob, 1);
    expect(loaded.layers[0].tracksCollapsed).toBe(true);
  });

  // Absent means EXPANDED, so every project saved before this field existed opens showing its
  // tracks — and the format version does not move for an optional, additive field.
  it("an old save with no field loads expanded", async () => {
    const project = createProject();
    const blob = await saveProjectBlob(project);
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const json = JSON.parse(strFromU8(zip["project.json"]));
    expect(json.version).toBe(1);
    expect(json.layers[0].tracksCollapsed).toBeUndefined();
    const loaded = await loadProjectBlob(blob, 1);
    expect(loaded.layers[0].tracksCollapsed ?? false).toBe(false);
  });

  it("round-trips a group's folded property rows", async () => {
    const project = createProject();
    project.groups = [{ id: 3, name: "G", collapsed: false, visible: true, tracksCollapsed: true }];
    project.layers[0].groupId = 3;
    const blob = await saveProjectBlob(project);
    const loaded = await loadProjectBlob(blob, 1);
    expect(loaded.groups[0].tracksCollapsed).toBe(true);
  });

  it("an old save's group with no field loads expanded", async () => {
    const project = createProject();
    project.groups = [{ id: 3, name: "G", collapsed: false, visible: true }];
    project.layers[0].groupId = 3;
    const blob = await saveProjectBlob(project);
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const json = JSON.parse(strFromU8(zip["project.json"]));
    expect(json.groups[0].tracksCollapsed).toBeUndefined();
    const loaded = await loadProjectBlob(blob, 1);
    expect(loaded.groups[0].tracksCollapsed ?? false).toBe(false);
  });
});

describe("trim field sanitisation", () => {
  it("round-trips a valid trim on a reference layer", async () => {
    const project = createProject();
    const ref = createReferenceLayer({ type: "missing", was: "video", name: "clip.mp4" }, "clip");
    ref.trimInFrames = 4;
    ref.trimLenFrames = 12;
    project.layers.push(ref);
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    const lref = loaded.layers.find((l) => l.kind === "ref")!;
    expect(lref.kind === "ref" && lref.trimInFrames).toBe(4);
    expect(lref.kind === "ref" && lref.trimLenFrames).toBe(12);
  });

  // The two trim fields were the one new persisted pair read back verbatim, so a NaN from a
  // hand-edited or truncated file survived into `videoClipLayout` as `min-width: NaNpx`. Absent
  // already means untrimmed, so dropping the value is the right failure.
  it("drops a non-integer or negative trim rather than carrying it into layout", async () => {
    const project = createProject();
    const ref = createReferenceLayer({ type: "missing", was: "video", name: "clip.mp4" }, "clip");
    ref.trimInFrames = Number.NaN;
    ref.trimLenFrames = -3;
    project.layers.push(ref);
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    const lref = loaded.layers.find((l) => l.kind === "ref")!;
    expect(lref.kind === "ref" && lref.trimInFrames).toBeUndefined();
    expect(lref.kind === "ref" && lref.trimLenFrames).toBeUndefined();
  });
});

describe("track box sanitisation", () => {
  const trackWith = (box: unknown) => ({
    transform: {
      keys: [{ frame: 0, v: { dx: 0, dy: 0, scale: 1, rotation: 0 } }],
      box,
    },
  });

  it("keeps a finite pivot box", async () => {
    const project = createProject();
    project.groups = [{ id: 3, name: "G", collapsed: false, visible: true }];
    project.layers[0].groupId = 3;
    project.groups[0].tracks = trackWith({ x: 1, y: 2, w: 3, h: 4 }) as never;
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    expect(loaded.groups[0].tracks?.transform?.box).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  // `groupBoxLogical` now READS this box, so a corrupt or hand-edited zip could otherwise feed a
  // NaN straight into pivot arithmetic and produce geometry with nothing on screen to explain it.
  it("drops a box carrying a non-finite field", async () => {
    const project = createProject();
    project.layers[0].tracks = trackWith({ x: 0, y: 0, w: Number.NaN, h: 4 }) as never;
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    expect(loaded.layers[0].tracks?.transform?.box).toBeNull();
  });

  it("drops a box that is missing fields entirely", async () => {
    const project = createProject();
    project.layers[0].tracks = trackWith({ x: 0, y: 0 }) as never;
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    expect(loaded.layers[0].tracks?.transform?.box).toBeNull();
  });
});
