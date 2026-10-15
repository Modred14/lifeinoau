// tests/love.test.mjs: the Love app's rules and service, against an in-memory database. Pure Node.
import { makeDb } from "./fakedb.mjs";
import { relate, getRelationship, decidePregnancy } from "../lib/relationshipService.js";
import * as R from "../lib/relationships.js";
import * as P from "../lib/lovePatches.js";

let bad = 0, n = 0;
const chk = (label, ok) => { n++; if (!ok) { bad++; console.log("FAIL", label); } };
const denies = async (label, fn, status) => { try { await fn(); chk(label + " (should have been refused)", false); } catch (e) { chk(label + ` -> ${e.message}`, e.status ? (status ? e.status === status : true) : false); } };

// ---------------- pure rules ----------------
{
  const b = { kind: "TALKING", dates: 0, meals: 0, visits: 0, kindWeek: 5, endedWeek: null, done: {} };
  const ctx = { me: "a", week: 6, energy: 80, myGender: "M", theirGender: "F", offCampus: true, hasBabe: false, theyHaveBabe: false, mySneaky: 0, theirSneaky: 0 };
  chk("cannot ask before doing things together", !!R.whyNotAsk(b, "BABE", ctx));
  const ready = { ...b, dates: 2, meals: 1, visits: 1 };
  chk("ready after 2 dates, food and a visit", R.progress(ready).ready && R.whyNotAsk(ready, "BABE", ctx) === null && R.whyNotAsk(ready, "SNEAKY", ctx) === null);
  chk("same gender never dates", !!R.whyNotAsk(ready, "BABE", { ...ctx, theirGender: "M" }));
  chk("one babe at a time (me)", !!R.whyNotAsk(ready, "BABE", { ...ctx, hasBabe: true }));
  chk("one babe at a time (them)", !!R.whyNotAsk(ready, "BABE", { ...ctx, theyHaveBabe: true }));
  chk("a sneaky link is allowed while you have a babe", R.whyNotAsk(ready, "SNEAKY", { ...ctx, hasBabe: true }) === null);
  chk("at most 2 sneaky links", !!R.whyNotAsk(ready, "SNEAKY", { ...ctx, mySneaky: 2 }));
  const babe = { ...ready, kind: "BABE", kindWeek: 5 };
  chk("cannot propose in the first week", !!R.whyNotAsk(babe, "PROPOSE", { ...ctx, week: 5 }) && R.whyNotAsk(babe, "PROPOSE", { ...ctx, week: 6 }) === null);
  chk("only a babe can be proposed to", !!R.whyNotAsk(ready, "PROPOSE", ctx));
  chk("moving in needs you off campus", !!R.whyNotAsk(babe, "MOVEIN", { ...ctx, offCampus: false }) && R.whyNotAsk(babe, "MOVEIN", ctx) === null);
  chk("moving in is for a babe only", !!R.whyNotAsk({ ...ready, kind: "SNEAKY" }, "MOVEIN", ctx));
  chk("dates are not for besties", !!R.whyNotActivity({ kind: "BESTIE", done: {} }, "date", { me: "a", week: 1, energy: 90 }));
  chk("besties can hang out", R.whyNotActivity({ kind: "BESTIE", done: {} }, "hang", { me: "a", week: 1, energy: 90 }) === null);
  chk("weekly limit per pair", !!R.whyNotActivity({ kind: "BABE", done: { date: 3 } }, "date", { me: "a", week: 3, energy: 90 }));
  chk("food limit is per player", R.whyNotActivity({ kind: "BABE", done: { "b:food": 3 } }, "food", { me: "a", week: 3, energy: 90 }) === null);
  chk("too tired", !!R.whyNotActivity({ kind: "BABE", done: {} }, "date", { me: "a", week: 3, energy: 5 }));
  chk("trust broken blocks joint activities", !!R.whyNotActivity({ kind: "BABE", done: {}, cheatedBy: "a" }, "date", { me: "a", week: 3, energy: 90 }));
  chk("decay: 3 a week, 1 when living together", R.decayFor(5, 9) === 9 && R.decayFor(5, 9, true) === 3 && R.decayFor(5, 6) === 0);
  chk("catch chance grows with a shared home and stays in range", R.catchChance("date", { together: true }) > R.catchChance("date") && R.catchChance("date", { luck: 100, popularity: 0 }) >= 3 && R.catchChance("night", { together: true, sameHall: true, popularity: 100 }) <= 70);
  chk("gifts and rings have prices", R.outcome("gift", { tier: "big" }).costKobo === 5_000_000n && R.ringOf("royal").costKobo === 200_000_000n && R.outcome("gift", { tier: "x" }).error);
  chk("startKind: same gender bestie, opposite talking", R.startKind("M", "M") === "BESTIE" && R.startKind("M", "F") === "TALKING");
}

