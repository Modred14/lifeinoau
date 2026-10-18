// tests/pg/jobs.pg.mjs: job shifts against a real PostgreSQL database (see harness.mjs)
import { db, reset, setGameClock, player, rq, balance, char, ok, denied, assert, done } from "./harness.mjs";
import { getCareer, jobAction } from "../../lib/careerService.js";
import { startSleep, wake } from "../../lib/sleepService.js";
await reset();
const p = await player("worker", { char: { level: 400 } });
const act = (who, body) => jobAction(db, who.uid, { requestId: rq(), ...body });
const ledgerFor = (who) => db.ledgerEntry.count({ where: { creditAccountId: who.accountId, memo: { contains: "shift" } } });
const endNow = (who) => db.$executeRawUnsafe(`UPDATE "JobShift" SET "endsAt" = now() - interval '1 second' WHERE "characterId" = '${who.id}' AND status = 'ACTIVE'`);

await setGameClock({ day: 1, minute: 8 * 60 });
await ok("pick Vendor", () => act(p, { action: "pick", job: "vendor" }));
await denied("DJ has no morning shift", async () => { await act(p, { action: "pick", job: "dj" }) ; await act(p, { action: "start", shift: "morning" }); }, /no morning shift/);
await act(p, { action: "pick", job: "vendor" });
await denied("cannot start night shift at 08:00 (opens 18:00)", () => act(p, { action: "start", shift: "night" }), /opens at 18:00/);
await denied("cannot start a shift that does not exist", () => act(p, { action: "start", shift: "afternoon" }), /no afternoon/);

// ---- simultaneous starts: exactly one wins
const ids = Array.from({ length: 8 }, rq);
const results = await Promise.allSettled(ids.map((requestId) => jobAction(db, p.uid, { requestId, action: "start", shift: "morning" })));
const winId = ids[results.findIndex((r) => r.status === "fulfilled" && !r.value.duplicate)];
const wins = results.filter((r) => r.status === "fulfilled" && !r.value.duplicate);
assert.equal(wins.length, 1, "exactly one concurrent start succeeds"); console.log("OK   8 simultaneous starts -> 1 shift");
assert.equal(await db.jobShift.count({ where: { characterId: p.id } }), 1);
let c = await char(p); assert.equal(c.energy, 90 - 15, "energy taken at clock-in (vendor morning = 15)"); console.log("OK   energy cost taken once:", c.energy);

// ---- replay of the same request changes nothing
await denied("a second start while on shift", () => act(p, { action: "start", shift: "night" }), /already on a shift/);
const again = await jobAction(db, p.uid, { requestId: winId, action: "start", shift: "morning" });
assert.ok(again.duplicate); assert.equal(await db.jobShift.count({ where: { characterId: p.id } }), 1); assert.equal((await char(p)).energy, 75); console.log("OK   replaying the winning request id is a no-op (no second shift, no second energy charge)");

// ---- cannot claim early, cannot quit/switch jobs mid-shift, cannot sleep mid-shift
await denied("claim before the shift ends", () => act(p, { action: "claim" }), /ends in/);
await denied("quit mid-shift", () => act(p, { action: "quit" }), /current shift/);
await denied("switch job mid-shift", () => act(p, { action: "pick", job: "barber" }), /current shift/);
await denied("sleep mid-shift", async () => { const it = await db.roomItem.create({ data: { characterId: p.id, key: "single_bed", placed: true, x: 1, z: 1, rot: 0, paid: 0n } }); await startSleep(db, p.uid, { bedId: it.id.toString(), requestId: rq() }); }, /on a shift/);
const cash0 = await balance(p);
let careerMid = await getCareer(db, p.uid); assert.ok(careerMid.job.active && !careerMid.job.active.done); console.log("OK   career view shows the running shift, ends in", Math.round((careerMid.job.active.endsAt - careerMid.serverNow) / 60000), "min");

