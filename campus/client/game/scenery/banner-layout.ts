import type { BannerArt, BannerFace } from "@campuslife/shared";

export const ATLAS_SIZE = 2048;
export const ATLAS_SIZE_LOW = 1024;
export const FACE_PX: Record<BannerFace, { w: number; h: number }> = {
  big: { w: 512, h: 256 },
  wide: { w: 320, h: 140 },
  poster: { w: 120, h: 128 },
  strip: { w: 512, h: 72 },
};

export interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Measure = (text: string, px: number, bold: boolean) => number;

export interface FaceText {
  text: string;
  x: number;
  y: number;
  px: number;
  bold: boolean;
  color: number;
}

export interface FaceRect extends Cell {
  color: number;
}

export interface FaceDrawing {
  rects: FaceRect[];
  texts: FaceText[];
}

interface BlockRule {
  top: number;
  height: number;
  maxPx: number;
  minPx: number;
  maxLines: number;
  wrap: boolean;
}

interface FaceRule {
  pad: number;
  band: number;
  bandAt: "top" | "bottom" | "ends";
  title: BlockRule;
  body: BlockRule;
  footerPx: number;
  bodyRows: number;
}

const FACE_RULES: Record<BannerFace, FaceRule> = {
  big: { pad: 0.05, band: 0.17, bandAt: "bottom", title: { top: 0.06, height: 0.42, maxPx: 84, minPx: 30, maxLines: 2, wrap: true }, body: { top: 0.5, height: 0.3, maxPx: 38, minPx: 18, maxLines: 2, wrap: false }, footerPx: 26, bodyRows: 2 },
  wide: { pad: 0.05, band: 0.19, bandAt: "bottom", title: { top: 0.06, height: 0.42, maxPx: 46, minPx: 17, maxLines: 2, wrap: true }, body: { top: 0.49, height: 0.3, maxPx: 22, minPx: 11, maxLines: 2, wrap: false }, footerPx: 16, bodyRows: 2 },
  poster: { pad: 0.07, band: 0.15, bandAt: "bottom", title: { top: 0.06, height: 0.42, maxPx: 22, minPx: 10, maxLines: 3, wrap: true }, body: { top: 0.5, height: 0.33, maxPx: 12, minPx: 7, maxLines: 4, wrap: true }, footerPx: 9, bodyRows: 2 },
  strip: { pad: 0.07, band: 0.035, bandAt: "ends", title: { top: 0.08, height: 0.84, maxPx: 42, minPx: 15, maxLines: 1, wrap: false }, body: { top: 0, height: 0, maxPx: 0, minPx: 0, maxLines: 0, wrap: false }, footerPx: 0, bodyRows: 1 },
};

const LINE_HEIGHT = 1.14;
const STRIP_JOIN = "  ·  ";
const ELLIPSIS = "...";
const UV_INSET_PX = 1;

export function packAtlas(faces: readonly BannerFace[], size: number): Cell[] {
  const scale = size / ATLAS_SIZE;
  const order = faces.map((_, i) => i).sort((a, b) => FACE_PX[faces[b]].h - FACE_PX[faces[a]].h || a - b);
  const out: Cell[] = [];
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const i of order) {
    const w = Math.floor(FACE_PX[faces[i]].w * scale);
    const h = Math.floor(FACE_PX[faces[i]].h * scale);
    if (x + w > size) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    if (y + h > size) break;
    out[i] = { x, y, w, h };
    x += w;
    shelf = Math.max(shelf, h);
  }
  return faces.map((_, i) => out[i] ?? out[order[0]] ?? { x: 0, y: 0, w: 1, h: 1 });
}

export function cellUv(cell: Cell, size: number): [number, number, number, number] {
  return [(cell.x + UV_INSET_PX) / size, 1 - (cell.y + cell.h - UV_INSET_PX) / size, (cell.x + cell.w - UV_INSET_PX) / size, 1 - (cell.y + UV_INSET_PX) / size];
}

