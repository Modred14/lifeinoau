// lib3d/campuslife/props/faces.js
// Ported from campus/client/game/scenery/banner-layout.ts and banner-paint.ts (commit c2b9477): the printed faces of the banners, laid out in one atlas and painted on a canvas. Type annotations removed.
export const ATLAS_SIZE = 2048;
export const ATLAS_SIZE_LOW = 1024;
export const FACE_PX = { big: { w: 512, h: 256 }, wide: { w: 320, h: 140 }, poster: { w: 120, h: 128 }, strip: { w: 512, h: 72 } };
const FACE_RULES = {
  big: { pad: 0.05, band: 0.17, bandAt: "bottom", title: { top: 0.06, height: 0.42, maxPx: 84, minPx: 30, maxLines: 2, wrap: true }, body: { top: 0.5, height: 0.3, maxPx: 38, minPx: 18, maxLines: 2, wrap: false }, footerPx: 26, bodyRows: 2 },
  wide: { pad: 0.05, band: 0.19, bandAt: "bottom", title: { top: 0.06, height: 0.42, maxPx: 46, minPx: 17, maxLines: 2, wrap: true }, body: { top: 0.49, height: 0.3, maxPx: 22, minPx: 11, maxLines: 2, wrap: false }, footerPx: 16, bodyRows: 2 },
  poster: { pad: 0.07, band: 0.15, bandAt: "bottom", title: { top: 0.06, height: 0.42, maxPx: 22, minPx: 10, maxLines: 3, wrap: true }, body: { top: 0.5, height: 0.33, maxPx: 12, minPx: 7, maxLines: 4, wrap: true }, footerPx: 9, bodyRows: 2 },
  strip: { pad: 0.07, band: 0.035, bandAt: "ends", title: { top: 0.08, height: 0.84, maxPx: 42, minPx: 15, maxLines: 1, wrap: false }, body: { top: 0, height: 0, maxPx: 0, minPx: 0, maxLines: 0, wrap: false }, footerPx: 0, bodyRows: 1 },
};
const LINE_HEIGHT = 1.14, STRIP_JOIN = "  ·  ", ELLIPSIS = "...", UV_INSET_PX = 1, BLANK = "#2a2d31", EDGE = "rgba(0,0,0,0.22)";
const hex = (c) => `#${c.toString(16).padStart(6, "0")}`;

/** Places one cell per face shape on shelves of a square atlas of `size` px. */
export function packAtlas(faces, size) {
  const scale = size / ATLAS_SIZE, order = faces.map((_, i) => i).sort((a, b) => FACE_PX[faces[b]].h - FACE_PX[faces[a]].h || a - b), out = [];
  let x = 0, y = 0, shelf = 0;
  for (const i of order) {
    const w = Math.floor(FACE_PX[faces[i]].w * scale), h = Math.floor(FACE_PX[faces[i]].h * scale);
    if (x + w > size) { x = 0; y += shelf; shelf = 0; }
    if (y + h > size) break;
    out[i] = { x, y, w, h }; x += w; shelf = Math.max(shelf, h);
  }
  return faces.map((_, i) => out[i] ?? out[order[0]] ?? { x: 0, y: 0, w: 1, h: 1 });
}
export const cellUv = (cell, size) => [(cell.x + UV_INSET_PX) / size, 1 - (cell.y + cell.h - UV_INSET_PX) / size, (cell.x + cell.w - UV_INSET_PX) / size, 1 - (cell.y + UV_INSET_PX) / size];

