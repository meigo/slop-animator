import {
  isDrawingLayer,
  isIdentityTransform,
  createCellCanvas,
  setMinLayerId,
  refreshLength,
  defaultBoilConfig,
  MAX_SAMPLE_EVERY,
  type Project,
  type Cell,
  type DrawingLayer,
  type BoilConfig,
  type ReferenceLayer,
  type RefTransform,
  type Layer,
  type LayerGroup,
  type TransformTrack,
  type Track,
  TRACK_PROPS,
  GROUP_TRACK_PROPS,
  type TrackProp,
  type GroupTrackProp,
  type Keyframe,
  type KeyInterp,
  type LayerTracks,
  type GroupTracks,
} from "../anim/document";
import { zipSync, unzipSync, strToU8, strFromU8, type ZipOptions } from "fflate";
import { decodeAudioBytes } from "../audio/decode";
import { mediaFromBlob } from "../anim/reference";
import { putMedia } from "./media-store";

export interface DrawingLayerJson {
  id: number;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  boilStrength: number;
  groupId: number | null;
  cells: ("key" | "hold")[];
  transform: RefTransform;
  tracks?: LayerTracks;
  /** Are the layer's property rows folded away in the timeline? Optional and additive: absent =
   *  EXPANDED, so every pre-existing save opens showing its tracks and the format version does not
   *  move. */
  tracksCollapsed?: boolean;
  /** LEGACY, read-only. The single-property shape that SHIPPED before `tracks` existed, so it is in
   *  real projects and autosaves; the loader promotes it. Never written. */
  transformTrack?: LegacyTransformTrackJson;
  cellTransforms?: {
    [index: number]: {
      transform?: RefTransform;
      transformBox?: { x: number; y: number; w: number; h: number } | null;
    };
  };
}

export interface ReferenceJson {
  index: number; // position in the full project.layers stack (z-order)
  id: number;
  name: string;
  visible: boolean;
  opacity: number;
  offsetFrames: number;
  speed?: number;
  audioEnabled?: boolean;
  locked?: boolean;
  range?: { start: number; end: number }; // absent = always visible
  mediaId?: string;
  mediaMime?: string;
  embedMedia?: boolean;
  groupId: number | null;
  was: "image" | "video";
  transform: RefTransform;
  tracks?: LayerTracks;
  /** See `DrawingLayerJson.tracksCollapsed`. */
  tracksCollapsed?: boolean;
  /** LEGACY, read-only — see `DrawingLayerJson.transformTrack`. */
  transformTrack?: LegacyTransformTrackJson;
}

/** Splice `refs` (by stack index, ascending) into `base`. Pure; rebuilds the original interleaving. */
export function insertReferencesByIndex<T>(base: T[], refs: { index: number; value: T }[]): T[] {
  const out = base.slice();
  for (const r of refs.slice().sort((a, b) => a.index - b.index)) {
    out.splice(Math.min(r.index, out.length), 0, r.value);
  }
  return out;
}

export interface MediaRefShape {
  kind: string;
  mediaId?: string;
  embedMedia?: boolean;
  media?: { type: string; was?: "image" | "video" }; // absent on drawing layers
}

/** Every media id the project still references (live or placeholder) — the prune keep-set. */
export function referencedMediaIds(layers: MediaRefShape[]): Set<string> {
  return new Set(
    layers.filter((l) => l.kind === "ref" && l.mediaId).map((l) => l.mediaId as string),
  );
}

/** Ids whose bytes go into the exported zip: live images always, live videos on opt-in. */
export function mediaIdsToEmbed(layers: MediaRefShape[]): string[] {
  return layers
    .filter(
      (l) =>
        l.kind === "ref" &&
        l.mediaId &&
        l.media &&
        l.media.type !== "missing" &&
        (l.media.type === "image" || l.embedMedia === true),
    )
    .map((l) => l.mediaId as string);
}

/** Whether a placeholder should hydrate from stored bytes (videos only on opt-in). */
export function shouldRestoreMedia(l: MediaRefShape): boolean {
  return (
    l.kind === "ref" &&
    !!l.mediaId &&
    l.media?.type === "missing" &&
    (l.media.was !== "video" || l.embedMedia === true)
  );
}

/** Project name → safe download filename stem: drop filesystem-hostile and control characters,
 *  trim, fall back to "untitled" when nothing survives. */
