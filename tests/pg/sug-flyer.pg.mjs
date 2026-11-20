// tests/pg/sug-flyer.pg.mjs: university / SUG / faculty candidacies, campaign photos, flyers and voting, against a REAL PostgreSQL database with every
// migration applied (see tests/pg/bankHarness.mjs for how to run it; with no Prisma engine available use PG_ADAPTER=1).
import { db, reset, player, rq, naira, denied, assert, ok, done } from "./bankHarness.mjs";
import { createCanvas } from "@napi-rs/canvas";
import * as S from "../../lib/sugService.js";
import * as R from "../../lib/sugRules.js";
import * as F from "../../lib/sugFlyer.js";

await reset();
const now = Date.now(), H = 3_600_000;
const tech = (await db.faculty.findFirst()).id, arts = (await db.faculty.create({ data: { name: "Arts", difficulty: 1 } })).id;
const old = { createdAt: new Date(now - 5 * H) }; // old enough to vote
const mk = (name, char = {}) => player(name, { balanceNaira: 20_000, char: { ...old, ...char } });
const reg = (p, position, extra = {}) => S.register(db, p.uid, { position, slogan: "Better campus", intro: "I want to serve students.", manifesto: "I will make the campus better for every student, every day, in every way.", promises: "Cheaper food\nBetter lights", requestId: rq(), ...extra });
function jpeg(w = 900, h = 1200, type = "jpeg") { const c = createCanvas(w, h), g = c.getContext("2d"); g.fillStyle = "#c9a37e"; g.fillRect(0, 0, w, h); g.fillStyle = "#6b4630"; g.beginPath(); g.ellipse(w / 2, h * 0.4, w * 0.2, h * 0.18, 0, 0, 7); g.fill(); return c.encodeSync(type); }

// ---------- the election and its races ----------
const t = (h) => now + h * H;
const cycle = await S.createCycle(db, { timetable: { announcedAt: t(-3), registrationOpensAt: t(-2), campaignStartsAt: t(1), votingStartsAt: t(2), votingEndsAt: t(26), termStartsAt: t(26) + 8 * H, termEndsAt: t(26) + 8 * H + 7 * 24 * H }, createdBy: "test" });
const races = await db.sugRace.findMany({ where: { cycleId: cycle.id }, select: { position: true, seats: true } });
assert.equal(races.length, 12 + 5 + 2 * 2, "12 SUG + 5 university + 2 per faculty (2 faculties)");
for (const k of [...R.UNIVERSITY_POSITION_KEYS, ...R.facultyPositionKeys(tech), ...R.facultyPositionKeys(arts)]) assert.ok(races.some((r) => r.position === k), `race ${k}`);
assert.equal(races.filter((r) => r.position === "HONOURABLE_MEMBER")[0].seats, 30); assert.equal(new Set(races.map((r) => r.position)).size, races.length, "no duplicate races");
ok("an election has the 12 SUG races, the 5 university races and two races per faculty, with no duplicates");
await db.sugRace.deleteMany({ where: { cycleId: cycle.id, position: { in: ["REGISTRAR", ...R.facultyPositionKeys(arts)] } } });
await S.advance(db); assert.equal(await db.sugRace.count({ where: { cycleId: cycle.id } }), 21);
ok("races that are missing from an election already running are added by advance()");

// ---------- eligibility, registration ----------
const vc = await mk("Vee_Cee", { level: 400, facultyId: tech }), low = await mk("Lowly", { level: 200, facultyId: tech }), dvc = await mk("Dee_Vee", { level: 300, facultyId: tech });
const pres = await mk("Prez", { level: 100, facultyId: tech }), tRep = await mk("TechRep", { level: 200, facultyId: tech }), aRep = await mk("ArtsRep", { level: 200, facultyId: arts });
await denied("a 200L student standing for Vice-Chancellor", () => reg(low, "VICE_CHANCELLOR"), /400 level/, 403);
await denied("a position that does not exist", () => reg(low, "CHANCELLOR"), /Choose a position/);
await denied("another faculty's representative race", () => reg(aRep, R.facultyPositionKey(tech)), /only to students of that faculty/, 403);
const rv = await reg(vc, "VICE_CHANCELLOR"); assert.equal(rv.title, "Vice-Chancellor");
await reg(dvc, "DEPUTY_VICE_CHANCELLOR"); await reg(pres, "PRESIDENT"); await reg(tRep, R.facultyPositionKey(tech)); await reg(aRep, R.facultyPositionKey(arts));
ok("VC, DVC, SUG President, and faculty representative candidates can register; the level and faculty rules are enforced by the server");
await denied("a second post in the same election", () => reg(vc, "PRESIDENT"), /already standing/, 409);
const sug = await S.getSug(db, aRep.uid);
assert.ok(sug.races.every((r) => r.category !== "FACULTY" || r.position.endsWith("_" + arts)), "a student sees only their own faculty's races");
assert.ok(sug.races.some((r) => r.category === "UNIVERSITY") && sug.races.some((r) => r.category === "SUG"));
assert.equal(sug.me.candidacy.category, "FACULTY"); assert.equal(sug.me.candidacy.faculty, "Arts"); assert.equal(sug.me.candidacy.canFlyer, true);
await denied("reading another faculty's candidates", () => S.getCandidates(db, aRep.uid, R.facultyPositionKey(tech)), /another faculty/, 403);
ok("faculty races are visible, readable and electable only to their own faculty");

