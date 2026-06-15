// WebGL line-boil (SPIKE). Displaces a drawing's outlines with a fragment-shader noise offset —
// one GPU pass per layer per frame. No per-frame CPU warp and no variant caching, so it runs live
// and stays memory-flat regardless of frame count. Throwaway exploration: validate perf on device
// before re-speccing the boil renderer around it.

let gl: WebGLRenderingContext | null = null;
let glCanvas: HTMLCanvasElement | null = null;
let prog: WebGLProgram | null = null;
let tex: WebGLTexture | null = null;
let aPos = -1;
let uTex: WebGLUniformLocation | null = null;
let uAmount: WebGLUniformLocation | null = null;
let uFreq: WebGLUniformLocation | null = null;
let uSeed: WebGLUniformLocation | null = null;

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;          // [-1,1] quad → [0,1] uv
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uAmount;   // displacement in uv units (x, y)
uniform float uFreq;    // noise periods across the canvas
uniform vec2 uSeed;     // per-frame + per-layer offset

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  // Pin the edges (window the displacement to 0 at the borders) so the canvas edge can't gap.
  vec2 edge = smoothstep(0.0, 0.06, vUv) * smoothstep(0.0, 0.06, 1.0 - vUv);
  float w = edge.x * edge.y;
  vec2 p = vUv * uFreq + uSeed;
  vec2 d = (vec2(vnoise(p), vnoise(p + vec2(19.3, 7.7))) - 0.5) * 2.0 * uAmount * w;
  gl_FragColor = texture2D(uTex, vUv + d);
}`;

function compile(g: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = g.createShader(type)!;
  g.shaderSource(s, src);
  g.compileShader(s);
  if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s) ?? "shader");
  return s;
}

function init(w: number, h: number): boolean {
  if (gl) return true;
  glCanvas = document.createElement("canvas");
  glCanvas.width = w;
  glCanvas.height = h;
  gl = glCanvas.getContext("webgl", { premultipliedAlpha: false, alpha: true, antialias: false });
  if (!gl) return false;
  const g = gl;
  prog = g.createProgram()!;
  g.attachShader(prog, compile(g, g.VERTEX_SHADER, VERT));
  g.attachShader(prog, compile(g, g.FRAGMENT_SHADER, FRAG));
  g.linkProgram(prog);
  if (!g.getProgramParameter(prog, g.LINK_STATUS)) return false;
  g.useProgram(prog);

  const buf = g.createBuffer();
  g.bindBuffer(g.ARRAY_BUFFER, buf);
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
  aPos = g.getAttribLocation(prog, "aPos");
  g.enableVertexAttribArray(aPos);
  g.vertexAttribPointer(aPos, 2, g.FLOAT, false, 0, 0);

  uTex = g.getUniformLocation(prog, "uTex");
  uAmount = g.getUniformLocation(prog, "uAmount");
  uFreq = g.getUniformLocation(prog, "uFreq");
  uSeed = g.getUniformLocation(prog, "uSeed");

  tex = g.createTexture();
  g.bindTexture(g.TEXTURE_2D, tex);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
  g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, 1);
  g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
  g.disable(g.BLEND);
  return true;
}

export interface BoilGLOptions {
  amount: number; // displacement, device px
  freq: number;   // noise periods across the canvas (≈ the old `cols`)
  seed: number;   // per-frame + per-layer
}

/** Displace `src` and blit the result onto `dstCtx` (device px, w×h). Falls back to a plain
 *  drawImage if WebGL is unavailable. Returns true if the GL path ran. */
export function drawBoiledGL(dstCtx: CanvasRenderingContext2D, src: HTMLCanvasElement, w: number, h: number, o: BoilGLOptions): boolean {
  if (!init(w, h)) { dstCtx.drawImage(src, 0, 0); return false; }
  const g = gl!, c = glCanvas!;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  g.viewport(0, 0, w, h);
  g.useProgram(prog);
  g.bindTexture(g.TEXTURE_2D, tex);
  g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, src);
  g.uniform1i(uTex, 0);
  g.uniform2f(uAmount, o.amount / w, o.amount / h);
  g.uniform1f(uFreq, Math.max(1, o.freq));
  g.uniform2f(uSeed, o.seed * 1.37, o.seed * 2.13);
  g.clearColor(0, 0, 0, 0);
  g.clear(g.COLOR_BUFFER_BIT);
  g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
  dstCtx.drawImage(c, 0, 0);
  return true;
}