export function sanitizeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control chars is the point
  const cleaned = name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, "").trim();
  return cleaned || "untitled";
}

export interface ProjectJson {
  version: 1;
  name?: string; // absent in pre-2026-08-09 saves; loader yields "" and the caller fills a fallback
  width: number;
  height: number;
  fps: number;
  bgColor: string;
  transparentBg?: boolean;
  frameCount: number;
  boil: BoilConfig;
  groups: {
    id: number;
    name: string;
    collapsed: boolean;
    visible: boolean;
    locked?: boolean;
    /** Static group opacity 0..100. Absent means 100. */
    opacity?: number;
    transform?: RefTransform;
    transformBox?: { x: number; y: number; w: number; h: number } | null;
    tracks?: GroupTracks;
  }[];
  layers: DrawingLayerJson[];
  references: ReferenceJson[];
  audio: {
    name: string;
    offsetFrames: number;
    muted: boolean;
    trimInFrames?: number;
    trimLenFrames?: number;
  } | null;
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
    name: project.name,
    width: project.width,
    height: project.height,
    fps: project.fps,
    bgColor: project.bgColor,
    transparentBg: !!project.transparentBg,
    frameCount: project.frameCount,
    boil: project.boil,
    groups: project.groups.map((g) => {
      const t = g.transform;
      const isId = !t || isIdentityTransform(t);
      const o = g.opacity;
      return {
        id: g.id,
        name: g.name,
        collapsed: g.collapsed,
        visible: g.visible,
        locked: g.locked,
        ...(typeof o === "number" && Number.isFinite(o) && o >= 0 && o <= 100
          ? { opacity: o }
          : {}),
        tracks: g.tracks,
        ...(isId ? {} : { transform: t, transformBox: g.transformBox ?? null }),
      };
    }),
    layers: project.layers.filter(isDrawingLayer).map((l) => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      locked: l.locked,
      opacity: l.opacity,
      boilStrength: l.boilStrength,
      groupId: l.groupId,
      cells: l.cells.map((c) => c.kind),
      transform: l.transform,
      tracks: l.tracks,
      tracksCollapsed: l.tracksCollapsed,
      cellTransforms: Object.fromEntries(
        l.cells.flatMap((c, i) =>
          c.kind === "key" &&
          c.transform &&
          !(
            c.transform.dx === 0 &&
            c.transform.dy === 0 &&
            c.transform.scale === 1 &&
            c.transform.rotation === 0
          )
            ? [[i, { transform: c.transform, transformBox: c.transformBox ?? null }]]
            : [],
        ),
      ),
    })),
    references: project.layers
      .map((l, index) => ({ l, index }))
      .filter((e): e is { l: ReferenceLayer; index: number } => e.l.kind === "ref")
      .map(({ l, index }) => ({
        index,
        id: l.id,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        offsetFrames: l.offsetFrames,
        speed: l.speed,
        audioEnabled: l.audioEnabled,
        locked: l.locked,
        range: l.range,
        mediaId: l.mediaId,
        mediaMime: l.mediaMime,
        embedMedia: l.embedMedia,
        groupId: l.groupId,
        was: l.media.type === "missing" ? l.media.was : l.media.type,
        transform: l.transform,
        tracks: l.tracks,
        tracksCollapsed: l.tracksCollapsed,
      })),
    // `audioUndecoded` is written back verbatim when the bytes couldn't be decoded on this device:
    // dropping the entry here (and the bytes in saveProjectBlob) would delete the audio from the
    // only copy of the project on the first autosave after opening it.
    audio: audioJson(project),
  };
}

function audioJson(project: Project): ProjectJson["audio"] {
  const a = project.audio ?? project.audioUndecoded;
  if (!a) return null;
  return {
    name: a.name,
    offsetFrames: a.offsetFrames,
    muted: a.muted,
    trimInFrames: a.trimInFrames,
    trimLenFrames: a.trimLenFrames,
  };
}

/** Path inside the zip for a key cell's PNG. */
export function frameAssetPath(layerId: number, frameIndex: number): string {
  return `frames/${layerId}/${frameIndex}.png`;
}

/** Path inside the zip for an embedded reference media file. */
export function mediaAssetPath(mediaId: string): string {
  return `media/${mediaId}`;
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(async (b) => {
      if (!b) return reject(new Error("toBlob failed"));
      resolve(new Uint8Array(await b.arrayBuffer()));
    }, "image/png"),
  );
}

