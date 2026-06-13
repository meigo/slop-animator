/**
 * Selection & Transform system.
 *
 * Two-stage flow:
 *   1. Select: drag rect or lasso path → marching ants on the actual shape (no lift, no handles).
 *   2. Transform: drag inside the selection → pixels are lifted into a floating canvas;
 *      bounding-box handles appear (corners=non-uniform scale, sides=skew, rotate handle, drag inside=move).
 *
 * Transform is a 6-parameter affine matrix applied around the rect's local coordinates.
 * Press Enter to commit, Escape to cancel.
 */

export interface SelectionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 2D affine matrix [[a, c, e], [b, d, f], [0, 0, 1]]. */
export interface Mat {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export type SelectionMode = "rect" | "lasso";
export type SelectionState = "idle" | "selected" | "transforming" | "warping";

type Handle = "tl" | "tr" | "bl" | "br" | "t" | "b" | "l" | "r" | "rotate" | "move" | "grid" | null;

const HANDLE_SIZE = 8;
const ROTATE_OFFSET = 20;
/** Minimum hit half-width in screen pixels — hit areas grow at low zoom so handles stay grabbable. */
const MIN_HIT_PX = 12;

/** Rotation cursor (CSS has no built-in 'rotate'). White halo + black stroke for legibility on any background. Hot-spot at center. */
const ROTATE_CURSOR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" stroke="white" stroke-width="4"/>' +
  '<path d="M21 3v5h-5" stroke="white" stroke-width="4"/>' +
  '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" stroke="black" stroke-width="2"/>' +
  '<path d="M21 3v5h-5" stroke="black" stroke-width="2"/>' +
  "</svg>";
const ROTATE_CURSOR = `url("data:image/svg+xml;utf8,${encodeURIComponent(ROTATE_CURSOR_SVG)}") 12 12, crosshair`;

const IDENTITY: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function identity(): Mat {
  return { ...IDENTITY };
}

function multiply(a: Mat, b: Mat): Mat {
  return {
    a: a.a * b.a + a.c * b.b,
    b: a.b * b.a + a.d * b.b,
    c: a.a * b.c + a.c * b.d,
    d: a.b * b.c + a.d * b.d,
    e: a.a * b.e + a.c * b.f + a.e,
    f: a.b * b.e + a.d * b.f + a.f,
  };
}

function applyPoint(m: Mat, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

function invert(m: Mat): Mat {
  const det = m.a * m.d - m.b * m.c;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

/** Transform a vector (no translation) by the linear part of m. */
function applyVec(m: Mat, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y, y: m.b * x + m.d * y };
}

/** Inverse of the linear (2x2) part applied to a vector. */
function invertVec(m: Mat, x: number, y: number): { x: number; y: number } {
  const det = m.a * m.d - m.b * m.c;
  return { x: (m.d * x - m.c * y) / det, y: (-m.b * x + m.a * y) / det };
}

export class Selection {
  state: SelectionState = "idle";
  rect: SelectionRect | null = null;
  mode: SelectionMode = "rect";
  matrix: Mat = identity();
  /** Warp control points in CSS coords, indexed [row][col]. Only meaningful in 'warping' state.
   *  warpGrid[0][0] = TL, warpGrid[0][cols-1] = TR, warpGrid[rows-1][cols-1] = BR, warpGrid[rows-1][0] = BL. */
  warpGrid: { x: number; y: number }[][] = [];
  warpRows = 2;
  warpCols = 2;
  floatingPixels: HTMLCanvasElement | null = null;

  /** Lasso path points (CSS coords) */
  private lassoPoints: { x: number; y: number }[] = [];
  /** Closed lasso path for clipping/hit-testing */
  private lassoPath: Path2D | null = null;

  private dragging: Handle = null;
  private dragGridIdx: { row: number; col: number } | null = null;
  /** Set transiently by hitTest() so startDrag() can pick up the right grid cell. */
  private hitGridIdx: { row: number; col: number } | null = null;
  private dragStart = { x: 0, y: 0 };
  private matrixStart: Mat = identity();
  private warpGridStart: { x: number; y: number }[][] = [];
  private isCreating = false;
  private createStart = { x: 0, y: 0 };
  private marchOffset = 0;
  private animFrame = 0;

  private overlayCanvas: HTMLCanvasElement;
  private overlayCtx: CanvasRenderingContext2D;

  /** Current viewport zoom — used to keep handle hit areas at a constant screen-pixel size. */
  screenScale = 1;

  onCommit: (() => void) | null = null;
  onCancel: (() => void) | null = null;
  onChange: (() => void) | null = null;
  /** Fires when state, mode, or warp grid resolution changes — for UI reactivity. */
  onStateChange: (() => void) | null = null;

  constructor(overlayCanvas: HTMLCanvasElement) {
    this.overlayCanvas = overlayCanvas;
    this.overlayCtx = overlayCanvas.getContext("2d")!;
  }

  get active(): boolean {
    return this.state !== "idle";
  }

  get hasFloating(): boolean {
    return (this.state === "transforming" || this.state === "warping") && this.floatingPixels !== null;
  }

  get isDragging(): boolean {
    return this.dragging !== null;
  }

  /**
   * Doc-space points outlining the current selection bounds for the floating
   * action panel. Returns null when there is no anchorable bbox (idle, or
   * mid-creation when the bbox is still degenerate).
   */
  getScreenBounds(): { x: number; y: number }[] | null {
    if (!this.rect || this.state === "idle" || this.isCreating) return null;
    if (this.state === "warping" && this.warpGrid.length === this.warpRows) {
      return outerPerimeter(this.warpGrid, this.warpRows, this.warpCols);
    }
    if (this.state === "transforming") {
      const c = this.transformedCorners();
      return [c.tl, c.tr, c.br, c.bl];
    }
    // 'selected' — rect or lasso, both use this.rect's AABB.
    const r = this.rect;
    return [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x, y: r.y + r.h },
    ];
  }

  /** Begin creating a new selection (clears any existing one). */
  startCreate(x: number, y: number) {
    this.cancel();
    this.isCreating = true;
    this.createStart = { x, y };
    this.rect = { x, y, w: 0, h: 0 };
    this.lassoPoints = [{ x, y }];
    this.lassoPath = null;
    this.state = "selected";
    this.onStateChange?.();
  }

  updateCreate(x: number, y: number) {
    if (!this.isCreating) return;

    if (this.mode === "lasso") {
      this.lassoPoints.push({ x, y });
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of this.lassoPoints) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      this.rect = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    } else {
      const sx = Math.min(this.createStart.x, x);
      const sy = Math.min(this.createStart.y, y);
      const w = Math.abs(x - this.createStart.x);
      const h = Math.abs(y - this.createStart.y);
      this.rect = { x: sx, y: sy, w, h };
    }
    this.drawOverlay();
  }

