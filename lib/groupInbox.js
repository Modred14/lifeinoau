// lib/groupInbox.js: the group conversations the Messages app lists beside private chats: the player's faculty group and every custom group they are in.
// Which groups appear is decided here from the player's own memberships; nothing the browser sends picks them.
import { facultyRoom } from "./facultyGroupService.js";
import { groupName } from "./facultyGroupRules.js";
import { blockSets } from "./chatCore.js";
import { unreadCount } from "./groupChat.js";

export async function groupChats(db, userId) {
  let faculty = null;
  try { faculty = await facultyRoom(db, userId); } // also repairs a missing faculty membership
  catch (e) { if (e?.status !== 404) throw e; return { chats: [] }; } // no character yet
  const meId = faculty.meId;
  const [own, custom, blocks] = await Promise.all([
    db.facultyGroupMember.findUnique({ where: { characterId: meId }, select: { lastReadId: true, joinedAt: true, group: { select: { faculty: { select: { name: true } } } } } }),
    db.customGroupMember.findMany({ where: { characterId: meId }, select: { groupId: true, role: true, lastReadId: true, joinedAt: true, group: { select: { name: true } } } }),
    blockSets(db, meId),
  ]);
  const hidden = [...new Set([...blocks.byMe, ...blocks.byThem])];
  const entry = async (room, name, lastReadId, joinedAt) => {
    const where = { [room.kind === "faculty" ? "facultyGroupId" : "customGroupId"]: room.groupId, senderId: { notIn: hidden } };
    const [m, unread] = await Promise.all([
      db.groupMessage.findFirst({ where, orderBy: { id: "desc" }, include: { sender: { select: { name: true } } } }),
      unreadCount(db, room, lastReadId),
    ]);
    return {
      kind: room.kind, id: room.groupId, name, unread,
      at: m?.createdAt ?? joinedAt, // an empty group sits where the player joined it
      last: m ? { from: m.sender.name, mine: m.senderId === meId, deleted: !!m.deletedAt, body: m.deletedAt ? "This message was deleted" : m.body.slice(0, 120) } : null,
    };
  };
  return {
    chats: await Promise.all([
      entry(faculty, groupName(own.group.faculty.name), own.lastReadId, own.joinedAt),
      ...custom.map((c) => entry({ kind: "custom", groupId: c.groupId, meId, role: c.role }, c.group.name, c.lastReadId, c.joinedAt)),
    ]),
  };
}
