// WebGL line-boil. Composites ALL drawing layers inside one GL canvas — each
// displaced by a fragment-shader noise offset and blended in z-order — then the caller blits the
// GL canvas onto the 2D composite EXACTLY ONCE per frame. Reading a WebGL canvas via drawImage
// multiple times per frame is unreliable on iOS Safari (stale/empty after the first read), which
// is why everything accumulates in GL and is read back just once.
//
// Usage per frame: boilBegin(w,h) → boilLayer(...) per drawing layer (bottom→top) → boilBlit(ctx).

let gl: WebGLRenderingContext | null = null;
let glCanvas: HTMLCanvasElement | null = null;
let prog: WebGLProgram | null = null;
let tex: WebGLTexture | null = null;
let aPos = -1;
let uTex: WebGLUniformLocation | null = null;
let uAmount: WebGLUniformLocation | null = null;
let uFreq: WebGLUniformLocation | null = null;
let uSeed: WebGLUniformLocation | null = null;
let uOpacity: WebGLUniformLocation | null = null;
let uWeight: WebGLUniformLocation | null = null;
let curW = 0, curH = 0;

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uAmount;   // displacement in uv units (0 → crisp)
uniform float uFreq;    // noise periods across the canvas
uniform vec2 uSeed;     // per-frame + per-layer offset
uniform float uOpacity; // layer opacity (0..1)
uniform float uWeight; // signed edge bias: + fatten, - thin

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  // Window the displacement to 0 at the borders so the canvas edge can't gap.
  vec2 e = smoothstep(0.0, 0.06, vUv) * smoothstep(0.0, 0.06, 1.0 - vUv);
  vec2 p = vUv * uFreq + uSeed;
  vec2 d = (vec2(vnoise(p), vnoise(p + vec2(19.3, 7.7))) - 0.5) * 2.0 * uAmount * (e.x * e.y);
  vec4 c = texture2D(uTex, vUv + d);
  // Line-weight: push the anti-aliased edge alpha (a*(1-a) peaks at edges); rescale rgb to stay premultiplied.
  float a0 = c.a;
  float a = clamp(a0 + uWeight * a0 * (1.0 - a0) * 4.0, 0.0, 1.0);
  vec3 rgb = a0 > 0.0 ? c.rgb * (a / a0) : c.rgb;
  gl_FragColor = vec4(rgb, a) * uOpacity;
}`;

function compile(g: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = g.createShader(type)!;
  g.shaderSource(s, src);
  g.compileShader(s);
  if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s) ?? "shader");
  return s;
}

function init(): boolean {
  if (gl) return true;
  glCanvas = document.createElement("canvas");
  glCanvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); resetBoilGL(); }, false);
  glCanvas.width = 1;
  glCanvas.height = 1;
  gl = glCanvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return false;
  const g = gl;
  prog = g.createProgram()!;
  g.attachShader(prog, compile(g, g.VERTEX_SHADER, VERT));
  g.attachShader(prog, compile(g, g.FRAGMENT_SHADER, FRAG));
  g.linkProgram(prog);
  if (!g.getProgramParameter(prog, g.LINK_STATUS)) { gl = null; return false; }
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
  uOpacity = g.getUniformLocation(prog, "uOpacity");
  uWeight = g.getUniformLocation(prog, "uWeight");

  tex = g.createTexture();
  g.bindTexture(g.TEXTURE_2D, tex);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
  g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, 1);
  g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
  return true;
}

/** Begin a frame: size/clear the GL accumulation surface. Returns false if WebGL is unavailable. */
export function boilBegin(w: number, h: number): boolean {
  if (!init()) return false;
  const g = gl!, c = glCanvas!;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  curW = w; curH = h;
  g.viewport(0, 0, w, h);
  g.useProgram(prog);
  g.enable(g.BLEND);
  g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA); // premultiplied "over"
  g.clearColor(0, 0, 0, 0);
  g.clear(g.COLOR_BUFFER_BIT);
  return true;
}

/** Map a (possibly huge) seed to a SMALL bounded 2D offset on the CPU (float64, exact). Feeding a
 *  large coordinate into the GLSL noise collapses it (few/constant states) on most GPUs. */
export function boilSeedOffset(seed: number): [number, number] {
  return [
    Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 17,
    Math.abs(Math.sin(seed * 78.233) * 12543.1234) % 17,
  ];
}

/** Composite one drawing layer into the GL surface (displaced by `amount` px; 0 = crisp). */
export function boilLayer(src: HTMLCanvasElement, opacity: number, amount: number, freq: number, weight: number, seed: number): void {
  const g = gl!;
  g.bindTexture(g.TEXTURE_2D, tex);
  g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, src);
  g.uniform1i(uTex, 0);
  g.uniform2f(uAmount, amount / curW, amount / curH);
  g.uniform1f(uFreq, Math.max(1, freq));
  const [sx, sy] = boilSeedOffset(seed);
  g.uniform2f(uSeed, sx, sy);
  // Signed per-frame jitter in [-1,1] (different stream from the displacement seed) so weight breathes.
  const wjit = (boilSeedOffset(seed + 31)[0] / 17) * 2 - 1;
  g.uniform1f(uWeight, weight * wjit * 0.12); // 0.12 = max edge-alpha push at full weight
  g.uniform1f(uOpacity, opacity);
  g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
}

/** Drop the GL state so the next boilBegin re-initialises (used on WebGL context loss). */
export function resetBoilGL(): void {
  gl = null; glCanvas = null; prog = null; tex = null;
}

/** Blit the accumulated GL surface onto the 2D composite (one read per frame — iOS-safe). */
export function boilBlit(dstCtx: CanvasRenderingContext2D): void {
  if (glCanvas) dstCtx.drawImage(glCanvas, 0, 0);
}
