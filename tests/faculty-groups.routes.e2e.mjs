// tests/faculty-groups.routes.e2e.mjs
// Calls the REAL Faculty Groups route handlers (src/app/api/faculty-groups/*) against a real Postgres, with the session replaced by globalThis.__uid.
// Checks what the HTTP layer adds on top of the services: login required, status codes, JSON shape, nothing sensitive in responses, rate limiting.
// Run: DATABASE_URL=... PRISMA_CLIENT=... PRISMA_ADAPTER=... node tests/faculty-groups.routes.e2e.mjs   (migrations applied; disposable database)
import { register } from "node:module";
register("./_route-loader.mjs", import.meta.url);
const { PrismaClient } = await import(process.env.PRISMA_CLIENT ?? "@prisma/client");
let db;
if (process.env.PRISMA_ADAPTER) { const { PrismaPg } = await import(process.env.PRISMA_ADAPTER); db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 10 }) }); }
else db = new PrismaClient();
globalThis.db = db; // the routes use globalThis.db when it exists

const overview = await import("../src/app/api/faculty-groups/route.js");
const members = await import("../src/app/api/faculty-groups/members/route.js");
const profile = await import("../src/app/api/faculty-groups/profile/route.js");
const convo = await import("../src/app/api/faculty-groups/conversation/route.js");
const elections = await import("../src/app/api/faculty-groups/elections/route.js");

