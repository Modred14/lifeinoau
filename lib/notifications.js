// lib/notifications.js
export async function unreadNotes(db, characterId) {
  const rows = await db.notification.findMany({ where: { characterId, readAt: null }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, kind: true, body: true } });
  return rows.map((r) => ({ id: r.id.toString(), kind: r.kind, body: r.body }));
}
/** Marks the player's unread notes read. With `ids` (at most 20 note ids) only those: for a result the screen already announced itself. */
export const markAllRead = (db, characterId, ids) => {
  const only = Array.isArray(ids) ? ids.slice(0, 20).filter((x) => /^\d{1,15}$/.test(String(x))).map((x) => BigInt(x)) : null;
  if (only && !only.length) return Promise.resolve({ count: 0 });
  return db.notification.updateMany({ where: { characterId, readAt: null, ...(only ? { id: { in: only } } : {}) }, data: { readAt: new Date() } });
};