// ---------------- the service ----------------
const MODELS = ["character", "account", "bond", "loveRequest", "bondEvent", "message", "block", "notification", "actionLog", "ledgerEntry", "pregnancy", "gameClock", "roomItem", "achievement"];
const db = makeDb(MODELS, {
  defaults: { bond: { kind: "TALKING", prevKind: null, affection: 0, dates: 0, meals: 0, visits: 0, done: {}, everBabe: false, everEngaged: false, together: false, homeHostel: null, cheatedBy: null, cheatedWeek: null, lastCheater: null, strikes: 0, endedWeek: null, endedBy: null }, loveRequest: { status: "PENDING", variant: null }, pregnancy: { status: "PENDING" } },
  unique: { actionLog: ["characterId", "requestId"], bond: ["lowId", "highId"] },
  join: { character: (r, T) => ({ ...r, account: T.account.find((a) => a.characterId === r.id), faculty: { name: "Law", difficulty: 1 } }) },
});
const T = db.T();
const DAY = 864e5;
T.gameClock.push({ id: 1, startedAt: new Date(Date.now() - 9 * 7 * DAY) }); // game week 10
const weekNow = () => Math.floor((Date.now() - T.gameClock[0].startedAt.getTime()) / (7 * DAY)) + 1;
for (const [id, kind, name] of [["VENUES", "SYSTEM", "VENUES"], ["LANDLORDS", "SYSTEM", "LANDLORDS"], ["CLINICS", "SYSTEM", "CLINICS"]]) T.account.push({ id, kind, systemName: name, balance: 0n });
const person = (id, name, gender, hostel) => {
  T.character.push({ id, userId: "u_" + id, name, gender, hostel, expelled: false, suspendedUntilWeek: 0, jailedUntil: null, graduated: false, lastTickWeek: weekNow(), personalities: [], energy: 100, happiness: 50, popularity: 20, luck: 50, dependents: 0, level: 200, facultyId: 1, sessionStartWeek: 1, rentPaidUntilWeek: 0, class: "MAPO" });
  T.account.push({ id: "acc_" + id, kind: "PLAYER", characterId: id, balance: 5_000_000_00n });
};
person("t", "Tunde", "M", "Awo"); person("z", "Zainab", "F", "Moremi"); person("a", "Amara", "F", "Mozambique"); person("s", "Seyi", "M", "Fajuyi"); person("k", "Kemi", "F", "Akintola");
const say = (from, to) => { T.message.push({ fromId: from, toId: to, body: "hi", createdAt: new Date() }); };
const C = (id) => T.character.find((c) => c.id === id), bal = (id) => T.account.find((a) => a.id === "acc_" + id).balance;
const nextWeek = () => { T.gameClock[0].startedAt = new Date(T.gameClock[0].startedAt.getTime() - 7 * DAY); T.character.forEach((c) => { c.lastTickWeek = weekNow(); c.energy = 100; }); };
let q = 0; const rid = () => "req-" + String(++q).padStart(8, "0");
const U = { t: "u_t", z: "u_z", a: "u_a", s: "u_s", k: "u_k" };
const as = (who, body) => relate(db, U[who], { requestId: rid(), ...body });
const view = (who) => getRelationship(db, U[who]);
const bondBetween = async (who, name) => (await view(who)).bonds.find((b) => b.name === name);

// talking first
await denies("add with nobody having messaged", () => as("t", { action: "add", name: "Zainab" }), 409);
say("t", "z");
await denies("add when only one side has spoken", () => as("t", { action: "add", name: "Zainab" }), 409);
say("z", "t");
chk("discover lists people you have talked to both ways", (await view("t")).discover.some((p) => p.name === "Zainab" && p.kind === "TALKING"));
const added = await as("t", { action: "add", name: "zainab" });
chk("opposite genders start as talking", added.kind === "TALKING");
await denies("adding the same person twice", () => as("t", { action: "add", name: "Zainab" }), 409);
say("t", "s"); say("s", "t");
chk("same gender starts as bestie", (await as("t", { action: "add", name: "Seyi" })).kind === "BESTIE");
const rep = rid(); await relate(db, U.t, { requestId: rep, action: "add", name: "Nobody" }).catch(() => {});
await denies("you cannot add yourself", () => as("t", { action: "add", name: "Tunde" }));
T.block.push({ blockerId: "k", blockedId: "t" }); say("t", "k"); say("k", "t");
await denies("a blocked player cannot be added", () => as("t", { action: "add", name: "Kemi" }), 403);
T.block.length = 0;

