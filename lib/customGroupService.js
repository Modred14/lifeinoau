// lib/customGroupService.js
// Player-made groups: create, discover, join, invite, approve, roles, remove, delete. Every function re-reads the caller's role from the database;
// nothing the browser says about who may do what is trusted. Official faculty groups live in other tables, so nothing here can rename or delete one.
//
// Changes to a group run in a transaction that locks the group's row first, so two requests (two approvals for the last place, a removal racing a role
// change) are applied one after the other against fresh data.
import { GameError } from "./gameService.js";
import { cleanText } from "./rules.js";
import { likeEscape } from "./facultyGroupRules.js";
import { LIMITS, PRIVACY, checkName, cleanDescription, permissions, mayRemove } from "./customGroupRules.js";
import { unreadCount } from "./groupChat.js";

const visible = { user: { status: { not: "DELETED" } } }; // archived accounts are not listed or counted
const NOT_FOUND = () => new GameError("That group does not exist.", 404);
const DENIED = (m = "You do not have permission to do that.") => new GameError(m, 403);
const gid = (raw) => { const n = Number(raw); if (!Number.isInteger(n) || n < 1 || n > 2_147_483_647) throw NOT_FOUND(); return n; };
const taken = (e) => (e?.code === "P2002" || /CustomGroup_name_lower_key/.test(e?.message ?? "") ? new GameError("A group with that name already exists.", 409) : e);

async function self(db, userId) {
  const c = await db.character.findUnique({ where: { userId }, select: { id: true, name: true } });
  if (!c) throw new GameError("Create a character first.", 404);
  return c;
}
const roleIn = async (db, groupId, characterId) => (await db.customGroupMember.findUnique({ where: { groupId_characterId: { groupId, characterId } }, select: { role: true } }))?.role ?? null;
const accessOf = async (db, groupId, characterId) => (await db.customGroupAccess.findUnique({ where: { groupId_characterId: { groupId, characterId } }, select: { status: true } }))?.status ?? null;
const countMembers = (db, groupId) => db.customGroupMember.count({ where: { groupId, character: visible } });

/** Runs fn(tx, { me, group, role }) with the group row locked. */
async function locked(db, userId, rawId, fn) {
  const id = gid(rawId), me = await self(db, userId);
  return db.$transaction(async (tx) => {
    const [group] = await tx.$queryRaw`SELECT "id", "name", "privacy" FROM "CustomGroup" WHERE "id" = ${id}::int FOR UPDATE`;
    if (!group) throw NOT_FOUND();
    return fn(tx, { me, group, role: await roleIn(tx, id, me.id) });
  });
}

/** The room a member may talk in (lib/groupChat.js). Non-members are refused, whatever the group's privacy. */
export async function roomFor(db, userId, rawId) {
  const id = gid(rawId), me = await self(db, userId);
  if (!(await db.customGroup.findUnique({ where: { id }, select: { id: true } }))) throw NOT_FOUND();
  const role = await roleIn(db, id, me.id);
  if (!role) throw DENIED("Join this group to see its discussion.");
  return { kind: "custom", groupId: id, meId: me.id, role };
}

const card = (g, memberCount, extra = {}) => ({ id: g.id, name: g.name, description: g.description, privacy: g.privacy, memberCount, ...extra });
const countsFor = async (db, ids) => new Map(ids.length ? (await db.customGroupMember.groupBy({ by: ["groupId"], where: { groupId: { in: ids }, character: visible }, _count: { _all: true } })).map((r) => [r.groupId, r._count._all]) : []);

/** My groups (with unread counts) and the invitations waiting for me. */
export async function myGroups(db, userId) {
  const me = await self(db, userId);
  const [mine, invites] = await Promise.all([
    db.customGroupMember.findMany({ where: { characterId: me.id }, include: { group: true }, orderBy: { joinedAt: "desc" } }),
    db.customGroupAccess.findMany({ where: { characterId: me.id, status: "INVITED" }, include: { group: true }, orderBy: { createdAt: "desc" } }),
  ]);
  const counts = await countsFor(db, [...mine, ...invites].map((r) => r.groupId));
  return {
    groups: await Promise.all(mine.map(async (r) => card(r.group, counts.get(r.groupId) ?? 0, { role: r.role, unread: await unreadCount(db, { kind: "custom", groupId: r.groupId, meId: me.id }, r.lastReadId) }))),
    invites: invites.map((r) => card(r.group, counts.get(r.groupId) ?? 0, { status: "INVITED" })),
    limits: { owned: mine.filter((r) => r.role === "OWNER").length, maxOwned: LIMITS.ownedPerPlayer },
  };
}