function wrapText(text, maxWidth, px, bold, measure) {
  const lines = []; let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) { const next = line ? `${line} ${word}` : word; if (line && measure(next, px, bold) > maxWidth) { lines.push(line); line = word; } else line = next; }
  if (line) lines.push(line);
  return lines;
}
function clip(text, maxWidth, px, bold, measure) {
  if (measure(text, px, bold) <= maxWidth) return text;
  let cut = text; while (cut.length > 1 && measure(cut + ELLIPSIS, px, bold) > maxWidth) cut = cut.slice(0, -1).trimEnd();
  return cut + ELLIPSIS;
}
function fitBlock(rows, box, rule, measure) {
  const lay = (px) => rows.flatMap((r) => (rule.wrap ? wrapText(r, box.w, px, rule.bold, measure) : [r]));
  for (let px = rule.maxPx; px >= rule.minPx; px -= Math.max(1, px * 0.06)) { const lines = lay(px); if (lines.length <= rule.maxLines && lines.length * px * LINE_HEIGHT <= box.h && lines.every((l) => measure(l, px, rule.bold) <= box.w)) return { px, lines }; }
  const px = rule.minPx, room = Math.max(1, Math.min(rule.maxLines, Math.floor(box.h / (px * LINE_HEIGHT))));
  return { px, lines: lay(px).slice(0, room).map((l) => clip(l, box.w, px, rule.bold, measure)) };
}
function placeBlock(out, fit, cell, top, height, bold, color) {
  const step = fit.px * LINE_HEIGHT, start = top + (height - fit.lines.length * step) / 2 + step / 2;
  fit.lines.forEach((text, i) => out.texts.push({ text, x: cell.w / 2, y: start + i * step, px: fit.px, bold, color }));
}
export function layoutFace(art, shape, cell, measure) {
  const rule = FACE_RULES[shape], k = cell.w / FACE_PX[shape].w, out = { rects: [{ x: 0, y: 0, w: cell.w, h: cell.h, color: art.color }], texts: [] };
  const band = rule.band * (rule.bandAt === "ends" ? cell.w : cell.h), side = rule.bandAt === "ends" ? band : 0, inner = cell.w - 2 * (rule.pad * cell.w + side);
  const scaled = (b, bold) => ({ maxPx: b.maxPx * k, minPx: b.minPx * k, maxLines: b.maxLines, wrap: b.wrap, bold });
  if (rule.bandAt === "ends") {
    out.rects.push({ x: 0, y: 0, w: band, h: cell.h, color: art.accent }, { x: cell.w - band, y: 0, w: band, h: cell.h, color: art.accent });
    const text = art.lines[0] ? `${art.title}${STRIP_JOIN}${art.lines[0]}` : art.title;
    placeBlock(out, fitBlock([text], { w: inner, h: rule.title.height * cell.h }, scaled(rule.title, true), measure), cell, rule.title.top * cell.h, rule.title.height * cell.h, true, art.ink);
    return out;
  }
  const footer = art.footer ?? "";
  out.rects.push({ x: 0, y: cell.h - band, w: cell.w, h: band, color: art.accent });
  if (footer) { const px = rule.footerPx * k; out.texts.push({ text: clip(footer, inner, px, true, measure), x: cell.w / 2, y: cell.h - band / 2, px, bold: true, color: art.color }); }
  placeBlock(out, fitBlock([art.title], { w: inner, h: rule.title.height * cell.h }, scaled(rule.title, true), measure), cell, rule.title.top * cell.h, rule.title.height * cell.h, true, art.ink);
  const rows = art.lines.slice(0, rule.bodyRows);
  if (rows.length) placeBlock(out, fitBlock(rows, { w: inner, h: rule.body.height * cell.h }, scaled(rule.body, false), measure), cell, rule.body.top * cell.h, rule.body.height * cell.h, false, art.ink);
  return out;
}

export const FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
/** Paints every face into its cell. faces: [{ art, shape }]. Returns false where there is no 2D canvas. */
export function paintAtlas(canvas, faces, cells) {
  const g = canvas.getContext("2d"); if (!g) return false;
  const font = (px, bold) => `${bold ? 800 : 600} ${px.toFixed(1)}px ${FONT}`;
  const measure = (text, px, bold) => { g.font = font(px, bold); return g.measureText(text).width; };
  g.fillStyle = BLANK; g.fillRect(0, 0, canvas.width, canvas.height); g.textAlign = "center"; g.textBaseline = "middle";
  faces.forEach((face, i) => {
    const cell = cells[i]; if (!cell) return;
    const drawing = layoutFace(face.art, face.shape, cell, measure);
    g.save(); g.beginPath(); g.rect(cell.x, cell.y, cell.w, cell.h); g.clip();
    for (const r of drawing.rects) { g.fillStyle = hex(r.color); g.fillRect(cell.x + r.x, cell.y + r.y, r.w, r.h); }
    for (const t of drawing.texts) { g.font = font(t.px, t.bold); g.fillStyle = hex(t.color); g.fillText(t.text, cell.x + t.x, cell.y + t.y); }
    g.strokeStyle = EDGE; g.lineWidth = 2; g.strokeRect(cell.x + 1, cell.y + 1, cell.w - 2, cell.h - 2);
    g.restore();
  });
  return true;
}
