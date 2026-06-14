import { isDrawingLayer, createCellCanvas, setMinLayerId, refreshLength, type Project, type Cell, type DrawingLayer } from "../anim/document";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";

export interface DrawingLayerJson {
  id: number;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  cells: ("key" | "hold")[];
}

export interface ProjectJson {
  version: 1;
  width: number;
  height: number;
  fps: number;
  bgColor: string;
  frameCount: number;
  layers: DrawingLayerJson[];
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
    layers: project.layers.filter(isDrawingLayer).map((l) => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      locked: l.locked,
      opacity: l.opacity,
      cells: l.cells.map((c) => c.kind),
    })),
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
  const files: Record<string, Uint8Array> = {
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
      locked: lj.locked, opacity: lj.opacity, cells,
    });
  }
  setMinLayerId(maxId + 1);
  const project: Project = {
    width: json.width, height: json.height, fps: json.fps,
    bgColor: json.bgColor, frameCount: json.frameCount, layers,
  };
  refreshLength(project); // independent per-layer lengths → derive document length from the layers
  return project;
}
