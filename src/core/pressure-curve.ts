/**
 * Pressure curve editor.
 * Uses a cubic bezier defined by two control points (cp1, cp2).
 * Input/output both 0–1. Start is always (0,0), end is always (1,1).
 */

export interface CurvePoint {
  x: number;
  y: number;
}

export class PressureCurve {
  cp1: CurvePoint = { x: 0.25, y: 0.25 }; // linear default
  cp2: CurvePoint = { x: 0.75, y: 0.75 };

  // Lookup table for fast evaluation
  private lut: number[] = [];
  private lutSize = 256;

  constructor() {
    this.buildLUT();
  }

  /** Evaluate the curve at input pressure t (0–1), returns output pressure (0–1) */
  evaluate(t: number): number {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const idx = t * (this.lutSize - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, this.lutSize - 1);
    const frac = idx - lo;
    return this.lut[lo] * (1 - frac) + this.lut[hi] * frac;
  }

  /** Rebuild the lookup table after control points change */
  buildLUT() {
    this.lut = [];
    // We need to map input pressure (0–1) to output pressure (0–1).
    // The bezier parametric t doesn't directly correspond to x,
    // so we sample the bezier and build a x→y lookup.
    const samples = 1000;
    const points: { x: number; y: number }[] = [];

    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const x = this.bezierComponent(t, 0, this.cp1.x, this.cp2.x, 1);
      const y = this.bezierComponent(t, 0, this.cp1.y, this.cp2.y, 1);
      points.push({ x, y });
    }

    // Build LUT by interpolating y for evenly-spaced x values
    let pi = 0;
    for (let i = 0; i < this.lutSize; i++) {
      const targetX = i / (this.lutSize - 1);
      while (pi < points.length - 1 && points[pi + 1].x < targetX) {
        pi++;
      }
      if (pi >= points.length - 1) {
        this.lut.push(points[points.length - 1].y);
      } else {
        const p0 = points[pi];
        const p1 = points[pi + 1];
        const dx = p1.x - p0.x;
        const frac = dx === 0 ? 0 : (targetX - p0.x) / dx;
        this.lut.push(p0.y + (p1.y - p0.y) * frac);
      }
    }
  }

  private bezierComponent(t: number, p0: number, p1: number, p2: number, p3: number): number {
    const mt = 1 - t;
    return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
  }

  /** Reset to linear */
  reset() {
    this.cp1 = { x: 0.25, y: 0.25 };
    this.cp2 = { x: 0.75, y: 0.75 };
    this.buildLUT();
  }
}

/**
 * Creates the curve editor UI element.
 * Returns the container element and the PressureCurve instance.
 */
