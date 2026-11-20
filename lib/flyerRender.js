// lib/flyerRender.js
// Draws a LifeinOAU campaign flyer as a real PNG on the server. Server side on purpose: the picture a candidate downloads is made from the
// facts the server holds (their account name, their registered post, their stored photograph) and not from anything the browser draws or sends.
//
//  - Every word is drawn as text in the brand's own typefaces (Outfit for headlines, Work Sans for the small print: the same pair the app loads in
//    src/app/layout.js; the font files are vendored in lib/flyer-assets/fonts with their licences). No image model is involved anywhere, so a
//    username, a post or a web address can never be misspelled.
//  - The logo is the real one: public/logo.png, the file the app itself uses. Nothing is redrawn or imitated.
//  - The colours are the app's own: the brand greens (#15803d primary, #166534 secondary, the darker steps of the same green scale) and the logo's gold.
//    Flat colour only: no gradients.
//  - The photograph is drawn exactly as stored (cropped to fit the frame, never altered).
//
// renderFlyer({ username, positionTitle, facultyName, photo }) -> { png, width, height, lines }
//   `lines` is the text that was drawn, in order, so a test (and the preview screen) can check the words without reading pixels.
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export const FLYER = { width: 1080, height: 1350, scale: 1.5 }; // 1620 x 2025 px: crisp on a phone and fine to print at A5/A4 for a notice board
export const COLORS = {
  bg: "#14532d", // the brand green scale, dark step
  tone: "#166534", // the brand's secondary green: the ring behind the photograph
  deep: "#052e16", // the darkest step: shadow block and the call-to-action band
  bright: "#3fd08a", // the app's --green-text
  paper: "#f2f6fe", // the logo's own off-white
  gold: "#fbad01", // the logo's sun
};

const root = process.cwd();
const FONT_DIR = path.join(root, "lib", "flyer-assets", "fonts");
const LOGO = path.join(root, "public", "logo.png");
let fontsReady = false, logoImg = null;
function fonts() {
  if (fontsReady) return;
  for (const [file, alias] of [["outfit-latin-900-normal.woff", "LifeBlack"], ["outfit-latin-700-normal.woff", "LifeHead"], ["outfit-latin-800-normal.woff", "LifeBold"], ["work-sans-latin-700-normal.woff", "LifeBody"]]) {
    const p = path.join(FONT_DIR, file);
    if (!existsSync(p) || !GlobalFonts.registerFromPath(p, alias)) throw new Error(`flyer font missing: ${file}`);
  }
  fontsReady = true;
}
async function logo() { return (logoImg ??= await loadImage(readFileSync(LOGO))); }