  endCreate() {
    this.isCreating = false;
    if (!this.rect || this.rect.w < 3 || this.rect.h < 3) {
      this.clear();
      return;
    }
    if (this.mode === "lasso" && this.lassoPoints.length > 2) {
      const path = new Path2D();
      path.moveTo(this.lassoPoints[0].x, this.lassoPoints[0].y);
      for (let i = 1; i < this.lassoPoints.length; i++) {
        path.lineTo(this.lassoPoints[i].x, this.lassoPoints[i].y);
      }
      path.closePath();
      this.lassoPath = path;
    }
    this.matrix = identity();
    this.drawOverlay();
  }

  /**
   * Lift pixels from source canvas into a new canvas (using lasso clip if available).
   * The source canvas is cleared in the lifted region. Returns the lifted canvas.
   * Caller is responsible for passing the result to beginTransform().
   */
  liftPixels(srcCtx: CanvasRenderingContext2D, dpr: number): HTMLCanvasElement | null {
    if (!this.rect) return null;
    const r = this.rect;
    const px = Math.round(r.x * dpr);
    const py = Math.round(r.y * dpr);
    const pw = Math.round(r.w * dpr);
    const ph = Math.round(r.h * dpr);
    if (pw <= 0 || ph <= 0) return null;

    const cvs = document.createElement("canvas");
    cvs.width = pw;
    cvs.height = ph;
    const ctx = cvs.getContext("2d")!;

    if (this.lassoPath) {
      ctx.save();
      const clipPath = new Path2D();
      for (let i = 0; i < this.lassoPoints.length; i++) {
        const lx = (this.lassoPoints[i].x - r.x) * dpr;
        const ly = (this.lassoPoints[i].y - r.y) * dpr;
        if (i === 0) clipPath.moveTo(lx, ly);
        else clipPath.lineTo(lx, ly);
      }
      clipPath.closePath();
      ctx.clip(clipPath);
      ctx.drawImage(srcCtx.canvas, px, py, pw, ph, 0, 0, pw, ph);
      ctx.restore();

      srcCtx.save();
      const srcClip = new Path2D();
      for (let i = 0; i < this.lassoPoints.length; i++) {
        const lx = this.lassoPoints[i].x * dpr;
        const ly = this.lassoPoints[i].y * dpr;
        if (i === 0) srcClip.moveTo(lx, ly);
        else srcClip.lineTo(lx, ly);
      }
      srcClip.closePath();
      srcCtx.resetTransform();
      srcCtx.clip(srcClip);
      srcCtx.clearRect(0, 0, srcCtx.canvas.width, srcCtx.canvas.height);
      srcCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      srcCtx.restore();
    } else {
      ctx.drawImage(srcCtx.canvas, px, py, pw, ph, 0, 0, pw, ph);
      srcCtx.clearRect(r.x, r.y, r.w, r.h);
    }

    return cvs;
  }

