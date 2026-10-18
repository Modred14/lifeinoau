// tests/pg/hustle.pg.mjs: the Oduduwa Hall event crew and the SUB backstairs runs against a real PostgreSQL database (see harness.mjs)
import { db, reset, setGameClock, player, rq, balance, char, ok, denied, assert, done } from "./harness.mjs";
import { startRun, finishRun, getSite, abandonRun } from "../../lib/hustleService.js";
import { travel } from "../../lib/travelService.js";
import { jobAction } from "../../lib/careerService.js";
await reset(); await setGameClock({ day: 3, minute: 10 * 60 });
const at = (p, placeId) => db.character.update({ where: { id: p.id }, data: { placeId, placeAt: new Date() } });
const go = (p, kind) => startRun(db, p.uid, { kind, requestId: rq() }), end = (p) => finishRun(db, p.uid, { requestId: rq() });
const over = (p) => db.$executeRawUnsafe(`UPDATE "HustleRun" SET "endsAt" = now() - interval '1 second' WHERE "characterId"='${p.id}' AND status='ACTIVE'`);
const gapOver = (p) => db.$executeRawUnsafe(`UPDATE "ActionLog" SET "createdAt" = now() - interval '7 hours' WHERE "characterId"='${p.id}' AND action='hustle'`);
const p = await player("hustler", { char: { energy: 100, hostel: "Awo", suspicion: 0 } });

// ---------- location
await denied("crew: not at Oduduwa Hall (at home)", () => go(p, "crew"), /Oduduwa Hall/);
await at(p, "sub"); await denied("crew: at the SUB instead", () => go(p, "crew"), /Oduduwa Hall/);
await at(p, "oduduwa"); await denied("backstairs: at Oduduwa Hall instead of the SUB", () => go(p, "backstairs"), /Student Union/);
await denied("unknown activity", () => startRun(db, p.uid, { kind: "safe", requestId: rq() }), /Unknown/);
let site = await getSite(db, p.uid, "crew"); assert.equal(site.atSite, true); assert.equal(site.blocked, null); assert.equal(site.energy, 20); assert.equal(site.durationGameMinutes, 20); console.log("OK   site panel at the hall: 20 energy, 20 game min, left today:", site.left);

// ---------- crew run: 8 parallel starts -> one run
const ids = Array.from({ length: 8 }, rq), rs = await Promise.allSettled(ids.map((requestId) => startRun(db, p.uid, { kind: "crew", requestId })));
assert.equal(rs.filter((r) => r.status === "fulfilled" && !r.value.duplicate).length, 1); assert.equal(await db.hustleRun.count({ where: { characterId: p.id } }), 1);
assert.equal((await char(p)).energy, 80); console.log("OK   8 simultaneous starts -> one run, energy taken once (100 -> 80)");
const run = await db.hustleRun.findFirst({ where: { characterId: p.id } }); assert.equal(+run.endsAt - +run.startedAt, 20 * 60_000);
assert.ok(run.payKobo >= 1_500n * 100n && run.payKobo <= 15_000n * 100n); console.log("OK   duration 20 game min; pay rolled and stored at the start:", "N" + run.payKobo / 100n);
await denied("second run while one is active", () => go(p, "crew"), /middle of a run/);
await denied("finish too early", () => end(p), /Not done yet/);
await db.character.update({ where: { id: p.id }, data: { jobKey: "vendor" } });
await setGameClock({ day: 3, minute: 10 * 60 });
await denied("clock in to a job shift mid-run", () => jobAction(db, p.uid, { requestId: rq(), action: "start", shift: "morning" }), /hustle|run|middle|shift/i);
let st = await getSite(db, p.uid, "crew"); assert.ok(st.run && !st.run.done); console.log("OK   panel shows the run in progress");

// ---------- finish: 10 parallel finishes -> one payout
await over(p); const before = await balance(p);
const fr = await Promise.allSettled(Array.from({ length: 10 }, () => end(p)));
const paid = fr.filter((r) => r.status === "fulfilled" && r.value.earnedKobo);
assert.equal(paid.length, 1); assert.equal((await balance(p)) - before, run.payKobo); assert.equal(await db.ledgerEntry.count({ where: { memo: "Event crew, Oduduwa Hall" } }), 1);
console.log("OK   10 simultaneous finishes -> one payout of N" + run.payKobo / 100n);
await denied("finish again", () => end(p), /not on a run/);

// ---------- limits: gap (a quarter of an in-game day = 6 hours) and 2 a day
await denied("second crew run inside the 6h gap", () => go(p, "crew"), /6 hour break/);
await gapOver(p); await go(p, "crew"); await over(p); await end(p); await gapOver(p);
await denied("third crew run today", () => go(p, "crew"), /both safe hustles/);
await setGameClock({ day: 4, minute: 10 * 60 }); await db.$executeRawUnsafe(`UPDATE "ActionLog" SET "createdAt" = now() - interval '25 hours' WHERE "characterId"='${p.id}'`);
await go(p, "crew"); console.log("OK   next in-game day resets the daily count"); await over(p); await end(p);