export function wrapText(text: string, maxWidth: number, px: number, bold: boolean, measure: Measure): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, px, bold) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function clip(text: string, maxWidth: number, px: number, bold: boolean, measure: Measure): string {
  if (measure(text, px, bold) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && measure(cut + ELLIPSIS, px, bold) > maxWidth) cut = cut.slice(0, -1).trimEnd();
  return cut + ELLIPSIS;
}

export function fitBlock(rows: readonly string[], box: { w: number; h: number }, rule: { maxPx: number; minPx: number; maxLines: number; wrap: boolean; bold: boolean }, measure: Measure): { px: number; lines: string[] } {
  const lay = (px: number) => rows.flatMap((r) => (rule.wrap ? wrapText(r, box.w, px, rule.bold, measure) : [r]));
  for (let px = rule.maxPx; px >= rule.minPx; px -= Math.max(1, px * 0.06)) {
    const lines = lay(px);
    if (lines.length <= rule.maxLines && lines.length * px * LINE_HEIGHT <= box.h && lines.every((l) => measure(l, px, rule.bold) <= box.w)) return { px, lines };
  }
  const px = rule.minPx;
  const room = Math.max(1, Math.min(rule.maxLines, Math.floor(box.h / (px * LINE_HEIGHT))));
  return { px, lines: lay(px).slice(0, room).map((l) => clip(l, box.w, px, rule.bold, measure)) };
}

function placeBlock(out: FaceDrawing, fit: { px: number; lines: string[] }, cell: { w: number }, top: number, height: number, bold: boolean, color: number) {
  const step = fit.px * LINE_HEIGHT;
  const start = top + (height - fit.lines.length * step) / 2 + step / 2;
  fit.lines.forEach((text, i) => out.texts.push({ text, x: cell.w / 2, y: start + i * step, px: fit.px, bold, color }));
}

export function layoutFace(art: BannerArt, shape: BannerFace, cell: { w: number; h: number }, measure: Measure): FaceDrawing {
  const rule = FACE_RULES[shape];
  const k = cell.w / FACE_PX[shape].w;
  const out: FaceDrawing = { rects: [{ x: 0, y: 0, w: cell.w, h: cell.h, color: art.color }], texts: [] };
  const band = rule.band * (rule.bandAt === "ends" ? cell.w : cell.h);
  const side = rule.bandAt === "ends" ? band : 0;
  const inner = cell.w - 2 * (rule.pad * cell.w + side);
  const scaled = (b: BlockRule, bold: boolean) => ({ maxPx: b.maxPx * k, minPx: b.minPx * k, maxLines: b.maxLines, wrap: b.wrap, bold });
  if (rule.bandAt === "ends") {
    out.rects.push({ x: 0, y: 0, w: band, h: cell.h, color: art.accent }, { x: cell.w - band, y: 0, w: band, h: cell.h, color: art.accent });
    const text = art.lines[0] ? `${art.title}${STRIP_JOIN}${art.lines[0]}` : art.title;
    placeBlock(out, fitBlock([text], { w: inner, h: rule.title.height * cell.h }, scaled(rule.title, true), measure), cell, rule.title.top * cell.h, rule.title.height * cell.h, true, art.ink);
    return out;
  }
  const footer = art.footer ?? "";
  out.rects.push({ x: 0, y: cell.h - band, w: cell.w, h: band, color: art.accent });
  if (footer) {
    const px = rule.footerPx * k;
    out.texts.push({ text: clip(footer, inner, px, true, measure), x: cell.w / 2, y: cell.h - band / 2, px, bold: true, color: art.color });
  }
  const title = fitBlock([art.title], { w: inner, h: rule.title.height * cell.h }, scaled(rule.title, true), measure);
  placeBlock(out, title, cell, rule.title.top * cell.h, rule.title.height * cell.h, true, art.ink);
  const rows = art.lines.slice(0, rule.bodyRows);
  if (rows.length) {
    const body = fitBlock(rows, { w: inner, h: rule.body.height * cell.h }, scaled(rule.body, false), measure);
    placeBlock(out, body, cell, rule.body.top * cell.h, rule.body.height * cell.h, false, art.ink);
  }
  return out;
}
