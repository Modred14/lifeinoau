import { ATLAS_HEIGHT, ATLAS_WIDTH, GLOW_SCALE, ROW_PX } from "./atlas-layout";

export interface AtlasPixels {
  width: number;
  height: number;
  color: Uint8ClampedArray;
  glowWidth: number;
  glowHeight: number;
  glow: Uint8ClampedArray;
}

export function emptyAtlas(): AtlasPixels {
  const glowWidth = Math.round(ATLAS_WIDTH * GLOW_SCALE), glowHeight = Math.round(ATLAS_HEIGHT * GLOW_SCALE);
  const color = new Uint8ClampedArray(ATLAS_WIDTH * ATLAS_HEIGHT * 4).fill(255);
  const glow = new Uint8ClampedArray(glowWidth * glowHeight * 4);
  for (let i = 3; i < glow.length; i += 4) glow[i] = 255;
  return { width: ATLAS_WIDTH, height: ATLAS_HEIGHT, color, glowWidth, glowHeight, glow };
}

export function seeded(seed: number): () => number {
  let s = seed % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function blend(data: Uint8ClampedArray, stride: number, x0: number, y0: number, x1: number, y1: number, hex: number, alpha: number) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  for (let y = y0; y < y1; y++) {
    let i = (y * stride + x0) * 4;
    for (let x = x0; x < x1; x++, i += 4) {
      data[i] += (r - data[i]) * alpha;
      data[i + 1] += (g - data[i + 1]) * alpha;
      data[i + 2] += (b - data[i + 2]) * alpha;
    }
  }
}

export class RowPainter {
  readonly rand: () => number;
  private readonly top: number;

  constructor(private readonly atlas: AtlasPixels, row: number) {
    this.rand = seeded(977 + row * 131);
    this.top = row * ROW_PX;
  }

  private paint(glow: boolean, x: number, y: number, w: number, h: number, hex: number, alpha: number) {
    const s = glow ? GLOW_SCALE : 1;
    const x0 = Math.max(0, Math.floor(x * s)), x1 = Math.min(Math.round(ATLAS_WIDTH * s), Math.max(Math.floor(x * s) + 1, Math.round((x + w) * s)));
    const y0 = Math.floor((this.top + Math.max(0, y)) * s), y1 = Math.max(y0 + 1, Math.round((this.top + Math.min(ROW_PX, y + h)) * s));
    if (w <= 0 || h <= 0 || y >= ROW_PX || y + h <= 0) return;
    blend(glow ? this.atlas.glow : this.atlas.color, glow ? this.atlas.glowWidth : this.atlas.width, x0, y0, x1, Math.min(y1, Math.round((this.top + ROW_PX) * s)), hex, alpha);
  }

  fill(x: number, y: number, w: number, h: number, hex: number, alpha = 1) {
    this.paint(false, x, y, w, h, hex, alpha);
    this.paint(true, x, y, w, h, 0, alpha);
  }

  glass(x: number, y: number, w: number, h: number, lit: boolean, arch = false) {
    const radius = w / 2;
    for (let dy = 0; dy < h; dy++) {
      const t = dy / h;
      const cut = arch && dy < radius ? radius - Math.sqrt(radius * radius - (radius - dy) * (radius - dy)) : 0;
      const tone = (Math.round(0x70 - 0x48 * t) << 16) | (Math.round(0x88 - 0x50 * t) << 8) | Math.round(0x98 - 0x52 * t);
      this.paint(false, x + cut, y + dy, w - 2 * cut, 1, tone, 1);
    }
    if (!lit) return;
    const inset = arch ? radius * 0.3 : 0;
    this.paint(true, x + inset, y + inset, w - 2 * inset, h - inset, 0xffffff, 1);
  }

  blot(x: number, y: number, radius: number, hex: number, alpha: number, stretch = 1) {
    for (let dy = -radius; dy < radius; dy++) {
      const half = Math.sqrt(radius * radius - dy * dy) * stretch;
      const fade = 1 - Math.abs(dy) / radius;
      this.paint(false, x - half, y + dy, half * 2, 1, hex, alpha * fade);
    }
  }

  grain(amount: number) {
    const data = this.atlas.color;
    const start = this.top * this.atlas.width * 4, end = (this.top + ROW_PX) * this.atlas.width * 4;
    for (let i = start; i < end; i += 4) {
      const n = (this.rand() - 0.5) * amount;
      data[i] += n;
      data[i + 1] += n;
      data[i + 2] += n;
    }
  }

  streaks(count: number, hex: number, alpha: number, from = 0) {
    for (let i = 0; i < count; i++) {
      const x = 48 + this.rand() * (ATLAS_WIDTH - 52);
      const length = 20 + this.rand() * 80;
      for (let k = 0; k < 4; k++) this.paint(false, x + k * 0.8, from, 2 + this.rand() * 3, length * (1 - k * 0.2), hex, alpha * 0.5);
    }
  }
}