  /** Enter the transforming state with the lifted pixels. */
  beginTransform(pixels: HTMLCanvasElement) {
    this.floatingPixels = pixels;
    this.matrix = identity();
    this.state = "transforming";
    this.drawOverlay();
    this.onStateChange?.();
  }

  /**
   * Enter warp/distort mode with a `rows × cols` grid of control points (≥ 2 each).
   * 2×2 = 4-corner distort; 3×3 = 2-segment mesh; etc. Initializes the grid by
   * sampling matrix-transformed rect coords uniformly. Requires lifted pixels.
   */
  beginWarp(rows = 2, cols = 2) {
    if (!this.rect || !this.floatingPixels) return;
    if (rows < 2 || cols < 2) return;
    this.warpGrid = sampleGrid(this.rect, this.matrix, rows, cols);
    this.warpRows = rows;
    this.warpCols = cols;
    this.state = "warping";
    this.drawOverlay();
    this.onStateChange?.();
  }

  /**
   * Resample the current warp grid to a new resolution via bilinear interpolation
   * over each existing cell. Preserves user edits when increasing density.
   */
  densifyWarp(rows: number, cols: number) {
    if (this.state !== "warping") return;
    if (rows < 2 || cols < 2) return;
    if (rows === this.warpRows && cols === this.warpCols) return;
    this.warpGrid = resampleGrid(this.warpGrid, this.warpRows, this.warpCols, rows, cols);
    this.warpRows = rows;
    this.warpCols = cols;
    this.drawOverlay();
    this.onStateChange?.();
  }

  /** Hit half-width in document px — at least MIN_HIT_PX in screen px, regardless of zoom. */
  private hitTolerance(): number {
    return Math.max(HANDLE_SIZE + 2, MIN_HIT_PX / this.screenScale);
  }

