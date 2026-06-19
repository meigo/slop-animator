import { getAudioContext } from "./context";
import type { AudioTrack } from "../anim/document";

/** Decode raw encoded audio bytes to an AudioBuffer via the shared AudioContext. */
export async function decodeAudioBytes(bytes: Uint8Array): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return ctx.decodeAudioData(ab);
}

/** Read a File, keep its bytes (for persistence), decode it, and build an AudioTrack. */
export async function loadAudioTrack(file: File): Promise<AudioTrack> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const buffer = await decodeAudioBytes(bytes);
  return { name: file.name, bytes, buffer, offsetFrames: 0, muted: false };
}
