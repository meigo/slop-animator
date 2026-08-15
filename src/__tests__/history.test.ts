import { describe, it, expect } from "vitest";
import { History, type Command } from "../anim/history";

function counterCmd(state: { n: number }, delta: number): Command {
  return {
    undo: () => {
      state.n -= delta;
    },
    redo: () => {
      state.n += delta;
    },
  };
}

describe("History", () => {
  it("undo reverts the last command and redo re-applies it", () => {
    const s = { n: 0 };
    const h = new History();
    s.n += 5;
    h.push(counterCmd(s, 5));
    expect(s.n).toBe(5);
    h.undo();
    expect(s.n).toBe(0);
    h.redo();
    expect(s.n).toBe(5);
  });

  it("pushing a new command after undo clears the redo stack", () => {
    const s = { n: 0 };
    const h = new History();
    s.n += 5;
    h.push(counterCmd(s, 5));
    h.undo();
    s.n += 2;
    h.push(counterCmd(s, 2));
    h.redo(); // nothing to redo
    expect(s.n).toBe(2);
    expect(h.canRedo).toBe(false);
  });

  it("undo/redo are no-ops on empty stacks", () => {
    const h = new History();
    expect(h.canUndo).toBe(false);
    h.undo();
    h.redo();
    expect(h.canUndo).toBe(false);
  });

  it("caps the undo stack at its max size", () => {
    const s = { n: 0 };
    const h = new History(3);
    for (let i = 0; i < 5; i++) {
      s.n += 1;
      h.push(counterCmd(s, 1));
    }
    let undone = 0;
    while (h.canUndo) {
      h.undo();
      undone++;
    }
    expect(undone).toBe(3); // only the last 3 are retained
  });

  it("drops the oldest commands when the byte budget is exceeded", () => {
    const s = { n: 0 };
    const h = new History(50, 25);
    for (let i = 0; i < 3; i++) {
      s.n += 1;
      h.push({ ...counterCmd(s, 1), bytes: 10 });
    }
    // 30 bytes > 25 → drop the oldest; 20 bytes / 2 commands remain
    let undone = 0;
    while (h.canUndo) {
      h.undo();
      undone++;
    }
    expect(undone).toBe(2);
  });

  it("keeps a single command even if it is over the byte budget", () => {
    const h = new History(50, 10);
    h.push({ ...counterCmd({ n: 0 }, 1), bytes: 99 });
    expect(h.canUndo).toBe(true);
    h.undo();
    expect(h.canUndo).toBe(false);
  });
});

describe("History.onChange", () => {
  /** The toolbar mirrors canUndo/canRedo into $state through this hook — a plain class getter is
   *  not a reactive dependency, so if the hook stops firing the buttons silently stop greying. */
  function tracked() {
    const st = { n: 0 };
    const h = new History();
    const seen: { undo: boolean; redo: boolean }[] = [];
    h.onChange = () => seen.push({ undo: h.canUndo, redo: h.canRedo });
    return { st, h, seen };
  }

  it("fires on push, undo, redo and clear, reporting the state AFTER the change", () => {
    const { st, h, seen } = tracked();
    h.push(counterCmd(st, 1));
    expect(seen.at(-1)).toEqual({ undo: true, redo: false });
    h.undo();
    expect(seen.at(-1)).toEqual({ undo: false, redo: true });
    h.redo();
    expect(seen.at(-1)).toEqual({ undo: true, redo: false });
    h.clear();
    expect(seen.at(-1)).toEqual({ undo: false, redo: false });
    expect(seen).toHaveLength(4);
  });

  it("does not fire when undo/redo have nothing to do", () => {
    const { h, seen } = tracked();
    h.undo();
    h.redo();
    expect(seen).toHaveLength(0);
  });

  it("reports redo as unavailable once a push clears the redo stack", () => {
    const { st, h, seen } = tracked();
    h.push(counterCmd(st, 1));
    h.undo();
    expect(h.canRedo).toBe(true);
    h.push(counterCmd(st, 2));
    expect(seen.at(-1)).toEqual({ undo: true, redo: false });
  });
});
