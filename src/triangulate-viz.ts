import { triangulateSilhouette } from "./core/triangulate";

const W = 300,
  H = 300;
const cv = document.getElementById("cv") as HTMLCanvasElement;
const ctx = cv.getContext("2d")!;
const shapeSel = document.getElementById("shape") as HTMLSelectElement;
const spacingEl = document.getElementById("spacing") as HTMLInputElement;
const spacingVal = document.getElementById("spacingVal")!;
const stats = document.getElementById("stats")!;

function paintShape(kind: string): Uint8ClampedArray {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  if (kind === "rect") ctx.fillRect(60, 60, 180, 180);
  else if (kind === "L") {
    ctx.fillRect(60, 60, 180, 180);
    ctx.clearRect(150, 150, 90, 90);
  } else {
    ctx.beginPath();
    ctx.arc(150, 150, 100, 0, Math.PI * 2);
    ctx.fill();
  }
  return ctx.getImageData(0, 0, W, H).data;
}

function render() {
  const spacing = Number(spacingEl.value);
  spacingVal.textContent = String(spacing);
  const data = paintShape(shapeSel.value);
  const inside = (x: number, y: number) =>
    x >= 0 && x < W && y >= 0 && y < H && data[(y * W + x) * 4 + 3] > 10;
  const m = triangulateSilhouette(inside, W, H, { spacing });

  ctx.strokeStyle = "rgba(0,128,255,0.8)";
  ctx.lineWidth = 1;
  for (const [a, b, c] of m.triangles) {
    const va = m.vertices[a],
      vb = m.vertices[b],
      vc = m.vertices[c];
    ctx.beginPath();
    ctx.moveTo(va.x, va.y);
    ctx.lineTo(vb.x, vb.y);
    ctx.lineTo(vc.x, vc.y);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.fillStyle = "#f00";
  for (const v of m.vertices) ctx.fillRect(v.x - 1.5, v.y - 1.5, 3, 3);
  stats.textContent = `${m.vertices.length} vertices, ${m.triangles.length} triangles`;
}

shapeSel.onchange = render;
spacingEl.oninput = render;
render();