  hitTest(x: number, y: number): Handle {
    if (!this.rect) return null;

    if (this.state === "selected") {
      // No handles in 'selected' state — only inside/outside the actual shape.
      if (this.mode === "lasso" && this.lassoPath) {
        return this.overlayCtx.isPointInPath(this.lassoPath, x, y) ? "move" : null;
      }
      const r = this.rect;
      return (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) ? "move" : null;
    }

    const tol = this.hitTolerance();

    if (this.state === "warping") {
      // Hit-test every grid control point.
      for (let r = 0; r < this.warpRows; r++) {
        for (let c = 0; c < this.warpCols; c++) {
          const p = this.warpGrid[r][c];
          if (Math.abs(x - p.x) < tol && Math.abs(y - p.y) < tol) {
            this.hitGridIdx = { row: r, col: c };
            return "grid";
          }
        }
      }
      this.hitGridIdx = null;
      // Inside the outer perimeter → drag-to-move-all.
      const perim = outerPerimeter(this.warpGrid, this.warpRows, this.warpCols);
      return this.pointInsideQuad(x, y, perim) ? "move" : null;
    }

    if (this.state !== "transforming") return null;

    const corners = this.transformedCorners();
    const sides = this.transformedSides(corners);
    const rotateHandle = this.rotateHandlePos(corners);

    const rotR = tol + 2;
    if ((x - rotateHandle.x) ** 2 + (y - rotateHandle.y) ** 2 < rotR * rotR) return "rotate";

    const cornerHandles: { handle: Handle; p: { x: number; y: number } }[] = [
      { handle: "tl", p: corners.tl },
      { handle: "tr", p: corners.tr },
      { handle: "bl", p: corners.bl },
      { handle: "br", p: corners.br },
    ];
    for (const c of cornerHandles) {
      if (Math.abs(x - c.p.x) < tol && Math.abs(y - c.p.y) < tol) {
        return c.handle;
      }
    }

    const sideHandles: { handle: Handle; p: { x: number; y: number } }[] = [
      { handle: "t", p: sides.t },
      { handle: "b", p: sides.b },
      { handle: "l", p: sides.l },
      { handle: "r", p: sides.r },
    ];
    for (const s of sideHandles) {
      if (Math.abs(x - s.p.x) < tol && Math.abs(y - s.p.y) < tol) {
        return s.handle;
      }
    }

    // Inside the transformed bounding box → move.
    return this.pointInsideTransformedBox(x, y) ? "move" : null;
  }

  startDrag(handle: Handle, x: number, y: number) {
    this.dragging = handle;
    this.dragStart = { x, y };
    this.matrixStart = { ...this.matrix };
    this.warpGridStart = this.warpGrid.map((row) => row.map((p) => ({ ...p })));
    this.dragGridIdx = handle === "grid" ? this.hitGridIdx : null;
  }

  updateDrag(x: number, y: number) {
    if (!this.dragging || !this.rect) return;
    const dx = x - this.dragStart.x;
    const dy = y - this.dragStart.y;

    if (this.state === "warping") {
      if (this.dragging === "move") {
        this.warpGrid = this.warpGridStart.map((row) => row.map((p) => ({ x: p.x + dx, y: p.y + dy })));
      } else if (this.dragging === "grid" && this.dragGridIdx) {
        const { row, col } = this.dragGridIdx;
        this.warpGrid = this.warpGridStart.map((rArr, r) =>
          rArr.map((p, c) => (r === row && c === col ? { x: p.x + dx, y: p.y + dy } : { ...p })),
        );
      }
      this.drawOverlay();
      this.onChange?.();
      return;
    }

    if (this.state !== "transforming") return;
    const r = this.rect;

    switch (this.dragging) {
      case "move": {
        this.matrix = { ...this.matrixStart, e: this.matrixStart.e + dx, f: this.matrixStart.f + dy };
        break;
      }

      case "tl": case "tr": case "bl": case "br": {
        // Non-uniform scale around the opposite corner (in local rect coords).
        const ax = this.dragging === "tl" || this.dragging === "bl" ? r.x + r.w : r.x;
        const ay = this.dragging === "tl" || this.dragging === "tr" ? r.y + r.h : r.y;
        const dragLocalX = this.dragging === "tl" || this.dragging === "bl" ? r.x : r.x + r.w;
        const dragLocalY = this.dragging === "tl" || this.dragging === "tr" ? r.y : r.y + r.h;

        const mouseLocal = applyPoint(invert(this.matrixStart), x, y);
        const denomX = dragLocalX - ax;
        const denomY = dragLocalY - ay;
        const sx = denomX !== 0 ? (mouseLocal.x - ax) / denomX : 1;
        const sy = denomY !== 0 ? (mouseLocal.y - ay) / denomY : 1;

        // S = T(ax, ay) * Scale(sx, sy) * T(-ax, -ay)
        const scale: Mat = { a: sx, b: 0, c: 0, d: sy, e: ax * (1 - sx), f: ay * (1 - sy) };
        this.matrix = multiply(this.matrixStart, scale);
        break;
      }

      case "l": case "r": {
        // Drag a vertical side; the opposite vertical side is anchored.
        // Translate the dragged side by (dx, dy) in world coords, leaving the opposite side fixed.
        const dl = invertVec(this.matrixStart, dx, dy);
        const ax = this.dragging === "r" ? r.x : r.x + r.w; // anchored x in local coords
        const sign = this.dragging === "r" ? 1 : -1;
        // T_local: a' = 1 + sign*dl.x/rw, b' = sign*dl.y/rw, c'=0, d'=1, e' = -ax*sign*dl.x/rw + (anchor offset)
        // Derivation in commit message.
        const k = sign / r.w;
        const tLocal: Mat = {
          a: 1 + dl.x * k,
          b: dl.y * k,
          c: 0,
          d: 1,
          e: -ax * dl.x * k,
          f: -ax * dl.y * k,
        };
        this.matrix = multiply(this.matrixStart, tLocal);
        break;
      }

      case "t": case "b": {
        const dl = invertVec(this.matrixStart, dx, dy);
        const ay = this.dragging === "b" ? r.y : r.y + r.h;
        const sign = this.dragging === "b" ? 1 : -1;
        const k = sign / r.h;
        const tLocal: Mat = {
          a: 1,
          b: 0,
          c: dl.x * k,
          d: 1 + dl.y * k,
          e: -ay * dl.x * k,
          f: -ay * dl.y * k,
        };
        this.matrix = multiply(this.matrixStart, tLocal);
        break;
      }

      case "rotate": {
        const center = applyPoint(this.matrixStart, r.x + r.w / 2, r.y + r.h / 2);
        const startAngle = Math.atan2(this.dragStart.y - center.y, this.dragStart.x - center.x);
        const currAngle = Math.atan2(y - center.y, x - center.x);
        const theta = currAngle - startAngle;
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        // Rotate around world center: M_new = T(c) * R(theta) * T(-c) * M_start
        const tx = center.x - cos * center.x + sin * center.y;
        const ty = center.y - sin * center.x - cos * center.y;
        const rotWorld: Mat = { a: cos, b: sin, c: -sin, d: cos, e: tx, f: ty };
        this.matrix = multiply(rotWorld, this.matrixStart);
        break;
      }
    }

    this.drawOverlay();
    this.onChange?.();
  }

