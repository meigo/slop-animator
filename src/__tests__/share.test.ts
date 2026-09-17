import { describe, it, expect } from "vitest";
import { isAppleTouch, classifyShareError } from "../export/share";

describe("isAppleTouch", () => {
  it("recognises iPhone and old-style iPad user agents", () => {
    expect(
      isAppleTouch("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "iPhone", 5),
    ).toBe(true);
    expect(isAppleTouch("Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X)", "iPad", 5)).toBe(true);
  });
  it("recognises an iPad that reports itself as a Mac, by its touch points", () => {
    expect(isAppleTouch("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5)).toBe(
      true,
    );
  });
  it("leaves a real Mac and other desktops alone", () => {
    expect(isAppleTouch("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0)).toBe(
      false,
    );
    expect(isAppleTouch("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32", 10)).toBe(false);
  });
});

describe("classifyShareError", () => {
  it("reads a closed share sheet as dismissed, not a failure", () => {
    expect(classifyShareError(new DOMException("x", "AbortError"))).toBe("dismissed");
  });
  it("reads an expired tap as needing a second tap", () => {
    expect(classifyShareError(new DOMException("x", "NotAllowedError"))).toBe("needs-tap");
  });
  it("reads anything else as a failure", () => {
    expect(classifyShareError(new DOMException("x", "DataError"))).toBe("failed");
    expect(classifyShareError(new Error("boom"))).toBe("failed");
    expect(classifyShareError("nope")).toBe("failed");
  });
});
