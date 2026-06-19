import { describe, it, expect } from "vitest";
import { parsePreferences } from "../persist/preferences";

describe("parsePreferences", () => {
  it("null → {}", () => {
    expect(parsePreferences(null)).toEqual({});
  });
  it("invalid JSON → {}", () => {
    expect(parsePreferences("not json")).toEqual({});
  });
  it("a JSON object → its contents", () => {
    expect(parsePreferences('{"theme":"light","sizeRange":2}')).toEqual({
      theme: "light",
      sizeRange: 2,
    });
  });
  it("valid JSON that isn't an object → {}", () => {
    expect(parsePreferences("5")).toEqual({});
  });
  it("a JSON array → {}", () => {
    expect(parsePreferences("[1,2]")).toEqual({});
  });
});
