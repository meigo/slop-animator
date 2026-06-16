import { isDrawingLayer, createCellCanvas, setMinLayerId, refreshLength, defaultBoilConfig, type Project, type Cell, type DrawingLayer, type BoilConfig } from "../anim/document";
import { zipSync, unzipSync, strToU8, strFromU8, type ZipOptions } from "fflate";
import { decodeAudioBytes } from "../audio/decode";

export interface DrawingLayerJson {
  id: number;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  boilStrength: number;
  cells: ("key" | "hold")[];
}

export interface ProjectJson {
  version: 1;
  width: number;
  height: number;
  fps: number;
  bgColor: string;
  frameCount: number;
  boil: BoilConfig;
  layers: DrawingLayerJson[];
  audio: { name: string; offsetFrames: number; muted: boolean } | null;
}

/** Normalise a persisted boil blob. Old saves used `scale`; weight has a different meaning, so old
 *  `scale` is dropped and weight falls back to the default. */
export function migrateBoil(raw: unknown): BoilConfig {
  const d = defaultBoilConfig();
  if (!raw || typeof raw !== "object") return d;
  const b = raw as Partial<BoilConfig>;
  return {
    enabled: b.enabled ?? d.enabled,
    amount: typeof b.amount === "number" ? b.amount : d.amount,
    cols: typeof b.cols === "number" ? b.cols : d.cols,
    rate: typeof b.rate === "number" ? b.rate : d.rate,
    weight: typeof b.weight === "number" ? b.weight : d.weight,
    holdsOnly: b.holdsOnly ?? d.holdsOnly,
  };
}

/** Serialize the project structure (drawing layers only) — no pixel data, no reference layers. */
export function projectToJson(project: Project): ProjectJson {
  return {
    version: 1,
    width: project.width,
    height: project.height,
    fps: project.fps,
    bgColor: project.bgColor,
    frameCount: project.frameCount,
    boil: project.boil,
    layers: project.layers.filter(isDrawingLayer).map((l) => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      locked: l.locked,
      opacity: l.opacity,
      boilStrength: l.boilStrength,
      cells: l.cells.map((c) => c.kind),
    })),
    audio: project.audio
      ? { name: project.audio.name, offsetFrames: project.audio.offsetFrames, muted: project.audio.muted }
      : null,
  };
}

/** Path inside the zip for a key cell's PNG. */
export function frameAssetPath(layerId: number, frameIndex: number): string {
  return `frames/${layerId}/${frameIndex}.png`;
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(async (b) => {
      if (!b) return reject(new Error("toBlob failed"));
      resolve(new Uint8Array(await b.arrayBuffer()));
    }, "image/png")
  );
}

function decodePng(bytes: Uint8Array): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }));
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("png decode failed")); };
    img.src = url;
  });
}

/** Zip the project: `project.json` + one PNG per key cell. Reference layers are not saved. */
export async function saveProjectBlob(project: Project): Promise<Blob> {
  const files: Record<string, Uint8Array | [Uint8Array, ZipOptions]> = {
    "project.json": strToU8(JSON.stringify(projectToJson(project))),
  };
  for (const layer of project.layers) {
    if (!isDrawingLayer(layer)) continue;
    for (let i = 0; i < layer.cells.length; i++) {
      const cell = layer.cells[i];
      if (cell.kind !== "key") continue;
      files[frameAssetPath(layer.id, i)] = await canvasToPngBytes(cell.canvas);
    }
  }
  // Audio is already-compressed media (mp3/aac); store it (level 0) so autosave doesn't re-DEFLATE it.
  if (project.audio) files["audio/track"] = [project.audio.bytes, { level: 0 }];
  return new Blob([zipSync(files)], { type: "application/zip" });
}

/** Rebuild a Project from a saved zip. `dpr` sizes the rebuilt cell canvases for the current display. */
export async function loadProjectBlob(blob: Blob, dpr: number): Promise<Project> {
  const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const json = JSON.parse(strFromU8(zip["project.json"])) as ProjectJson;

  let maxId = 0;
  const layers: DrawingLayer[] = [];
  for (const lj of json.layers) {
    maxId = Math.max(maxId, lj.id);
    const cells: Cell[] = [];
    for (let i = 0; i < lj.cells.length; i++) {
      if (lj.cells[i] === "hold") { cells.push({ kind: "hold" }); continue; }
      const canvas = createCellCanvas(json.width, json.height, dpr);
      const bytes = zip[frameAssetPath(lj.id, i)];
      if (bytes) {
        const img = await decodePng(bytes);
        const ctx = canvas.getContext("2d")!;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
      cells.push({ kind: "key", canvas });
    }
    layers.push({
      kind: "draw", id: lj.id, name: lj.name, visible: lj.visible,
      locked: lj.locked, opacity: lj.opacity, boilStrength: lj.boilStrength ?? 1, cells,
    });
  }
  setMinLayerId(maxId + 1);
  const project: Project = {
    width: json.width, height: json.height, fps: json.fps,
    bgColor: json.bgColor, frameCount: json.frameCount, boil: migrateBoil(json.boil), layers,
    audio: null,
  };
  refreshLength(project); // independent per-layer lengths → derive document length from the layers
  const aj = json.audio;
  const audioBytes = zip["audio/track"];
  if (aj && audioBytes) {
    try {
      const buffer = await decodeAudioBytes(audioBytes);
      project.audio = { name: aj.name, bytes: audioBytes, buffer, offsetFrames: aj.offsetFrames, muted: aj.muted };
    } catch {
      project.audio = null; // corrupt/unsupported audio → open the project without it
    }
  }
  return project;
}