/** Groups I am not in. Private ones are listed by name so that people can ask to join; their members and discussion stay hidden. */
export async function discover(db, userId, { q = "", offset = 0 } = {}) {
  const me = await self(db, userId);
  const term = cleanText(q, 40), skip = Math.min(Math.max(Math.trunc(Number(offset)) || 0, 0), 100_000);
  const rows = await db.customGroup.findMany({
    where: {
      members: { none: { characterId: me.id } },
      access: { none: { characterId: me.id, status: "REMOVED" } },
      ...(term ? { name: { contains: likeEscape(term), mode: "insensitive" } } : {}),
    },
    include: { access: { where: { characterId: me.id }, select: { status: true } }, _count: { select: { members: { where: { character: visible } } } } },
    orderBy: [{ members: { _count: "desc" } }, { id: "desc" }], skip, take: LIMITS.page + 1,
  });
  return { hasMore: rows.length > LIMITS.page, groups: rows.slice(0, LIMITS.page).map((g) => card(g, g._count.members, { status: g.access[0]?.status ?? null })) };
}

export async function createGroup(db, userId, { name, description = "", privacy = "PUBLIC" } = {}) {
  const me = await self(db, userId), n = checkName(name);
  if (n.error) throw new GameError(n.error, 400);
  if (!PRIVACY.includes(privacy)) throw new GameError("Choose public or private.", 400);
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${me.id} FOR UPDATE`; // two taps at once cannot both pass the limit
      if ((await tx.customGroupMember.count({ where: { characterId: me.id, role: "OWNER" } })) >= LIMITS.ownedPerPlayer) throw new GameError(`You can own up to ${LIMITS.ownedPerPlayer} groups.`, 409);
      await roomToJoin(tx, me.id);
      if (await tx.customGroup.findFirst({ where: { name: { equals: likeEscape(n.name), mode: "insensitive" } }, select: { id: true } })) throw new GameError("A group with that name already exists.", 409);
      const g = await tx.customGroup.create({ data: { name: n.name, description: cleanDescription(description), privacy, createdById: me.id, members: { create: { characterId: me.id, role: "OWNER" } } } });
      return { id: g.id };
    });
  } catch (e) { throw taken(e); }
}

/** One group, as much of it as this player may see. */
export async function detail(db, userId, rawId, { q = "", offset = 0 } = {}) {
  const id = gid(rawId), me = await self(db, userId);
  const g = await db.customGroup.findUnique({ where: { id } });
  if (!g) throw NOT_FOUND();
  const [role, status, memberCount] = await Promise.all([roleIn(db, id, me.id), accessOf(db, id, me.id), countMembers(db, id)]);
  const can = permissions(role), seesMembers = !!role || g.privacy === "PUBLIC";
  const term = cleanText(q, 30), skip = Math.min(Math.max(Math.trunc(Number(offset)) || 0, 0), 100_000);
  const [rows, waiting] = await Promise.all([
    seesMembers ? db.customGroupMember.findMany({ where: { groupId: id, character: { ...visible, ...(term ? { name: { contains: likeEscape(term), mode: "insensitive" } } : {}) } }, include: { character: { select: { name: true, level: true } } }, orderBy: [{ joinedAt: "asc" }, { characterId: "asc" }], skip, take: LIMITS.page + 1 }) : [],
    can.invite ? db.customGroupAccess.findMany({ where: { groupId: id, status: { in: ["INVITED", "REQUESTED"] }, character: visible }, include: { character: { select: { name: true, level: true } } }, orderBy: { createdAt: "asc" }, take: LIMITS.pendingPerGroup + 100 }) : [],
  ]);
  const person = (r) => ({ name: r.character.name, level: r.character.level });
  return {
    group: card(g, memberCount), role, status: role ? null : status, can,
    members: seesMembers ? rows.slice(0, LIMITS.page).map((r) => ({ ...person(r), role: r.role, isMe: r.characterId === me.id, canRemove: r.characterId !== me.id && mayRemove(role, r.role) })) : null,
    hasMore: rows.length > LIMITS.page,
    requests: waiting.filter((r) => r.status === "REQUESTED").map(person),
    invited: waiting.filter((r) => r.status === "INVITED").map(person),
  };
}

async function roomToJoin(tx, characterId) {
  if ((await tx.customGroupMember.count({ where: { characterId } })) >= LIMITS.joinedPerPlayer) throw new GameError(`A player can be in up to ${LIMITS.joinedPerPlayer} groups.`, 409);
}
async function admit(tx, groupId, characterId) {
  await tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${characterId} FOR NO KEY UPDATE`;
  await roomToJoin(tx, characterId);
  if ((await countMembers(tx, groupId)) >= LIMITS.membersPerGroup) throw new GameError("This group is full.", 409);
  await tx.customGroupMember.createMany({ data: [{ groupId, characterId, role: "MEMBER" }], skipDuplicates: true });
  await tx.customGroupAccess.deleteMany({ where: { groupId, characterId } });
}
const setAccess = (tx, groupId, characterId, status) =>
  tx.customGroupAccess.upsert({ where: { groupId_characterId: { groupId, characterId } }, update: { status, createdAt: new Date() }, create: { groupId, characterId, status } });