function decodePng(bytes: Uint8Array): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(
      new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }),
    );
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("png decode failed"));
    };
    img.src = url;
  });
}

/** One key cell's zip path and the canvas whose pixels go there. */
export interface FrameAsset {
  path: string;
  canvas: HTMLCanvasElement;
}

/** Every key cell's `{ path, canvas }`, in one pass over the model.
 *
 *  Must be called in the SAME TICK as `projectToJson`: the JSON records each layer's cell KINDS,
 *  and the two together describe one document. `saveProjectBlob` used to walk the live `$state`
 *  arrays across hundreds of `await`s (one per PNG encode, seconds in total, with input unblocked),
 *  so deleting a frame or a layer mid-save produced a zip whose JSON and PNG set disagreed —
 *  restoring with shifted drawings, or a layer that came back completely blank. */
export function collectFrameAssets(project: Project): FrameAsset[] {
  const out: FrameAsset[] = [];
  for (const layer of project.layers) {
    if (!isDrawingLayer(layer)) continue;
    for (let i = 0; i < layer.cells.length; i++) {
      const cell = layer.cells[i];
      if (cell.kind !== "key") continue;
      out.push({ path: frameAssetPath(layer.id, i), canvas: cell.canvas });
    }
  }
  return out;
}

/** Reference media to embed, as `{ path, src }` — captured synchronously with the frame list so a
 *  re-link or a layer delete mid-save can't change which entries are written. */
function collectMediaAssets(project: Project): { path: string; src: string }[] {
  const out: { path: string; src: string }[] = [];
  for (const id of mediaIdsToEmbed(project.layers)) {
    const layer = project.layers.find((l) => l.kind === "ref" && l.mediaId === id);
    if (!layer || layer.kind !== "ref" || layer.media.type === "missing") continue;
    out.push({ path: mediaAssetPath(id), src: layer.media.el.src });
  }
  return out;
}

/** Zip the project: `project.json` + one PNG per key cell. Reference layers are not saved.
 *  `includeMedia` additionally embeds reference media bytes (explicit "Save Project" only —
 *  autosave never sets it, keeping the debounced save cheap). `onMediaEmbedFailed` fires (once
 *  per failed entry) if fetching a live element's bytes fails — that entry is skipped rather than
 *  failing the whole save, since a lost explicit save is the data lifeline. */
export async function saveProjectBlob(
  project: Project,
  includeMedia = false,
  onMediaEmbedFailed?: () => void,
): Promise<Blob> {
  // ─── ONE synchronous read of the model ────────────────────────────────────────────────────────
  // Everything the zip will contain is decided here, before the first `await`. Nothing below may
  // touch `project` again: every PNG encode is a yield point at which the user can delete a frame
  // or a layer, and a JSON captured from a different read of the model than the PNG set is a
  // silently corrupt save (see collectFrameAssets).
  const json = strToU8(JSON.stringify(projectToJson(project)));
  const frames = collectFrameAssets(project);
  const audioBytes = project.audio?.bytes ?? project.audioUndecoded?.bytes ?? null;
  const media = includeMedia ? collectMediaAssets(project) : [];
  // ──────────────────────────────────────────────────────────────────────────────────────────────

  const files: Record<string, Uint8Array | [Uint8Array, ZipOptions]> = { "project.json": json };
  for (const { path, canvas } of frames) {
    // PNG is already DEFLATE-compressed internally; store it (level 0) so the zip doesn't burn
    // CPU re-compressing it for ~nothing — the same treatment the audio entry gets below.
    // Autosave re-encodes every key cell on a 3s debounce, so this pass is paid repeatedly.
    files[path] = [await canvasToPngBytes(canvas), { level: 0 }];
  }
  // Audio is already-compressed media (mp3/aac); store it (level 0) so autosave doesn't re-DEFLATE it.
  if (audioBytes) files["audio/track"] = [audioBytes, { level: 0 }];
  // Original media formats are already compressed — store at level 0, like audio/track.
  for (const { path, src } of media) {
    try {
      files[path] = [new Uint8Array(await (await fetch(src)).arrayBuffer()), { level: 0 }];
    } catch {
      onMediaEmbedFailed?.();
    }
  }
  return new Blob([zipSync(files)], { type: "application/zip" });
}