let passed = 0, failed = 0;
const ok = (c, name, extra = "") => { c ? passed++ : failed++; console.log(`${c ? "PASS" : "FAIL"}  ${name}${c ? "" : "  " + extra}`); };
const req = (url, body) => new Request("http://x" + url, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const call = async (fn, r) => { const res = await fn(r); const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {} return { status: res.status, json, text }; };

const tag = "fgr_" + Math.random().toString(36).slice(2, 6);
const facA = await db.faculty.create({ data: { name: `Faculty of ${tag}A` } }), facB = await db.faculty.create({ data: { name: `Faculty of ${tag}B` } });
const mk = async (n, facultyId) => {
  const u = await db.user.create({ data: { email: `${tag}_${n}@x.test`, passwordHash: "secret-hash", isAdult: true } });
  const c = await db.character.create({ data: { userId: u.id, name: `${tag}_${n}`, gender: "F", class: "MAPO", facultyId, luck: 50, riskTolerance: 50, hostel: "Off-campus", lastTickWeek: 99999 } });
  await db.account.create({ data: { kind: "PLAYER", characterId: c.id } });
  return { userId: u.id, id: c.id, name: c.name };
};
const a1 = await mk("a1", facA.id), a2 = await mk("a2", facA.id), b1 = await mk("b1", facB.id);

console.log("\n== login required ==");
globalThis.__uid = null;
for (const [name, fn, r] of [["overview", overview.GET, req("/")], ["members", members.GET, req("/?q=")], ["profile", profile.GET, req("/?name=x")], ["conversation", convo.POST, req("/", { name: "x" })], ["elections", elections.GET, req("/")]]) {
  const r2 = await call(fn, r);
  ok(r2.status === 401 && r2.json?.error, `${name}: no session gets 401 with a JSON error`, r2.text);
}

console.log("\n== signed in ==");
globalThis.__uid = a1.userId;
let r = await call(overview.GET, req("/"));
ok(r.status === 200 && r.json.memberCount === 2 && r.json.group.faculty === facA.name, "overview: 200 with the group and its real member count", r.text);
r = await call(members.GET, req("/?q="));
ok(r.status === 200 && r.json.members.length === 1 && r.json.members[0].name === a2.name, "members: 200, my faculty only", r.text);
r = await call(members.GET, req("/?q=" + encodeURIComponent(b1.name)));
ok(r.status === 200 && r.json.members.length === 0, "members: searching for another faculty's player finds nobody");
r = await call(profile.GET, req("/?name=" + encodeURIComponent(a2.name)));
ok(r.status === 200 && r.json.name === a2.name && r.json.canMessage === true, "profile: a colleague opens");
const all = r.text + (await call(overview.GET, req("/"))).text + (await call(members.GET, req("/?q="))).text;
ok(!/@x\.test|secret-hash|passwordHash|email/i.test(all), "no email or password data in any response");
r = await call(profile.GET, req("/?name=" + encodeURIComponent(b1.name)));
ok(r.status === 404 && r.json.error, "profile: a player of another faculty is a 404");
r = await call(profile.GET, req("/"));
ok(r.status === 404, "profile: a missing name is a 404 (not a crash)");
r = await call(convo.POST, req("/", { name: a2.name }));
ok(r.status === 200 && r.json.name === a2.name && r.json.chatId > 0, "conversation: opens with a colleague");
r = await call(convo.POST, req("/", { name: b1.name }));
ok(r.status === 404, "conversation: another faculty is refused (404)");
ok((await db.chat.count({ where: { OR: [{ aId: b1.id }, { bId: b1.id }] } })) === 0, "...and nothing was created");
r = await call(convo.POST, req("/", { name: a1.name }));
ok(r.status === 400, "conversation: yourself is a 400");
r = await call(convo.POST, req("/", "{ not json"));
ok(r.status === 404 && r.json.error, "conversation: a malformed body is handled, not a 500");
r = await call(convo.POST, req("/", { name: { $ne: null } }));
ok(r.status === 404, "conversation: an object where a name belongs is handled");
r = await call(elections.GET, req("/"));
ok(r.status === 200 && Array.isArray(r.json.races) && "cycle" in r.json && r.json.offices, "elections: 200 with races, cycle and offices");
ok(!JSON.stringify(r.json).includes(b1.name), "elections: nothing from another faculty");
ok(elections.POST === undefined && convo.GET === undefined && members.POST === undefined, "elections are read-only here (no POST), and conversation is POST-only");

console.log("\n== another player, same checks from their side ==");
globalThis.__uid = b1.userId;
r = await call(members.GET, req("/?q="));
ok(r.status === 200 && r.json.total === 0 && r.json.members.length === 0, "faculty B's directory has only B (just them: nobody else)");
r = await call(profile.GET, req("/?name=" + encodeURIComponent(a1.name)));
ok(r.status === 404, "faculty B cannot open faculty A's profile");
r = await call(convo.POST, req("/", { name: a1.name }));
ok(r.status === 404, "faculty B cannot open a conversation with faculty A");

console.log("\n== rate limiting ==");
globalThis.__uid = a1.userId;
const burst = await Promise.all(Array.from({ length: 60 }, () => call(convo.POST, req("/", { name: a2.name }))));
ok(burst.some((x) => x.status === 429) && burst.filter((x) => x.status === 200).length <= 40, `conversation: more than 40 a minute is limited (${burst.filter((x) => x.status === 200).length} ok, ${burst.filter((x) => x.status === 429).length} limited)`);

console.log("\n== cleanup ==");
try {
  const ids = [a1.id, a2.id, b1.id];
  await db.message.deleteMany({}); await db.chat.deleteMany({ where: { OR: [{ aId: { in: ids } }, { bId: { in: ids } }] } });
  await db.account.deleteMany({ where: { characterId: { in: ids } } }); await db.character.deleteMany({ where: { id: { in: ids } } });
  await db.user.deleteMany({ where: { email: { startsWith: tag } } }); await db.faculty.deleteMany({ where: { id: { in: [facA.id, facB.id] } } });
  console.log("cleaned up");
} catch (e) { console.log("NOTE  cleanup incomplete:", String(e.message).split("\n")[0].slice(0, 100)); }
console.log(`\n${passed} passed, ${failed} failed`);
await db.$disconnect(); process.exit(failed ? 1 : 0);