export function createCurveEditor(curve: PressureCurve, onChange: () => void): HTMLElement & { redraw: () => void } {
  const SIZE = 160;
  const PAD = 20;
  const FULL = SIZE + PAD * 2;

  const container = document.createElement("div");
  container.id = "curve-editor";

  const cvs = document.createElement("canvas");
  cvs.width = FULL * 2; // retina
  cvs.height = FULL * 2;
  cvs.style.width = FULL + "px";
  cvs.style.height = FULL + "px";
  cvs.style.cursor = "default";
  const c = cvs.getContext("2d")!;
  c.scale(2, 2);

  const resetBtn = document.createElement("button");
  resetBtn.textContent = "Reset";
  resetBtn.className = "layer-btn";
  resetBtn.style.cssText = "width:auto;padding:2px 8px;font-size:11px;margin-top:4px";
  resetBtn.addEventListener("click", () => {
    curve.reset();
    draw();
    onChange();
  });

  container.appendChild(cvs);
  container.appendChild(resetBtn);

  let dragging: "cp1" | "cp2" | null = null;

  function toCanvas(p: CurvePoint): { cx: number; cy: number } {
    return {
      cx: PAD + p.x * SIZE,
      cy: PAD + (1 - p.y) * SIZE,
    };
  }

  function fromCanvas(cx: number, cy: number): CurvePoint {
    return {
      x: Math.max(0, Math.min(1, (cx - PAD) / SIZE)),
      y: Math.max(0, Math.min(1, 1 - (cy - PAD) / SIZE)),
    };
  }

  function draw() {
    c.clearRect(0, 0, FULL, FULL);

    // Background
    c.fillStyle = "#1a1a1a";
    c.fillRect(0, 0, FULL, FULL);

    // Grid
    c.strokeStyle = "#333";
    c.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const v = PAD + (i / 4) * SIZE;
      c.beginPath();
      c.moveTo(PAD, v);
      c.lineTo(PAD + SIZE, v);
      c.stroke();
      c.beginPath();
      c.moveTo(v, PAD);
      c.lineTo(v, PAD + SIZE);
      c.stroke();
    }

    // Diagonal (linear reference)
    c.strokeStyle = "#444";
    c.lineWidth = 1;
    c.setLineDash([4, 4]);
    c.beginPath();
    c.moveTo(PAD, PAD + SIZE);
    c.lineTo(PAD + SIZE, PAD);
    c.stroke();
    c.setLineDash([]);

    // Control point handles (lines from endpoints to control points)
    const c1 = toCanvas(curve.cp1);
    const c2 = toCanvas(curve.cp2);
    c.strokeStyle = "#666";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(PAD, PAD + SIZE); // start (0,0)
    c.lineTo(c1.cx, c1.cy);
    c.stroke();
    c.beginPath();
    c.moveTo(PAD + SIZE, PAD); // end (1,1)
    c.lineTo(c2.cx, c2.cy);
    c.stroke();

    // Bezier curve
    c.strokeStyle = "#4af";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(PAD, PAD + SIZE);
    c.bezierCurveTo(c1.cx, c1.cy, c2.cx, c2.cy, PAD + SIZE, PAD);
    c.stroke();

    // Control points
    for (const pt of [c1, c2]) {
      c.fillStyle = "#fff";
      c.beginPath();
      c.arc(pt.cx, pt.cy, 5, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = "#4af";
      c.lineWidth = 1.5;
      c.stroke();
    }

    // Labels
    c.fillStyle = "#666";
    c.font = "10px system-ui";
    c.textAlign = "center";
    c.fillText("Input", PAD + SIZE / 2, FULL - 3);
    c.save();
    c.translate(10, PAD + SIZE / 2);
    c.rotate(-Math.PI / 2);
    c.fillText("Output", 0, 0);
    c.restore();
  }

  function hitTest(mx: number, my: number): "cp1" | "cp2" | null {
    const c1 = toCanvas(curve.cp1);
    const c2 = toCanvas(curve.cp2);
    const r = 10;
    if ((mx - c1.cx) ** 2 + (my - c1.cy) ** 2 < r * r) return "cp1";
    if ((mx - c2.cx) ** 2 + (my - c2.cy) ** 2 < r * r) return "cp2";
    return null;
  }

  cvs.addEventListener("pointerdown", (e) => {
    const rect = cvs.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    dragging = hitTest(mx, my);
    if (dragging) {
      cvs.setPointerCapture(e.pointerId);
      cvs.style.cursor = "grabbing";
    }
  });

  cvs.addEventListener("pointermove", (e) => {
    const rect = cvs.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (dragging) {
      const pt = fromCanvas(mx, my);
      curve[dragging] = pt;
      curve.buildLUT();
      draw();
      onChange();
    } else {
      cvs.style.cursor = hitTest(mx, my) ? "grab" : "default";
    }
  });

  cvs.addEventListener("pointerup", () => {
    dragging = null;
    cvs.style.cursor = "default";
  });

  // Initial draw
  draw();

  const result = container as unknown as HTMLElement & { redraw: () => void };
  result.redraw = draw;
  return result;
}
