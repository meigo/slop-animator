import {
  createReferenceLayer,
  type ReferenceLayer,
  type ReferenceMedia,
  type Project,
} from "./document";

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
    el.preload = "metadata";
    el.playsInline = true;
    el.addEventListener("seeked", onSeeked);
    el.addEventListener("loadedmetadata", () => resolve({ type: "video", el }), { once: true });
    el.addEventListener("error", () => reject(new Error(`Failed to load video: ${file.name}`)), {
      once: true,
    });
    el.src = URL.createObjectURL(file);
  });
}

/** Load reference media of either kind, chosen by the file's MIME type (video/* → video, else image). */
export async function loadReferenceMedia(
  file: File,
  onSeeked: () => void,
): Promise<ReferenceMedia> {
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

/** Free a reference layer's media: revoke its blob URL and (for video) detach the source so the
 *  decoder can be reclaimed. Call ONLY when the media is unreachable (relink of the old media,
 *  or replaceProject clearing the old document) — NOT on removeLayer (undo shares the object). */
export function releaseReferenceMedia(media: ReferenceMedia): void {
  if (media.type === "missing") return;
  if (media.type === "video") media.el.pause();
  if (media.el.src.startsWith("blob:")) URL.revokeObjectURL(media.el.src);
  if (media.type === "video") {
    media.el.removeAttribute("src");
    media.el.load(); // detach the source; lets the media element release its decode buffers
  }
}

const SEEK_EPSILON = 1e-3;
const PLAY_DRIFT = 0.3; // s — while playing, only re-seek when the video drifts more than this
//     (also catches the end→start jump on loop-wrap)

/**
 * Align each video reference to the playhead. Paused (scrubbing) → exact seek. Playing → let the
 * element run and only re-seek on large drift, and resume play() if it paused (ended / joined
 * mid-playback). `onSeeked` (set at load) recomposites when a seek lands.
 */
export function syncReferenceVideos(
  project: Project,
  frame: number,
  fps: number,
  playing = false,
): void {
  for (const layer of project.layers) {
    if (layer.kind !== "ref" || layer.media.type !== "video") continue;
    const vid = layer.media.el;
    const off = Number.isFinite(layer.offsetFrames) ? layer.offsetFrames : 0;
    const wanted = (frame + off) / fps;
    const dur = isFinite(vid.duration) ? vid.duration : wanted;
    const clamped = Math.max(0, Math.min(dur, wanted));
    if (!playing) {
      if (Math.abs(vid.currentTime - clamped) > SEEK_EPSILON) vid.currentTime = clamped;
    } else if (vid.paused) {
      vid.currentTime = clamped;
      void vid.play().catch(() => {});
    } else if (Math.abs(vid.currentTime - clamped) > PLAY_DRIFT) {
      vid.currentTime = clamped;
    }
  }
}