  endDrag() {
    this.dragging = null;
  }

  commit() {
    if (this.hasFloating) {
      this.onCommit?.();
    }
    this.clear();
  }

  cancel() {
    if (this.hasFloating) {
      this.onCancel?.();
    }
    this.clear();
  }

  /**
   * Apply a clip path matching the current selection (rect or lasso) to the given context.
   * Coords are CSS pixels — caller's ctx must already have its dpr transform set.
   * Only meaningful in 'selected' state; returns true if a clip was applied.
   */
  applyClip(ctx: CanvasRenderingContext2D): boolean {
    if (this.state !== "selected" || !this.rect) return false;
    if (this.mode === "lasso" && this.lassoPath) {
      ctx.clip(this.lassoPath);
    } else {
      ctx.beginPath();
      ctx.rect(this.rect.x, this.rect.y, this.rect.w, this.rect.h);
      ctx.clip();
    }
    return true;
  }

  /** Render the floating pixels into the given context, applying the current transform/warp. */
  renderFloatingTo(ctx: CanvasRenderingContext2D) {
    if (!this.floatingPixels || !this.rect) return;
    if (this.state === "transforming") {
      const m = this.matrix;
      ctx.save();
      ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
      ctx.drawImage(this.floatingPixels, this.rect.x, this.rect.y, this.rect.w, this.rect.h);
      ctx.restore();
    } else if (this.state === "warping") {
      drawWarpedMesh(ctx, this.floatingPixels, this.rect, this.warpGrid, this.warpRows, this.warpCols);
    }
  }

  private clear() {
    const wasActive = this.state !== "idle";
    this.rect = null;
    this.floatingPixels = null;
    this.lassoPoints = [];
    this.lassoPath = null;
    this.matrix = identity();
    this.warpGrid = [];
    this.warpGridStart = [];
    this.warpRows = 2;
    this.warpCols = 2;
    this.dragGridIdx = null;
    this.hitGridIdx = null;
    this.isCreating = false;
    this.dragging = null;
    this.state = "idle";
    cancelAnimationFrame(this.animFrame);
    this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    if (wasActive) this.onStateChange?.();
  }

  getCursor(handle: Handle): string {
    switch (handle) {
      case "move": return "move";
      case "rotate": return ROTATE_CURSOR;
      case "tl": case "br": return "nwse-resize";
      case "tr": case "bl": return "nesw-resize";
      case "l": case "r": return "ew-resize";
      case "t": case "b": return "ns-resize";
      case "grid": return "grab";
      default: return "crosshair";
    }
  }

