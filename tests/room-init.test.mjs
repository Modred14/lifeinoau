// tests/room-init.test.mjs
// First entry into the game: the player's room must come with its furniture, with no reload.
// Covers the real cause of the "room without furniture right after sign-up" bug: the game screen opened (instantly) while the request that
// creates the home was still running, so the room was asked for too early, was refused, and nothing ever asked again.
// Pure Node: an in-memory stand-in for the database, no browser.
import assert from "node:assert/strict";
import { holdRoomUntil, waitForRoomGate, roomGateOpen } from "../lib/roomGate.js";
import { chooseHostelWithRoom, getRoom } from "../lib/roomService.js";
import { createStore } from "../lib/optimistic.js";
import { starterFor } from "../lib/furniture.js";
import { occupantsFor } from "../lib/rules.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };

// ---- the gate ----
chk("with nothing running the gate is open at once", !roomGateOpen() && (await waitForRoomGate()) === undefined);
{ let done = false; const p = holdRoomUntil(sleep(40).then(() => { done = true; return "ok"; }));
  chk("holdRoomUntil hands the request's own promise back", (await p) === "ok");
  await waitForRoomGate(); chk("the gate waits for the request, then opens", done && !roomGateOpen());
  const bads = holdRoomUntil(Promise.reject(new Error("boom"))); await bads.catch(() => {}); await waitForRoomGate(); chk("a failed request also opens the gate (the room then reports the real problem)", !roomGateOpen()); }
{ const order = []; const a = holdRoomUntil(sleep(30).then(() => order.push("a"))), b = holdRoomUntil(sleep(60).then(() => order.push("b")));
  await waitForRoomGate(); chk("it waits for ALL requests, including ones added while waiting", order.join() === "a,b"); await Promise.all([a, b]); }

// ---- a tiny in-memory database: just what roomService touches ----
function fakeDb() {
  const chars = new Map(), items = [], accounts = new Map([[1, { id: 1, balance: 5_000_000n }]]);
  let nextItem = 1n, writeLog = [];
  const char = (id) => chars.get(id) && { ...chars.get(id), account: accounts.get(chars.get(id).accountId) };
  const tx = {
    gameClock: { findUnique: async () => ({ id: 1, startedAt: new Date(Date.now() - 3 * 86400_000), campusEpoch: new Date(Date.now() - 3 * 86400_000) }) },
    character: {
      findUnique: async ({ where, include }) => { const c = where.id != null ? chars.get(where.id) : [...chars.values()].find((x) => x.userId === where.userId); return c ? (include?.account ? char(c.id) : { ...c }) : null; },
      updateMany: async ({ where, data }) => { const c = chars.get(where.id); if (!c || (where.hostel !== undefined && c.hostel !== where.hostel)) return { count: 0 }; Object.assign(c, data); writeLog.push("hostel"); return { count: 1 }; },
    },
    account: { findUnique: async ({ where }) => accounts.get(where.id) },
    roomItem: {
      findMany: async ({ where }) => items.filter((r) => r.characterId === where.characterId).sort((a, b) => (a.id < b.id ? -1 : 1)),
      create: async ({ data }) => { const r = { id: nextItem++, ...data }; items.push(r); writeLog.push("item"); return r; },
      deleteMany: async ({ where }) => { const ids = new Set(where.id.in); for (let i = items.length - 1; i >= 0; i--) if (ids.has(items[i].id)) items.splice(i, 1); },
      update: async ({ where, data }) => Object.assign(items.find((r) => r.id === where.id), data),
    },
    $queryRaw: async () => [],
  };
  const db = { ...tx, $transaction: async (fn) => fn(tx) };
  return { db, chars, items, writeLog: () => writeLog };
}
const player = (hostel = "") => ({ id: 7, userId: "u1", accountId: 1, hostel, sessionStartWeek: 1, class: "MAPO", gender: "M", level: 100 });