/** Another player by name (any letter case). */
async function player(tx, name) {
  const s = cleanText(name, 40);
  const p = s && await tx.character.findFirst({ where: { name: { equals: likeEscape(s), mode: "insensitive" }, ...visible }, select: { id: true, name: true } });
  if (!p) throw new GameError("No player with that name.", 404);
  return p;
}

const ACTIONS = {
  /** Join a public group, accept an invitation, or ask to join a private one. */
  async join(tx, { me, group, role }) {
    if (role) return { joined: true };
    const status = await accessOf(tx, group.id, me.id);
    if (status === "REMOVED") throw DENIED("You were removed from this group. An administrator can invite you back.");
    if (status === "INVITED" || group.privacy === "PUBLIC") { await admit(tx, group.id, me.id); return { joined: true }; }
    await setAccess(tx, group.id, me.id, "REQUESTED");
    return { requested: true };
  },
  /** Say no to an invitation, or take back a request. A removal stays on record. */
  async decline(tx, { me, group }) {
    await tx.customGroupAccess.deleteMany({ where: { groupId: group.id, characterId: me.id, status: { in: ["INVITED", "REQUESTED"] } } });
    return {};
  },
  async leave(tx, { me, group, role }) {
    if (!role) throw new GameError("You are not in this group.", 409);
    if (role === "OWNER") {
      if ((await countMembers(tx, group.id)) > 1) throw new GameError("Make someone else the owner before you leave, or delete the group.", 409);
      await tx.customGroup.delete({ where: { id: group.id } });
      return { deleted: true };
    }
    await tx.customGroupMember.delete({ where: { groupId_characterId: { groupId: group.id, characterId: me.id } } });
    return {};
  },
  async update(tx, { group, role }, b) {
    const can = permissions(role), data = {};
    if (!can.edit) throw DENIED();
    if (b.name !== undefined) {
      const n = checkName(b.name); if (n.error) throw new GameError(n.error, 400);
      if (await tx.customGroup.findFirst({ where: { id: { not: group.id }, name: { equals: likeEscape(n.name), mode: "insensitive" } }, select: { id: true } })) throw new GameError("A group with that name already exists.", 409);
      data.name = n.name;
    }
    if (b.description !== undefined) data.description = cleanDescription(b.description);
    if (b.privacy !== undefined && b.privacy !== group.privacy) {
      if (!can.changePrivacy) throw DENIED("Only the owner can change who may join.");
      if (!PRIVACY.includes(b.privacy)) throw new GameError("Choose public or private.", 400);
      data.privacy = b.privacy;
    }
    await tx.customGroup.update({ where: { id: group.id }, data });
    return {};
  },
  async delete(tx, { group, role }) {
    if (!permissions(role).destroy) throw DENIED("Only the owner can delete this group.");
    await tx.customGroup.delete({ where: { id: group.id } });
    return { deleted: true };
  },
  /** Invite a player. If they already asked to join, this lets them in. It also lifts an earlier removal (as an invitation they must accept). */
  async invite(tx, { me, group, role }, b) {
    if (!permissions(role).invite) throw DENIED();
    const p = await player(tx, b.name);
    if (await roleIn(tx, group.id, p.id)) throw new GameError(`${p.name} is already a member.`, 409);
    if (await tx.block.findFirst({ where: { OR: [{ blockerId: me.id, blockedId: p.id }, { blockerId: p.id, blockedId: me.id }] }, select: { id: true } })) throw DENIED("You cannot invite this player.");
    if ((await accessOf(tx, group.id, p.id)) === "REQUESTED") { await admit(tx, group.id, p.id); return { name: p.name, joined: true }; }
    if ((await tx.customGroupAccess.count({ where: { groupId: group.id, status: "INVITED" } })) >= LIMITS.pendingPerGroup) throw new GameError("Too many invitations are waiting. Cancel some first.", 409);
    await setAccess(tx, group.id, p.id, "INVITED");
    return { name: p.name, invited: true };
  },
  async approve(tx, { group, role }, b) {
    if (!permissions(role).invite) throw DENIED();
    const p = await player(tx, b.name);
    if ((await accessOf(tx, group.id, p.id)) !== "REQUESTED") throw new GameError("There is no request from that player.", 404);
    await admit(tx, group.id, p.id);
    return { name: p.name };
  },
  /** Turn down a request or cancel an invitation. */
  async reject(tx, { group, role }, b) {
    if (!permissions(role).invite) throw DENIED();
    const p = await player(tx, b.name);
    await tx.customGroupAccess.deleteMany({ where: { groupId: group.id, characterId: p.id, status: { in: ["INVITED", "REQUESTED"] } } });
    return { name: p.name };
  },
  async remove(tx, { me, group, role }, b) {
    if (!permissions(role).invite) throw DENIED();
    const p = await player(tx, b.name), theirs = await roleIn(tx, group.id, p.id);
    if (!theirs) throw new GameError("That player is not a member.", 404);
    if (p.id === me.id || !mayRemove(role, theirs)) throw DENIED("You cannot remove that member.");
    await tx.customGroupMember.delete({ where: { groupId_characterId: { groupId: group.id, characterId: p.id } } });
    await setAccess(tx, group.id, p.id, "REMOVED");
    return { name: p.name };
  },
  async role(tx, { me, group, role }, b) {
    if (!permissions(role).changeRoles) throw DENIED("Only the owner can change roles.");
    if (!["ADMIN", "MEMBER"].includes(b.role)) throw new GameError("Choose administrator or member.", 400);
    const p = await player(tx, b.name);
    if (p.id === me.id) throw new GameError("To step down, make someone else the owner.", 409);
    if (!(await roleIn(tx, group.id, p.id))) throw new GameError("That player is not a member.", 404);
    await tx.customGroupMember.update({ where: { groupId_characterId: { groupId: group.id, characterId: p.id } }, data: { role: b.role } });
    return { name: p.name };
  },
  async transfer(tx, { me, group, role }, b) {
    if (!permissions(role).transfer) throw DENIED("Only the owner can hand over the group.");
    const p = await player(tx, b.name);
    if (p.id === me.id) throw new GameError("You already own this group.", 409);
    if (!(await roleIn(tx, group.id, p.id))) throw new GameError("That player is not a member.", 404);
    await tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${p.id} FOR NO KEY UPDATE`;
    if ((await tx.customGroupMember.count({ where: { characterId: p.id, role: "OWNER" } })) >= LIMITS.ownedPerPlayer) throw new GameError(`${p.name} already owns ${LIMITS.ownedPerPlayer} groups.`, 409);
    // the old owner first: the database allows one owner per group at every moment
    await tx.customGroupMember.update({ where: { groupId_characterId: { groupId: group.id, characterId: me.id } }, data: { role: "ADMIN" } });
    await tx.customGroupMember.update({ where: { groupId_characterId: { groupId: group.id, characterId: p.id } }, data: { role: "OWNER" } });
    return { name: p.name };
  },
};

export async function act(db, userId, rawId, body = {}) {
  const fn = Object.hasOwn(ACTIONS, body.action) ? ACTIONS[body.action] : null;
  if (!fn) throw new GameError("Unknown action.", 400);
  try { return { ok: true, ...(await locked(db, userId, rawId, (tx, ctx) => fn(tx, ctx, body))) }; } catch (e) { throw taken(e); }
}
