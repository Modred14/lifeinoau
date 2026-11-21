// lib/facultyGroupService.js
// Faculty groups: which group a player is in, who else is in it, their public profile, and starting a private chat with a colleague.
//
// Membership is NOT decided by the browser. Every player is in exactly one group, the group of Character.facultyId, and database triggers
// (prisma/migrations/20261121000000_faculty_groups) keep that true on sign-up, on backfill and on any later faculty change. Each function here
// still re-checks "same faculty" from Character.facultyId on the server, so a forged request can never reach a player outside the group.
// Private messages are NOT a second chat system: a conversation is the existing Chat row (lib/chatCore.js), found or made for the pair, so
// history, unread counts, blocks and real-time delivery are the ones every conversation already has.
import { GameError, getProfile } from "./gameService.js";
import { chatFor, whoAmI } from "./chatCore.js";
import { settingsOf } from "./settings.js";
import { cleanText } from "./rules.js";
import { groupName, likeEscape } from "./facultyGroupRules.js";
import { facultyPositionKeys, titleOf } from "./sugRules.js";

export const PAGE = 30;
export const ONLINE_RECENT_MS = 3 * 60_000; // no realtime server: "online" = a signed-in request in the last 3 minutes (User.lastActiveAt)

// ---------------------------------------------------------------------------------------------------- who is online
let liveCache = { at: 0, set: null };
/** The ids of players with an open socket, from the realtime server (cached 15 s). Null when there is no realtime server or it did not answer. */
async function liveIds(now = Date.now()) {
  if (liveCache.at && now - liveCache.at < 15_000) return liveCache.set;
  let set = null;
  if (process.env.REALTIME_URL) {
    const { askRealtime } = await import("./realtimeNotify.js");
    const r = await askRealtime({ type: "online" });
    if (r?.ids) set = new Set(r.ids);
  }
  liveCache = { at: now, set };
  return set;
}
export const _resetLive = () => { liveCache = { at: 0, set: null }; };

/** A function (characterId, lastActiveAt) -> boolean using the best presence source there is. */
async function onlineTest(now = Date.now()) {
  const live = await liveIds(now);
  return live ? (id) => live.has(id) : (_id, lastActive) => !!lastActive && now - +new Date(lastActive) < ONLINE_RECENT_MS;
}

// ---------------------------------------------------------------------------------------------------- me and my group
/** The signed-in player and their group. Heals a missing membership (the triggers make that impossible, this is the belt to their braces). */
export async function myGroup(db, userId) {
  const c = await db.character.findUnique({ where: { userId }, select: { id: true, name: true, level: true, facultyId: true, faculty: { select: { name: true } }, user: { select: { status: true } } } });
  if (!c) throw new GameError("Create a character first.", 404);
  let m = await db.facultyGroupMember.findUnique({ where: { characterId: c.id }, select: { groupId: true, group: { select: { facultyId: true } } } });
  if (!m || m.group.facultyId !== c.facultyId) {
    const g = await db.facultyGroup.upsert({ where: { facultyId: c.facultyId }, update: {}, create: { facultyId: c.facultyId }, select: { id: true } });
    await db.$executeRaw`INSERT INTO "FacultyGroupMember" ("groupId","characterId") VALUES (${g.id}, ${c.id}) ON CONFLICT ("characterId") DO UPDATE SET "groupId" = EXCLUDED."groupId", "joinedAt" = CURRENT_TIMESTAMP WHERE "FacultyGroupMember"."groupId" <> EXCLUDED."groupId"`;
    m = { groupId: g.id };
  }
  return { me: { id: c.id, name: c.name, level: c.level, userId }, groupId: m.groupId, facultyId: c.facultyId, facultyName: c.faculty.name };
}

/** Which of these players hold one of THIS faculty's two SUG posts right now: Map(characterId -> "Faculty Representative" | "Assistant Faculty Representative"). */
async function facultyPosts(db, facultyId, characterIds, now) {
  const at = new Date(now), keys = facultyPositionKeys(facultyId);
  const rows = await db.sugAppointment.findMany({ where: { characterId: { in: characterIds }, position: { in: keys }, status: "ACTIVE", term: { startsAt: { lte: at }, endsAt: { gt: at } } }, select: { characterId: true, position: true } });
  return new Map(rows.map((r) => [r.characterId, titleOf(r.position)]));
}

