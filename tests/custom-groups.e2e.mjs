// tests/custom-groups.e2e.mjs
// Custom groups and group discussions against a real Postgres, through the REAL route handlers (session replaced by globalThis.__uid).
// Also covers faculty membership on sign-up through the real character route and a faculty change.
// Run: DATABASE_URL=... node tests/custom-groups.e2e.mjs   (migrations applied; use a DISPOSABLE database. PRISMA_CLIENT / PRISMA_ADAPTER as in tests/chat.e2e.mjs.)
import { register } from "node:module";
register("./_route-loader.mjs", import.meta.url);
const { PrismaClient } = await import(process.env.PRISMA_CLIENT ?? "@prisma/client");
let db;
if (process.env.PRISMA_ADAPTER) { const { PrismaPg } = await import(process.env.PRISMA_ADAPTER); db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 20 }), transactionOptions: { maxWait: 15_000, timeout: 60_000 } }); }
else db = new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } });
globalThis.db = db;
const groups = await import("../src/app/api/groups/route.js");
const one = await import("../src/app/api/groups/[id]/route.js");
const msgs = await import("../src/app/api/groups/[id]/messages/route.js");
const fmsgs = await import("../src/app/api/faculty-groups/messages/route.js");
const overview = await import("../src/app/api/faculty-groups/route.js");
const chats = await import("../src/app/api/groups/chats/route.js");
const characterRoute = await import("../src/app/api/character/route.js");
const { PERSONALITIES } = await import("../lib/rules.js");

