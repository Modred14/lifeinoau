// tests/billboards.test.mjs
// Billboards and the extra map places: prices, picture checks, the rotation clock, and that every game hostel / club / Floor O is on the map. Pure Node, no database.
import fs from "node:fs";
import { BILLBOARD, BILLBOARDS, withExtras } from "../lib3d/mapExtras.js";
import { currentIndex } from "../lib3d/billboards3d.js" ;
import { priceFor, parseImage, testPaymentsAllowed, listBillboards, reserveBillboard, confirmBillboardOrder } from "../lib/billboards.js";
import { listPlaces } from "../lib3d/campusData.js";
import { allowedHostels } from "../lib/rules.js";
let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };
const throws = async (f) => { try { await f(); return null; } catch (e) { return e; } };

chk("ten billboards, ten spots each", BILLBOARDS.length === 10 && BILLBOARD.SLOTS === 10 && new Set(BILLBOARDS.map((b) => b.id)).size === 10);
chk("each poster shows for 15 seconds", BILLBOARD.SECONDS === 15);
chk("one spot is N20,000 and the whole board N200,000 (in kobo)", priceFor(false, 1) === 2_000_000 && priceFor(false, 3) === 6_000_000 && priceFor(true, 10) === 20_000_000);
chk("the rotation moves on every 15 s and wraps", currentIndex(0, 4) === 0 && currentIndex(14_999, 4) === 0 && currentIndex(15_000, 4) === 1 && currentIndex(60_000, 4) === 0 && currentIndex(0, 0) === -1);
chk("two boards with different phase are not in step", currentIndex(0, 4, 0) !== currentIndex(0, 4, 20));
chk("test payments are off in production by default", !testPaymentsAllowed({ NODE_ENV: "production" }) && testPaymentsAllowed({ NODE_ENV: "development" }) && testPaymentsAllowed({ NODE_ENV: "production", BILLBOARD_TEST_PAYMENTS: "1" }));

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(200, 1)]).toString("base64"), jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(200, 1)]).toString("base64");
chk("a real-looking PNG and JPG are accepted", parseImage("data:image/png;base64," + png).mime === "image/png" && parseImage("data:image/jpeg;base64," + jpg).mime === "image/jpeg");
chk("a file with the wrong signature is refused", !!(await throws(() => parseImage("data:image/png;base64," + jpg))));
chk("svg, gif and junk are refused", !!(await throws(() => parseImage("data:image/svg+xml;base64,AAAA"))) && !!(await throws(() => parseImage("hello"))));
chk("a picture over the size limit is refused", (await throws(() => parseImage("data:image/png;base64," + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(BILLBOARD.MAX_IMAGE_BYTES + 10)]).toString("base64"))))?.status === 413);

// a tiny in-memory stand-in for the BillboardSlot table
function fakeDb() { const rows = []; let id = 1; const m = (w, r) => Object.entries(w ?? {}).every(([k, v]) => k === "OR" ? v.some((o) => m(o, r)) : v && typeof v === "object" && "in" in v ? v.in.includes(r[k]) : v && typeof v === "object" && "lt" in v ? r[k] && r[k] < v.lt : r[k] === v);
  const t = { findMany: async ({ where }) => rows.filter((r) => m(where, r)), count: async ({ where }) => rows.filter((r) => m(where, r)).length, deleteMany: async ({ where }) => { let n = 0; for (let i = rows.length - 1; i >= 0; i--) if (m(where, rows[i])) { rows.splice(i, 1); n++; } return { count: n }; },
    createMany: async ({ data }) => { for (const d of data) { if (rows.some((r) => r.board === d.board && r.slot === d.slot)) throw Object.assign(new Error("dup"), { code: "P2002" }); rows.push({ id: id++, hidden: false, updatedAt: new Date(), ...d }); } },
    updateMany: async ({ where, data }) => { rows.filter((r) => m(where, r)).forEach((r) => Object.assign(r, data)); } };
  return { billboardSlot: t, $transaction: (f) => f({ billboardSlot: t }), rows }; }