// ---------- leaving the building abandons the run
await db.$executeRawUnsafe(`UPDATE "ActionLog" SET "createdAt" = now() - interval '25 hours' WHERE "characterId"='${p.id}'`);
await go(p, "crew"); const e0 = (await char(p)).energy;
await travel(db, p.uid, { to: "library", mode: "trek", requestId: rq() });
assert.equal((await db.hustleRun.findFirst({ where: { characterId: p.id }, orderBy: { id: "desc" } })).status, "ABANDONED"); assert.equal(await db.hustleRun.count({ where: { characterId: p.id, status: "ACTIVE" } }), 0);
assert.equal((await char(p)).energy, e0); console.log("OK   travelling away abandons the run (energy stays spent, nothing paid)");

// ---------- a browser cannot teleport: arriving far away straight after arriving here is refused
await at(p, "oduduwa"); await db.character.update({ where: { id: p.id }, data: { arrivedAt: new Date() } });
await denied("teleport on foot across campus", () => travel(db, p.uid, { to: "f_agric", mode: "trek", requestId: rq() }), /not got there yet/);
assert.equal((await char(p)).placeId, "oduduwa", "and you stay where you were");
await db.character.update({ where: { id: p.id }, data: { arrivedAt: new Date(Date.now() - 2 * 3600_000) } });
await travel(db, p.uid, { to: "f_agric", mode: "trek", requestId: rq() }); console.log("OK   the same trip two hours later is allowed (a walk of that distance takes well under that)");
await db.character.update({ where: { id: p.id }, data: { arrivedAt: new Date() } });
await denied("teleport by keke in 1 second (a ride takes at least ~5 s)", () => travel(db, p.uid, { to: "f_social", mode: "keke", requestId: rq() }), /not got there yet/);
await at(p, "sub");
// ---------- backstairs at the SUB: caught / not caught
await at(p, "sub"); await db.character.update({ where: { id: p.id }, data: { energy: 100, suspicion: 0, strikes: 0 } });
site = await getSite(db, p.uid, "backstairs"); assert.equal(site.left, 1); assert.equal(site.energy, 25); assert.match(site.risk, /Low|Moderate|High/);
await go(p, "backstairs"); let r = await db.hustleRun.findFirst({ where: { characterId: p.id, kind: "backstairs" } });
assert.equal(+r.endsAt - +r.startedAt, 10 * 60_000); assert.equal((await char(p)).energy, 75); assert.equal((await char(p)).suspicion, 15); console.log("OK   backstairs: 25 energy and +15 suspicion spent at the start; 10 game min run");
await denied("second backstairs run the same day", () => go(p, "backstairs"), /already tried a risky hustle|middle of a run/);
await db.$executeRawUnsafe(`UPDATE "HustleRun" SET caught=false, "payKobo"=${300000n * 100n} WHERE id=${r.id}`); await over(p); const b1 = await balance(p);
const win = await end(p); assert.equal(win.caught, false); assert.equal((await balance(p)) - b1, 300000n * 100n); console.log("OK   clean run pays N300,000 once");

// N-QRS: force a caught outcome
await setGameClock({ day: 5, minute: 10 * 60 }); await db.$executeRawUnsafe(`UPDATE "ActionLog" SET "createdAt" = now() - interval '25 hours' WHERE "characterId"='${p.id}'`);
await db.character.update({ where: { id: p.id }, data: { energy: 100 } }); await go(p, "backstairs");
r = await db.hustleRun.findFirst({ where: { characterId: p.id, status: "ACTIVE" } }); await db.$executeRawUnsafe(`UPDATE "HustleRun" SET caught=true WHERE id=${r.id}`); await over(p);
const cash = await balance(p), dsa = await db.account.findUnique({ where: { systemName: "DSA" } });
const credited = async () => (await db.ledgerEntry.aggregate({ where: { creditAccountId: dsa.id }, _sum: { amount: true } }))._sum.amount ?? 0n, dsaBefore = await credited();
const arrest = await end(p); assert.equal(arrest.caught, true);
const dsaAfter = await credited(), c = await char(p);
assert.equal(dsaAfter - dsaBefore, (cash * 30n) / 100n, "30% seized"); assert.ok(c.jailedUntil && +c.jailedUntil > Date.now()); assert.equal(c.strikes, 1); assert.equal(c.placeId, "floor0", "held inside Floor O"); assert.equal((await db.floorZero.findFirst({ where: { characterId: p.id } })).location, "floor0");
assert.equal(await db.floorZero.count({ where: { characterId: p.id } }), 1); console.log("OK   caught: 30% seized to the QRS, sentenced to Floor O, strike added");
await denied("in custody: cannot start another hustle", () => go(p, "backstairs"), /Floor O|custody/);
await denied("in custody: cannot walk out", () => travel(db, p.uid, { to: "library", mode: "trek", requestId: rq() }), /Floor O/);

// ---------- asleep / shift
await reset(); await setGameClock({ day: 1, minute: 600 }); const s = await player("sleepy", { char: { sleepingSince: new Date(), placeId: "oduduwa" } });
await denied("cannot hustle asleep", () => go(s, "crew"), /asleep/);
await db.character.update({ where: { id: s.id }, data: { sleepingSince: null, jobKey: "vendor" } });
await jobAction(db, s.uid, { requestId: rq(), action: "start", shift: "morning" }); await denied("cannot hustle on a job shift", () => go(s, "crew"), /job shift/);
console.log("DONE"); await done();
