import { createReferenceLayer, type ReferenceLayer, type ReferenceMedia, type Project } from "./document";

export function loadImageMedia(file: File): Promise<ReferenceMedia> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve({ type: "image", el });
    el.onerror = () => reject(new Error(`Failed to load image: ${file.name}`));
    el.src = URL.createObjectURL(file);
  });
}

export function loadVideoMedia(file: File, onSeeked: () => void): Promise<ReferenceMedia> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("video");
    el.muted = true;
    el.preload = "auto";
    el.playsInline = true;
    el.addEventListener("seeked", onSeeked);
    el.addEventListener("loadeddata", () => resolve({ type: "video", el }), { once: true });
    el.addEventListener("error", () => reject(new Error(`Failed to load video: ${file.name}`)), { once: true });
    el.src = URL.createObjectURL(file);
  });
}

/** Load reference media of either kind, chosen by the file's MIME type (video/* → video, else image). */
export async function loadReferenceMedia(file: File, onSeeked: () => void): Promise<ReferenceMedia> {
  return file.type.startsWith("video") ? loadVideoMedia(file, onSeeked) : loadImageMedia(file);
}

/** Load an image file into a reference layer (resolves once the bitmap is decoded). */
export async function loadImageLayer(file: File): Promise<ReferenceLayer> {
  return createReferenceLayer(await loadImageMedia(file), file.name);
}

/**
 * Load a video file into a reference layer. `onSeeked` fires after each frame seek
 * completes (the caller uses it to repaint). Resolves once the first frame is available.
 */
export async function loadVideoLayer(file: File, onSeeked: () => void): Promise<ReferenceLayer> {
  return createReferenceLayer(await loadVideoMedia(file, onSeeked), file.name);
}

/** Seek every video reference layer to the time matching `frame` at `fps`. */
export function syncReferenceVideos(project: Project, frame: number, fps: number): void {
  for (const layer of project.layers) {
    if (layer.kind !== "ref" || layer.media.type !== "video") continue;
    const vid = layer.media.el;
    const off = Number.isFinite(layer.offsetFrames) ? layer.offsetFrames : 0; // guard a transiently-empty input
    const wanted = (frame + off) / fps;
    const dur = isFinite(vid.duration) ? vid.duration : wanted;
    const clamped = Math.max(0, Math.min(dur, wanted));
    if (Math.abs(vid.currentTime - clamped) > 1e-3) vid.currentTime = clamped;
  }
}