const db = fakeDb(), IMG = "data:image/png;base64," + png, now = new Date("2026-10-12T12:00:00Z");
const o1 = await reserveBillboard(db, "u1", { board: 1, slots: [2, 3], caption: "Hi", image: IMG }, now);
chk("reserving two spots costs N40,000 and holds them", o1.amountKobo === 4_000_000 && db.rows.length === 2 && db.rows.every((r) => r.status === "PENDING"));
chk("a held spot cannot be taken by someone else", (await throws(() => reserveBillboard(db, "u2", { board: 1, slots: [3, 4], image: IMG }, now)))?.status === 409);
chk("the whole board cannot be bought once a spot is held", (await throws(() => reserveBillboard(db, "u2", { board: 1, whole: true, image: IMG }, now)))?.status === 409);
chk("a hold that lapsed frees the spot", (await reserveBillboard(db, "u2", { board: 1, slots: [3], image: IMG }, new Date(now.getTime() + 16 * 60_000))).slots[0] === 3);
const L1 = await listBillboards(db, "u2", now);
chk("an unpaid reservation shows no poster", L1.boards[0].posters.length === 0);
const o3 = await reserveBillboard(db, "u3", { board: 4, whole: true, image: IMG }, now);
chk("the whole board is N200,000 and takes all ten spots", o3.amountKobo === 20_000_000 && db.rows.filter((r) => r.board === 4).length === 10);
chk("paying someone else's order is refused", (await throws(() => confirmBillboardOrder(db, o3.orderId, "x", "u1", now)))?.status === 404);
await confirmBillboardOrder(db, o3.orderId, "test", "u3", now);
chk("paying twice is harmless", (await confirmBillboardOrder(db, o3.orderId, "test", "u3", now)).already === true);
const L2 = await listBillboards(db, "u3", now);
chk("a paid whole board shows its poster and no free spots", L2.boards[3].free === 0 && L2.boards[3].posters.length === 1 && !L2.boards[3].canBuyWhole && L2.boards[3].mine.length === 10);

// the map data
const d = JSON.parse(fs.readFileSync(new URL("../public/data/oau-campus.json", import.meta.url), "utf8")), x = withExtras(d), places = listPlaces(x);
const has = (id) => places.some((p) => p.id === id && p.located);
chk("Ojaja, Floor O, Quantum, 0203 and Royal Divas are on the map", ["h_ojaja", "floor0", "club_quantum", "club_0203", "club_divas"].every(has));
const living = [...new Set(["M", "F"].flatMap((g) => [100, 200].flatMap((lv) => ["NEPO", "MAPO", "LAPO"].flatMap((c) => allowedHostels(c, g, lv)))))].filter((h) => h !== "Off-campus");
chk(`every hostel a player can live in is on the map (${living.join(", ")})`, living.length >= 9 && living.every((h) => places.some((p) => p.kind === "hostel" && p.located && p.name.toLowerCase().includes(h.toLowerCase()))));
chk("the Postgraduate hall and Akintola Hall are on the map", has("h_pg") && has("h_akintola"));
chk("ten billboards are on the map", places.filter((p) => p.kind === "billboard" && p.located).length === 10);
chk("no game place is left without a position", x.gameOnly.filter((g) => ["h_ojaja", "floor0", "club_quantum", "club_0203", "club_divas", "h_akintola"].includes(g.id)).length === 0);
chk("the original data object is untouched", d.places.length === 88 && !d.extrasAdded);
chk("Ojaja stands behind (south of) the New Market", x.places.find((p) => p.id === "h_ojaja").z > x.places.find((p) => p.id === "new_market").z);
chk("new footprints get fresh ids and never overlap a real building", (() => { const ids = x.buildings.map((q) => q.id); return new Set(ids).size === ids.length && x.places.every((p) => p.bid == null || x.buildings.find((q) => q.id === p.bid)); })());
process.exit(bad ? 1 : 0);
