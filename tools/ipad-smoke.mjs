// iPad smoke check (`npm run test:ipad`): the app in WebKit — Safari's engine — at iPad Pro 11
// landscape size with touch, in a fresh temp profile (its own IndexedDB: never your autosave).
// Port of slop-paint's tools/ipad-smoke.mjs (0b2a071), with this app's selectors and checks.
//
//   npm run test:ipad                     starts its own dev server on a free port
//   npm run test:ipad -- <url>            checks that URL instead (e.g. the deployed site)
//
// Screenshots go to test-results/ipad/. Exits 1 when a check fails or the page reports an error.
// This is DESKTOP WebKit in an iPad-sized touch window, not iPadOS: it catches Safari-engine
// breakage and regressions in the pen and finger paths, and guards the browser-side fixes of the
// 2026-09-30 code review (each of those checks was confirmed to FAIL on the pre-review code,
// e060951), plus a finger drag of a layer row (2026-10-01). Every check reads its verdict from the page, so a deployed URL runs them too. Not covered — test these on the iPad: the
// real Pencil (strokes here are simulated pen events), how iPadOS orders a Pencil and a finger,
// iOS-only rendering (CLAUDE.md gotcha #14 drew correctly in desktop WebKit), the share sheet, the
// on-screen keyboard (gotcha #15), iPadOS memory limits.
// First run on a machine: `npx playwright install webkit` (~100 MB).
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// A persistent profile in a fresh temp folder, not Playwright's default context: that one is
// ephemeral, and ephemeral WebKit refuses Blobs in IndexedDB ("Error preparing Blob/File data to be
// stored in object store"), so every autosave failed there — a harness artifact, not the app.
const profile = mkdtempSync(join(tmpdir(), "slop-ipad-smoke-"));
const context = await webkit.launchPersistentContext(profile, {
  ...devices["iPad Pro 11 landscape"],
});
let homeProfile = "";
try {
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
  const page = context.pages()[0] ?? (await context.newPage());
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
   * `steps` is a list of [type, pointerType, id, t, dy?] with t in 0..1 along a line across the stage,
   * shifted down by `dy` (a fraction of the stage height) for a line apart from the others.
   */
  const send = (steps) =>
    page.evaluate(
      ({ x, y, w, h, steps }) => {
        const at = (t, dy = 0) => ({
          cx: x + w * (0.25 + 0.5 * t),
          cy: y + h * (0.4 + 0.2 * t + dy),
        });
        for (const [type, pointerType, pointerId, t, dy] of steps) {
          const { cx, cy } = at(t, dy);
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

  // A pen press on the canvas leaves a focused text field (review batch E): the press is
  // preventDefault'ed, so nothing else took focus — on iPad the keyboard stayed up.
  await page.locator('input[inputmode="decimal"]').first().focus();
  const focusedBefore = await page.evaluate(() => document.activeElement?.tagName);
  await send(line("pen", 4));
  await page.waitForTimeout(200);
  const focusedAfter = await page.evaluate(() => document.activeElement?.tagName);
  check(
    focusedBefore === "INPUT" && focusedAfter !== "INPUT",
    "a pen press on the canvas leaves a focused number field",
  );

  // ── Review fixes (2026-09-30 code review, batches A–E). Each reads its verdict from the page —
  // tool button state, undo/redo titles, display pixels, the timeline's scroll — so they also run
  // against a deployed URL. ──

  /** Lit tool button's title: the active tool, as the toolbar shows it. */
  const activeTool = () =>
    page.evaluate(() => document.querySelector("button.ui-on[title]")?.getAttribute("title") ?? "");
  /** Dark pixels on the display canvas (black ink on the default white paper). */
  const ink = () =>
    page.evaluate(() => {
      const c = document.querySelector("div.touch-none.overflow-hidden > div canvas");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] < 128) n++;
      return n;
    });
  const redoTitle = () => page.locator('button[title^="Redo"]').first().getAttribute("title");
  const statusSays = (text) => page.evaluate((t) => document.body.innerText.includes(t), text);
  const menuItem = async (menu, title) => {
    await page
      .getByRole("button", { name: new RegExp(`^${menu}`) })
      .first()
      .click();
    await page.locator(`[role^="menuitem"][title^="${title}"]`).first().click();
  };

  // A two-finger tap while the Pencil is down is a resting hand, not Undo (batch A): it used to
  // roll back the open stroke AND undo the stroke before it.
  // Both strokes on lines of their own: undoing a stroke that another one overlaps changes no pixel.
  const UP = -0.25;
  const DOWN = 0.25;
  const inkStart = await ink();
  await send(line("pen", 5).map((step) => [...step, UP]));
  await page.waitForTimeout(200);
  const inkBefore = await ink();
  const oneStroke = inkBefore - inkStart;
  await send([
    ["pointerdown", "pen", 5, 0, DOWN],
    ["pointermove", "pen", 5, 0.3, DOWN],
    ["pointerdown", "touch", 11, 0.4, DOWN],
    ["pointerdown", "touch", 12, 0.6, DOWN],
    ["pointerup", "touch", 11, 0.4, DOWN],
    ["pointerup", "touch", 12, 0.6, DOWN],
    ["pointermove", "pen", 5, 0.7, DOWN],
    ["pointerup", "pen", 5, 1, DOWN],
  ]);
  await page.waitForTimeout(300);
  // The open stroke is redrawn from all its points, so with the bug the line comes back while the
  // stroke before it is gone: the total stays about level. Fixed, it grows by about one stroke.
  check(
    oneStroke > 0 && (await ink()) - inkBefore > oneStroke / 2,
    "a two-finger tap mid-stroke undoes nothing",
  );

  // Single-key tool shortcuts skip Cmd chords (batch E): Cmd+S switched to Select. `e` first, from
  // an unfocused page, so the check cannot pass on keys that are not reaching the app at all.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("e");
  const keysLive = /^Eraser/.test(await activeTool());
  await page.keyboard.press("Meta+s");
  check(keysLive && /^Eraser/.test(await activeTool()), "Cmd+S does not switch to the Select tool");
  await page.keyboard.press("b");

  // …and stay live with a slider focused — only TEXT fields own the keys (batch E).
  await page.locator('input[type="range"]').first().focus();
  await page.keyboard.press("e");
  check(/^Eraser/.test(await activeTool()), "tool keys work while a slider has focus");
  await page.keyboard.press("b");

  // …and stand aside while a dialog is open (batch E).
  await menuItem("Document", "Name, background colour");
  await page.getByRole("button", { name: "Close" }).focus();
  await page.keyboard.press("e");
  check(/^Brush/.test(await activeTool()), "tool keys are dead under the Project Settings dialog");
  await page.getByRole("button", { name: "Close" }).click();

  // Redo with a moved selection open leaves both alone (batch A): it cancelled the move, which
  // pushes no undo step, so the move was lost for good.
  await page.keyboard.press("Meta+z");
  const redoReady = /^Redo$/.test((await redoTitle()) ?? "");
  await page.keyboard.press("s");
  await send([
    ["pointerdown", "pen", 6, 0.1],
    ["pointermove", "pen", 6, 0.5],
    ["pointermove", "pen", 6, 0.9],
    ["pointerup", "pen", 6, 0.9],
  ]);
  await send([
    ["pointerdown", "pen", 6, 0.5],
    ["pointermove", "pen", 6, 0.55],
    ["pointermove", "pen", 6, 0.6],
    ["pointerup", "pen", 6, 0.6],
  ]);
  await page.waitForTimeout(200);
  await page.keyboard.press("Meta+Shift+z");
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/5-float-redo.png` });
  check(
    redoReady &&
      /^Redo$/.test((await redoTitle()) ?? "") &&
      (await statusSays("Apply or cancel the transform first")),
    "redo with a moved selection keeps the move and the redo step",
  );
  await page.keyboard.press("Enter"); // apply the move
  await page.keyboard.press("b");

  // The eyedropper on an empty spot of a transparent background picks nothing (batch E): it read
  // the empty pixel's channels and set the colour to black.
  await menuItem("Document", "Transparent background");
  await page.locator('button[title^="Eyedropper"]').first().click();
  const paper = await page
    .locator("div.touch-none.overflow-hidden > div canvas")
    .first()
    .boundingBox();
  await page.evaluate(
    ({ x, y }) => {
      for (const type of ["pointerdown", "pointerup"])
        document.elementFromPoint(x, y)?.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 9,
            pointerType: "pen",
            isPrimary: true,
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
            clientX: x,
            clientY: y,
            pressure: 0.5,
          }),
        );
    },
    { x: paper.x + 6, y: paper.y + 6 },
  );
  await page.waitForTimeout(200);
  check(
    /^Eyedropper/.test(await activeTool()) && (await statusSays("Nothing to pick there")),
    "the eyedropper picks nothing on an empty transparent spot",
  );
  await menuItem("Document", "Transparent background");
  await page.keyboard.press("b");

  // A finger pan on the timeline ruler that the OS cancels does not fling (batch E); one that is
  // released does, so the check can tell the two apart.
  // A new project is 1 frame, which leaves nothing to scroll: make it long enough to.
  await page.locator('button[title="Playback settings"]').click();
  const length = page.getByLabel("Animation length in frames");
  await length.click();
  await length.press("Meta+a");
  await length.pressSequentially("300");
  await length.press("Enter");
  await page.waitForTimeout(300);
  const ruler = await page.locator('[aria-label="Scrub frames"]').boundingBox();
  /** Swipe left along the ruler, end it with `end`, and report how far it coasts afterwards. */
  const rulerSwipe = (end) =>
    page.evaluate(
      async ({ x, y, w, end }) => {
        const el = document.querySelector('[aria-label="Scrub frames"]');
        const s = el.closest(".timeline-grid");
        const fire = (type, cx) =>
          el.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 21,
              pointerType: "touch",
              isPrimary: true,
              button: 0,
              buttons: type === "pointermove" || type === "pointerdown" ? 1 : 0,
              clientX: cx,
              clientY: y,
            }),
          );
        const frame = () => new Promise((r) => setTimeout(r, 16));
        if (!s || s.scrollWidth <= s.clientWidth) return { scrollable: false, coast: 0 };
        s.scrollLeft = 0;
        let cx = x + w * 0.8;
        fire("pointerdown", cx);
        for (let i = 0; i < 8; i++) {
          await frame();
          cx -= 25;
          fire("pointermove", cx);
        }
        fire(end, cx);
        const atEnd = s.scrollLeft;
        await new Promise((r) => setTimeout(r, 400));
        return { scrollable: true, coast: s.scrollLeft - atEnd };
      },
      { x: ruler.x, y: ruler.y + ruler.height / 2, w: ruler.width, end },
    );
  const released = await rulerSwipe("pointerup");
  const cancelled = await rulerSwipe("pointercancel");
  check(
    released.scrollable && released.coast > 0 && cancelled.coast === 0,
    `a cancelled finger pan on the timeline does not fling (released coasts ${released.coast}px, cancelled ${cancelled.coast}px)`,
  );

  // File ▸ Open asks before replacing the project (batch A); declining keeps it. The file is this
  // project, saved through File ▸ Save, so the save path is exercised too.
  const download = page.waitForEvent("download");
  await menuItem("File", "Save the project");
  const saved = await (await download).path();
  const chooser = page.waitForEvent("filechooser");
  await menuItem("File", "Open a saved project");
  let asked = "";
  page.once("dialog", (d) => {
    asked = d.type();
    void d.dismiss();
  });
  await (
    await chooser
  ).setFiles({
    name: "smoke.zip",
    mimeType: "application/zip",
    buffer: readFileSync(saved),
  });
  await page.waitForTimeout(1000);
  check(
    asked === "confirm" &&
      /^Undo$/.test(
        (await page.locator('button[title^="Undo"]').first().getAttribute("title")) ?? "",
      ),
    "File ▸ Open asks first, and declining keeps the current project",
  );

  // The autosave reaches IndexedDB and brings the drawing back after a reload (batch A made it
  // one save at a time; a save superseded mid-encode used to be dropped). It fires 3 s after the
  // last edit once no pointer has been down for 1.5 s.
  const stored = await page.evaluate(async () => {
    const read = () =>
      new Promise((resolve) => {
        const open = indexedDB.open("slop-animator");
        open.onsuccess = () => {
          const db = open.result;
          const get = db.transaction("kv").objectStore("kv").get("autosave");
          get.onsuccess = () => (db.close(), resolve(get.result != null));
          get.onerror = () => (db.close(), resolve(false));
        };
        open.onerror = () => resolve(false);
      });
    for (let i = 0; i < 20; i++) {
      if (await read()) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  });
  const inkSaved = await ink();
  await page.reload();
  await page.waitForSelector('[aria-label="Scrub frames"]', { timeout: 20000 });
  await page.waitForTimeout(800);
  const frames = await page.locator('[aria-label="Scrub frames"]').getAttribute("aria-valuemax");
  check(
    stored && frames === "300" && (await ink()) === inkSaved && inkSaved > 0,
    "the autosave comes back after a reload (drawing and length)",
  );
  check(!(await statusSays("Autosave is failing")), "no autosave failure warning");

  // A finger drag of a layer row (2026-10-01, the drag that replaced SortableJS): the bottom row
  // to the top, and the gap open mid-drag. Simulated pointers are not live, so capture fails (the
  // init script lets it fail quietly) and every event goes to the grip, as a captured stream would.
  await page.locator('button[title="Add layer"]').click();
  await page.waitForTimeout(200);
  const rowOrder = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("[data-layer-list] [data-row-key]")]
        .filter((el) => el.getBoundingClientRect().height > 0)
        .map((el) => el.dataset.rowKey),
    );
  const rowsBefore = await rowOrder();
  const fingerDrag = await page.evaluate(async (keys) => {
    const from = keys[keys.length - 1];
    const grip = document.querySelector(
      `[data-layer-list] [data-row-key="${from}"] .layer-drag-handle`,
    );
    const to = document
      .querySelector(`[data-layer-list] [data-row-key="${keys[0]}"]`)
      .getBoundingClientRect();
    const g = grip.getBoundingClientRect();
    const x = g.left + g.width / 2;
    const fire = (type, y) =>
      grip.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 31,
          pointerType: "touch",
          isPrimary: true,
          button: 0,
          buttons: type === "pointerup" || type === "pointerout" || type === "pointerleave" ? 0 : 1,
          clientX: x,
          clientY: y,
        }),
      );
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const y = g.top + g.height / 2;
    for (const t of ["pointerover", "pointerenter", "pointerdown"]) fire(t, y);
    const target = to.top + to.height * 0.2;
    for (let i = 1; i <= 8; i++) {
      fire("pointermove", y + ((target - y) * i) / 8);
      await frame();
    }
    const slid = [...document.querySelectorAll("[data-layer-list] [data-row-key]")].some((el) =>
      el.style.transform.includes("translateY"),
    );
    for (const t of ["pointerup", "pointerout", "pointerleave"]) fire(t, target);
    await frame();
    return { slid };
  }, rowsBefore);
  await page.waitForTimeout(300);
  const rowsAfter = await rowOrder();
  check(
    fingerDrag.slid &&
      rowsAfter[0] === rowsBefore[rowsBefore.length - 1] &&
      rowsAfter.length === rowsBefore.length,
    `a finger drag moves a layer row, with the gap open mid-drag (${rowsBefore} → ${rowsAfter})`,
  );

  // A real finger tap on a toolbar menu.
  const file = await page.getByRole("button", { name: /^File/ }).first().boundingBox();
  await page.touchscreen.tap(file.x + file.width / 2, file.y + file.height / 2);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/4-menu.png` });
  check((await page.locator('[role="menu"]').count()) > 0, "a finger tap opens the File menu");

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);

  // ── The Home Screen app (standalone), where iOS can't download at all: the link does nothing,
  // so File ▸ Save said "Saved" and wrote nothing. A context of its own, faking standalone mode
  // and recording what reaches the share sheet. `window.__share` steers the fake: `fail` is the
  // error name the next share throws, `accepts` is what canShare answers. ──
  homeProfile = mkdtempSync(join(tmpdir(), "slop-ipad-smoke-home-"));
  const home = await webkit.launchPersistentContext(homeProfile, {
    ...devices["iPad Pro 11 landscape"],
  });
  await home.addInitScript(() => {
    const media = window.matchMedia.bind(window);
    window.matchMedia = (q) =>
      /display-mode:\s*standalone/.test(q) ? { ...media(q), matches: true, media: q } : media(q);
    window.__share = { shared: [], fail: "", accepts: true };
    navigator.canShare = () => window.__share.accepts;
    navigator.share = async ({ files }) => {
      if (window.__share.fail) {
        const name = window.__share.fail;
        window.__share.fail = "";
        throw new DOMException("fake", name);
      }
      window.__share.shared.push(files[0].name);
    };
  });
  const hp = home.pages()[0] ?? (await home.newPage());
  let downloads = 0;
  hp.on("download", () => downloads++);
  await hp.goto(url);
  await hp.waitForSelector('[aria-label="Scrub frames"]', { timeout: 20000 });
  await hp.waitForTimeout(500);
  const fileMenu = async (title) => {
    await hp.getByRole("button", { name: /^File/ }).first().click();
    await hp.locator(`[role="menuitem"][title^="${title}"]`).first().click();
  };
  const shared = () => hp.evaluate(() => window.__share.shared.slice());

  await fileMenu("Save the project");
  await hp.waitForTimeout(1000);
  check(
    downloads === 0 && (await shared()).some((n) => n.endsWith(".zip")),
    "Home Screen app: File ▸ Save goes to the share sheet, not a download",
  );

  // The tap expired before the sheet could open: the ready dialog takes a fresh one, and offers
  // no download there.
  await hp.evaluate(() => (window.__share.fail = "NotAllowedError"));
  await fileMenu("Save the project");
  await hp.waitForTimeout(1000);
  const dialogUp = (await hp.getByText(/is ready$/).count()) > 0;
  check(
    dialogUp && (await hp.getByRole("button", { name: "Download instead" }).count()) === 0,
    "Home Screen app: the ready dialog offers no download",
  );
  if (dialogUp) await hp.getByRole("button", { name: "Cancel" }).click();

  // The sheet won't take the file: say so, rather than a download that silently does nothing.
  await hp.evaluate(() => (window.__share.accepts = false));
  const downloadsBefore = downloads;
  await fileMenu("Save the project");
  await hp.waitForTimeout(1000);
  check(
    downloads === downloadsBefore &&
      (await hp.evaluate(() => document.body.innerText.includes("can't download"))),
    "Home Screen app: a file the sheet won't take is reported, not downloaded",
  );
  await home.close();
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
  if (homeProfile) rmSync(homeProfile, { recursive: true, force: true });
  await server?.close();
}
console.log(
  failures.length ? `\n${failures.length} failed` : `\nall passed — screenshots in ${OUT}/`,
);
process.exit(failures.length ? 1 : 0);