/** The biggest font size (stepping down by 2) at which `text` fits `max` pixels wide. */
function fitSize(ctx, text, face, max, from, to) {
  for (let s = from; s >= to; s -= 2) { ctx.font = `${s}px ${face}`; if (ctx.measureText(text).width <= max) return s; }
  ctx.font = `${to}px ${face}`; return to;
}
/** Splits words into the two most even lines, for a long post title. */
function twoLines(text) {
  const w = text.split(" "); let best = [text, ""], gap = Infinity;
  for (let i = 1; i < w.length; i++) { const a = w.slice(0, i).join(" "), b = w.slice(i).join(" "), d = Math.abs(a.length - b.length); if (d < gap) { gap = d; best = [a, b]; } }
  return best;
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
const spaced = (ctx, px) => { try { ctx.letterSpacing = `${px}px`; } catch { /* older canvas: no tracking, still correct */ } };
/** Centred text; the baseline is `y`. Returns the width drawn. */
function centred(ctx, text, y, color) { ctx.fillStyle = color; ctx.textAlign = "center"; ctx.fillText(text, FLYER.width / 2, y); return ctx.measureText(text).width; }

/** The words on the flyer for these facts. Pure; exported so the screens and the tests can show / check exactly what will be drawn. */
export function flyerWords({ username, positionTitle, facultyName = null }) {
  const U = String(username).toUpperCase(), P = String(positionTitle).toUpperCase();
  return {
    headline: `VOTE FOR @${U} AS ${P} ON LIFEINOAU`, // the exact campaign message
    action: "VISIT LIFEINOAU.COM NOW TO VOTE", // the exact call to action
    handle: `@${U}`, position: P, faculty: facultyName ? String(facultyName).toUpperCase() : null,
  };
}

/**
 * Draw one flyer. `photo` is the candidate's stored photograph (bytes). `username` is the account name and `positionTitle` the registered post: the
 * caller (lib/sugFlyer.js) takes both from the database, never from the request.
 */
export async function renderFlyer({ username, positionTitle, facultyName = null, photo }) {
  if (!photo?.length) throw new Error("A photograph is required to draw a flyer.");
  fonts();
  const { width: W, height: H, scale } = FLYER, C = COLORS, words = flyerWords({ username, positionTitle, facultyName }), lines = [];
  const canvas = createCanvas(Math.round(W * scale), Math.round(H * scale)), ctx = canvas.getContext("2d");
  ctx.scale(scale, scale); ctx.textBaseline = "alphabetic"; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";

  // background: flat brand green, one tonal ring echoing the logo's own ring
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = C.tone; ctx.lineWidth = 78; ctx.beginPath(); ctx.arc(W / 2, 462, 392, 0, Math.PI * 2); ctx.stroke();

  // header: the real logo and the name
  const lh = 100, lw = (lh * 812) / 654, img = await logo();
  ctx.drawImage(img, 56, 40, lw, lh);
  // the name exactly as the app's header writes it: lowercase Outfit bold, "in" in the app's green (life<i>in</i>oau, components/Shell.js + .hud .brand i)
  ctx.textAlign = "left"; ctx.font = "60px LifeHead"; spaced(ctx, -0.9);
  let nx = 56 + lw + 22; for (const [t, col] of [["life", C.paper], ["in", C.bright], ["oau", C.paper]]) { ctx.fillStyle = col; ctx.fillText(t, nx, 104); nx += ctx.measureText(t).width; }
  lines.push("lifeinoau");
  ctx.fillStyle = C.bright; ctx.font = "20px LifeBody"; spaced(ctx, 6); ctx.fillText("CAMPUS ELECTIONS", 56 + lw + 24, 134); spaced(ctx, 0);

  // the photograph: cover-cropped to the frame with the face (upper part) kept, on a flat shadow block
  const fw = 560, fh = 600, fx = (W - fw) / 2, fy = 172, r = 26, photoImg = await loadImage(photo);
  ctx.fillStyle = C.deep; roundRect(ctx, fx + 22, fy + 22, fw, fh, r); ctx.fill();
  ctx.save(); roundRect(ctx, fx, fy, fw, fh, r); ctx.clip();
  const k = Math.max(fw / photoImg.width, fh / photoImg.height), sw = fw / k, sh = fh / k, sx = (photoImg.width - sw) / 2, sy = (photoImg.height - sh) * 0.28;
  ctx.drawImage(photoImg, sx, sy, sw, sh, fx, fy, fw, fh); ctx.restore();
  ctx.strokeStyle = C.paper; ctx.lineWidth = 6; roundRect(ctx, fx, fy, fw, fh, r); ctx.stroke();

  // the message, in the order it is read: VOTE FOR / @USERNAME / AS POSITION / ON LIFEINOAU
  const maxW = W - 120; let y = fy + fh + 22 + 62;
  ctx.font = "42px LifeBold"; spaced(ctx, 9); centred(ctx, "VOTE FOR", y, C.bright); spaced(ctx, 0); lines.push("VOTE FOR");
  const us = fitSize(ctx, words.handle, "LifeBlack", maxW, 128, 56); y += us * 0.98; centred(ctx, words.handle, y, C.paper); lines.push(words.handle);
  const asText = `AS ${words.position}`; let ps = fitSize(ctx, asText, "LifeBlack", maxW, 66, 56);
  ctx.font = `${ps}px LifeBlack`;
  if (ctx.measureText(asText).width <= maxW) { y += ps * 1.28; centred(ctx, asText, y, C.gold); lines.push(asText); }
  else { // a long post title is set on two lines
    const [a, b] = twoLines(words.position), l1 = `AS ${a}`; ps = Math.min(fitSize(ctx, l1, "LifeBlack", maxW, 60, 36), fitSize(ctx, b, "LifeBlack", maxW, 60, 36));
    ctx.font = `${ps}px LifeBlack`; y += ps * 1.25; centred(ctx, l1, y, C.gold); y += ps * 1.08; centred(ctx, b, y, C.gold); lines.push(l1, b);
  }
  if (words.faculty) { y += 40; ctx.font = "26px LifeBody"; spaced(ctx, 5); const fs = fitSize(ctx, words.faculty, "LifeBody", maxW, 26, 18); ctx.font = `${fs}px LifeBody`; centred(ctx, words.faculty, y, C.bright); spaced(ctx, 0); lines.push(words.faculty); }
  y += 62; ctx.font = "44px LifeBold"; spaced(ctx, 4); centred(ctx, "ON LIFEINOAU", y, C.paper); spaced(ctx, 0); lines.push("ON LIFEINOAU");

  // the call to action
  const bandH = 112, by = H - bandH;
  ctx.fillStyle = C.deep; ctx.fillRect(0, by, W, bandH); ctx.fillStyle = C.gold; ctx.fillRect(0, by, W, 6);
  const parts = [["VISIT ", C.paper], ["LIFEINOAU.COM", C.gold], [" NOW TO VOTE", C.paper]];
  let cs = 44; for (; cs >= 24; cs -= 2) { ctx.font = `${cs}px LifeBlack`; if (ctx.measureText(parts.map((p) => p[0]).join("")).width <= W - 100) break; }
  ctx.font = `${cs}px LifeBlack`; const total = ctx.measureText(parts.map((p) => p[0]).join("")).width; let x = (W - total) / 2; ctx.textAlign = "left";
  for (const [t, col] of parts) { ctx.fillStyle = col; ctx.fillText(t, x, by + 6 + (bandH - 6) / 2 + cs * 0.34); x += ctx.measureText(t).width; }
  lines.push(words.action);

  return { png: await canvas.encode("png"), width: canvas.width, height: canvas.height, lines, words };
}
