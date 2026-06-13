/**
 * Brush tip textures using fast canvas drawing (no per-pixel ImageData).
 * All tips are generated once at a fixed size and scaled at draw time.
 */

const TIP_SIZE = 64; // all tips generated at this size, scaled when drawn
const tipCache = new Map<string, HTMLCanvasElement>();

function getCachedTip(key: string, generator: (ctx: CanvasRenderingContext2D, s: number) => void): HTMLCanvasElement {
  if (tipCache.has(key)) return tipCache.get(key)!;

  const cvs = document.createElement("canvas");
  cvs.width = TIP_SIZE;
  cvs.height = TIP_SIZE;
  const ctx = cvs.getContext("2d")!;
  generator(ctx, TIP_SIZE);

  tipCache.set(key, cvs);
  return cvs;
}

/** Hard round brush — clean circle with slight antialiased edge */
function hardRoundTip(): HTMLCanvasElement {
  return getCachedTip("hard", (ctx, s) => {
    const r = s / 2;
    const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, "rgba(0,0,0,1)");
    grad.addColorStop(0.85, "rgba(0,0,0,1)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
  });
}

/** Soft round brush */
function softRoundTip(): HTMLCanvasElement {
  return getCachedTip("soft", (ctx, s) => {
    const r = s / 2;
    const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, "rgba(0,0,0,1)");
    grad.addColorStop(0.5, "rgba(0,0,0,0.6)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
  });
}

/** Pencil tip — uses scattered small circles for grain */
function pencilTip(): HTMLCanvasElement {
  return getCachedTip("pencil", (ctx, s) => {
    const r = s / 2;

    // Base soft shape
    const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, "rgba(0,0,0,0.8)");
    grad.addColorStop(0.4, "rgba(0,0,0,0.5)");
    grad.addColorStop(0.8, "rgba(0,0,0,0.15)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);

    // Subtract random dots to create grain
    ctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 300; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * r;
      const x = r + Math.cos(angle) * dist;
      const y = r + Math.sin(angle) * dist;
      const dotR = 0.5 + Math.random() * 2;
      // More grain near edges
      const edgeFactor = dist / r;
      ctx.globalAlpha = 0.3 + edgeFactor * 0.7;
      ctx.beginPath();
      ctx.arc(x, y, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Charcoal tip — rough, chunky */
function charcoalTip(): HTMLCanvasElement {
  return getCachedTip("charcoal", (ctx, s) => {
    const r = s / 2;

    // Rough base shape using overlapping circles
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    for (let i = 0; i < 20; i++) {
      const ox = r + (Math.random() - 0.5) * r * 0.5;
      const oy = r + (Math.random() - 0.5) * r * 0.5;
      const cr = r * (0.3 + Math.random() * 0.5);
      ctx.beginPath();
      ctx.arc(ox, oy, cr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cut out chunks for rough texture
    ctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 200; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * r;
      const x = r + Math.cos(angle) * dist;
      const y = r + Math.sin(angle) * dist;
      const dotR = 1 + Math.random() * 3;
      ctx.globalAlpha = 0.2 + Math.random() * 0.6;
      ctx.beginPath();
      ctx.arc(x, y, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Airbrush tip — very soft, wide falloff */
function airbrushTip(): HTMLCanvasElement {
  return getCachedTip("airbrush", (ctx, s) => {
    const r = s / 2;
    const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, "rgba(0,0,0,0.3)");
    grad.addColorStop(0.3, "rgba(0,0,0,0.15)");
    grad.addColorStop(0.7, "rgba(0,0,0,0.05)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
  });
}

export type BrushType = "smooth" | "pencil" | "charcoal" | "airbrush";

export function getTip(type: BrushType): HTMLCanvasElement {
  switch (type) {
    case "smooth": return hardRoundTip();
    case "pencil": return pencilTip();
    case "charcoal": return charcoalTip();
    case "airbrush": return airbrushTip();
    default: return softRoundTip();
  }
}

export function clearTipCache() {
  tipCache.clear();
}
