/**
 * Viewport: zoom, pan, and rotation.
 * Uses CSS transform for predictable coordinate mapping.
 * Transform order: translate(panX, panY) rotate(rotation) scale(zoom)
 * Transform origin is top-left (0,0).
 */

export class Viewport {
  zoom = 1;
  // Pan in screen pixels (how far the canvas origin has moved on screen)
  panX = 0;
  panY = 0;
  // Rotation in radians
  rotation = 0;

  private target: HTMLElement;
  private parent: HTMLElement;
  private minZoom = 0.1;
  private maxZoom = 20;

  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private panStartPanX = 0;
  private panStartPanY = 0;

  onChange: (() => void) | null = null;

  constructor(target: HTMLElement) {
    this.target = target;
    this.parent = target.parentElement!;
    this.applyTransform();
  }

  /** Convert screen (client) coords to canvas (logical) coords */
  screenToCanvas(sx: number, sy: number): { x: number; y: number } {
    const rect = this.parent.getBoundingClientRect();
    // Point relative to the parent's top-left
    let rx = sx - rect.left;
    let ry = sy - rect.top;
    // Undo translate
    rx -= this.panX;
    ry -= this.panY;
    // Undo rotate
    const cos = Math.cos(-this.rotation);
    const sin = Math.sin(-this.rotation);
    const urx = rx * cos - ry * sin;
    const ury = rx * sin + ry * cos;
    // Undo scale
    return { x: urx / this.zoom, y: ury / this.zoom };
  }

  /** Convert canvas (logical) coords to screen (client) coords. Inverse of screenToCanvas. */
  canvasToScreen(cx: number, cy: number): { x: number; y: number } {
    const rect = this.parent.getBoundingClientRect();
    const cos = Math.cos(this.rotation);
    const sin = Math.sin(this.rotation);
    const sx = cx * this.zoom;
    const sy = cy * this.zoom;
    // Apply: rotate then translate (pan), plus parent offset
    return {
      x: rect.left + this.panX + sx * cos - sy * sin,
      y: rect.top + this.panY + sx * sin + sy * cos,
    };
  }

  /** Zoom toward a screen point, keeping that point fixed */
  zoomAt(screenX: number, screenY: number, delta: number) {
    const rect = this.parent.getBoundingClientRect();
    const rx = screenX - rect.left;
    const ry = screenY - rect.top;

    // Canvas point under cursor before zoom
    const canvas = this.screenToCanvas(screenX, screenY);

    const oldZoom = this.zoom;
    const factor = delta > 0 ? 0.9 : 1.1;
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, oldZoom * factor));

    // Adjust pan so the same canvas point stays under cursor
    // Forward: screen = pan + rotate(scale(canvas))
    const cos = Math.cos(this.rotation);
    const sin = Math.sin(this.rotation);
    const sx = canvas.x * this.zoom;
    const sy = canvas.y * this.zoom;
    this.panX = rx - (sx * cos - sy * sin);
    this.panY = ry - (sx * sin + sy * cos);

    this.applyTransform();
    this.onChange?.();
  }

  setZoom(z: number) {
    // Zoom toward center of viewport
    const rect = this.parent.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const canvas = this.screenToCanvas(centerX, centerY);

    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, z));

    const rx = rect.width / 2;
    const ry = rect.height / 2;
    const cos = Math.cos(this.rotation);
    const sin = Math.sin(this.rotation);
    const sx = canvas.x * this.zoom;
    const sy = canvas.y * this.zoom;
    this.panX = rx - (sx * cos - sy * sin);
    this.panY = ry - (sx * sin + sy * cos);

    this.applyTransform();
    this.onChange?.();
  }

  /** Rotate around the center of the viewport */
  rotateAroundCenter(deltaRadians: number) {
    const rect = this.parent.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    // Canvas point at viewport center
    const canvas = this.screenToCanvas(centerX, centerY);

    this.rotation += deltaRadians;

    // Recompute pan to keep the same canvas point at center
    const rx = rect.width / 2;
    const ry = rect.height / 2;
    const cos = Math.cos(this.rotation);
    const sin = Math.sin(this.rotation);
    const sx = canvas.x * this.zoom;
    const sy = canvas.y * this.zoom;
    this.panX = rx - (sx * cos - sy * sin);
    this.panY = ry - (sx * sin + sy * cos);

    this.applyTransform();
    this.onChange?.();
  }

  resetView() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.rotation = 0;
    this.applyTransform();
    this.onChange?.();
  }

  startPan(screenX: number, screenY: number) {
    this.isPanning = true;
    this.panStartX = screenX;
    this.panStartY = screenY;
    this.panStartPanX = this.panX;
    this.panStartPanY = this.panY;
  }

  updatePan(screenX: number, screenY: number) {
    if (!this.isPanning) return;
    this.panX = this.panStartPanX + (screenX - this.panStartX);
    this.panY = this.panStartPanY + (screenY - this.panStartY);
    this.applyTransform();
    this.onChange?.();
  }

  endPan() {
    this.isPanning = false;
  }

  get panning(): boolean {
    return this.isPanning;
  }

  /** Public wrapper for code that mutates pan/zoom/rotation directly. Fires onChange so subscribers (e.g. selection hit-tolerance) stay in sync. */
  applyTransformPublic() {
    this.applyTransform();
    this.onChange?.();
  }

  private applyTransform() {
    const deg = this.rotation * (180 / Math.PI);
    this.target.style.transformOrigin = "0 0";
    this.target.style.transform = `translate(${this.panX}px, ${this.panY}px) rotate(${deg}deg) scale(${this.zoom})`;
  }
}
