/** A reversible edit. The caller performs the action, then pushes the command. */
export interface Command {
  undo(): void;
  redo(): void;
  label?: string;
}

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private maxSize: number;
  constructor(maxSize = 50) {
    this.maxSize = maxSize;
  }

  push(cmd: Command): void {
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.maxSize) this.undoStack.shift();
    this.redoStack = [];
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
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