const visible = { user: { status: { not: "DELETED" } } }; // archived accounts are not listed or counted

/** The people who hold this faculty's two posts right now (an appointment counts only while its term window contains the current time). */
export async function facultyOffices(db, facultyId, now = Date.now()) {
  const at = new Date(now), keys = facultyPositionKeys(facultyId);
  const rows = await db.sugAppointment.findMany({
    where: { position: { in: keys }, status: "ACTIVE", term: { startsAt: { lte: at }, endsAt: { gt: at } } },
    select: { position: true, characterId: true, term: { select: { startsAt: true } } },
  });
  // SugAppointment keeps a plain characterId (no relation), so the people are read in a second query. Only players still IN this faculty can hold its posts.
  const people = rows.length ? await db.character.findMany({ where: { id: { in: rows.map((r) => r.characterId) }, facultyId, ...visible }, select: { id: true, name: true, level: true } }) : [];
  const [rep, asst] = keys, who = new Map(people.map((p) => [p.id, p]));
  const one = (k, title) => { const r = rows.find((x) => x.position === k && who.has(x.characterId)); const p = r && who.get(r.characterId); return { title, holder: p ? { name: p.name, level: p.level, since: r.term.startsAt } : null }; };
  return { REPRESENTATIVE: one(rep, "Faculty Representative"), ASSISTANT: one(asst, "Assistant Faculty Representative") };
}


/** Another player of MY faculty, by name (any letter case). A player outside the faculty, or a name nobody has, is "not found": nothing about them is revealed. */
async function colleague(db, g, name) {
  const s = cleanText(name, 40);
  const p = s && await db.character.findFirst({ where: { name: { equals: s, mode: "insensitive" }, facultyId: g.facultyId, id: { not: g.me.id }, ...visible }, select: { id: true, name: true } });
  if (!p) throw new GameError("No such member in your faculty group.", 404);
  return p;
}

/** The group's front page: its name, how many members, who is online, who holds each office, and unread messages from colleagues. */
export async function overview(db, userId) {
  const g = await myGroup(db, userId), now = Date.now();
  const [memberCount, offices, unread, ids] = await Promise.all([
    db.facultyGroupMember.count({ where: { groupId: g.groupId, character: visible } }),
    facultyOffices(db, g.facultyId, now),
    db.$queryRaw`SELECT COALESCE(SUM(CASE WHEN c."aId" = ${g.me.id} THEN c."aUnread" ELSE c."bUnread" END), 0)::int AS n
      FROM "Chat" c JOIN "FacultyGroupMember" m ON m."characterId" = CASE WHEN c."aId" = ${g.me.id} THEN c."bId" ELSE c."aId" END
      WHERE (c."aId" = ${g.me.id} OR c."bId" = ${g.me.id}) AND m."groupId" = ${g.groupId}`,
    db.facultyGroupMember.findMany({ where: { groupId: g.groupId, character: visible }, select: { characterId: true, character: { select: { user: { select: { lastActiveAt: true } } } } } }),
  ]);
  const isOn = await onlineTest(now);
  return {
    group: { id: g.groupId, name: groupName(g.facultyName), faculty: g.facultyName },
    me: { name: g.me.name, level: g.me.level },
    memberCount, onlineCount: ids.filter((m) => isOn(m.characterId, m.character.user.lastActiveAt)).length,
    unread: Number(unread[0]?.n ?? 0),
    offices, // the SUG election's faculty posts, held right now (see lib/facultyGroupElections.js)
  };
}