  private transformedCorners() {
    const r = this.rect!;
    const m = this.matrix;
    return {
      tl: applyPoint(m, r.x, r.y),
      tr: applyPoint(m, r.x + r.w, r.y),
      bl: applyPoint(m, r.x, r.y + r.h),
      br: applyPoint(m, r.x + r.w, r.y + r.h),
    };
  }

  private transformedSides(c: ReturnType<Selection["transformedCorners"]>) {
    return {
      t: { x: (c.tl.x + c.tr.x) / 2, y: (c.tl.y + c.tr.y) / 2 },
      b: { x: (c.bl.x + c.br.x) / 2, y: (c.bl.y + c.br.y) / 2 },
      l: { x: (c.tl.x + c.bl.x) / 2, y: (c.tl.y + c.bl.y) / 2 },
      r: { x: (c.tr.x + c.br.x) / 2, y: (c.tr.y + c.br.y) / 2 },
    };
  }

  private rotateHandlePos(c: ReturnType<Selection["transformedCorners"]>) {
    // Outward normal at the top edge: -local_y direction transformed.
    const n = applyVec(this.matrix, 0, -1);
    const len = Math.hypot(n.x, n.y) || 1;
    const top = { x: (c.tl.x + c.tr.x) / 2, y: (c.tl.y + c.tr.y) / 2 };
    return { x: top.x + (n.x / len) * ROTATE_OFFSET, y: top.y + (n.y / len) * ROTATE_OFFSET };
  }

  private pointInsideTransformedBox(x: number, y: number): boolean {
    // Map world point back to local rect coords; check against the rect bounds.
    const r = this.rect!;
    const local = applyPoint(invert(this.matrix), x, y);
    return local.x >= r.x && local.x <= r.x + r.w && local.y >= r.y && local.y <= r.y + r.h;
  }

