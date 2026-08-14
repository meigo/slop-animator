/** A reversible edit. The caller performs the action, then pushes the command. */
export interface Command {
  undo(): void;
  redo(): void;
  label?: string;
  /** Retained RAM for this command (e.g. two ImageData copies). Used to evict old pixel undos. */
  bytes?: number;
}

/** Default pixel-undo budget: ~15 full-frame 1920×1080 strokes (2 ImageDatas each). */
export const DEFAULT_HISTORY_BYTES = 256 * 1024 * 1024;

export function pixelCommand(
  undo: () => void,
  redo: () => void,
  before: ImageData,
  after: ImageData,
): Command {
  return { undo, redo, bytes: before.data.byteLength + after.data.byteLength };
}

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private bytes = 0;
  private maxSize: number;
  private maxBytes: number;
  constructor(maxSize = 50, maxBytes = DEFAULT_HISTORY_BYTES) {
    this.maxSize = maxSize;
    this.maxBytes = maxBytes;
  }

  push(cmd: Command): void {
    for (const c of this.redoStack) this.bytes -= c.bytes ?? 0;
    this.redoStack = [];
    this.undoStack.push(cmd);
    this.bytes += cmd.bytes ?? 0;
    this.trim();
  }

  private trim(): void {
    while (
      this.undoStack.length > this.maxSize ||
      (this.bytes > this.maxBytes && this.undoStack.length > 1)
    ) {
      const old = this.undoStack.shift();
      if (!old) break;
      this.bytes -= old.bytes ?? 0;
    }
    if (this.bytes < 0) this.bytes = 0;
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.redo();
    this.undoStack.push(cmd);
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