/** The member directory: colleagues of the same faculty, A to Z, searchable by name, `limit` at a time. */
export async function members(db, userId, { q = "", offset = 0, limit = PAGE } = {}) {
  const g = await myGroup(db, userId), now = Date.now();
  const lim = Math.min(Math.max(Math.trunc(Number(limit)) || PAGE, 1), 50), skip = Math.min(Math.max(Math.trunc(Number(offset)) || 0, 0), 100_000), term = cleanText(q, 30);
  const where = { facultyId: g.facultyId, id: { not: g.me.id }, ...visible, ...(term ? { name: { contains: likeEscape(term), mode: "insensitive" } } : {}) }; // Prisma does not escape % and _ itself: a typed % must not match everyone
  const [rows, total] = await Promise.all([
    db.character.findMany({ where, orderBy: [{ name: "asc" }], skip, take: lim + 1, select: { id: true, name: true, level: true, gender: true, user: { select: { lastActiveAt: true } } } }),
    db.character.count({ where }),
  ]);
  const page = rows.slice(0, lim), ids = page.map((r) => r.id);
  const [chats, seen, held] = await Promise.all([
    ids.length ? db.chat.findMany({ where: { OR: [{ aId: g.me.id, bId: { in: ids } }, { bId: g.me.id, aId: { in: ids } }] }, select: { aId: true, aUnread: true, bUnread: true, bId: true } }) : [],
    ids.length ? db.presence.findMany({ where: { characterId: { in: ids } }, select: { characterId: true, lastSeen: true } }) : [],
    ids.length ? facultyPosts(db, g.facultyId, ids, now) : new Map(),
  ]);
  const unread = new Map(chats.map((c) => [c.aId === g.me.id ? c.bId : c.aId, c.aId === g.me.id ? c.aUnread : c.bUnread])), last = new Map(seen.map((s) => [s.characterId, s.lastSeen]));
  const isOn = await onlineTest(now);
  return {
    total, hasMore: rows.length > lim, offset: skip,
    members: page.map((r) => ({
      name: r.name, level: r.level, gender: r.gender,
      department: null, // players do not choose a department in LifeinOAU yet (Character has no department): shown only once it exists
      office: held.get(r.id) ?? null,
      online: isOn(r.id, r.user.lastActiveAt), lastSeen: last.get(r.id) ?? r.user.lastActiveAt ?? null,
      unread: unread.get(r.id) ?? 0,
    })),
  };
}

/** A colleague's public profile: what the game already shows any player (never an email, money or standing), plus whether they are online. */
export async function memberProfile(db, userId, name) {
  const g = await myGroup(db, userId), p = await colleague(db, g, name), now = Date.now();
  const [pub, u, held, seen] = await Promise.all([
    getProfile(db, userId, p.name),
    db.character.findUnique({ where: { id: p.id }, select: { user: { select: { lastActiveAt: true } } } }),
    facultyPosts(db, g.facultyId, [p.id], now),
    db.presence.findUnique({ where: { characterId: p.id }, select: { lastSeen: true } }),
  ]);
  const isOn = await onlineTest(now);
  return {
    name: pub.name, gender: pub.gender, faculty: pub.faculty, level: pub.level, class: pub.class, department: null,
    cgpa: pub.cgpa, popularity: pub.popularity, achievements: pub.achievements, relationship: pub.relationship, office: pub.office, look: pub.look,
    facultyOffice: held.get(p.id) ?? null,
    online: isOn(p.id, u.user.lastActiveAt), lastSeen: seen?.lastSeen ?? u.user.lastActiveAt ?? null,
    canMessage: true,
  };
}

/**
 * Start (or reopen) the private conversation with a colleague. The server decides: same faculty group, not yourself, not blocked either way.
 * There is one Chat row per pair (a unique key), so asking twice, or both players asking at once, gives the same conversation.
 * Returns { name }: the browser then opens the normal Messages app on that name.
 */
export async function openConversation(db, userId, name) {
  const g = await myGroup(db, userId);
  if (cleanText(name, 40).toLowerCase() === g.me.name.toLowerCase()) throw new GameError("You cannot message yourself.", 400);
  const p = await colleague(db, g, name);
  const blocked = await db.block.findFirst({ where: { OR: [{ blockerId: g.me.id, blockedId: p.id }, { blockerId: p.id, blockedId: g.me.id }] }, select: { id: true } });
  if (blocked) throw new GameError("You cannot message this player.", 403);
  const me = await whoAmI(db, userId);
  const chat = await chatFor(db, me.id, p.id, { create: true });
  return { name: p.name, chatId: chat.id };
}
