let ctx: AudioContext | null = null;

/** Lazily create one shared AudioContext (constructed on first use, i.e. a user gesture). */
export function getAudioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}
