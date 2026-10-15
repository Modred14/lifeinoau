// lib/chatShared.js
// Small pure helpers used by BOTH the servers and the browser, so a message means the same thing everywhere.
// No imports on purpose: the browser bundle and the plain-Node realtime server can both load this file.

export const MAX_BODY = 500;
export const MAX_NOTE = 80;
export const PREVIEW_LEN = 60;
export const KIND = { TEXT: 0, MONEY: 1 };

// control characters (except new lines), zero-width and "right to left override" characters are removed: they are used to fake names and hide text
const BAD = /[\u0000-\u0009\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
/** A chat message as it is stored: tidy, new lines kept (never more than one blank line), at most 500 characters. */
export const cleanBody = (s, max = MAX_BODY) =>
  String(s ?? "").replace(/\r\n?/g, "\n").replace(BAD, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);

export const naira = (n) => "₦" + Number(n || 0).toLocaleString("en-NG");

/** A money note is stored as "<whole naira>" or "<whole naira>\n<note>". */
export const moneyBody = (nairaAmount, note = "") => {
  const n = cleanBody(note, MAX_NOTE).replace(/\n/g, " ");
  return n ? `${Math.trunc(Number(nairaAmount))}\n${n}` : String(Math.trunc(Number(nairaAmount)));
};
export const parseMoney = (body = "") => {
  const i = body.indexOf("\n"), n = Number(i < 0 ? body : body.slice(0, i));
  return { naira: Number.isFinite(n) ? n : 0, note: i < 0 ? "" : body.slice(i + 1) };
};

/** The one-line preview kept on the Chat row (so old messages can be pruned and the inbox still has something to show). */
export const previewOf = (kind, body) => (kind === KIND.MONEY ? naira(parseMoney(body).naira) : String(body).replace(/\s+/g, " ").trim().slice(0, PREVIEW_LEN));

/** The tick under one of my messages: sent (one grey tick), delivered (two grey), read (two blue). `id` is null until the server has it. */
export const tickOf = (id, peerDel, peerRead) => (id == null ? "sent" : id <= peerRead ? "read" : id <= peerDel ? "delivered" : "sent");

/** Two players' ids in a fixed order (plain text comparison, the same rule the database migration used), so a pair has exactly one chat. */
export const pairOf = (x, y) => (x < y ? [x, y] : [y, x]);