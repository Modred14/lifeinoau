import type { BannerArt, BannerFace } from "@campuslife/shared";
import { uiFontFamily } from "../fonts";
import { layoutFace, type Cell, type Measure } from "./banner-layout";

export interface AtlasFace {
  art: BannerArt;
  shape: BannerFace;
}

const BLANK = "#2a2d31";
const EDGE = "rgba(0,0,0,0.22)";
const WEIGHT = { bold: 800, plain: 600 };
const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

export function createAtlasCanvas(size: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  return canvas;
}

export function paintAtlas(canvas: HTMLCanvasElement, faces: readonly AtlasFace[], cells: readonly Cell[]): boolean {
  const g = canvas.getContext("2d");
  if (!g) return false;
  const family = uiFontFamily();
  const font = (px: number, bold: boolean) => `${bold ? WEIGHT.bold : WEIGHT.plain} ${px.toFixed(1)}px ${family}`;
  const measure: Measure = (text, px, bold) => {
    g.font = font(px, bold);
    return g.measureText(text).width;
  };
  g.fillStyle = BLANK;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.textAlign = "center";
  g.textBaseline = "middle";
  faces.forEach((face, i) => {
    const cell = cells[i];
    if (!cell) return;
    const drawing = layoutFace(face.art, face.shape, cell, measure);
    g.save();
    g.beginPath();
    g.rect(cell.x, cell.y, cell.w, cell.h);
    g.clip();
    for (const r of drawing.rects) {
      g.fillStyle = hex(r.color);
      g.fillRect(cell.x + r.x, cell.y + r.y, r.w, r.h);
    }
    for (const t of drawing.texts) {
      g.font = font(t.px, t.bold);
      g.fillStyle = hex(t.color);
      g.fillText(t.text, cell.x + t.x, cell.y + t.y);
    }
    g.strokeStyle = EDGE;
    g.lineWidth = 2;
    g.strokeRect(cell.x + 1, cell.y + 1, cell.w - 2, cell.h - 2);
    g.restore();
  });
  return true;
}