  private pointInsideQuad(x: number, y: number, quad: { x: number; y: number }[]): boolean {
    // Even-odd ray test against the closed polygon. Handles non-convex / self-intersecting cases gracefully.
    let inside = false;
    for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
      const xi = quad[i].x, yi = quad[i].y;
      const xj = quad[j].x, yj = quad[j].y;
      const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  drawOverlay() {
    const ctx = this.overlayCtx;
    const cvs = this.overlayCanvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    if (!this.rect || this.state === "idle") return;

    // Animation re-trigger
    this.marchOffset = (this.marchOffset + 0.3) % 8;
    cancelAnimationFrame(this.animFrame);
    this.animFrame = requestAnimationFrame(() => this.drawOverlay());

    // 'selected' state OR mid-creation: draw the actual selection shape with marching ants.
    if (this.state === "selected" || this.isCreating) {
      if (this.mode === "lasso" && (this.lassoPath || this.lassoPoints.length > 1)) {
        ctx.beginPath();
        ctx.moveTo(this.lassoPoints[0].x, this.lassoPoints[0].y);
        for (let i = 1; i < this.lassoPoints.length; i++) {
          ctx.lineTo(this.lassoPoints[i].x, this.lassoPoints[i].y);
        }
        if (this.lassoPath) ctx.closePath();
        this.strokeMarchingAnts(ctx);
      } else {
        ctx.beginPath();
        ctx.rect(this.rect.x, this.rect.y, this.rect.w, this.rect.h);
        this.strokeMarchingAnts(ctx);
      }
      return;
    }

    // 'warping' state: tessellated render + grid lines + handles + outer perimeter.
    if (this.state === "warping" && this.warpGrid.length === this.warpRows) {
      const grid = this.warpGrid;
      if (this.floatingPixels) {
        drawWarpedMesh(ctx, this.floatingPixels, this.rect, grid, this.warpRows, this.warpCols);
      }
      // Internal grid lines (between adjacent control points).
      ctx.save();
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let r = 0; r < this.warpRows; r++) {
        for (let c = 0; c < this.warpCols - 1; c++) {
          ctx.moveTo(grid[r][c].x, grid[r][c].y);
          ctx.lineTo(grid[r][c + 1].x, grid[r][c + 1].y);
        }
      }
      for (let c = 0; c < this.warpCols; c++) {
        for (let r = 0; r < this.warpRows - 1; r++) {
          ctx.moveTo(grid[r][c].x, grid[r][c].y);
          ctx.lineTo(grid[r + 1][c].x, grid[r + 1][c].y);
        }
      }
      ctx.stroke();
      ctx.restore();
      // Outer perimeter with marching ants.
      const perim = outerPerimeter(grid, this.warpRows, this.warpCols);
      ctx.beginPath();
      ctx.moveTo(perim[0].x, perim[0].y);
      for (let i = 1; i < perim.length; i++) ctx.lineTo(perim[i].x, perim[i].y);
      ctx.closePath();
      this.strokeMarchingAnts(ctx);
      // Handles at every grid intersection.
      for (let r = 0; r < this.warpRows; r++) {
        for (let c = 0; c < this.warpCols; c++) {
          this.drawHandle(ctx, grid[r][c].x, grid[r][c].y, "square");
        }
      }
      return;
    }

    // 'transforming' state: floating pixels + transformed bounding box + handles.
    const c = this.transformedCorners();
    const sides = this.transformedSides(c);
    const rotHandle = this.rotateHandlePos(c);

    // Draw floating pixels under the matrix.
    if (this.floatingPixels) {
      const m = this.matrix;
      ctx.save();
      ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
      ctx.drawImage(this.floatingPixels, this.rect.x, this.rect.y, this.rect.w, this.rect.h);
      ctx.restore();
    }

    // Bounding-box marching ants (transformed quad).
    ctx.beginPath();
    ctx.moveTo(c.tl.x, c.tl.y);
    ctx.lineTo(c.tr.x, c.tr.y);
    ctx.lineTo(c.br.x, c.br.y);
    ctx.lineTo(c.bl.x, c.bl.y);
    ctx.closePath();
    this.strokeMarchingAnts(ctx);

    // Corner handles.
    for (const p of [c.tl, c.tr, c.bl, c.br]) {
      this.drawHandle(ctx, p.x, p.y, "square");
    }

    // Side handles (smaller squares).
    for (const p of [sides.t, sides.b, sides.l, sides.r]) {
      this.drawHandle(ctx, p.x, p.y, "square");
    }

    // Rotation tether + handle.
    const top = { x: (c.tl.x + c.tr.x) / 2, y: (c.tl.y + c.tr.y) / 2 };
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(rotHandle.x, rotHandle.y);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = "#000";
    ctx.setLineDash([2, 2]);
    ctx.stroke();
    ctx.setLineDash([]);
    this.drawHandle(ctx, rotHandle.x, rotHandle.y, "circle");
  }