/** Rebuild a Project from a saved zip. `dpr` sizes the rebuilt cell canvases for the current display.
 *  `onSeeked` fires as each hydrated video reference's first frame becomes available (repaint hook).
 *  `onMediaPersistFailed` fires if seeding the local media store for a hydrated file fails (quota). */
/** Is this a usable key VALUE? Per property, because the failure differs: a NaN in a transform
 *  poisons the whole compose chain, while an out-of-range or NaN opacity is worse than it looks —
 *  per spec, `globalAlpha` IGNORES a value outside [0,1] or NaN, so the layer paints at the PREVIOUS
 *  draw op's alpha and it reads as a compositing bug rather than as bad data. `sanitiseTrack` guards
 *  `frame` and `sampleEvery`; the value was simply never guarded with them. */
/**
 * The transform key as the PARENT BUILD wrote it: the value lived on `t` before it was renamed `v`.
 *
 * Declared separately from `Keyframe<RefTransform>` deliberately. Typing the on-disk field as the
 * CURRENT model type is what hid the migration bug: it made the already-renamed shape the only one
 * the promotion tests could express, so they fabricated `v` keys and passed while every real file
 * lost its animation. Both fields are optional here because this describes untrusted bytes — a file
 * may carry either, and `legacyTracks` normalises to `v`.
 */
interface LegacyTransformKeyJson {
  frame: number;
  t?: RefTransform;
  v?: RefTransform;
  interp?: KeyInterp;
}
interface LegacyTransformTrackJson {
  keys?: LegacyTransformKeyJson[];
  sampleEvery?: number;
  box?: TransformTrack["box"];
}

function isTransformValue(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const t = v as RefTransform;
  return [t.dx, t.dy, t.scale, t.rotation].every((n) => Number.isFinite(n));
}
function isOpacityValue(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
}

/**
 * A track read back from a file is untrusted input. `transformAt` assumes `keys[0]` is the earliest
 * key and the last is the latest — that assumption is what makes it CLAMP outside the key range
 * instead of extrapolating — so unsorted or duplicated keys from a hand-edited file produce motion
 * the file never described. A `sampleEvery` outside its range quantises every sampled frame to
 * nonsense, and a non-finite one makes the whole transform NaN.
 *
 * Sort, de-duplicate (the later key wins, the same collision rule the ripple uses) and clamp. An
 * empty key array becomes no track at all: a track is documented never-empty, and `transformAt`
 * already falls back to the static transform.
 */
function sanitiseTrack<T extends Track<unknown>>(
  track: T | undefined,
  isValidValue: (v: unknown) => boolean,
): T | undefined {
  if (!track || !Array.isArray(track.keys)) return undefined;
  const byFrame = new Map<number, Keyframe<unknown>>();
  const sorted = track.keys
    // INTEGER and >= 0, not merely finite: every key action (tap-to-seek, retime, delete, the ease
    // control) matches `k.frame === playhead`, so a fractional or negative frame produces a key that
    // renders but can never be selected, moved or removed.
    .filter(
      (k) =>
        k && Number.isInteger(k.frame) && k.frame >= 0 && isValidValue((k as Keyframe<unknown>).v),
    )
    .sort((a, b) => a.frame - b.frame);
  for (const k of sorted) byFrame.set(k.frame, k);
  if (byFrame.size === 0) return undefined;
  const every = track.sampleEvery;
  const keys = [...byFrame.values()];
  if (every === undefined) return { ...track, keys };
  const n = Math.floor(Number.isFinite(every) ? every : 1);
  return { ...track, keys, sampleEvery: Math.min(MAX_SAMPLE_EVERY, Math.max(1, n)) };
}

/** A pivot box whose every field is a finite number, else null (= "no frozen box", which the
 *  consumers already fall back from). `groupBoxLogical` now READS this field, so a hand-edited or
 *  corrupt zip can feed it straight into pivot arithmetic — one NaN there produces NaN geometry
 *  with nothing on screen to say why. Same `Number.isFinite` shape as the frame/sampleEvery guards
 *  above; the fields are re-listed rather than spread so an unexpected extra key cannot ride in. */
function sanitiseTrackBox(box: TransformTrack["box"] | undefined): TransformTrack["box"] {
  return box && [box.x, box.y, box.w, box.h].every((n) => Number.isFinite(n))
    ? { x: box.x, y: box.y, w: box.w, h: box.h }
    : null;
}