// ---- choosing a hostel creates the home AND its furniture in one step ----
for (const hostel of ["Awo", "Angola", "Ojaja", "Off-campus"]) {
  const f = fakeDb(); f.chars.set(7, player());
  chk(`${hostel}: choosing it saves the hostel`, (await chooseHostelWithRoom(f.db, 7, hostel)) === true && f.chars.get(7).hostel === hostel);
  const want = starterFor(hostel, occupantsFor(hostel, 7)).slice().sort().join();
  chk(`${hostel}: the starter furniture exists the moment the hostel does`, f.items.map((r) => r.key).sort().join() === want && f.items.length > 0);
  chk(`${hostel}: every starter piece is placed in the room`, f.items.every((r) => r.placed && r.x != null));
  const seen = await getRoom(f.db, "u1");
  chk(`${hostel}: the first read of the room is complete (same pieces, same places)`, seen.items.length === f.items.length && seen.room.hostel === hostel);
  const before = f.items.length; await getRoom(f.db, "u1"); await getRoom(f.db, "u1");
  chk(`${hostel}: reading the room again never duplicates or resets furniture`, f.items.length === before && new Set(f.items.map((r) => r.id)).size === before);
}
{ const f = fakeDb(); f.chars.set(7, player());
  const [a, b] = await Promise.all([chooseHostelWithRoom(f.db, 7, "Awo"), chooseHostelWithRoom(f.db, 7, "Awo")]);
  chk("a double tap on the hostel changes nothing twice", a !== b && f.items.length === starterFor("Awo", occupantsFor("Awo", 7)).length); }
{ const f = fakeDb(); f.chars.set(7, player("Awo"));
  chk("choosing again after a hostel is already set is refused", (await chooseHostelWithRoom(f.db, 7, "Fajuyi")) === false && f.chars.get(7).hostel === "Awo" && f.items.length === 0); }

// ---- the screen's side: the room store must not ask before the home exists ----
// A fake server that behaves like /api/room: refused until the hostel request has finished.
function fakeServer() { const s = { hostel: false, calls: 0 };
  s.postHostel = async () => { await sleep(60); s.hostel = true; return { ok: true, status: 200 }; };
  s.getRoom = async () => { s.calls++; await sleep(5); return s.hostel ? { room: { w: 8, d: 6 }, items: [{ id: "1", key: "wardrobe" }], status: 200 } : { failed: true, status: 409, error: "Choose where to live first." }; };
  return s; }
{ // before the fix: the game opens at once and asks for the room straight away
  const s = fakeServer(), store = createStore(() => s.getRoom()); const post = s.postHostel(); const r = await store.refresh(); await post;
  chk("WITHOUT the gate the room is asked for too early and refused (the old bug)", r.failed && r.status === 409 && store.get() === null); }
{ // after the fix
  const s = fakeServer(), store = createStore(async () => { await waitForRoomGate(); return s.getRoom(); });
  const post = holdRoomUntil(s.postHostel()); const r = await store.refresh(); await post;
  chk("WITH the gate the room is asked for only after the home exists", !r.failed && s.calls === 1);
  chk("and its furniture is in the store straight away, with no reload", store.get()?.items?.length === 1 && store.get().room.w === 8); }
{ // the screen kept showing something for a moment: the second refresh (a quiet re-check) never wipes furniture
  const s = fakeServer(); s.hostel = true; const store = createStore(async () => { await waitForRoomGate(); return s.getRoom(); });
  await store.refresh(); const first = store.get(); await store.refresh();
  chk("a later refresh keeps the same furniture", store.get().items.length === first.items.length); }
{ // a refused room keeps nothing, so the screen can show its error and a retry that works
  const s = fakeServer(), store = createStore(() => s.getRoom()); const r1 = await store.refresh(); s.hostel = true; const r2 = await store.refresh();
  chk("a failed first load can be retried and then fills in by itself", r1.failed && !r2.failed && store.get()?.items?.length === 1); }

console.log(bad ? `\n${bad} check(s) failed` : "\nAll room-initialisation checks passed"); process.exit(bad ? 1 : 0);