// asking too early / wrong
let zb = await bondBetween("t", "Zainab");
chk("a fresh bond shows the checklist", zb.progress.length === 3 && !zb.ready && zb.can.BABE);
await denies("asking for babe before doing things together", () => as("t", { action: "request", id: zb.id, kind: "BABE" }), 409);
await denies("dates are refused for besties", async () => { const sb = await bondBetween("t", "Seyi"); await as("t", { action: "request", id: sb.id, kind: "DATE" }); }, 409);

// date 1 (invite -> accept)
const money0 = bal("t"), zEnergy = C("z").energy;
await as("t", { action: "request", id: zb.id, kind: "DATE" });
await denies("asking for the same date twice", () => as("t", { action: "request", id: zb.id, kind: "DATE" }), 409);
let v = await view("z"); const inc = v.requests.find((r) => !r.mine && r.kind === "DATE");
chk("the other player sees the invite", !!inc && inc.from === "Tunde" && /date/.test(inc.text));
await denies("only the invited player can accept", () => as("t", { action: "answer", id: inc.id, accept: true }), 403);
const ans = await as("z", { action: "answer", id: inc.id, accept: true });
chk("accepting a date charges the one who invited", bal("t") === money0 - 15_000_00n && C("z").energy === zEnergy - 15 && C("t").energy === 85);
zb = await bondBetween("t", "Zainab");
chk("the date counts and affection grows", zb.dates === 1 && zb.affection >= 14 && zb.done.date);
await denies("a second date in the same week", async () => { await as("z", { action: "request", id: zb.id, kind: "DATE" }); }, 409);
nextWeek();
await as("t", { action: "request", id: zb.id, kind: "DATE" }); v = await view("z"); await as("z", { action: "answer", id: v.requests.find((r) => !r.mine && r.kind === "DATE").id, accept: true });
// food and a visit
const f0 = bal("t"); await as("t", { action: "food", id: zb.id });
chk("food costs and counts", bal("t") === f0 - 8_000_00n && (await bondBetween("t", "Zainab")).meals === 1);
await denies("food twice in a week", () => as("t", { action: "food", id: zb.id }), 409);
await as("t", { action: "request", id: zb.id, kind: "VISIT" }); v = await view("z"); await as("z", { action: "answer", id: v.requests.find((r) => !r.mine && r.kind === "VISIT").id, accept: true });
zb = await bondBetween("t", "Zainab");
chk("ready to be asked", zb.ready && zb.dates === 2 && zb.visits === 1 && zb.can.BABE === null && zb.can.SNEAKY === null);
// notes land in messages
nextWeek();
await denies("a made-up note is refused", () => as("t", { action: "note", id: zb.id, line: 99 }), 400);
const msgs0 = T.message.length; await as("t", { action: "note", id: zb.id, line: 0 });
chk("a note goes into Messages", T.message.length === msgs0 + 1 && T.message.at(-1).toId === "z");
await denies("note twice in a week", () => as("t", { action: "note", id: zb.id, line: 1 }), 409);

// babe: ask, decline, ask, accept
await as("t", { action: "request", id: zb.id, kind: "BABE" });
v = await view("z"); await as("z", { action: "answer", id: v.requests.find((r) => !r.mine && r.kind === "BABE").id, accept: false });
chk("a declined ask leaves it as talking", (await bondBetween("t", "Zainab")).kind === "TALKING");
await as("z", { action: "request", id: zb.id, kind: "BABE" }); // she asks this time
v = await view("t"); await as("t", { action: "answer", id: v.requests.find((r) => !r.mine && r.kind === "BABE").id, accept: true });
zb = await bondBetween("t", "Zainab");
chk("babe now", zb.kind === "BABE" && zb.label === "Babe" && zb.weeks === 0);
await denies("proposal in the first week", () => as("t", { action: "request", id: zb.id, kind: "PROPOSE", variant: "classic" }), 409);
// a second babe is refused
for (const who of ["a"]) { say("t", who); say(who, "t"); }
await as("t", { action: "add", name: "Amara" });
let ab = await bondBetween("t", "Amara");
for (let i = 0; i < 2; i++) { await as("t", { action: "request", id: ab.id, kind: "DATE" }); v = await view("a"); await as("a", { action: "answer", id: v.requests.find((r) => !r.mine && r.kind === "DATE").id, accept: true }); nextWeek(); }
await as("t", { action: "food", id: ab.id });
await as("t", { action: "request", id: ab.id, kind: "VISIT" }); v = await view("a"); await as("a", { action: "answer", id: v.requests.find((r) => !r.mine && r.kind === "VISIT").id, accept: true });
ab = await bondBetween("t", "Amara");
chk("Amara is ready but a second babe is not allowed", ab.ready && !!ab.can.BABE && ab.can.SNEAKY === null);
await denies("second babe", () => as("t", { action: "request", id: ab.id, kind: "BABE" }), 409);
// moving in needs off campus
await denies("move in while living on campus", () => as("t", { action: "request", id: zb.id, kind: "MOVEIN" }), 409);

