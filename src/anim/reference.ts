import { createReferenceLayer, type ReferenceLayer, type Project } from "./document";

/** Load an image file into a reference layer (resolves once the bitmap is decoded). */
export function loadImageLayer(file: File): Promise<ReferenceLayer> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(createReferenceLayer({ type: "image", el }, file.name));
    el.onerror = () => reject(new Error(`Failed to load image: ${file.name}`));
    el.src = URL.createObjectURL(file);
  });
}

/**
 * Load a video file into a reference layer. `onSeeked` fires after each frame seek
 * completes (the caller uses it to repaint). Resolves once the first frame is available.
 */
export function loadVideoLayer(file: File, onSeeked: () => void): Promise<ReferenceLayer> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("video");
    el.muted = true;
    el.preload = "auto";
    el.playsInline = true;
    el.addEventListener("seeked", onSeeked);
    el.addEventListener("loadeddata", () => resolve(createReferenceLayer({ type: "video", el }, file.name)), { once: true });
    el.addEventListener("error", () => reject(new Error(`Failed to load video: ${file.name}`)), { once: true });
    el.src = URL.createObjectURL(file);
  });
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
