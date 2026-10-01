// iPad smoke check (`npm run test:ipad`): the app in WebKit — Safari's engine — at iPad Pro 11
// landscape size with touch, in a fresh profile (its own IndexedDB: never your autosave).
// Port of slop-paint's tools/ipad-smoke.mjs (0b2a071), with this app's selectors and checks.
//
//   npm run test:ipad                     starts its own dev server on a free port
//   npm run test:ipad -- <url>            checks that URL instead (e.g. the deployed site)
//
// Screenshots go to test-results/ipad/. Exits 1 when a check fails or the page reports an error.
// This is DESKTOP WebKit in an iPad-sized touch window, not iPadOS: it catches Safari-engine
// breakage and regressions in the pen and finger paths. Not covered — test these on the iPad: the
// real Pencil (strokes here are simulated pen events), how iPadOS orders a Pencil and a finger,
// iOS-only rendering (CLAUDE.md gotcha #14 drew correctly in desktop WebKit), the share sheet, the
// on-screen keyboard (gotcha #15), iPadOS memory limits.
// First run on a machine: `npx playwright install webkit` (~100 MB).
import { mkdirSync } from "node:fs";
import { webkit, devices } from "playwright";
import { createServer } from "vite";

const OUT = "test-results/ipad";
mkdirSync(OUT, { recursive: true });

let server = null;
let url = process.argv[2];
if (!url) {
  server = await createServer({ server: { port: 0 }, logLevel: "error" });
  await server.listen();
  url = server.resolvedUrls.local[0];
}

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const browser = await webkit.launch();
try {
  const context = await browser.newContext({ ...devices["iPad Pro 11 landscape"] });
  // Simulated pointers aren't live ones, so WebKit refuses to capture them ("The object can not be
  // found here"); a real Pencil or finger is one. Let capture fail quietly for the simulation.
  await context.addInitScript(() => {
    const capture = Element.prototype.setPointerCapture;
    Element.prototype.setPointerCapture = function (id) {
      try {
        capture.call(this, id);
      } catch {
        /* simulated pointer */
      }
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto(url);
  await page.waitForSelector('[aria-label="Scrub frames"]', { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/1-loaded.png` });
  check(true, `loads (${url})`);

  const stage = await page.locator("div.touch-none.overflow-hidden").first().boundingBox();
  /** The view's pan/zoom/rotate, as the viewport writes it on the stage's first child. */
  const viewTransform = () =>
    page.evaluate(
      () => document.querySelector("div.touch-none.overflow-hidden > div")?.style.transform ?? "",
    );
  /**
   * Pointer events on the stage, in the page (synthetic: the app's handlers are what is tested).
   * `steps` is a list of [type, pointerType, id, t] with t in 0..1 along a line across the stage.
   */
  const send = (steps) =>
    page.evaluate(
      ({ x, y, w, h, steps }) => {
        const at = (t) => ({ cx: x + w * (0.25 + 0.5 * t), cy: y + h * (0.4 + 0.2 * t) });
        for (const [type, pointerType, pointerId, t] of steps) {
          const { cx, cy } = at(t);
          const target = document.elementFromPoint(cx, cy);
          target?.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId,
              pointerType,
              isPrimary: true,
              button: 0,
              buttons: type === "pointerup" ? 0 : 1,
              clientX: cx,
              clientY: cy,
              pressure: pointerType === "pen" ? 0.2 + 0.6 * Math.sin(t * Math.PI) : 0.5,
            }),
          );
        }
      },
      { x: stage.x, y: stage.y, w: stage.width, h: stage.height, steps },
    );
  const line = (type, id) => {
    const out = [["pointerdown", type, id, 0]];
    for (let i = 1; i <= 30; i++) out.push(["pointermove", type, id, i / 30]);
    out.push(["pointerup", type, id, 1]);
    return out;
  };

  // A Pencil stroke.
  await send(line("pen", 2));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/2-stroke.png` });
  const undo = await page.locator('button[title^="Undo"]').first().getAttribute("title");
  check(!/nothing to undo/.test(undo ?? ""), "a pen stroke draws and adds an undo step");

  // A finger landing DURING a pen stroke is a resting hand: the view must not move under the line
  // (review batch A; it used to pan, so the line jumped).
  const before = await viewTransform();
  await send([
    ["pointerdown", "pen", 3, 0],
    ["pointermove", "pen", 3, 0.2],
    ["pointerdown", "touch", 8, 0.3],
    ["pointermove", "touch", 8, 0.6],
    ["pointermove", "pen", 3, 0.5],
    ["pointermove", "touch", 8, 0.9],
    ["pointerup", "touch", 8, 0.9],
    ["pointermove", "pen", 3, 0.8],
    ["pointerup", "pen", 3, 1],
  ]);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/3-palm.png` });
  check((await viewTransform()) === before, "a finger landing mid-stroke does not pan the view");

  // …while a finger drag on its own does pan it (so the check above can tell the difference).
  await send(line("touch", 7));
  await page.waitForTimeout(200);
  check((await viewTransform()) !== before, "a finger drag pans the view");

  // A real finger tap on a toolbar menu.
  const file = await page.getByRole("button", { name: /^File/ }).first().boundingBox();
  await page.touchscreen.tap(file.x + file.width / 2, file.y + file.height / 2);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/4-menu.png` });
  check((await page.locator('[role="menu"]').count()) > 0, "a finger tap opens the File menu");

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
} finally {
  await browser.close();
  await server?.close();
}
console.log(
  failures.length ? `\n${failures.length} failed` : `\nall passed — screenshots in ${OUT}/`,
);
process.exit(failures.length ? 1 : 0);