// ---------- the flyer: who may make one ----------
const stranger = await mk("Stranger", { level: 300, facultyId: tech });
await denied("a flyer for a player who is not a candidate", () => F.makeFlyer(db, stranger.uid, {}), /Only candidates/, 403);
await denied("a flyer before a picture is uploaded", () => F.makeFlyer(db, vc.uid, {}), /Upload your campaign picture first/, 409);
await denied("a photo upload by a non-candidate", () => F.savePhoto(db, stranger.uid, jpeg()), /Only candidates/, 403);
const bad = [["a text file", Buffer.from("hello, I am not a picture".repeat(10)), /not a picture/, 415], ["an SVG", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><script>alert(1)</script></svg>'.padEnd(64, " ")), /not a picture/, 415],
  ["a tiny picture", jpeg(100, 100), /too small/, 422], ["a picture over 4 MB", Buffer.concat([jpeg(), Buffer.alloc(4.1 * 1024 * 1024)]), /too large/, 413], ["an empty upload", Buffer.alloc(0), /Choose a picture/, 400]];
for (const [label, buf, re, status] of bad) await denied(`upload of ${label}`, () => F.savePhoto(db, vc.uid, buf), re, status);
const st0 = await F.getFlyerState(db, vc.uid); assert.equal(st0.hasPhoto, false); assert.equal(st0.username, "Vee_Cee"); assert.equal(st0.positionTitle, "Vice-Chancellor");
for (const [type, buf] of [["jpeg", jpeg()], ["png", jpeg(800, 1000, "png")], ["webp", jpeg(800, 1000, "webp")]]) { const r = await F.savePhoto(db, vc.uid, buf); assert.equal(r.hasPhoto, true, type); }
const stored = await db.sugCandidatePhoto.findMany(); assert.equal(stored.length, 1, "one photo per candidacy (replaced, not added)"); assert.equal(stored[0].mime, "image/jpeg");
assert.ok(F.sniffImage(Buffer.from(stored[0].bytes)).type === "jpeg" && stored[0].width <= 1600 && stored[0].height <= 1600);
ok("only JPEG/PNG/WebP pictures of a sensible size are accepted, are re-encoded to one stored JPEG, and one is kept per candidate");
const dvcId = (await db.sugCandidate.findFirst({ where: { position: "DEPUTY_VICE_CHANCELLOR" } })).id, vcId = rv.candidateId;
await F.savePhoto(db, dvc.uid, jpeg());
await denied("a flyer for another candidate by id", () => F.makeFlyer(db, vc.uid, { candidateId: dvcId }), /not your candidacy/, 403);
await denied("a flyer claiming a different position", () => F.makeFlyer(db, vc.uid, { position: "PRESIDENT" }), /not standing for that position/, 403);
await denied("reading another candidate's photo", () => F.getPhoto(db, vc.uid, { candidateId: dvcId }), /not your candidacy/, 403);
await denied("uploading onto another candidate", () => F.savePhoto(db, vc.uid, jpeg(), { candidateId: dvcId }), /not your candidacy/, 403);
ok("a candidate cannot make a flyer, read a photo or upload for another candidate or another position, even by naming them");

// ---------- the flyer itself ----------
const f = await F.makeFlyer(db, vc.uid, { candidateId: vcId, position: "VICE_CHANCELLOR" });
assert.equal(f.png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a"); assert.deepEqual([f.width, f.height], [1620, 2025]);
assert.equal(f.words.headline, "VOTE FOR @VEE_CEE AS VICE-CHANCELLOR ON LIFEINOAU"); assert.equal(f.words.action, "VISIT LIFEINOAU.COM NOW TO VOTE");
assert.ok(f.lines.includes("@VEE_CEE") && f.lines.includes("AS VICE-CHANCELLOR") && f.lines.includes("VISIT LIFEINOAU.COM NOW TO VOTE") && f.lines.includes("lifeinoau"));
const f2 = await F.makeFlyer(db, vc.uid, {}); assert.deepEqual(f2.lines, f.lines); ok("the flyer is a real 1620x2025 PNG with the exact username, position and voting message; regenerating gives the same facts");
await F.savePhoto(db, pres.uid, jpeg()); const fp = await F.makeFlyer(db, pres.uid, {}); assert.equal(fp.words.headline, "VOTE FOR @PREZ AS SUG PRESIDENT ON LIFEINOAU");
await F.savePhoto(db, aRep.uid, jpeg()); const fa = await F.makeFlyer(db, aRep.uid, {}); assert.equal(fa.words.headline, "VOTE FOR @ARTSREP AS FACULTY REPRESENTATIVE ON LIFEINOAU"); assert.equal(fa.words.faculty, "ARTS");
await F.savePhoto(db, tRep.uid, jpeg()); assert.equal((await F.makeFlyer(db, tRep.uid, {})).words.faculty, "TECHNOLOGY");
ok("SUG and faculty candidates get the right post (and faculty) on their flyers automatically");

// ---------- voting ----------
const v1 = await mk("Voter_One", { level: 100, facultyId: tech }), v2 = await mk("Voter_Two", { level: 100, facultyId: arts }), v3 = await mk("Voter_Three", { level: 100, facultyId: tech });
await db.$executeRaw`UPDATE "SugCycle" SET "announcedAt" = ${new Date(t(-5))}, "registrationOpensAt" = ${new Date(t(-4))}, "campaignStartsAt" = ${new Date(t(-2))}, "votingStartsAt" = ${new Date(t(-1))} WHERE id = ${cycle.id}`; // voting opens (allowed: it had not begun)
await S.advance(db);
await denied("a flyer-less non-vote on a candidate in another race", () => S.vote(db, v1.uid, { position: "PRESIDENT", candidateId: vcId, requestId: rq() }), /not standing for this position/, 404);
const r1 = await S.vote(db, v1.uid, { position: "VICE_CHANCELLOR", candidateId: vcId, requestId: rq() }); assert.equal(r1.ok, true);
await denied("a second vote in the same race", () => S.vote(db, v1.uid, { position: "VICE_CHANCELLOR", candidateId: vcId, requestId: rq() }), /already voted/, 409);
const techRace = R.facultyPositionKey(tech), tRepId = (await db.sugCandidate.findFirst({ where: { position: techRace } })).id;
await denied("an Arts student voting in a Technology race", () => S.vote(db, v2.uid, { position: techRace, candidateId: tRepId, requestId: rq() }), /only students of that faculty/i, 403);
await S.vote(db, v3.uid, { position: techRace, candidateId: tRepId, requestId: rq() }); await S.vote(db, v1.uid, { position: techRace, candidateId: tRepId, requestId: rq() });
await S.vote(db, v2.uid, { position: "VICE_CHANCELLOR", candidateId: vcId, requestId: rq() });
await S.vote(db, v3.uid, { position: "PRESIDENT", candidateId: (await db.sugCandidate.findFirst({ where: { position: "PRESIDENT" } })).id, requestId: rq() }); // a candidate needs one valid vote to win
const counts = Object.fromEntries((await db.sugBallot.groupBy({ by: ["candidateId"], _count: { _all: true } })).map((x) => [x.candidateId, x._count._all]));
assert.equal(counts[vcId], 2); assert.equal(counts[tRepId], 2); ok("ballots are counted from the database; duplicate votes and cross-faculty votes are refused");
assert.equal((await F.makeFlyer(db, vc.uid, {})).words.headline.includes("WON"), false); ok("a flyer is still available while voting runs, and never claims a win");

// ---------- results: the new posts tally and form offices without stipends ----------
await db.$executeRaw`ALTER TABLE "SugCycle" DISABLE TRIGGER sug_cycle_lock`;
await db.$executeRaw`UPDATE "SugCycle" SET "votingEndsAt" = ${new Date(t(-0.5))}, "termStartsAt" = ${new Date(t(8))}, "termEndsAt" = ${new Date(t(8 + 168))} WHERE id = ${cycle.id}`;
await db.$executeRaw`ALTER TABLE "SugCycle" ENABLE TRIGGER sug_cycle_lock`;
const tl = await S.tally(db, cycle.id); assert.equal(tl.done, true);
const winners = await db.sugAppointment.findMany({ select: { position: true } }); const wp = winners.map((w) => w.position);
assert.ok(wp.includes("VICE_CHANCELLOR") && wp.includes(techRace) && wp.includes("PRESIDENT"), `winners ${wp}`);
const res = await S.getResults(db, vc.uid); assert.equal(res.races.find((r) => r.position === "VICE_CHANCELLOR").rows[0].votes, 2); assert.ok(res.races.find((r) => r.position === techRace).title.includes("Technology"));
ok("the tally decides university, SUG and faculty races from the ballots and records the winners");
await denied("a flyer after the election is decided", () => F.makeFlyer(db, vc.uid, {}), /no election running/, 409);
ok("no flyer can be made once the result is out");
await done();
