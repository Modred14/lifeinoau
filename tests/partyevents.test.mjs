// tests/partyevents.test.mjs: the Parties app's events: input checks, admin operations and what players see. No database needed.
import assert from "node:assert/strict";
import { parseFlyer, parseTicketUrl, cleanName, listEvents, EventInputError, KEEP_AFTER_START_MS } from "../lib/partyEvents.js";
import { createEvent, updateEvent, deleteEvent } from "../lib/adminEvents.js";
import { AdminError } from "../lib/adminCore.js";

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(200, 1)]);
const png64 = "data:image/png;base64," + png.toString("base64");

// flyer
assert.equal(parseFlyer(png64).mime, "image/png");
assert.throws(() => parseFlyer("data:image/png;base64," + Buffer.alloc(200, 7).toString("base64")), EventInputError, "wrong signature refused");
assert.throws(() => parseFlyer("data:image/svg+xml;base64,AAAA"), EventInputError, "svg refused");
assert.throws(() => parseFlyer(null), EventInputError);
assert.throws(() => parseFlyer("data:image/png;base64," + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(700_000)]).toString("base64")), /too big/);

// ticket link: web addresses only, because players are sent straight to it
assert.equal(parseTicketUrl("https://tix.example.com/e/1"), "https://tix.example.com/e/1");
for (const bad of ["", "javascript:alert(1)", "data:text/html,hi", "tix.example.com", "ftp://x.com/a"]) assert.throws(() => parseTicketUrl(bad), EventInputError, bad);
assert.throws(() => cleanName("a", "The host", 80), EventInputError);

// a fake database that keeps the events and the audit log in memory
function fakeDb() {
  const events = [], audit = []; let id = 0;
  const tx = {
    partyEvent: {
      create: async ({ data }) => { const e = { id: ++id, createdAt: new Date(), updatedAt: new Date(), ...data }; events.push(e); return e; },
      findUnique: async ({ where }) => events.find((e) => e.id === where.id) ?? null,
      update: async ({ where, data }) => { Object.assign(events.find((e) => e.id === where.id), data, { updatedAt: new Date() }); },
      delete: async ({ where }) => { events.splice(events.findIndex((e) => e.id === where.id), 1); },
      findMany: async ({ where }) => events.filter((e) => e.eventDate >= where.eventDate.gte).sort((a, b) => a.eventDate - b.eventDate || a.id - b.id),
    },
    auditLog: {
      findFirst: async ({ where }) => audit.find((a) => a.actorId === where.actorId && a.requestId === where.requestId && a.status === where.status) ?? null,
      create: async ({ data }) => { audit.push(data); return data; },
    },
  };
  return { ...tx, $transaction: async (fn) => fn(tx), events, audit };
}

const db = fakeDb(), soon = new Date(Date.now() + 86_400_000).toISOString();
const body = (o = {}) => ({ name: "Freshers Night", host: "Hall 4", price: "2,500.50", date: soon, ticketUrl: "https://tix.example.com/f", flyer: png64, requestId: "req-aaaaaaaa", ...o });

const made = await createEvent(db, "admin1", body());
assert.equal(made.ok, true);
assert.equal(db.events[0].priceKobo, 250050n, "price kept exactly in kobo");
assert.equal(db.audit.at(-1).action, "EVENT:CREATE");

assert.equal((await createEvent(db, "admin1", body())).duplicate, true, "the same request never adds the event twice");
assert.equal(db.events.length, 1);

// several events in one week are fine
await createEvent(db, "admin1", body({ name: "Rooftop Party", requestId: "req-bbbbbbbb", date: new Date(Date.now() + 2 * 86_400_000).toISOString() }));
await createEvent(db, "admin1", body({ name: "Free Jam", price: "", requestId: "req-cccccccc", date: new Date(Date.now() + 3 * 86_400_000).toISOString() }));
assert.equal(db.events.length, 3);
assert.equal(db.events[2].priceKobo, 0n, "an empty price field means free");

// bad input is refused with a message the administrator can read, and nothing is stored
for (const [o, re] of [[{ flyer: undefined }, /flyer/i], [{ name: "x" }, /name/i], [{ ticketUrl: "javascript:alert(1)" }, /web address|http/i], [{ date: "nope" }, /date/i], [{ price: "12.345" }, /decimal/i], [{ price: "-5" }, /number/i]]) {
  await assert.rejects(createEvent(db, "admin1", body({ ...o, requestId: "req-dddddddd" })), (e) => e instanceof AdminError && re.test(e.message), JSON.stringify(Object.keys(o)));
}
assert.equal(db.events.length, 3);

// players see events soonest first, and a party that started a few hours ago is still listed
const list = await listEvents(db);
assert.deepEqual(list.events.map((e) => e.name), ["Freshers Night", "Rooftop Party", "Free Jam"]);
assert.equal(list.events[0].priceKobo, "250050");
assert.ok(list.events[0].flyer.startsWith("/api/parties/flyer?id=1&v="));
assert.equal("flyer" in db.events[0] && JSON.stringify(list).includes("iVBOR"), false, "picture bytes never travel in the list");
db.events.push({ id: 99, name: "Old", host: "x", priceKobo: 0n, ticketUrl: "https://x.com", eventDate: new Date(Date.now() - KEEP_AFTER_START_MS - 60_000), updatedAt: new Date() });
assert.equal((await listEvents(db)).events.some((e) => e.name === "Old"), false, "old events drop off");
db.events.pop();

// edit: the flyer is kept unless a new one is sent
const before = db.events[0].flyer;
await updateEvent(db, "admin1", body({ id: 1, name: "Freshers Night II", flyer: undefined, requestId: "req-eeeeeeee" }));
assert.equal(db.events[0].name, "Freshers Night II");
assert.equal(db.events[0].flyer, before);
await assert.rejects(updateEvent(db, "admin1", body({ id: 42, requestId: "req-ffffffff" })), /no longer exists/);

// delete
await deleteEvent(db, "admin1", { id: 2, requestId: "req-gggggggg" });
assert.deepEqual(db.events.map((e) => e.id), [1, 3]);
await assert.rejects(deleteEvent(db, "admin1", { id: 2, requestId: "req-hhhhhhhh" }), /no longer exists/);
assert.ok(db.audit.some((a) => a.action === "EVENT:DELETE" && a.status === "OK"));
assert.ok(db.audit.some((a) => a.status === "FAILED"), "failed attempts are recorded too");

console.log("party events: all checks passed");