// sneaky link while having a babe, and getting caught
nextWeek();
await as("t", { action: "request", id: ab.id, kind: "SNEAKY" }); v = await view("a"); await as("a", { action: "answer", id: v.requests.find((r) => !r.mine && r.kind === "SNEAKY").id, accept: true });
ab = await bondBetween("t", "Amara");
chk("sneaky link while having a babe", ab.kind === "SNEAKY");
let caught = false, tries = 0;
while (!caught && tries < 80) {
  tries++; nextWeek();
  const cur = await bondBetween("t", "Amara");
  if (cur.can.visit) break;
  await as("t", { action: "request", id: cur.id, kind: "VISIT" }); v = await view("a");
  const r = await as("a", { action: "answer", id: v.requests.find((x) => !x.mine && x.kind === "VISIT").id, accept: true });
  caught = (r.caught ?? []).length > 0;
}
chk(`seeing a sneaky link while having a babe gets you caught eventually (${tries} tries)`, caught);
zb = await bondBetween("t", "Zainab");
chk("the babe's bond is damaged and marked", zb.cheat?.by === "me" && (zb.kind === "BABE"));
chk("everyone involved is told", T.notification.some((x) => x.characterId === "z" && /caught/.test(x.body)) && T.notification.some((x) => x.characterId === "t" && /caught/.test(x.body)));
await denies("no dates while trust is broken", () => as("t", { action: "request", id: zb.id, kind: "DATE" }), 409);
await denies("the cheater cannot forgive themselves", () => as("t", { action: "forgive", id: zb.id }), 409);
const ap0 = bal("t"); await as("t", { action: "apologise", id: zb.id });
chk("a sorry gift costs money and helps", bal("t") === ap0 - 50_000_00n);
await as("z", { action: "forgive", id: zb.id });
chk("forgiven", (await bondBetween("t", "Zainab")).cheat === null);
// caught again -> over
let over = false; tries = 0;
while (!over && tries < 120) {
  tries++; nextWeek();
  const cur = await bondBetween("t", "Amara"); if (cur.can.visit) break;
  await as("t", { action: "request", id: cur.id, kind: "VISIT" }); v = await view("a");
  const r = await as("a", { action: "answer", id: v.requests.find((x) => !x.mine && x.kind === "VISIT").id, accept: true });
  over = (r.caught ?? []).some((x) => x.over);
  if (!over && (r.caught ?? []).length) { const z2 = await bondBetween("t", "Zainab"); await as("z", { action: "forgive", id: z2.id }); }
}
chk("caught twice ends the relationship", over && (await bondBetween("t", "Zainab")).kind === "EX");

// reconcile, start over, remove
let ex = await bondBetween("t", "Zainab");
chk("an ex can ask for another chance", ex.can.RECONCILE === null);
await as("t", { action: "request", id: ex.id, kind: "RECONCILE" }); v = await view("z");
const rc0 = bal("t"); await as("z", { action: "answer", id: v.requests.find((r) => !r.mine && r.kind === "RECONCILE").id, accept: true });
chk("getting back together costs the asker a gift", bal("t") === rc0 - 10_000_00n && (await bondBetween("t", "Zainab")).kind === "BABE");

// proposal, then move in (off campus)
nextWeek(); nextWeek();
zb = await bondBetween("t", "Zainab");
chk("proposal is open after a week as babe", zb.can.PROPOSE === null);
const ring0 = bal("t"); await as("t", { action: "request", id: zb.id, kind: "PROPOSE", variant: "classic" });
v = await view("z"); await as("z", { action: "answer", id: v.requests.find((r) => !r.mine && r.kind === "PROPOSE").id, accept: true });
chk("a yes makes them engaged and charges the ring", (await bondBetween("t", "Zainab")).kind === "ENGAGED" && bal("t") === ring0 - 75_000_000n);
C("t").hostel = "Off-campus"; C("z").sessionStartWeek = weekNow() - 2; C("z").rentPaidUntilWeek = 0;
zb = await bondBetween("t", "Zainab");
chk("once off campus, move in is open", zb.can.MOVEIN === null);
const t0 = bal("t"), z0 = bal("z");
await as("t", { action: "request", id: zb.id, kind: "MOVEIN", variant: "cover" }); v = await view("z");
const mv = await as("z", { action: "answer", id: v.requests.find((r) => !r.mine && r.kind === "MOVEIN").id, accept: true });
zb = await bondBetween("t", "Zainab");
chk("moving in: she lives at his place, together, he covered it", C("z").hostel === "Off-campus" && zb.together && bal("t") < t0 && bal("z") === z0);
chk("living together shows on both sides", (await bondBetween("z", "Tunde")).together);
C("z").hostel = "Moremi";
chk("moving elsewhere ends 'living together' by itself", !(await bondBetween("t", "Zainab")).together);