// ---- finish, then claim 12 times at once: paid exactly once
await endNow(p);
const claims = await Promise.allSettled(Array.from({ length: 12 }, () => act(p, { action: "claim" })));
const paid = claims.filter((r) => r.status === "fulfilled" && r.value.paidKobo);
assert.equal(paid.length, 1, "one payout"); assert.equal(await ledgerFor(p), 1, "one ledger entry");
const gain = (await balance(p)) - cash0; assert.ok(gain >= 6000n * 100n * 1n && gain <= 12000n * 100n, "vendor morning pay within roll range: " + gain); console.log("OK   12 simultaneous claims -> 1 payout of N" + gain / 100n);
await denied("claim again", () => act(p, { action: "claim" }), /no finished shift/);
assert.equal((await char(p)).jobXp, 1);

// ---- locked until the next in-game day, even though a night shift window is open
await setGameClock({ day: 1, minute: 19 * 60 });
await denied("second shift the same day (night window open)", () => act(p, { action: "start", shift: "night" }), /already worked today/);
let cr = await getCareer(db, p.uid); assert.equal(cr.job.workedToday, true); assert.ok(cr.job.nextShiftAt > cr.serverNow); console.log("OK   next shift shown:", Math.round((cr.job.nextShiftAt - cr.serverNow) / 60000), "min away");
await setGameClock({ day: 2, minute: 9 * 60 });
cr = await getCareer(db, p.uid); assert.equal(cr.job.workedToday, false);
// refresh exploit: setting the clock back does not let a day-1 slot be reused
await setGameClock({ day: 1, minute: 8 * 60 });
await denied("rewound clock cannot reuse day 1", () => act(p, { action: "start", shift: "morning" }), /already worked today/);

// ---- next day: night shift pays a premium and costs more
await setGameClock({ day: 2, minute: 20 * 60 });
await db.character.update({ where: { id: p.id }, data: { energy: 100 } });
const n1 = await act(p, { action: "start", shift: "night" }); assert.equal(n1.energy, 18, "night = ceil(15 x 1.15)"); console.log("OK   night shift energy:", n1.energy);
const sh = await db.jobShift.findFirst({ where: { characterId: p.id, gameDay: 2 } });
assert.ok(sh.payKobo >= 7500n * 100n * 1n && sh.payKobo <= 15000n * 100n * 1n, "night pay in 1.25x range, level 0: " + sh.payKobo);
assert.equal(+sh.endsAt - +sh.startedAt, 3 * 60 * 60_000, "3 game hours"); console.log("OK   duration is 3 game hours (vendor), on the 1:1 clock");
await act(p, { action: "abandon" }); assert.equal((await db.jobShift.findFirst({ where: { id: sh.id } })).status, "ABANDONED");
await denied("abandoned shift does not allow another today", () => act(p, { action: "start", shift: "night" }), /already worked today/);
assert.equal(await ledgerFor(p), 1, "abandon pays nothing"); console.log("OK   abandon pays nothing");

// ---- weekly cap: 5 shifts a week
await reset(); const w = await player("weekly"); await db.character.update({ where: { id: w.id }, data: { jobKey: "vendor" } });
for (let d = 1; d <= 6; d++) {
  await setGameClock({ day: d, minute: 8 * 60 }); await db.character.update({ where: { id: w.id }, data: { energy: 100 } });
  if (d <= 5) { await jobAction(db, w.uid, { requestId: rq(), action: "start", shift: "morning" }); await endNow(w); await jobAction(db, w.uid, { requestId: rq(), action: "claim" }); }
  else await denied("6th shift in a week", () => jobAction(db, w.uid, { requestId: rq(), action: "start", shift: "morning" }), /5 shifts a week/);
}
// ---- energy
await reset(); const t = await player("tired", { char: { energy: 10, jobKey: "vendor" } }); await setGameClock({ day: 1, minute: 480 });
await denied("too tired to clock in", () => jobAction(db, t.uid, { requestId: rq(), action: "start", shift: "morning" }), /15 energy/);
// ---- asleep / custody
await reset(); const s = await player("sleepy", { char: { jobKey: "vendor", sleepingSince: new Date() } }); await setGameClock({ day: 1, minute: 480 });
await denied("cannot clock in asleep", () => jobAction(db, s.uid, { requestId: rq(), action: "start", shift: "morning" }), /asleep/);
await db.character.update({ where: { id: s.id }, data: { sleepingSince: null, jailedUntil: new Date(Date.now() + 600000) } });
await denied("cannot clock in in custody", () => jobAction(db, s.uid, { requestId: rq(), action: "start", shift: "morning" }), /Floor O|custody/);
console.log("DONE"); await done();
