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
    expect(createDrawingLayer(1).id).toBeGreaterThanOrEqual(500);
  });
  it("never lowers the counter", () => {
    setMinLayerId(500);
    const a = createDrawingLayer(1).id;
    setMinLayerId(10);
    const b = createDrawingLayer(1).id;
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
    project.layers.push(createReferenceLayer({ type: "missing", was: "image", name: "a.png" }));
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    const lref = loaded.layers.find((l) => l.kind === "ref")!;
    expect(lref.kind === "ref" && lref.mediaId).toBeUndefined();
    expect(lref.kind === "ref" && lref.embedMedia).toBeUndefined();
  });
});

describe("zip media entries", () => {
  it("includeMedia=true writes no media/ entry for missing media; =false never writes any", async () => {
    const project = createProject();
    const ref = createReferenceLayer({ type: "missing", was: "image", name: "a.png" });
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
