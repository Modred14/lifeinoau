// lib/groupChat.js
// The discussion of a group, faculty or custom. Private messages stay in lib/chatCore.js (one Chat row per pair, which cannot hold a group), so this
// reuses its text cleaning, send allowance and blocks, and stores group posts in GroupMessage. Callers (facultyGroupService, customGroupService) decide
// WHO may use a group and pass the result in as `room`; every write below still re-checks membership in the same statement.
//   room = { kind: "faculty" | "custom", groupId, meId, role }   (role: custom groups only)
import { cleanBody } from "./chatShared.js";
import { takeSendToken, blockSets, ChatError } from "./chatCore.js";

export const GROUP_CHAT = { page: 40, keep: 300, trimEvery: 25, maxLength: 1000 };

const column = (room) => (room.kind === "faculty" ? "facultyGroupId" : "customGroupId");
const memberModel = (db, room) => (room.kind === "faculty" ? db.facultyGroupMember : db.customGroupMember);
const memberWhere = (room) => ({ groupId: room.groupId, characterId: room.meId });
const idOf = (raw) => { if (!/^\d{1,18}$/.test(String(raw))) throw new ChatError("That message is no longer available.", 404); return BigInt(raw); };

/** May this player delete this message? Their own always; in a custom group the owner any, an administrator those of regular members. */
function mayDelete(room, senderId, senderRole) {
  if (senderId === room.meId) return true;
  if (room.kind !== "custom") return false;
  return room.role === "OWNER" || (room.role === "ADMIN" && (senderRole ?? "MEMBER") === "MEMBER");
}

async function hiddenSenders(db, meId) {
  const { byMe, byThem } = await blockSets(db, meId);
  return [...new Set([...byMe, ...byThem])];
}

/** The newest posts (or the page before `before`), oldest first. Reading the newest page marks the group as read. Blocked players' posts are left out. */
export async function readMessages(db, room, { before } = {}) {
  const hidden = await hiddenSenders(db, room.meId);
  const rows = await db.groupMessage.findMany({
    where: { [column(room)]: room.groupId, senderId: { notIn: hidden }, ...(before ? { id: { lt: idOf(before) } } : {}) },
    orderBy: { id: "desc" }, take: GROUP_CHAT.page + 1, include: { sender: { select: { name: true } } },
  });
  const list = rows.slice(0, GROUP_CHAT.page).reverse();
  const roles = room.kind === "custom" && list.length
    ? new Map((await db.customGroupMember.findMany({ where: { groupId: room.groupId, characterId: { in: list.map((m) => m.senderId) } }, select: { characterId: true, role: true } })).map((r) => [r.characterId, r.role]))
    : new Map();
  if (!before && list.length) {
    const newest = list[list.length - 1].id;
    await memberModel(db, room).updateMany({ where: { ...memberWhere(room), lastReadId: { lt: newest } }, data: { lastReadId: newest } });
  }
  return {
    hasMore: rows.length > GROUP_CHAT.page,
    messages: list.map((m) => ({
      id: Number(m.id), from: m.sender.name, mine: m.senderId === room.meId, at: m.createdAt,
      deleted: !!m.deletedAt, body: m.deletedAt ? "This message was deleted" : m.body,
      canDelete: !m.deletedAt && mayDelete(room, m.senderId, roles.get(m.senderId)),
    })),
  };
}

export async function sendMessage(db, room, body) {
  const text = cleanBody(body, GROUP_CHAT.maxLength);
  if (!text) throw new ChatError("Write a message first.");
  if (!takeSendToken(room.meId)) throw new ChatError("Slow down a little. You are sending messages too fast.", 429);
  // one statement: a player removed a moment ago can no longer post. The time is written in UTC, whatever the database's time zone (the column default is local time).
  const rows = room.kind === "faculty"
    ? await db.$queryRaw`INSERT INTO "GroupMessage" ("facultyGroupId", "senderId", "body", "createdAt")
        SELECT "groupId", "characterId", ${text}, (now() AT TIME ZONE 'UTC') FROM "FacultyGroupMember" WHERE "groupId" = ${room.groupId}::int AND "characterId" = ${room.meId} FOR SHARE
        RETURNING "id", "createdAt"`
    : await db.$queryRaw`INSERT INTO "GroupMessage" ("customGroupId", "senderId", "body", "createdAt")
        SELECT "groupId", "characterId", ${text}, (now() AT TIME ZONE 'UTC') FROM "CustomGroupMember" WHERE "groupId" = ${room.groupId}::int AND "characterId" = ${room.meId} FOR SHARE
        RETURNING "id", "createdAt"`;
  if (!rows.length) throw new ChatError("You are not a member of this group.", 403);
  const id = rows[0].id;
  await memberModel(db, room).updateMany({ where: { ...memberWhere(room), lastReadId: { lt: id } }, data: { lastReadId: id } });
  if (Number(id) % GROUP_CHAT.trimEvery === 0) await trimGroup(db, room).catch(() => {});
  return { id: Number(id), at: rows[0].createdAt };
}

export async function deleteMessage(db, room, rawId) {
  const m = await db.groupMessage.findFirst({ where: { id: idOf(rawId), [column(room)]: room.groupId }, select: { id: true, senderId: true, deletedAt: true } });
  if (!m) throw new ChatError("That message is no longer available.", 404);
  const sender = room.kind === "custom" ? await db.customGroupMember.findUnique({ where: { groupId_characterId: { groupId: room.groupId, characterId: m.senderId } }, select: { role: true } }) : null;
  if (!mayDelete(room, m.senderId, sender?.role)) throw new ChatError("You cannot delete that message.", 403);
  if (!m.deletedAt) await db.groupMessage.update({ where: { id: m.id }, data: { deletedAt: new Date(), body: "" } });
  return { ok: true };
}

/** Unread posts from others, counted up to 100 so a busy group stays cheap. */
export async function unreadCount(db, room, lastReadId) {
  const hidden = await hiddenSenders(db, room.meId);
  const rows = await db.groupMessage.findMany({ where: { [column(room)]: room.groupId, id: { gt: lastReadId }, deletedAt: null, senderId: { notIn: [room.meId, ...hidden] } }, select: { id: true }, take: 100 });
  return rows.length;
}

/** Keep only the newest posts of a group, so the table stops growing. */
export async function trimGroup(db, room, keep = GROUP_CHAT.keep) {
  const cut = await db.groupMessage.findMany({ where: { [column(room)]: room.groupId }, orderBy: { id: "desc" }, skip: keep, take: 1, select: { id: true } });
  if (cut.length) await db.groupMessage.deleteMany({ where: { [column(room)]: room.groupId, id: { lte: cut[0].id } } });
}
