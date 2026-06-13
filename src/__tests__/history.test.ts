import { describe, it, expect } from "vitest";
import { History, type Command } from "../anim/history";

function counterCmd(state: { n: number }, delta: number): Command {
  return { undo: () => { state.n -= delta; }, redo: () => { state.n += delta; } };
}

describe("History", () => {
  it("undo reverts the last command and redo re-applies it", () => {
    const s = { n: 0 };
    const h = new History();
    s.n += 5; h.push(counterCmd(s, 5));
    expect(s.n).toBe(5);
    h.undo(); expect(s.n).toBe(0);
    h.redo(); expect(s.n).toBe(5);
  });

  it("pushing a new command after undo clears the redo stack", () => {
    const s = { n: 0 };
    const h = new History();
    s.n += 5; h.push(counterCmd(s, 5));
    h.undo();
    s.n += 2; h.push(counterCmd(s, 2));
    h.redo(); // nothing to redo
    expect(s.n).toBe(2);
    expect(h.canRedo).toBe(false);
  });

  it("undo/redo are no-ops on empty stacks", () => {
    const h = new History();
    expect(h.canUndo).toBe(false);
    h.undo(); h.redo();
    expect(h.canUndo).toBe(false);
  });

  it("caps the undo stack at its max size", () => {
    const s = { n: 0 };
    const h = new History(3);
    for (let i = 0; i < 5; i++) { s.n += 1; h.push(counterCmd(s, 1)); }
    let undone = 0;
    while (h.canUndo) { h.undo(); undone++; }
    expect(undone).toBe(3); // only the last 3 are retained
  });
});
