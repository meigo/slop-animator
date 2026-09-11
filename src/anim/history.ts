import { markInkChanged } from "../lib/cell-ink";
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

/**
 * An undoable pixel write on `canvas`. Also marks `canvas`'s ink as changed — now (the write this
 * records has just happened) and on every undo/redo — so the per-canvas emptiness/bounds caches in
 * `cell-ink` re-measure exactly the drawing that changed. Every undoable pixel write goes through
 * here, which is what lets those caches stop invalidating on every document edit.
 */
export function pixelCommand(
  canvas: HTMLCanvasElement,
  undo: () => void,
  redo: () => void,
  before: ImageData,
  after: ImageData,
): Command {
  markInkChanged(canvas);
  return {
    undo: () => {
      undo();
      markInkChanged(canvas);
    },
    redo: () => {
      redo();
      markInkChanged(canvas);
    },
    bytes: before.data.byteLength + after.data.byteLength,
  };
}

export class History {
  /** Fired after any change to either stack. The UI mirrors `canUndo`/`canRedo` into `$state`
   *  through this: a plain class getter is not a reactive dependency, so a button bound directly
   *  to `history.canUndo` would never re-render. One hook here beats notifying at every push site. */
  onChange?: () => void;
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
    this.onChange?.();
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
    this.onChange?.();
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.redo();
    this.undoStack.push(cmd);
    this.onChange?.();
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
    this.onChange?.();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
