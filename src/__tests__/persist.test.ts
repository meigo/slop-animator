import { describe, it, expect } from "vitest";
import { setMinLayerId, createDrawingLayer } from "../anim/document";

describe("setMinLayerId", () => {
  it("ensures subsequent created layers get ids at or above the floor", () => {
    setMinLayerId(500);
    expect(createDrawingLayer(1).id).toBeGreaterThanOrEqual(500);
  });
  it("never lowers the counter", () => {
    setMinLayerId(500);
    const a = createDrawingLayer(1).id;
    setMinLayerId(10);
    const b = createDrawingLayer(1).id;
    expect(b).toBeGreaterThan(a);
  });
});
