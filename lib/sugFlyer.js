// lib/sugFlyer.js
// Campaign flyers for every candidate: university posts, SUG posts and faculty posts alike (the post is whatever the candidate registered for).
//
// WHO MAY MAKE A FLYER, AND OF WHAT
//  The candidate is found from the SESSION: the signed-in player's own candidacy in the running election. Nothing the browser sends can name another
//  candidate, another player or another post. If a request carries a candidateId or a position anyway, it must match that candidacy exactly, or it is
//  refused (403). The flyer says:
//     username  = Character.name of the signed-in player (the account's own name, never typed text)
//     post      = SugCandidate.position of that candidacy, which the registration rules (eligibility, window, fee) already approved
//  A flyer is made only while the candidacy is ACTIVE (on the ballot) in an election that is still running, so a withdrawn or disqualified player, or a
//  non-candidate, gets nothing, and nothing is ever drawn that says someone has won.
//
// THE PHOTOGRAPH
//  Required. Accepted: JPEG, PNG or WebP (checked by the file's own bytes, not by its name or declared type), at most 4 MB, between 300 and 8000 px a side.
//  It is decoded and re-encoded as a plain JPEG (longest side 1600 px, all metadata and any hidden payload dropped) and stored in SugCandidatePhoto.
//  Only its owner can read it back; there is no public URL for it.
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { serverNow } from "./clock.js";
import { GameError } from "./gameService.js";
import { renderFlyer, flyerWords } from "./flyerRender.js";
export { GameError };
import * as R from "./sugRules.js";

export const PHOTO = { maxBytes: 4 * 1024 * 1024, minSide: 300, maxSide: 8000, storeSide: 1600, quality: 90 };