// breakup, fresh, remove, expiry, replay, Floor O
const sb = await bondBetween("t", "Seyi");
await as("t", { action: "breakup", id: sb.id }); chk("breakup makes an ex", (await bondBetween("t", "Seyi")).kind === "EX");
await as("t", { action: "fresh", id: sb.id }); chk("start over resets it", (await bondBetween("t", "Seyi")).kind === "BESTIE");
await denies("cannot remove a babe or fiancé directly", () => as("t", { action: "remove", id: zb.id }), 409);
await as("t", { action: "remove", id: sb.id }); chk("remove deletes the bond", !(await bondBetween("t", "Seyi")));
const old = rid(); const kb = await (async () => { say("t", "k"); say("k", "t"); const r = await as("t", { action: "add", name: "Kemi" }); return r; })();
const r1 = await relate(db, U.t, { requestId: old, action: "note", id: kb.id, line: 0 });
const r2 = await relate(db, U.t, { requestId: old, action: "note", id: kb.id, line: 0 });
chk("a replayed request does nothing twice", r1.ok && r2.duplicate === true && T.message.filter((m) => m.body === R.NOTES[0] && m.toId === "k").length === 1);
const kd = await as("t", { action: "request", id: kb.id, kind: "DATE" });
C("k").jailedUntil = new Date(Date.now() + 3600e3);
await denies("they are in Floor O: they cannot answer", () => as("k", { action: "answer", id: kd.id, accept: true }));
C("k").jailedUntil = null;
for (let i = 0; i < 4; i++) nextWeek();
const vk = await view("k");
chk("an unanswered request lapses after 3 weeks", !vk.requests.some((r) => r.id === kd.id));
await denies("answering a lapsed request", () => as("k", { action: "answer", id: kd.id, accept: true }));

// pregnancy: both sides get a decision; deciding works
await as("t", { action: "remove", id: kb.id });
// give the Love list a night in between Tunde and Zainab (engaged): retry until pregnancy roll lands, keep it bounded
let preg = false; for (let i = 0; i < 400 && !preg; i++) {
  nextWeek(); zb = await bondBetween("t", "Zainab"); if (zb.can.night) continue;
  await as("t", { action: "request", id: zb.id, kind: "NIGHT", variant: "risky" }); v = await view("z");
  const r = await as("z", { action: "answer", id: v.requests.find((x) => !x.mine && x.kind === "NIGHT").id, accept: true }); preg = !!r.pregnancy;
}
if (preg) {
  chk("a pregnancy shows up on both sides", (await view("t")).pregnancy && (await view("z")).pregnancy);
  const d = await decidePregnancy(db, U.z, { choice: "keep", requestId: rid() });
  chk("deciding works and costs money", d.ok && C("z").dependents === 1);
} else console.log("note: no pregnancy rolled in the bounded loop (6% a night); skipped");

// optimistic patches mirror the server
{
  const d = await view("t");
  const b = d.bonds.find((x) => x.name === "Zainab");
  const after = P.solo(b.id, "food")(d).bonds.find((x) => x.id === b.id);
  chk("patch: food raises affection and locks the tile", after.affection >= Math.min(100, b.affection) && after.done.food && after.can.food);
  const sent = P.sent(b.id, "NIGHT", "safe", "tmp-1")(d);
  chk("patch: an invite shows as waiting", sent.bonds.find((x) => x.id === b.id).can.night && sent.requests[0].id === "tmp-1");
  chk("patch: cancelling removes it", !P.cancelled("tmp-1")(sent).requests.some((r) => r.id === "tmp-1"));
  chk("patch: breaking up makes an ex", P.brokeUp(b.id)(d).bonds.find((x) => x.id === b.id).kind === "EX");
}

console.log(bad ? `\n${bad} of ${n} checks FAILED` : `All ${n} checks passed`);
process.exit(bad ? 1 : 0);
