// tests/pg/sleep.pg.mjs: sleep and energy against a real PostgreSQL database (see harness.mjs)
import { db, reset, setGameClock, player, rq, char, ok, denied, assert, done, MIN } from "./harness.mjs";
import { startSleep, wake, getSleep } from "../../lib/sleepService.js";
import { SLEEP } from "../../lib/sleep.js";
await reset(); await setGameClock({ day: 1, minute: 22 * 60 });
const bed = (p, key = "single_bed", placed = true) => db.roomItem.create({ data: { characterId: p.id, key, placed, x: 1, z: 1, rot: 0, paid: 0n } });
const sleptFor = (p, gameMinutes) => db.$executeRawUnsafe(`UPDATE "Character" SET "sleepingSince" = now() - interval '${gameMinutes} minutes' WHERE id = '${p.id}'`);
const p = await player("sleeper", { char: { energy: 20, health: 70 } }), b = await bed(p), other = await player("neighbour"), ob = await bed(other);
const sleep = (who, bedId, extra = {}) => startSleep(db, who.uid, { bedId: String(bedId), requestId: rq(), ...extra });

await denied("cannot sleep in someone else's bed", () => sleep(p, ob.id), /own room/);
await denied("cannot sleep on a bed that is not placed", async () => { const un = await bed(p, "single_bed", false); await sleep(p, un.id); }, /own room/);
await denied("cannot 'sleep' on a non-bed item", async () => { const d = await bed(p, "desk"); await sleep(p, d.id); }, /own room/);
await denied("no bed id at all", () => sleep(p, undefined), /own room/);
const s0 = await sleep(p, b.id); assert.ok(s0.ok && !s0.duplicate); console.log("OK   lie down in own bed; server stored the moment:", !!(await char(p)).sleepingSince);
await denied("already asleep", () => sleep(p, b.id), /already asleep/);
const st = await getSleep(db, p.uid); assert.equal(st.sleeping, true);

// a client cannot choose how long it slept: wake straight away = nothing restored
let r = await wake(db, p.uid, { bedId: String(b.id), requestId: rq() });
assert.equal(r.restored, 0); assert.equal(r.energy, 20); console.log("OK   waking at once restores nothing (dozed", r.minutes, "game min)");
await sleep(p, b.id);
// 2 hours -> 120 min x 0.5 = 60
await sleptFor(p, 120); const ids = Array.from({ length: 6 }, rq);
const rs = await Promise.allSettled(ids.map((requestId) => wake(db, p.uid, { bedId: String(b.id), requestId })));
const applied = rs.filter((x) => x.status === "fulfilled" && x.value.restored > 0);
assert.equal(applied.length, 1, "6 simultaneous wakes restore once"); let c = await char(p);
assert.equal(c.energy, 80, "20 + 2h x 30/h = 80"); assert.equal(c.sleepingSince, null); assert.equal(c.health, 71, "+1 health per 2h slept: 70 + 1");
console.log("OK   2 hours -> +60 energy (20 -> 80), health +1, 6 simultaneous wakes applied once");
r = await wake(db, p.uid, { bedId: String(b.id), requestId: rq() }); assert.ok(r.awake && (await char(p)).energy === 80); console.log("OK   waking again when awake does nothing");

// longer sleep restores more, capped at 100
await db.character.update({ where: { id: p.id }, data: { energy: 10 } }); await sleep(p, b.id); await sleptFor(p, 30);
let a = await wake(db, p.uid, { bedId: String(b.id), requestId: rq() });
await db.character.update({ where: { id: p.id }, data: { energy: 10 } }); await sleep(p, b.id); await sleptFor(p, 180);
let z = await wake(db, p.uid, { bedId: String(b.id), requestId: rq() });
assert.ok(z.restored > a.restored); assert.equal(a.restored, 15); assert.equal(z.restored, 90); console.log("OK   30 min -> +15, 3h -> +90: longer sleep restores more");
await db.character.update({ where: { id: p.id }, data: { energy: 50 } }); await sleep(p, b.id); await sleptFor(p, 24 * 60);
z = await wake(db, p.uid, { bedId: String(b.id), requestId: rq() }); assert.equal(z.energy, 100); assert.equal(z.rested, true); console.log("OK   24h in bed still capped at 100 energy");
// double bed recovers faster, bunk slower
const dbl = await bed(p, "double_bed"), bunk = await bed(p, "iron_bunk");
for (const [it, want] of [[dbl, 75], [bunk, 51]]) { await db.character.update({ where: { id: p.id }, data: { energy: 0 } }); await sleep(p, it.id); await sleptFor(p, 120); const w = await wake(db, p.uid, { bedId: String(it.id), requestId: rq() }); assert.equal(w.energy, want, it.key); }
console.log("OK   double bed +75 / iron bunk +51 over the same 2h (plain bed +60)");

// the wake-up rate comes from the bed the SERVER put you in, whatever bed id the browser sends when waking
await db.character.update({ where: { id: p.id }, data: { energy: 0 } }); await sleep(p, bunk.id); await sleptFor(p, 120);
const cheat = await wake(db, p.uid, { bedId: String(dbl.id), requestId: rq() }); assert.equal(cheat.energy, 51, "slept in the bunk, so bunk rate even though the double bed id was sent"); console.log("OK   client cannot pick a better bed at wake-up (bunk rate applied)");
// not tired
await db.character.update({ where: { id: p.id }, data: { energy: 99 } }); await denied("not tired", () => sleep(p, b.id), /not tired/);
// custody
const j = await player("caught", { char: { energy: 10, jailedUntil: new Date(Date.now() + 3600000) } }); const jb = await bed(j);
await denied("cannot sleep in QRS custody (escape)", () => sleep(j, jb.id), /custody/);
// asleep players cannot do other things that need them awake: covered by awake:true in loadLocked (jobs). Check a replay:
const q = await player("replay", { char: { energy: 10 } }), qb = await bed(q), rid = rq();
await startSleep(db, q.uid, { bedId: String(qb.id), requestId: rid }); const dup = await startSleep(db, q.uid, { bedId: String(qb.id), requestId: rid });
assert.ok(dup.duplicate); console.log("OK   replayed sleep request is a no-op");
// refresh: state survives (persistence) because it lives in the database
const re = await getSleep(db, q.uid); assert.equal(re.sleeping, true); console.log("OK   sleeping state persists across reloads (database, not browser)");
console.log("DONE"); await done();