// ============================================================================================================================ reading an image's own header
/** { type, width, height } read from the bytes themselves, or null when they are not a JPEG, PNG or WebP. Cheap: nothing is decoded. */
export function sniffImage(b) {
  if (!b || b.length < 24) return null;
  if (b[0] === 0x89 && b.toString("latin1", 1, 4) === "PNG" && b.toString("latin1", 12, 16) === "IHDR") return { type: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) { // JPEG: walk the segments to the first "start of frame"
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: "jpeg", height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return null;
  }
  if (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
    const k = b.toString("latin1", 12, 16);
    if (k === "VP8X" && b.length >= 30) return { type: "webp", width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (k === "VP8 " && b.length >= 30) return { type: "webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (k === "VP8L" && b.length >= 25) { const v = b.readUInt32LE(21); return { type: "webp", width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
  }
  return null;
}

/** Checks an upload and returns the JPEG to store: { bytes, width, height }. Throws a GameError with a reason a player can act on. */
export async function normalisePhoto(raw) {
  const b = Buffer.isBuffer(raw) ? raw : Buffer.from(raw ?? []);
  if (!b.length) throw new GameError("Choose a picture first.", 400);
  if (b.length > PHOTO.maxBytes) throw new GameError("That picture is too large. Use one under 4 MB.", 413);
  const s = sniffImage(b);
  if (!s) throw new GameError("That file is not a picture we can use. Upload a JPEG, PNG or WebP photograph.", 415);
  if (s.width < PHOTO.minSide || s.height < PHOTO.minSide) throw new GameError(`That picture is too small. Use one at least ${PHOTO.minSide} pixels wide and tall.`, 422);
  if (s.width > PHOTO.maxSide || s.height > PHOTO.maxSide) throw new GameError(`That picture is too big. Use one no larger than ${PHOTO.maxSide} pixels on a side.`, 422);
  let img; try { img = await loadImage(b); } catch { throw new GameError("That picture could not be read. Try another photograph.", 422); }
  const k = Math.min(1, PHOTO.storeSide / Math.max(img.width, img.height)), w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const c = createCanvas(w, h), g = c.getContext("2d");
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h); g.imageSmoothingQuality = "high"; g.drawImage(img, 0, 0, w, h);
  return { bytes: Buffer.from(await c.encode("jpeg", PHOTO.quality)), width: w, height: h };
}

// ============================================================================================================================ who is asking
/**
 * The signed-in player's own candidacy, or a refusal. `claimed` is whatever the request said about a candidate or a post: it is never used to find
 * anything, only compared with the truth. This is the single gate every flyer, photo and state request goes through.
 */
export async function ownCandidacy(db, userId, claimed = {}) {
  const c = await db.character.findUnique({ where: { userId }, include: { faculty: { select: { id: true, name: true } } } });
  if (!c) throw new GameError("Create a character first.", 404);
  const cycle = await db.sugCycle.findFirst({ where: { status: "LIVE" } });
  if (!cycle || cycle.resultsAt != null) throw new GameError("There is no election running, so there is no campaign flyer to make.", 409);
  const cand = await db.sugCandidate.findUnique({ where: { cycleId_characterId: { cycleId: cycle.id, characterId: c.id } } });
  if (!cand) throw new GameError("Only candidates can make a campaign flyer. Register for a position first.", 403);
  if (claimed.candidateId != null && Number(claimed.candidateId) !== cand.id) throw new GameError("That is not your candidacy. You can only make a flyer for yourself.", 403);
  if (claimed.position != null && String(claimed.position) !== cand.position) throw new GameError(`You are not standing for that position. Your registered position is ${R.titleOf(cand.position)}.`, 403);
  if (cand.status !== "ACTIVE") throw new GameError(cand.status === "WITHDRAWN" ? "You withdrew from this election, so you cannot make a campaign flyer." : cand.status === "DISQUALIFIED" ? "Your candidacy was disqualified, so you cannot make a campaign flyer." : "Your candidacy is closed, so you cannot make a campaign flyer.", 403);
  const pos = R.positionOf(cand.position);
  if (!pos) throw new GameError("Your registered position is not available.", 409);
  const facultyName = pos.facultyId ? (await db.faculty.findUnique({ where: { id: pos.facultyId }, select: { name: true } }))?.name ?? null : null;
  return { c, cycle, cand, pos, facultyName };
}

const view = ({ c, cycle, cand, pos, facultyName }, photo) => ({
  candidateId: cand.id, username: c.name, position: cand.position, positionTitle: pos.title, category: pos.category, categoryLabel: R.CATEGORIES[pos.category].label, faculty: facultyName,
  cycle: cycle.title, stage: cycle.stage, hasPhoto: !!photo, photoUpdatedAt: photo ? +photo.updatedAt : null,
  words: flyerWords({ username: c.name, positionTitle: pos.title, facultyName }),
  shareText: `Vote for @${c.name} as ${pos.title}${facultyName ? ` (${facultyName})` : ""} on LifeinOAU. Visit lifeinoau.com now to vote.`,
});

/** What the flyer screen needs: the facts the flyer will state (from the server) and whether a photograph is on file. */
export async function getFlyerState(db, userId, claimed) {
  const o = await ownCandidacy(db, userId, claimed);
  const photo = await db.sugCandidatePhoto.findUnique({ where: { candidateId: o.cand.id }, select: { updatedAt: true } });
  return { ok: true, ...view(o, photo), limits: { maxBytes: PHOTO.maxBytes, minSide: PHOTO.minSide } };
}

/** Stores (or replaces) the candidate's photograph. */
export async function savePhoto(db, userId, bytes, claimed) {
  const o = await ownCandidacy(db, userId, claimed);
  const p = await normalisePhoto(bytes);
  const row = await db.sugCandidatePhoto.upsert({
    where: { candidateId: o.cand.id },
    create: { candidateId: o.cand.id, characterId: o.c.id, bytes: p.bytes, sizeBytes: p.bytes.length, width: p.width, height: p.height },
    update: { bytes: p.bytes, sizeBytes: p.bytes.length, width: p.width, height: p.height, characterId: o.c.id },
  });
  return { ok: true, ...view(o, row) };
}

/** The owner's own stored photograph (bytes), or a refusal. Nobody else's is ever returned. */
export async function getPhoto(db, userId, claimed) {
  const o = await ownCandidacy(db, userId, claimed);
  const photo = await db.sugCandidatePhoto.findUnique({ where: { candidateId: o.cand.id } });
  if (!photo || photo.characterId !== o.c.id) throw new GameError("You have not uploaded a campaign picture yet.", 404);
  return { bytes: Buffer.from(photo.bytes), mime: photo.mime };
}

/** Draws the flyer. Refused until a photograph is on file. Returns { png, filename, words, ... } for the route to send. */
export async function makeFlyer(db, userId, claimed) {
  const o = await ownCandidacy(db, userId, claimed);
  const photo = await db.sugCandidatePhoto.findUnique({ where: { candidateId: o.cand.id } });
  if (!photo || photo.characterId !== o.c.id) throw new GameError("Upload your campaign picture first. A flyer cannot be made without it.", 409);
  const out = await renderFlyer({ username: o.c.name, positionTitle: o.pos.title, facultyName: o.facultyName, photo: Buffer.from(photo.bytes) });
  const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 40);
  return { png: out.png, width: out.width, height: out.height, lines: out.lines, words: out.words, filename: `lifeinoau-${safe(o.c.name)}-${safe(o.pos.title)}-flyer.png`, at: serverNow() };
}
