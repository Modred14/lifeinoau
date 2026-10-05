// lib/notifications.js
export async function unreadNotes(db, characterId) {
  const rows = await db.notification.findMany({ where: { characterId, readAt: null }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, kind: true, body: true } });
  return rows.map((r) => ({ id: r.id.toString(), kind: r.kind, body: r.body }));
}
export const markAllRead = (db, characterId) => db.notification.updateMany({ where: { characterId, readAt: null }, data: { readAt: new Date() } });
