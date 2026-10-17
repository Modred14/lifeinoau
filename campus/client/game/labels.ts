/**
 * Screen-space text labels (building names, player name tags) as sprites.
 * sizeAttenuation=false keeps them the same size on screen at any zoom,
 * like the pill labels in most social sims.
 */
import * as THREE from "three";
import { uiFontFamily } from "./fonts";

export interface LabelOptions {
  /** Height on screen as a fraction of the viewport height. */
  screenHeight?: number;
  color?: string;
  background?: string;
  bold?: boolean;
}

const DPR = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;

export function makeLabel(text: string, opts: LabelOptions = {}): THREE.Sprite {
  const { screenHeight = 0.032, color = "#f4f2df", background = "rgba(16,30,25,0.9)", bold = true } = opts;
  const fontPx = 28 * DPR;
  const padX = 14 * DPR;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = `${bold ? "700" : "500"} ${fontPx}px ${uiFontFamily()}`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width + padX * 2);
  const h = Math.ceil(fontPx * 1.55);
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  ctx.fillStyle = background;
  const r = 8 * DPR;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, r);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h / 2 + DPR);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, sizeAttenuation: false });
  const sprite = new THREE.Sprite(mat);
  sprite.center.set(0.5, 0); // anchor at bottom-centre
  sprite.scale.set((screenHeight * w) / h, screenHeight, 1);
  sprite.renderOrder = 10;
  return sprite;
}

export function disposeLabel(sprite: THREE.Sprite) {
  sprite.material.map?.dispose();
  sprite.material.dispose();
  sprite.removeFromParent();
}