let passed = 0, failed = 0;
const ok = (c, name, extra = "") => { c ? passed++ : failed++; console.log(`${c ? "PASS" : "FAIL"}  ${name}${c ? "" : "  " + JSON.stringify(extra)}`); };
const req = (url, body) => new Request("http://x" + url, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const as = async (p, fn, url, body, id) => { globalThis.__uid = p?.userId ?? null; const res = await fn(req(url, body), { params: Promise.resolve({ id: String(id) }) }); return { status: res.status, json: await res.json().catch(() => null) }; };

const tag = "cg" + Math.random().toString(36).slice(2, 6);
const facA = await db.faculty.create({ data: { name: `Faculty of ${tag}A` } }), facB = await db.faculty.create({ data: { name: `Faculty of ${tag}B` } });
await db.gameClock.upsert({ where: { id: 1 }, update: {}, create: { id: 1, startedAt: new Date() } });
const user = async (n) => ({ userId: (await db.user.create({ data: { email: `${tag}_${n}@x.test`, passwordHash: "x", isAdult: true } })).id });
const mk = async (n, facultyId = facA.id) => {
  const u = await user(n);
  const c = await db.character.create({ data: { userId: u.userId, name: `${tag}_${n}`, gender: "F", class: "MAPO", facultyId, luck: 50, riskTolerance: 50, hostel: "Off-campus", lastTickWeek: 99999 } });
  return { ...u, id: c.id, name: c.name };
};
const memberships = (id) => db.facultyGroupMember.findMany({ where: { characterId: id }, include: { group: true } });

console.log("\n== sign-up and faculty ==");
const fresh = await user("new");
let r = await as(fresh, characterRoute.POST, "/api/character", { name: `${tag}new`, gender: "F", personalities: [PERSONALITIES[0]] });
ok(r.status === 400 && (await db.character.count({ where: { userId: fresh.userId } })) === 0, "no faculty: no character and no group", r);
ok((await as(fresh, overview.GET, "/api/faculty-groups")).status === 404, "an account without faculty information is in no faculty group");
r = await as(fresh, characterRoute.POST, "/api/character", { name: `${tag}new`, gender: "F", personalities: [PERSONALITIES[0]], facultyId: facA.id });
const born = await db.character.findUnique({ where: { userId: fresh.userId } });
let m = born ? await memberships(born.id) : [];
ok(r.status === 200 && m.length === 1 && m[0].group.facultyId === facA.id, "the real sign-up route puts a new player in their faculty group at once", r);
await Promise.all(Array.from({ length: 12 }, (_, i) => mk("race" + i, facB.id)));
ok((await db.facultyGroup.count({ where: { facultyId: facB.id } })) === 1 && (await db.facultyGroupMember.count({ where: { group: { facultyId: facB.id } } })) === 12, "12 players registering at once: one group, 12 memberships");

const owner = await mk("owner"), admin = await mk("admin"), mem = await mk("mem"), out = await mk("out", facB.id), guest = await mk("guest", facB.id);

console.log("\n== faculty discussion ==");
r = await as(owner, fmsgs.POST, "/m", { body: "hello faculty" }); ok(r.status === 200, "a member posts in their faculty discussion", r);
const fid = r.json.id;
r = await as(admin, overview.GET, "/api/faculty-groups"); ok(r.json.discussionUnread === 1, "a colleague has one unread", r.json);
r = await as(admin, fmsgs.GET, "/m"); ok(r.json.messages.some((x) => x.body === "hello faculty" && !x.canDelete), "a colleague reads it and cannot delete it", r.json);
ok(Math.abs(Date.parse(r.json.messages.find((x) => x.body === "hello faculty").at) - Date.now()) < 120_000, "a post carries the right time whatever the database's time zone", r.json.messages);
ok((await as(admin, overview.GET, "/api/faculty-groups")).json.discussionUnread === 0, "reading clears unread");
ok(!(await as(out, fmsgs.GET, "/m")).json.messages.some((x) => x.body === "hello faculty"), "another faculty never sees it");
ok((await as(out, fmsgs.POST, "/m", { action: "delete", id: fid })).status === 404, "another faculty cannot delete it");
ok((await as(admin, fmsgs.POST, "/m", { action: "delete", id: fid })).status === 403, "a colleague cannot delete it");
await db.block.create({ data: { blockerId: admin.id, blockedId: owner.id } });
ok(!(await as(admin, fmsgs.GET, "/m")).json.messages.some((x) => x.from === owner.name), "a blocked player's posts are hidden");
await db.block.deleteMany({ where: { blockerId: admin.id } });
ok((await as(null, fmsgs.GET, "/m")).status === 401 && (await as(null, groups.GET, "/api/groups")).status === 401, "login required");

await db.character.update({ where: { id: mem.id }, data: { facultyId: facB.id } });
m = await memberships(mem.id);
ok(m.length === 1 && m[0].group.facultyId === facB.id, "changing faculty moves the one membership");
ok(!(await as(mem, fmsgs.GET, "/m")).json.messages.some((x) => x.body === "hello faculty"), "and the old faculty's discussion is gone for them");

console.log("\n== create ==");
r = await as(owner, groups.POST, "/api/groups", { name: `${tag} Chess`, description: "Boards", privacy: "PUBLIC" });
ok(r.status === 200 && r.json.id, "a player creates a group", r); const g = r.json.id;
r = await as(owner, one.GET, "/g", undefined, g); ok(r.json.role === "OWNER" && r.json.group.memberCount === 1, "and is its owner", r.json);
ok((await as(admin, groups.POST, "/api/groups", { name: `${tag} CHESS` })).status === 409, "names are unique in any letter case");
ok((await as(admin, groups.POST, "/api/groups", { name: "Law Faculty Group" })).status === 400, "official names are refused");
ok((await as(admin, groups.POST, "/api/groups", { name: `${tag} Odd`, privacy: "SECRET" })).status === 400, "unknown privacy refused");
const same = await Promise.all([as(out, groups.POST, "/api/groups", { name: `${tag} Twin` }), as(guest, groups.POST, "/api/groups", { name: `${tag} Twin` })]);
ok(same.map((x) => x.status).sort().join() === "200,409", "two simultaneous creations of one name: exactly one wins", same);

console.log("\n== join, discover, permissions ==");
r = await as(admin, groups.GET, `/api/groups?view=discover&q=${tag}%20Chess`); ok(r.json.groups.length === 1, "a public group is discoverable", r.json);
for (const p of [admin, mem]) ok((await as(p, one.POST, "/g", { action: "join" }, g)).json.joined, "join a public group");
await as(admin, one.POST, "/g", { action: "join" }, g);
ok((await db.customGroupMember.count({ where: { groupId: g } })) === 3, "joining twice adds no second membership");
let dup; try { await db.customGroupMember.create({ data: { groupId: g, characterId: mem.id } }); } catch (e) { dup = e.code; }
ok(dup === "P2002", "the database refuses a duplicate membership", dup);
let two; try { await db.customGroupMember.update({ where: { groupId_characterId: { groupId: g, characterId: mem.id } }, data: { role: "OWNER" } }); } catch (e) { two = e.code ?? "refused"; }
ok(!!two, "the database refuses a second owner");
const attempts = [{ action: "update", name: `${tag} Hijack` }, { action: "delete" }, { action: "invite", name: guest.name }, { action: "remove", name: admin.name }, { action: "role", name: mem.name, role: "ADMIN" }, { action: "transfer", name: mem.name }, { action: "approve", name: guest.name }, { action: "reject", name: guest.name }];
for (const who of [mem, out]) for (const a of attempts) { const x = await as(who, one.POST, "/g", a, g); ok(x.status === 403, `${who === mem ? "a member" : "an outsider"} cannot ${a.action}`, x); }
ok((await as(mem, one.POST, "/g", { action: "constructor" }, g)).status === 400, "unknown actions are refused");
ok((await as(owner, one.POST, "/g", { action: "role", name: admin.name, role: "OWNER" }, g)).status === 400, "the role action cannot mint an owner");
ok((await as(owner, one.POST, "/g", { action: "role", name: admin.name, role: "ADMIN" }, g)).status === 200, "the owner makes an administrator");
for (const a of [{ action: "delete" }, { action: "transfer", name: mem.name }, { action: "role", name: mem.name, role: "ADMIN" }, { action: "update", privacy: "PRIVATE" }, { action: "remove", name: owner.name }]) ok((await as(admin, one.POST, "/g", a, g)).status === 403, `an administrator cannot ${a.action}`);
ok((await as(admin, one.POST, "/g", { action: "update", name: `${tag} Chess Club`, description: "New" }, g)).status === 200, "an administrator edits details");

console.log("\n== discussion, removal ==");
r = await as(mem, msgs.POST, "/m", { body: "e4" }, g); ok(r.status === 200, "a member posts", r); const mid = r.json.id;
ok((await as(out, msgs.GET, "/m", undefined, g)).status === 403 && (await as(out, msgs.POST, "/m", { body: "hi" }, g)).status === 403, "an outsider neither reads nor posts");
ok((await as(mem, msgs.POST, "/m", { body: "   " }, g)).status === 400, "empty posts refused");
ok((await as(admin, msgs.POST, "/m", { action: "delete", id: mid }, g)).status === 200, "an administrator deletes a member's post");
const own = (await as(owner, msgs.POST, "/m", { body: "rules" }, g)).json.id;
ok((await as(admin, msgs.POST, "/m", { action: "delete", id: own }, g)).status === 403, "but not the owner's");
ok((await as(admin, one.POST, "/g", { action: "remove", name: mem.name }, g)).status === 200, "an administrator removes a member");
ok((await as(mem, msgs.POST, "/m", { body: "back" }, g)).status === 403, "a removed player cannot post");
ok((await as(mem, one.POST, "/g", { action: "join" }, g)).status === 403, "nor rejoin");
await as(mem, one.POST, "/g", { action: "decline" }, g);
ok((await as(mem, one.POST, "/g", { action: "join" }, g)).status === 403, "declining does not erase the removal");
ok(!(await as(mem, groups.GET, `/api/groups?view=discover&q=${tag}%20Chess`)).json.groups.length, "and the group is not offered to them");
await as(owner, one.POST, "/g", { action: "invite", name: mem.name }, g);
ok((await as(mem, one.POST, "/g", { action: "join" }, g)).json.joined, "an invitation lets them back");

console.log("\n== private ==");
ok((await as(owner, one.POST, "/g", { action: "update", privacy: "PRIVATE" }, g)).status === 200, "the owner makes it private");
r = await as(out, one.GET, "/g", undefined, g); ok(r.json.members === null && r.json.requests.length === 0, "outsiders see no members of a private group", r.json);
ok((await as(out, one.POST, "/g", { action: "join" }, g)).json.requested && (await db.customGroupMember.count({ where: { groupId: g, characterId: out.id } })) === 0, "joining a private group only asks");
ok((await as(admin, one.GET, "/g", undefined, g)).json.requests.some((x) => x.name === out.name), "administrators see the request");
ok((await as(admin, one.POST, "/g", { action: "approve", name: out.name }, g)).status === 200 && (await db.customGroupMember.count({ where: { groupId: g, characterId: out.id } })) === 1, "approval admits");
ok((await as(admin, one.POST, "/g", { action: "approve", name: guest.name }, g)).status === 404, "nobody is approved without asking");
ok((await as(admin, one.POST, "/g", { action: "invite", name: guest.name.toUpperCase() }, g)).json.invited, "invite by name, any case");
ok((await as(guest, groups.GET, "/api/groups")).json.invites.some((x) => x.id === g), "the invitation appears in My Groups");
await as(guest, one.POST, "/g", { action: "decline" }, g);
ok((await as(guest, one.POST, "/g", { action: "join" }, g)).json.requested, "after declining, joining needs approval again");
ok((await as(admin, one.POST, "/g", { action: "invite", name: "%" }, g)).status === 404, "a wildcard is not a player name");
const blocked = await mk("blk"); await db.block.create({ data: { blockerId: blocked.id, blockedId: admin.id } });
ok((await as(admin, one.POST, "/g", { action: "invite", name: blocked.name }, g)).status === 403, "a block stops invitations");

console.log("\n== group chats in Messages ==");
const listOf = async (p) => (await as(p, chats.GET, "/api/groups/chats")).json.chats;
await as(out, msgs.POST, "/m", { body: "hello club" }, g);
let list = await listOf(owner);
ok(list.filter((c) => c.kind === "faculty").length === 1 && list.some((c) => c.kind === "custom" && c.id === g), "Messages lists my faculty group and my custom groups", list);
let row = list.find((c) => c.id === g && c.kind === "custom");
ok(row.last.body === "hello club" && row.last.from === out.name && !row.last.mine && row.unread >= 1, "with the last post, its sender and the unread count", row);
await as(owner, msgs.GET, "/m", undefined, g);
ok((await listOf(owner)).find((c) => c.id === g && c.kind === "custom").unread === 0, "opening the chat clears its unread count");
const lone = await mk("lone", facB.id);
list = await listOf(lone);
ok(list.length === 1 && list[0].kind === "faculty" && !JSON.stringify(list).includes("hello faculty"), "a player in no custom group sees only their own faculty group", list);
await db.block.create({ data: { blockerId: owner.id, blockedId: out.id } });
ok((await listOf(owner)).find((c) => c.id === g && c.kind === "custom").last?.body !== "hello club", "a blocked player's post is not previewed");
await db.block.deleteMany({ where: { blockerId: owner.id } });
const nobody = await user("nochar");
ok((await listOf(nobody)).length === 0 && (await as(null, chats.GET, "/api/groups/chats")).status === 401, "no character: an empty list; no login: refused");

console.log("\n== leave, transfer, delete ==");
ok((await as(owner, one.POST, "/g", { action: "leave" }, g)).status === 409, "the owner cannot walk out on a group with members");
ok((await as(owner, one.POST, "/g", { action: "transfer", name: admin.name }, g)).status === 200, "ownership is handed over");
ok((await as(owner, one.GET, "/g", undefined, g)).json.role === "ADMIN" && (await db.customGroupMember.count({ where: { groupId: g, role: "OWNER" } })) === 1, "still exactly one owner");
ok((await as(owner, one.POST, "/g", { action: "leave" }, g)).status === 200, "the former owner leaves");
await db.character.delete({ where: { id: admin.id } });
ok((await db.customGroupMember.count({ where: { groupId: g, role: "OWNER" } })) === 1, "if the owner's character is erased, someone takes over");
const solo = (await as(owner, groups.POST, "/api/groups", { name: `${tag} Solo` })).json.id;
ok((await as(owner, one.POST, "/g", { action: "leave" }, solo)).json.deleted, "the last member leaving removes the group");
const d = (await as(owner, groups.POST, "/api/groups", { name: `${tag} Doomed` })).json.id;
await as(owner, msgs.POST, "/m", { body: "bye" }, d);
ok((await as(owner, one.POST, "/g", { action: "delete" }, d)).status === 200 && (await db.groupMessage.count({ where: { customGroupId: d } })) === 0, "the owner deletes a group and its messages");
ok((await as(owner, one.GET, "/g", undefined, d)).status === 404 && (await as(owner, one.GET, "/g", undefined, "abc")).status === 404, "gone and malformed ids are 404");
ok((await db.facultyGroup.count({ where: { facultyId: facA.id } })) === 1, "the faculty group is untouched by any of this");
for (let i = 0; i < 5; i++) await as(fresh, groups.POST, "/api/groups", { name: `${tag} Limit ${i}` });
ok((await as(fresh, groups.POST, "/api/groups", { name: `${tag} Limit 6` })).status === 409, "ownership limit");

console.log(`\n${passed} passed, ${failed} failed`);
await db.$disconnect();
process.exit(failed ? 1 : 0);
