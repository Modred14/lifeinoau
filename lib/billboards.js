// lib/billboards.js
// The ten map billboards: ten poster spots each, N20,000 a spot or N200,000 for the whole board. This is REAL money (kobo), kept apart from
// in-game cash. The payment provider is wired later: until then a reservation is confirmed only through confirmBillboardOrder(), which the
// real payment webhook is meant to call, and which the test-payment button calls outside production.
import { randomUUID } from "node:crypto";
import { BILLBOARD } from "../lib3d/mapExtras.js";
import { cleanText } from "./rules.js";
import { GameError } from "./gameService.js";
import { cached, invalidate, scopeOf } from "./cache.js";

export const SLOT_NUMBERS = Array.from({ length: BILLBOARD.SLOTS }, (_, i) => i + 1);
const MIME = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Price in kobo for the chosen spots: the whole board is one flat price, otherwise the spots are charged one by one. */
export const priceFor = (whole, slotCount) => (whole ? BILLBOARD.WHOLE_KOBO : slotCount * BILLBOARD.SLOT_KOBO);

/** Whether payments may be confirmed by the test button: never in production unless BILLBOARD_TEST_PAYMENTS=1 is set on purpose. */
export const testPaymentsAllowed = (env = process.env) => env.NODE_ENV !== "production" || env.BILLBOARD_TEST_PAYMENTS === "1";

/** "data:image/png;base64,...." -> { bytes, mime } or throws a GameError. Checks size and the file's real signature, not just its label. */
export function parseImage(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ""));
  if (!m) throw new GameError("Upload a JPG, PNG or WebP picture.", 400);
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length < 100) throw new GameError("That picture looks empty.", 400);
  if (bytes.length > BILLBOARD.MAX_IMAGE_BYTES) throw new GameError("That picture is too big. Keep it under 400 KB.", 413);
  const sig = (...a) => a.every((v, i) => bytes[i] === v);
  const ok = m[1] === "jpeg" ? sig(0xff, 0xd8, 0xff) : m[1] === "png" ? sig(0x89, 0x50, 0x4e, 0x47) : sig(0x52, 0x49, 0x46, 0x46) && bytes.subarray(8, 12).toString("latin1") === "WEBP";
  if (!ok) throw new GameError("That file is not a real " + m[1].toUpperCase() + " picture.", 400);
  return { bytes, mime: MIME[m[1]] };
}

const checkBoard = (n) => { if (!Number.isInteger(n) || n < 1 || n > BILLBOARD.COUNT) throw new GameError("There is no such billboard.", 404); return n; };
const live = (r, now) => r.status === "PAID" || (r.holdUntil && r.holdUntil > now);
export const imageUrl = (r) => `/api/billboards/image?b=${r.board}&s=${r.slot}&v=${r.updatedAt.getTime()}`;

/** Every billboard as the map needs it. Spots whose payment hold lapsed count as free. `userId` (optional) marks which spots are the caller's. */
export async function listBillboards(db, userId = null, now = new Date()) {
  // The rows are the same for everybody, so one query serves every player for 10 seconds. It is cleared the moment anything is bought or changed.
  const rows = await cached(`bb:rows:${scopeOf(db)}`, 10_000, () => db.billboardSlot.findMany({ select: { board: true, slot: true, ownerId: true, scope: true, status: true, caption: true, hidden: true, holdUntil: true, updatedAt: true, orderId: true, imageMime: true } }));
  const boards = [];
  for (let n = 1; n <= BILLBOARD.COUNT; n++) {
    const mine = rows.filter((r) => r.board === n && live(r, now)), taken = new Set(mine.map((r) => r.slot));
    boards.push({ n, free: BILLBOARD.SLOTS - taken.size, freeSlots: SLOT_NUMBERS.filter((s) => !taken.has(s)), canBuyWhole: taken.size === 0,
      posters: mine.filter((r) => r.status === "PAID" && !r.hidden && r.imageMime).sort((a, b) => a.slot - b.slot).map((r) => ({ slot: r.slot, url: imageUrl(r), caption: r.caption })),
      mine: userId ? mine.filter((r) => r.ownerId === userId).map((r) => ({ slot: r.slot, status: r.status, orderId: r.orderId, hasPoster: !!r.imageMime, caption: r.caption, holdUntil: r.status === "PENDING" ? r.holdUntil : null })) : [] });
  }
  return { boards, prices: { slotKobo: BILLBOARD.SLOT_KOBO, wholeKobo: BILLBOARD.WHOLE_KOBO }, seconds: BILLBOARD.SECONDS, paymentsConnected: false, testPayments: testPaymentsAllowed() };
}

/**
 * Reserve spots and hold them for HOLD_MINUTES while the buyer pays. whole=true takes every spot, and only works on a board nobody has touched.
 * The poster picture is stored on the first spot; a whole-board owner can add pictures to the other spots later (setPoster).
 */
