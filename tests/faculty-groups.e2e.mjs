// tests/faculty-groups.e2e.mjs
// End-to-end test of faculty groups (membership, directory, private chats) and their window onto the SUG election's faculty races, against a real
// Postgres (the real services, triggers and constraints). Voting rules themselves belong to the SUG election and are tested in its own tests; here we check
// that Faculty Groups shows only the caller's faculty's races and that a vote sent through them is accepted or refused by SUG.
// Not part of `npm test` (that needs no database). Run it with:   DATABASE_URL=... node tests/faculty-groups.e2e.mjs
// The database must already have the migrations applied, and should be DISPOSABLE: it creates rows tagged fg_*, and the faculty-races section casts real SUG ballots,
// which the database keeps forever (SugBallot is append-only), so that section leaves rows behind. That section is skipped when a live SUG election already exists.
// (PRISMA_CLIENT / PRISMA_ADAPTER work as in tests/chat.e2e.mjs.)
import * as G from "../lib/facultyGroupService.js";
import * as E from "../lib/facultyGroupElections.js";
import * as SUG from "../lib/sugService.js";
import * as core from "../lib/chatCore.js";

const { PrismaClient } = await import(process.env.PRISMA_CLIENT ?? "@prisma/client");
let db;
if (process.env.PRISMA_ADAPTER) { const { PrismaPg } = await import(process.env.PRISMA_ADAPTER); db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 20 }) }); }
else db = new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } });

