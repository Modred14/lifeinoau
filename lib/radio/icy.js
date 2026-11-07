// lib/radio/icy.js
// What is playing on a radio station, read from the stream itself. Internet radio (Shoutcast / Icecast) can carry the current track in the audio: ask for it with the
// request header "Icy-MetaData: 1", and the server answers with "icy-metaint: N" and puts a small text block after every N bytes of audio, like  StreamTitle='Artist - Song';
// Browsers cannot read it from an <audio> element, so the server (src/app/api/radio/meta/route.js) reads the first block and the radio panel shows the result.
// Pure JS (works on bytes), so it is tested without a network.

/** "StreamTitle='Artist - Song';StreamUrl='';" -> "Artist - Song" (or "" when there is none). Tolerates apostrophes inside the title. */
export function parseStreamTitle(block) {
  const m = /StreamTitle='([\s\S]*?)';(?:\s*Stream\w+=|\s*$|\u0000)/.exec(block) ?? /StreamTitle='([\s\S]*?)'/.exec(block);
  return m ? m[1].replace(/\u0000/g, "").trim() : "";
}
/** "Artist - Song" -> { artist, track }. Without a " - ", the whole text is the track. Returns null for empty or placeholder titles. */
export function splitTitle(title) {
  const t = String(title ?? "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 200 || /^(unknown|n\/a|-|null|undefined|live|advert(isement)?)$/i.test(t)) return null;
  const i = t.indexOf(" - ");
  return i > 0 ? { artist: t.slice(0, i).trim(), track: t.slice(i + 3).trim() } : { artist: "", track: t };
}
/**
 * Reads the first metadata block of a stream. `read` is an async function returning the next Uint8Array chunk (or null at the end), `metaint` the interval from the header.
 * Returns the raw text of the block ("" if the first block is empty: most stations send an empty block between changes), or null if the stream ends before it.
 * Never reads more than metaint + 4096 bytes.
 */
export async function readIcyBlock(read, metaint) {
  if (!Number.isInteger(metaint) || metaint < 1 || metaint > 65536) return null;
  let buf = new Uint8Array(0), need = metaint + 1;
  const push = (c) => { const n = new Uint8Array(buf.length + c.length); n.set(buf); n.set(c, buf.length); buf = n; };
  while (buf.length < need) { const c = await read(); if (!c) return null; push(c); if (buf.length > metaint + 4096 + 1) break; }
  if (buf.length < need) return null;
  const len = buf[metaint] * 16; if (len === 0) return "";
  need = metaint + 1 + len; while (buf.length < need) { const c = await read(); if (!c) return null; push(c); }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(metaint + 1, need));
}