export async function reserveBillboard(db, userId, { board, slots, whole, caption, image }, now = new Date()) {
  checkBoard(board); whole = !!whole;
  const want = whole ? SLOT_NUMBERS : [...new Set((Array.isArray(slots) ? slots : []).map(Number))].sort((a, b) => a - b);
  if (!want.length || want.length > BILLBOARD.SLOTS || want.some((s) => !SLOT_NUMBERS.includes(s))) throw new GameError("Pick at least one poster spot.", 400);
  const pic = parseImage(image), text = cleanText(caption, BILLBOARD.CAPTION_MAX), orderId = randomUUID(), total = priceFor(whole, want.length), holdUntil = new Date(now.getTime() + BILLBOARD.HOLD_MINUTES * 60_000);
  try {
    const out = await db.$transaction(async (tx) => {
      await tx.billboardSlot.deleteMany({ where: { status: "PENDING", OR: [{ holdUntil: { lt: now } }, { ownerId: userId }] } }); // lapsed holds, and this buyer's own older unpaid holds
      const taken = await tx.billboardSlot.findMany({ where: { board, slot: { in: want } }, select: { slot: true } });
      if (taken.length) throw new GameError(whole ? "That billboard already has posters on it. Pick single spots instead." : "Someone just took " + (taken.length > 1 ? "some of those spots." : "that spot."), 409);
      if (whole) { const any = await tx.billboardSlot.count({ where: { board } }); if (any) throw new GameError("That billboard already has posters on it.", 409); }
      await tx.billboardSlot.createMany({ data: want.map((slot, i) => ({ board, slot, ownerId: userId, orderId, scope: whole ? "WHOLE" : "SLOT", status: "PENDING", amountKobo: BILLBOARD.SLOT_KOBO, orderKobo: total, caption: i === 0 ? text : "", image: i === 0 ? pic.bytes : null, imageMime: i === 0 ? pic.mime : null, holdUntil })) });
      return { orderId, board, slots: want, whole, amountKobo: total, holdUntil };
    });
    invalidate("bb:"); return out;
  } catch (e) { if (e?.code === "P2002") throw new GameError("Someone just took that spot.", 409); throw e; }
}

/** Mark an order paid. Safe to call twice (a payment webhook may repeat itself). Real payments: call this from the provider's verified webhook. */
export async function confirmBillboardOrder(db, orderId, payRef, userId = null, now = new Date()) {
  const rows = await db.billboardSlot.findMany({ where: { orderId }, select: { id: true, ownerId: true, status: true, holdUntil: true } });
  if (!rows.length || (userId && rows.some((r) => r.ownerId !== userId))) throw new GameError("Order not found.", 404);
  if (rows.every((r) => r.status === "PAID")) return { orderId, paid: true, already: true };
  if (rows.some((r) => r.status === "PENDING" && r.holdUntil && r.holdUntil < now)) throw new GameError("That reservation expired. Pick the spots again.", 410);
  await db.billboardSlot.updateMany({ where: { orderId, status: "PENDING" }, data: { status: "PAID", paidAt: now, holdUntil: null, payRef: String(payRef ?? "").slice(0, 120) } });
  invalidate("bb:");
  return { orderId, paid: true, already: false };
}

/** The owner of a PAID spot can change its picture and caption. */
export async function setPoster(db, userId, { board, slot, caption, image }) {
  checkBoard(board); slot = Number(slot);
  const row = await db.billboardSlot.findUnique({ where: { board_slot: { board, slot } }, select: { ownerId: true, status: true } });
  if (!row || row.ownerId !== userId || row.status !== "PAID") throw new GameError("That spot is not yours.", 403);
  const pic = parseImage(image);
  await db.billboardSlot.update({ where: { board_slot: { board, slot } }, data: { image: pic.bytes, imageMime: pic.mime, caption: cleanText(caption, BILLBOARD.CAPTION_MAX) } });
  invalidate("bb:");
  return { board, slot };
}

/** A shown poster's picture, or null. Unpaid, hidden and empty spots never serve an image. */
export async function posterImage(db, board, slot) {
  checkBoard(board);
  const r = await db.billboardSlot.findUnique({ where: { board_slot: { board, slot: Number(slot) } }, select: { image: true, imageMime: true, status: true, hidden: true } });
  return r && r.status === "PAID" && !r.hidden && r.image ? { bytes: r.image, mime: r.imageMime } : null;
}

/** The buyer gives up an unpaid reservation. */
export async function cancelBillboardOrder(db, userId, orderId) {
  const r = await db.billboardSlot.deleteMany({ where: { orderId, ownerId: userId, status: "PENDING" } });
  invalidate("bb:");
  return { cancelled: r.count };
}