let passed = 0, failed = 0;
const ok = (c, name, extra = "") => { c ? passed++ : failed++; console.log(`${c ? "PASS" : "FAIL"}  ${name}${c ? "" : "  " + extra}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Runs fn and returns { status, message } of the GameError it throws (or { status: 200, value }). */
const run = async (fn) => { try { return { status: 200, value: await fn() }; } catch (e) { return { status: e.status ?? e.code ?? 500, message: e.message }; } };
const rid = (() => { let n = 0; const t = Math.random().toString(36).slice(2, 8); return () => `fg-${t}-${++n}-xxxxxxxx`; })();

// ---------------------------------------------------------------------------------------------------- fixtures
const tag = "fg_" + Math.random().toString(36).slice(2, 6);
const facA = await db.faculty.create({ data: { name: `Faculty of ${tag}A` } });
const facB = await db.faculty.create({ data: { name: `Faculty of ${tag}B` } });
const mk = async (n, facultyId, extra = {}) => {
  const u = await db.user.create({ data: { email: `${tag}_${n}@x.test`, passwordHash: "x", isAdult: true, ...(extra.role ? { role: extra.role } : {}) } });
  const c = await db.character.create({ data: { userId: u.id, name: `${tag}_${n}`, gender: "F", class: "MAPO", facultyId, luck: 50, riskTolerance: 50, hostel: "Off-campus", lastTickWeek: 99999, level: 100 + (n.length) * 100 } });
  await db.account.create({ data: { kind: "PLAYER", characterId: c.id } });
  return { n, userId: u.id, id: c.id, name: c.name };
};

console.log("\n== membership ==");
const gA = await db.facultyGroup.findMany({ where: { facultyId: facA.id } }), gB = await db.facultyGroup.findMany({ where: { facultyId: facB.id } });
ok(gA.length === 1 && gB.length === 1, "a new faculty gets exactly one group, by itself");
ok(gA[0].id !== gB[0].id, "different faculties have separate groups");
const a1 = await mk("a1", facA.id), a2 = await mk("a2", facA.id), a3 = await mk("a3", facA.id), a4 = await mk("a4", facA.id), a5 = await mk("a5", facA.id), b1 = await mk("b1", facB.id), b2 = await mk("b2", facB.id), b3 = await mk("b3", facB.id);
await db.gameClock.upsert({ where: { id: 1 }, update: {}, create: { id: 1, startedAt: new Date() } });
const memberOf = async (p) => db.facultyGroupMember.findMany({ where: { characterId: p.id } });
let m = await memberOf(a1);
ok(m.length === 1 && m[0].groupId === gA[0].id, "a new player is put in their faculty's group the moment the character exists (no code ran: the database did it)");
m = await memberOf(b1); ok(m.length === 1 && m[0].groupId === gB[0].id, "a player of another faculty is in that faculty's group");
ok((await db.facultyGroupMember.count({ where: { groupId: gA[0].id } })) === 5, "member count of group A is the real count (a1-a5)");
const dup = await run(() => db.facultyGroupMember.create({ data: { groupId: gB[0].id, characterId: a1.id } }));
ok(dup.status === "P2002", "the database refuses a second membership for a player (no joining two groups by API manipulation)", JSON.stringify(dup));
const dupGroup = await run(() => db.facultyGroup.create({ data: { facultyId: facA.id } }));
ok(dupGroup.status === "P2002", "the database refuses a second group for a faculty");
let o = await G.overview(db, a1.userId);
ok(o.memberCount === 5 && o.group.name === `${tag}A Faculty Group`.replace(/^/, "") , "overview shows the group name and member count", JSON.stringify(o.group) + o.memberCount);
// self-heal: remove the row, the next request puts it back
await db.facultyGroupMember.delete({ where: { characterId: a5.id } });
o = await G.overview(db, a5.userId);
ok(o.memberCount === 5, "a missing membership row is healed on the next request");

const facC = await db.faculty.create({ data: { name: `Faculty of ${tag}C` } });
ok((await db.facultyGroup.count({ where: { facultyId: facC.id } })) === 1, "a faculty added later also gets its group at once");
await db.faculty.delete({ where: { id: facC.id } });
ok((await db.facultyGroup.count({ where: { facultyId: facC.id } })) === 0, "removing a faculty removes its group (cascade)");

console.log("\n== directory & profile ==");
let l = await G.members(db, a1.userId, {});
ok(l.total === 4 && l.members.every((x) => ![b1, b2, b3].some((p) => p.name === x.name)), "directory lists only my faculty (no player of faculty B), without me", l.members.map((x) => x.name).join());
ok(l.members.every((x) => x.name !== a1.name), "directory leaves out the player themselves");
l = await G.members(db, a1.userId, { q: "A3" });
ok(l.members.length === 1 && l.members[0].name === a3.name, "search finds a member by part of their name, any letter case");
l = await G.members(db, a1.userId, { q: b1.name });
ok(l.members.length === 0, "search never returns someone from another faculty");
l = await G.members(db, a1.userId, { limit: 2 });
ok(l.members.length === 2 && l.hasMore === true && l.total === 4, "directory pages");
l = await G.members(db, a1.userId, { q: "%" });
ok(l.members.length === 0, "a % in the search is matched literally, not as a wildcard");
const prof = await G.memberProfile(db, a1.userId, a2.name.toUpperCase());
ok(prof.name === a2.name && prof.faculty === facA.name && "level" in prof && "online" in prof, "a colleague's profile opens (any letter case)");
const flat = JSON.stringify(prof).toLowerCase();
ok(!flat.includes("@x.test") && !flat.includes("passwordhash") && !flat.includes("email"), "the profile exposes no email or password data");
ok(!("netWorthKobo" in prof), "the faculty profile leaves out money");
ok((await run(() => G.memberProfile(db, a1.userId, b1.name))).status === 404, "a player outside the faculty has no profile through this feature (404)");
ok((await run(() => G.memberProfile(db, a1.userId, "nobody_here"))).status === 404, "an unknown name is the same 404 (nothing is revealed)");
await db.user.update({ where: { id: a4.userId }, data: { status: "DELETED" } });
l = await G.members(db, a1.userId, {});
ok(l.total === 3 && !l.members.some((x) => x.name === a4.name), "archived accounts are not listed");
o = await G.overview(db, a1.userId); ok(o.memberCount === 4, "archived accounts are not counted");
await db.user.update({ where: { id: a4.userId }, data: { status: "ACTIVE" } });

console.log("\n== online status ==");
await db.user.update({ where: { id: a2.userId }, data: { lastActiveAt: new Date() } });
await db.user.update({ where: { id: a3.userId }, data: { lastActiveAt: new Date(Date.now() - 3_600_000) } });
l = await G.members(db, a1.userId, {});
ok(l.members.find((x) => x.name === a2.name).online === true && l.members.find((x) => x.name === a3.name).online === false, "online = active in the last minutes (no realtime server configured)");

console.log("\n== private conversations ==");
const c1 = await G.openConversation(db, a1.userId, a2.name);
ok(c1.name === a2.name && c1.chatId > 0, "a member can start a conversation with a colleague");
const c2 = await G.openConversation(db, a2.userId, a1.name), c3 = await G.openConversation(db, a1.userId, a2.name.toLowerCase());
ok(c2.chatId === c1.chatId && c3.chatId === c1.chatId, "the same pair always shares ONE conversation, whoever starts it");
ok((await db.chat.count({ where: { OR: [{ aId: a1.id, bId: a2.id }, { aId: a2.id, bId: a1.id }] } })) === 1, "no duplicate conversation row");
const conc = await Promise.all(Array.from({ length: 8 }, () => G.openConversation(db, a1.userId, a3.name)));
ok(new Set(conc.map((x) => x.chatId)).size === 1, "8 simultaneous starts still make one conversation");
ok((await run(() => G.openConversation(db, a1.userId, b1.name))).status === 404, "the server refuses a conversation with someone outside the faculty");
ok((await db.chat.count({ where: { OR: [{ aId: b1.id }, { bId: b1.id }] } })) === 0, "...and no chat row was created for them");
ok((await run(() => G.openConversation(db, a1.userId, a1.name))).status === 400, "you cannot start a conversation with yourself");
ok((await run(() => G.openConversation(db, a1.userId, "  "))).status === 404, "an empty name is refused");
await db.block.create({ data: { blockerId: a3.id, blockedId: a1.id } });
ok((await run(() => G.openConversation(db, a1.userId, a3.name))).status === 403, "a block in either direction stops the conversation");
await db.block.deleteMany({});
// messages persist, are read back, and drive the unread badge
const meA2 = await core.whoAmI(db, a2.userId), meA1 = await core.whoAmI(db, a1.userId);
await core.sendText(db, meA2, a1.name, "hello from a2"); await core.sendText(db, meA2, a1.name, "second");
const th = await core.getThread(db, meA1, a2.name);
ok(th.messages.length === 2 && th.messages[0].body === "hello from a2" && th.messages[0].at, "messages persist in the database, with timestamps, in order");
l = await G.members(db, a1.userId, {});
ok(l.members.find((x) => x.name === a2.name).unread === 2, "the directory shows 2 unread from a2");
o = await G.overview(db, a1.userId); ok(o.unread === 2, "the group shows the total unread from colleagues");
await core.markRead(db, meA1, a2.name, th.lastId);
o = await G.overview(db, a1.userId); ok(o.unread === 0, "reading the conversation clears the unread count");
const reopened = await G.openConversation(db, a1.userId, a2.name);
ok(reopened.chatId === c1.chatId && (await core.getThread(db, meA1, a2.name)).messages.length === 2, "reopening a previous conversation shows its history");

console.log("\n== faculty elections (the SUG election's faculty races) ==");
const R = await import("../lib/sugRules.js");
const nowMs = Date.now(), day = 86_400_000, at = (ms) => new Date(nowMs + ms);
// This section drives the SUG engine's live cycle (moves its timetable, adds candidates and ballots). It must NEVER touch a real election, so it only runs
// when the database has no live cycle yet, and it removes the cycle it caused to exist.
const preexisting = await db.sugCycle.findFirst({ where: { status: "LIVE" }, select: { id: true } });
let cycle, repA, asstA, repB, v;
election: {
if (preexisting) { console.log("SKIP  a live SUG election already exists in this database: not touching it. Run against a database without one to test the faculty races."); break election; }
// The SUG engine announces its own election the first time anyone looks (and allows only one live cycle), so the test drives THAT cycle.
v = await E.view(db, a1.userId);
cycle = await db.sugCycle.findFirst({ where: { status: "LIVE" } });
ok(v.cycle?.id === cycle.id && v.cycle.stage === "ANNOUNCED" && v.votingOpen === false, "a freshly announced election shows its stage and no voting yet");
ok(v.races.length === 2 && v.races.every((r) => r.canVote === false && r.candidates.length === 0), "...with this faculty's two races, no candidates and nothing to vote on");
// SUG will not let a brand-new character vote (it waits a couple of hours), so the test players are made a few days old.
await db.character.updateMany({ where: { name: { startsWith: tag } }, data: { createdAt: at(-5 * day) } });
// Candidates can only be added while registration is open (the SUG database refuses otherwise), so: open registration, add them, then move into voting.
const times = (reg, camp, voteStart) => ({ announcedAt: at(-6 * day), registrationOpensAt: at(reg), campaignStartsAt: at(camp), votingStartsAt: at(voteStart), votingEndsAt: at(voteStart + 2 * day), termStartsAt: at(voteStart + 4 * day), termEndsAt: at(100 * day) });
await db.sugCycle.update({ where: { id: cycle.id }, data: times(-day, day, 2 * day) });
const race = async (position) => db.sugRace.upsert({ where: { cycleId_position: { cycleId: cycle.id, position } }, update: {}, create: { cycleId: cycle.id, position, seats: 1 } });
[repA, asstA, repB] = [await race(R.facultyPositionKey(facA.id)), await race(R.facultyPositionKey(facA.id, true)), await race(R.facultyPositionKey(facB.id))];
const stand = (rc, p, slogan) => db.sugCandidate.create({ data: { cycleId: cycle.id, raceId: rc.id, characterId: p.id, position: rc.position, slogan, intro: "x".repeat(20), manifesto: "m", promises: [], feeKobo: 0n } });
const cRepA2 = await stand(repA, a2, "Together"), cRepA3 = await stand(repA, a3, "Forward"), cAsstA4 = await stand(asstA, a4, "Service"), cRepB1 = await stand(repB, b1, "B first");
v = await E.view(db, a1.userId);
ok(v.cycle?.stage === "REGISTRATION" && v.races.find((r) => r.position === repA.position).candidates.length === 2, "while registration is open the candidates already show");
await db.sugCycle.update({ where: { id: cycle.id }, data: times(-4 * day, -3 * day, -day) });
v = await E.view(db, a1.userId);
ok(v.cycle?.stage === "VOTING" && v.votingOpen === true && v.round === 1, "a member sees the election move into voting");
ok(v.races.length === 2 && v.races.every((r) => r.position.endsWith(`_${facA.id}`)), "a member sees exactly their own faculty's two races", v.races.map((r) => r.position).join());
ok(!JSON.stringify(v).includes(`REP_${facB.id}`) && !JSON.stringify(v).includes(b1.name), "another faculty's race and candidates are not in the response");
const repView = v.races.find((r) => r.position === R.facultyPositionKey(facA.id));
ok(repView.candidates.map((c) => c.name).sort().join() === [a2.name, a3.name].sort().join() && repView.candidates.every((c) => c.level && "slogan" in c), "the candidates are listed with name, level and slogan");
ok(!JSON.stringify(v).includes('"ballots"') && !repView.candidates.some((c) => "votes" in c), "no vote counts are shown while voting is open");
ok(repView.canVote === true && v.races.every((r) => r.voted === false), "the member may vote in both posts");
const vb = await E.view(db, b1.userId);
ok(vb.races.length === 2 && vb.races.every((r) => r.position.endsWith(`_${facB.id}`)), "faculty B sees only its own two races");
const ballot = (p, position, cid) => run(() => SUG.vote(db, p.userId, { position, candidateId: cid, requestId: crypto.randomUUID() }));
const first = await ballot(a1, repA.position, cRepA2.id);
ok(first.status === 200, "a vote sent through the SUG election's vote action is accepted", JSON.stringify(first));
v = await E.view(db, a1.userId);
ok(v.races.find((r) => r.position === repA.position).voted === true && v.races.find((r) => r.position === repA.position).canVote === false && v.races.find((r) => r.position === asstA.position).canVote === true, "the screen then shows that vote, and still allows the other post");
ok((await ballot(a1, repA.position, cRepA3.id)).status === 409, "a second vote for the same post is refused");
ok((await ballot(a1, asstA.position, cAsstA4.id)).status === 200, "the same member can vote for the other post independently");
ok((await ballot(b1, repA.position, cRepA3.id)).status === 403, "a player of another faculty cannot vote in this faculty's race");
ok((await ballot(a1, repA.position, cRepB1.id)).status !== 200 && (await db.sugBallot.count({ where: { voterId: a1.id, raceId: repA.id } })) === 1, "a candidate of another race cannot receive the vote");
ok((await db.sugBallot.count({ where: { cycleId: cycle.id, voterId: { in: [a1.id, b1.id] } } })) === 2, "exactly two ballots are stored for those voters");
ok((await run(() => SUG.getCandidates(db, a1.userId, repB.position))).status === 403, "SUG itself refuses to list another faculty's race");
} // end of the section that needs a database without a live election

console.log("\n== faculty leadership (SUG offices) ==");
o = await G.overview(db, a1.userId);
ok(o.offices.REPRESENTATIVE.holder === null && o.offices.ASSISTANT.holder === null, "with no one in office both posts show as not filled");
const mkCycle = (number, title, status, stage) => db.sugCycle.create({ data: { number, title, status, stage, announcedAt: at(-300 * day), registrationOpensAt: at(-299 * day), campaignStartsAt: at(-298 * day), votingStartsAt: at(-297 * day), votingEndsAt: at(-296 * day), termStartsAt: at(-295 * day), termEndsAt: at(-200 * day), nominationFeeKobo: 0n, spendCapExecKobo: 0n, spendCapAssemblyKobo: 0n, createdBy: "SYSTEM" } });
const base = -(10_000 + Math.floor(Math.random() * 1_000_000)); // fixture cycles get their own numbers (a past run may have left some behind)
const cur = await mkCycle(base, `${tag} current term`, "DECIDED", "ACTIVE");
const term = await db.sugTerm.create({ data: { cycleId: cur.id, startsAt: at(-day), endsAt: at(day), status: "ACTIVE" } });
const appoint = (p, key, termId = term.id) => db.sugAppointment.create({ data: { termId, characterId: p.id, position: key, kind: "ELECTED" } });
await appoint(a2, R.facultyPositionKey(facA.id)); await appoint(a3, R.facultyPositionKey(facA.id, true)); await appoint(b1, R.facultyPositionKey(facB.id));
o = await G.overview(db, a1.userId);
ok(o.offices.REPRESENTATIVE.holder?.name === a2.name && o.offices.ASSISTANT.holder?.name === a3.name, "the group shows who holds Faculty Representative and Assistant (from the SUG offices)");
ok(o.offices.REPRESENTATIVE.holder.name !== b1.name, "another faculty's representative never appears");
l = await G.members(db, a1.userId, {});
ok(l.members.find((x) => x.name === a2.name).office === "Faculty Representative" && l.members.find((x) => x.name === a3.name).office === "Assistant Faculty Representative", "the directory marks the representative and the assistant");
ok((await G.memberProfile(db, a1.userId, a2.name)).facultyOffice === "Faculty Representative", "the profile shows the post");
const old = await mkCycle(base - 1, `${tag} old term`, "DECIDED", "COMPLETED");
const ended = await db.sugTerm.create({ data: { cycleId: old.id, startsAt: at(-295 * day), endsAt: at(-200 * day), status: "ENDED" } });
await appoint(a5, R.facultyPositionKey(facA.id, true), ended.id);
o = await G.overview(db, a1.userId);
ok(o.offices.ASSISTANT.holder?.name === a3.name, "an office from a term that has ended does not count");
v = await E.view(db, a1.userId); ok(v.offices.REPRESENTATIVE.holder?.name === a2.name, "the elections screen shows the same office holders");
await db.character.update({ where: { id: a2.id }, data: { facultyId: facB.id } });
o = await G.overview(db, a1.userId);
ok(o.offices.REPRESENTATIVE.holder === null, "a holder who moved to another faculty no longer represents this one");
ok((await memberOf(a2)).length === 1 && (await memberOf(a2))[0].groupId === gB[0].id, "...and their membership moved with them (still exactly one)");
ok((await run(() => G.memberProfile(db, a1.userId, a2.name))).status === 404, "...and they are no longer visible in the old faculty's directory");
await db.character.update({ where: { id: a2.id }, data: { facultyId: facA.id } });

console.log("\n== new life ==");
const nl = a5;
await db.account.deleteMany({ where: { characterId: nl.id } }); await db.character.delete({ where: { id: nl.id } });
const reborn = await db.character.create({ data: { userId: nl.userId, name: `${tag}_a5new`, gender: "F", class: "MAPO", facultyId: facA.id, luck: 50, riskTolerance: 50, hostel: "Off-campus", lastTickWeek: 99999 } });
await db.account.create({ data: { kind: "PLAYER", characterId: reborn.id } });
ok((await memberOf({ id: reborn.id })).length === 1, "a player who starts a new life is put straight back in their faculty group");

console.log("\n== cleanup (best effort) ==");
try {
  const ids = (await db.character.findMany({ where: { name: { startsWith: tag } }, select: { id: true } })).map((c) => c.id);
  await db.sugAppointment.deleteMany({ where: { termId: { in: [term.id, ended.id] } } }); await db.sugTerm.deleteMany({ where: { id: { in: [term.id, ended.id] } } });
  if (!(await db.sugBallot.count({ where: { voterId: { in: ids } } }))) { // ballots are append-only, so players who voted (and the cycle) stay
    await db.sugCandidate.deleteMany({ where: { cycleId: { in: [cur.id, old.id] } } }); await db.sugRace.deleteMany({ where: { cycleId: { in: [cur.id, old.id] } } }); await db.sugCycle.deleteMany({ where: { id: { in: [cur.id, old.id] } } });
    await db.actionLog.deleteMany({ where: { characterId: { in: ids } } }); await db.message.deleteMany({}); await db.chat.deleteMany({ where: { OR: [{ aId: { in: ids } }, { bId: { in: ids } }] } });
    await db.account.deleteMany({ where: { characterId: { in: ids } } }); await db.character.deleteMany({ where: { id: { in: ids } } });
    await db.user.deleteMany({ where: { email: { startsWith: tag } } }); await db.faculty.deleteMany({ where: { id: { in: [facA.id, facB.id] } } });
    console.log("cleaned up");
  } else console.log("NOTE  SUG ballots were cast (append-only): the fg_* players and their election rows are left in this disposable database.");
} catch (e) { console.log("NOTE  cleanup incomplete:", String(e.message).split("\n")[0].slice(0, 120)); }

console.log(`\n${passed} passed, ${failed} failed`);
await db.$disconnect();
process.exit(failed ? 1 : 0);