/** Sort, de-duplicate and clamp every track in a persisted bag. A bag whose tracks all sanitise
 *  away is `undefined`, not an empty object — "no animation" has one representation in the model. */
function sanitiseTracks<T extends LayerTracks | GroupTracks>(tracks: T | undefined): T | undefined {
  if (!tracks) return undefined;
  const out = {} as T;
  // Union of layer + group props (deduped) with a `never` arm, matching `copyTracks`. A bag field
  // missed here is not merely unvalidated — it is never copied into `out`, so it VANISHES on reload.
  // Looping only TRACK_PROPS would drop a future group-only field on every open.
  for (const p of new Set<TrackProp | GroupTrackProp>([...TRACK_PROPS, ...GROUP_TRACK_PROPS])) {
    switch (p) {
      case "transform": {
        const transform = sanitiseTrack(tracks.transform, isTransformValue);
        if (transform) out.transform = { ...transform, box: sanitiseTrackBox(transform.box) };
        break;
      }
      case "opacity": {
        if (!("opacity" in tracks)) break;
        const opacity = sanitiseTrack(tracks.opacity, isOpacityValue);
        if (opacity) (out as LayerTracks).opacity = opacity;
        break;
      }
      default: {
        const unreachable: never = p;
        void unreachable;
      }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Promote the LEGACY single-track field into a bag, rewriting each key's value field.
 *
 * `transformTrack` shipped, so it is in real files and autosaves — and those files carry the value
 * on **`t`**, the name it had before this build renamed it `v`. Wrapping the track without
 * rewriting the keys leaves every `v` undefined, so `sanitiseTrack`'s value guard drops all of
 * them, the emptied track collapses to `undefined`, and the file opens parked at the static
 * `layer.transform` — a pose the layer may never have rendered. The next edit then autosaves that
 * over the only restorable copy.
 *
 * The rename was safe everywhere the compiler could see it. This is the one boundary where a type
 * is an assertion about bytes on disk rather than a fact, which is exactly where it got through.
 */
function legacyTracks(track: LegacyTransformTrackJson | undefined): LayerTracks | undefined {
  if (!track) return undefined;
  const keys = Array.isArray(track.keys)
    ? track.keys.map((k) => {
        if (!k || typeof k !== "object") return k;
        // Strip `t` rather than spreading it through: it is not a model field, and leaving it would
        // ride into the bag and be written back out on the next save.
        const { t, ...rest } = k;
        return t !== undefined && rest.v === undefined ? { ...rest, v: t } : rest;
      })
    : track.keys;
  // Cast at the boundary only — `sanitiseTrack` runs next and is what actually validates these.
  return { transform: { ...track, keys } as unknown as TransformTrack };
}

export async function loadProjectBlob(
  blob: Blob,
  dpr: number,
  onSeeked?: () => void,
  onMediaPersistFailed?: () => void,
): Promise<Project> {
  const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const json = JSON.parse(strFromU8(zip["project.json"])) as ProjectJson;

  let maxId = 0;
  const layers: DrawingLayer[] = [];
  for (const lj of json.layers) {
    maxId = Math.max(maxId, lj.id);
    const cells: Cell[] = [];
    for (let i = 0; i < lj.cells.length; i++) {
      if (lj.cells[i] === "hold") {
        cells.push({ kind: "hold" });
        continue;
      }
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
    const ct = lj.cellTransforms ?? {};
    for (const [k, v] of Object.entries(ct)) {
      const cell = cells[Number(k)];
      if (cell && cell.kind === "key") {
        cell.transform = v.transform;
        cell.transformBox = v.transformBox ?? null;
      }
    }
    layers.push({
      kind: "draw",
      id: lj.id,
      name: lj.name,
      visible: lj.visible,
      locked: lj.locked,
      opacity: lj.opacity,
      boilStrength: lj.boilStrength ?? 1,
      groupId: lj.groupId ?? null,
      cells,
      transform: lj.transform ?? { dx: 0, dy: 0, scale: 1, rotation: 0 },
      // Read both shapes: `transformTrack` shipped and is in real projects, including autosaves.
      // `tracks` wins when a file carries both.
      tracks: sanitiseTracks(lj.tracks ?? legacyTracks(lj.transformTrack)),
      // Passed through, not defaulted to `false`: absent already MEANS expanded, and defaulting
      // would write a redundant `tracksCollapsed: false` onto every layer of every later save.
      tracksCollapsed: lj.tracksCollapsed,
    });
  }
  const refsJson = json.references ?? [];
  for (const rj of refsJson) maxId = Math.max(maxId, rj.id);
  const refLayers: { index: number; value: ReferenceLayer }[] = [];
  for (const rj of refsJson) {
    const value = {
      kind: "ref",
      id: rj.id,
      name: rj.name,
      visible: rj.visible,
      opacity: rj.opacity,
      offsetFrames: rj.offsetFrames,
      speed: rj.speed ?? 1,
      audioEnabled: rj.audioEnabled ?? false,
      locked: rj.locked ?? false,
      range: rj.range,
      mediaId: rj.mediaId,
      mediaMime: rj.mediaMime,
      embedMedia: rj.embedMedia,
      groupId: rj.groupId ?? null,
      transform: rj.transform,
      tracks: sanitiseTracks(rj.tracks ?? legacyTracks(rj.transformTrack)),
      tracksCollapsed: rj.tracksCollapsed,
      media: { type: "missing", was: rj.was, name: rj.name },
    } as ReferenceLayer;
    const bytes = rj.mediaId ? zip[mediaAssetPath(rj.mediaId)] : undefined;
    if (bytes && rj.mediaId && shouldRestoreMedia(value)) {
      const mime = rj.mediaMime ?? (rj.was === "video" ? "video/mp4" : "image/png");
      const mediaBlob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime });
      try {
        value.media = await mediaFromBlob(mediaBlob, mime, rj.name, onSeeked ?? (() => {}));
        // Seed the local store so this file restores on every later reload (write-once path).
        void putMedia(rj.mediaId, { blob: mediaBlob, mime, name: rj.name }).catch(() =>
          onMediaPersistFailed?.(),
        );
      } catch {
        /* corrupt media entry → stays a re-link placeholder */
      }
    }
    refLayers.push({ index: rj.index, value });
  }
  const orderedLayers = insertReferencesByIndex<Layer>(layers, refLayers);
  const groups: LayerGroup[] = (json.groups ?? []).map((g) => {
    const o = g.opacity;
    return {
      id: g.id,
      name: g.name,
      collapsed: g.collapsed,
      visible: g.visible,
      locked: g.locked ?? false,
      opacity: typeof o === "number" && Number.isFinite(o) && o >= 0 && o <= 100 ? o : undefined,
      transform: g.transform ? { ...g.transform } : undefined,
      transformBox: g.transformBox ? { ...g.transformBox } : null,
      tracks: sanitiseTracks(g.tracks),
    };
  });
  for (const g of groups) maxId = Math.max(maxId, g.id);
  setMinLayerId(maxId + 1);
  const project: Project = {
    name: json.name ?? "",
    width: json.width,
    height: json.height,
    fps: json.fps,
    bgColor: json.bgColor,
    transparentBg: json.transparentBg ?? false,
    frameCount: json.frameCount,
    boil: migrateBoil(json.boil),
    groups,
    layers: orderedLayers,
    audio: null,
  };
  refreshLength(project); // independent per-layer lengths → derive document length from the layers
  const aj = json.audio;
  const audioBytes = zip["audio/track"];
  if (aj && audioBytes) {
    try {
      const buffer = await decodeAudioBytes(audioBytes);
      project.audio = {
        name: aj.name,
        bytes: audioBytes,
        buffer,
        offsetFrames: aj.offsetFrames,
        muted: aj.muted,
        trimInFrames: aj.trimInFrames,
        trimLenFrames: aj.trimLenFrames,
      };
    } catch {
      // Unsupported/corrupt encoding (a desktop-Chrome m4a opened in WebKit is the common one).
      // The project opens WITHOUT audio — playback and export need a decoded buffer — but the
      // encoded bytes are kept so the next save writes them back unchanged. Clearing them here is
      // what used to make one edit + autosave delete the audio from the only copy.
      project.audio = null;
      project.audioUndecoded = {
        name: aj.name,
        bytes: audioBytes,
        offsetFrames: aj.offsetFrames,
        muted: aj.muted,
        trimInFrames: aj.trimInFrames,
        trimLenFrames: aj.trimLenFrames,
      };
    }
  }
  return project;
}