  private strokeMarchingAnts(ctx: CanvasRenderingContext2D) {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.strokeStyle = "#000";
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -this.marchOffset;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number, shape: "square" | "circle") {
    if (shape === "square") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(x - HANDLE_SIZE / 2, y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.strokeRect(x - HANDLE_SIZE / 2, y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, HANDLE_SIZE / 2, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

type Pt = { x: number; y: number };

/**
 * Draw a bitmap warped through an N×M control-point grid by splitting each cell
 * into two triangles (along the cell's TL→BR diagonal) and rendering each with
 * a per-triangle affine. A faint crease may show along cell diagonals; cells
 * scale with grid density. 2×2 = 4-corner distort.
 */
function drawWarpedMesh(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  rect: SelectionRect,
  grid: Pt[][],
  rows: number,
  cols: number,
) {
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const u0 = c / (cols - 1);
      const u1 = (c + 1) / (cols - 1);
      const v0 = r / (rows - 1);
      const v1 = (r + 1) / (rows - 1);
      const tlSrc: Pt = { x: rect.x + u0 * rect.w, y: rect.y + v0 * rect.h };
      const trSrc: Pt = { x: rect.x + u1 * rect.w, y: rect.y + v0 * rect.h };
      const brSrc: Pt = { x: rect.x + u1 * rect.w, y: rect.y + v1 * rect.h };
      const blSrc: Pt = { x: rect.x + u0 * rect.w, y: rect.y + v1 * rect.h };
      const tl = grid[r][c];
      const tr = grid[r][c + 1];
      const br = grid[r + 1][c + 1];
      const bl = grid[r + 1][c];
      drawTriangle(ctx, img, rect, [tlSrc, trSrc, brSrc], [tl, tr, br]);
      drawTriangle(ctx, img, rect, [tlSrc, brSrc, blSrc], [tl, br, bl]);
    }
  }
}

/** Build a fresh rows×cols grid by uniformly sampling the matrix-transformed rect. */
function sampleGrid(rect: SelectionRect, m: Mat, rows: number, cols: number): Pt[][] {
  const grid: Pt[][] = [];
  for (let i = 0; i < rows; i++) {
    const row: Pt[] = [];
    const v = i / (rows - 1);
    for (let j = 0; j < cols; j++) {
      const u = j / (cols - 1);
      row.push(applyPoint(m, rect.x + u * rect.w, rect.y + v * rect.h));
    }
    grid.push(row);
  }
  return grid;
}

/** Resample a control grid to a new resolution via piecewise bilinear interp over the existing cells. */
function resampleGrid(grid: Pt[][], oldRows: number, oldCols: number, newRows: number, newCols: number): Pt[][] {
  const out: Pt[][] = [];
  for (let i = 0; i < newRows; i++) {
    const row: Pt[] = [];
    const v = i / (newRows - 1);
    for (let j = 0; j < newCols; j++) {
      const u = j / (newCols - 1);
      row.push(bilinearSample(grid, oldRows, oldCols, u, v));
    }
    out.push(row);
  }
  return out;
}

function bilinearSample(grid: Pt[][], rows: number, cols: number, u: number, v: number): Pt {
  const fx = u * (cols - 1);
  const fy = v * (rows - 1);
  const x0 = Math.min(Math.floor(fx), cols - 2);
  const y0 = Math.min(Math.floor(fy), rows - 2);
  const tx = fx - x0;
  const ty = fy - y0;
  const a = grid[y0][x0];
  const b = grid[y0][x0 + 1];
  const c = grid[y0 + 1][x0];
  const d = grid[y0 + 1][x0 + 1];
  return {
    x: (1 - tx) * (1 - ty) * a.x + tx * (1 - ty) * b.x + (1 - tx) * ty * c.x + tx * ty * d.x,
    y: (1 - tx) * (1 - ty) * a.y + tx * (1 - ty) * b.y + (1 - tx) * ty * c.y + tx * ty * d.y,
  };
}

/** Walk the outer ring of a control grid clockwise starting from TL. */
function outerPerimeter(grid: Pt[][], rows: number, cols: number): Pt[] {
  const ring: Pt[] = [];
  for (let c = 0; c < cols; c++) ring.push(grid[0][c]);
  for (let r = 1; r < rows; r++) ring.push(grid[r][cols - 1]);
  for (let c = cols - 2; c >= 0; c--) ring.push(grid[rows - 1][c]);
  for (let r = rows - 2; r >= 1; r--) ring.push(grid[r][0]);
  return ring;
}

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  rect: SelectionRect,
  src: [Pt, Pt, Pt],
  dst: [Pt, Pt, Pt],
) {
  const m = triangleAffine(src, dst);
  ctx.save();
  // Clip to dest triangle in current (pre-m) coord space.
  ctx.beginPath();
  ctx.moveTo(dst[0].x, dst[0].y);
  ctx.lineTo(dst[1].x, dst[1].y);
  ctx.lineTo(dst[2].x, dst[2].y);
  ctx.closePath();
  ctx.clip();
  // Apply triangle-warp matrix on top of current transform.
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

/** Affine that maps src triangle to dst triangle (3 corresponding vertices). */
function triangleAffine(src: [Pt, Pt, Pt], dst: [Pt, Pt, Pt]): Mat {
  const aSrc: Mat = {
    a: src[1].x - src[0].x, b: src[1].y - src[0].y,
    c: src[2].x - src[0].x, d: src[2].y - src[0].y,
    e: src[0].x, f: src[0].y,
  };
  const aDst: Mat = {
    a: dst[1].x - dst[0].x, b: dst[1].y - dst[0].y,
    c: dst[2].x - dst[0].x, d: dst[2].y - dst[0].y,
    e: dst[0].x, f: dst[0].y,
  };
  return multiply(aDst, invert(aSrc));
}
