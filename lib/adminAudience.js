// lib/adminAudience.js
// "Who exactly?" for a bulk reward or an announcement. One resolver, so what the preview shows is what the operation touches.
// Only accounts in good standing are ever included (suspended and closed accounts are skipped), and the ids come back sorted, so a long
// job can be done in pieces and resumed without anyone being missed or paid twice.
import { AdminError, int, str } from "./adminCore.js";
import { where, NOW } from "./adminSql.js";
import { presenceList } from "./adminPresence.js";

export const AUDIENCE_TYPES = ["all", "online", "class", "faculty", "level", "names"];
export const MAX_NAMES = 500;
const GOOD = `(u.status = 'ACTIVE' OR (u.status = 'SUSPENDED' AND u."statusUntil" IS NOT NULL AND u."statusUntil" <= ${NOW}))`;

/** -> { ids: sorted character ids, label, missing: names that matched nobody } */
export async function resolveAudience(db, aud) {
  const type = str(aud?.type, 20);
  if (!AUDIENCE_TYPES.includes(type)) throw new AdminError("Choose who this is for.");
  const w = where().add(GOOD);
  let label = "", missing = [];
  if (type === "all") label = "Every player in good standing";
  else if (type === "online") {
    const { players } = await presenceList(db);
    const ids = players.filter((p) => (p.presence === "ONLINE" || p.presence === "IDLE") && p.accountStatus === "ACTIVE").map((p) => p.characterId).sort();
    return { ids, label: "Players online right now", missing };
  } else if (type === "class") {
    const k = str(aud.class, 10).toUpperCase();
    if (!["NEPO", "MAPO", "LAPO"].includes(k)) throw new AdminError("Choose a class.");
    w.add('c.class = ?::"Class"', k); label = `Every ${k} player`;
  } else if (type === "faculty") {
    const f = int(aud.facultyId, { min: 1 });
    if (f == null) throw new AdminError("Choose a faculty.");
    w.add('c."facultyId" = ?::int', f); label = "One faculty";
  } else if (type === "level") {
    const l = int(aud.level, { min: 100, max: 2000 });
    if (l == null) throw new AdminError("Choose a level.");
    w.add("c.level = ?::int", l); label = `Every ${l}L player`;
  } else {
    const names = [...new Set((Array.isArray(aud.names) ? aud.names : String(aud.names ?? "").split(/[\n,]+/)).map((n) => str(n, 40).toLowerCase()).filter(Boolean))];
    if (!names.length) throw new AdminError("Enter at least one player name.");
    if (names.length > MAX_NAMES) throw new AdminError(`Name at most ${MAX_NAMES} players at once, or choose a group instead.`);
    w.add("lower(c.name) = ANY(?::text[])", names); label = `${names.length} named player${names.length === 1 ? "" : "s"}`;
    const rows = await db.$queryRawUnsafe(`SELECT c.id, lower(c.name) AS n FROM "Character" c JOIN "User" u ON u.id = c."userId" ${w.clause()} ORDER BY c.id`, ...w.values);
    const found = new Set(rows.map((r) => r.n));
    missing = names.filter((n) => !found.has(n));
    return { ids: rows.map((r) => r.id), label, missing };
  }
  const rows = await db.$queryRawUnsafe(`SELECT c.id FROM "Character" c JOIN "User" u ON u.id = c."userId" ${w.clause()} ORDER BY c.id`, ...w.values);
  return { ids: rows.map((r) => r.id), label, missing };
}
