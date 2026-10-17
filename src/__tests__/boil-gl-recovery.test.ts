import { afterEach, describe, expect, it, vi } from "vitest";

// Review 2026-10-17 #20: on a LOST WebGL context, getShaderParameter/getProgramParameter return
// null, so compile/link "fail" — and that used to mark boil unsupported for the whole session.
// A lost context must only delay the next try (bounded backoff); a live context's failure still
// means the device can't, and is final.

/** A fake WebGL context: every call returns something truthy, except the status queries. */
function fakeGl(opts: { lost: boolean; compiles: boolean }) {
  return new Proxy(
    {},
    {
      get: (_t, k) => {
        if (k === "isContextLost") return () => opts.lost;
        if (k === "getShaderParameter" || k === "getProgramParameter")
          return () => (opts.lost ? null : opts.compiles);
        if (k === "getShaderInfoLog") return () => "log";
        if (typeof k === "string" && /^[A-Z_]+$/.test(k)) return 1; // GL enums
        return () => ({});
      },
    },
  );
}

let now = 0;
function setup(contexts: (() => unknown)[]) {
  let i = 0;
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      addEventListener: () => {},
      getContext: () => contexts[Math.min(i++, contexts.length - 1)](),
    }),
  });
  vi.spyOn(performance, "now").mockImplementation(() => now);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  now = 0;
});

describe("boil after a lost WebGL context", () => {
  it("a build on a lost context is retried later, not given up for the session", async () => {
    setup([
      () => fakeGl({ lost: true, compiles: true }),
      () => fakeGl({ lost: false, compiles: true }),
    ]);
    const { boilBegin, boilFallbacks } = await import("../core/boil-gl");
    expect(boilBegin(10, 10)).toBe(false); // lost → 2D path this frame
    expect(boilBegin(10, 10)).toBe(false); // backing off: no new context yet
    expect(boilFallbacks()).toBe(2);
    now += 1000;
    expect(boilBegin(10, 10)).toBe(true); // the GPU is back
  });

  it("the backoff grows while it keeps failing, and is bounded at 30 s", async () => {
    const attempts: number[] = [];
    setup([
      () => {
        attempts.push(now);
        return fakeGl({ lost: true, compiles: true });
      },
    ]);
    const { boilBegin } = await import("../core/boil-gl");
    for (now = 0; now <= 300_000; now += 100) boilBegin(10, 10);
    const gaps = attempts.slice(1).map((t, i) => t - attempts[i]);
    expect(gaps[0]).toBeLessThan(1000); // retried soon at first
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThanOrEqual(gaps[i - 1]);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(30_100); // bounded
    expect(attempts.length).toBeLessThan(25); // not a new context every frame
    expect(attempts[attempts.length - 1]).toBeGreaterThan(260_000); // still trying
  });

  it("a shader that fails on a LIVE context is final (the device can't)", async () => {
    setup([
      () => fakeGl({ lost: false, compiles: false }),
      () => fakeGl({ lost: false, compiles: true }),
    ]);
    const { boilBegin } = await import("../core/boil-gl");
    expect(boilBegin(10, 10)).toBe(false);
    now += 60_000;
    expect(boilBegin(10, 10)).toBe(false);
  });
});
