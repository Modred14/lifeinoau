// lib/adminRoutes.js
// The administrator console's API as two plain tables (GET reads, POST changes). Kept out of the Next route file so a Node test can call it directly.
// Every handler receives (db, adminId, query-or-body). Authorization, rate limiting and the same-origin check happen once, in the route file.
import { AdminError, jsonSafe, str, int } from "./adminCore.js";
import { dashboard } from "./adminOverview.js";
import { presenceList } from "./adminPresence.js";
import * as P from "./adminPlayers.js";
import * as F from "./adminForbes.js";
import * as E from "./adminEconomy.js";
import * as M from "./adminModeration.js";
import * as G from "./adminGame.js";
import * as A from "./adminAudit.js";
import * as N from "./adminNotify.js";
import * as S from "./sugAdmin.js";
import { resolveReport, reportMessages } from "./admin.js";

const json = (v) => ({ json: jsonSafe(v) });
const file = (name, text) => ({ csv: text, name });

export const GET = {
  me: async (db, a) => { const u = await db.user.findUnique({ where: { id: a }, select: { id: true, email: true, character: { select: { name: true } } } }); return json({ id: u.id, name: u.character?.name ?? "Administrator" }); },
  overview: async (db, _a, q) => json(await dashboard(db, { days: int(q.days, { min: 7, max: 90, fallback: 30 }) })),
  online: async (db) => json(await presenceList(db)),
  players: async (db, _a, q) => json(await P.listPlayers(db, q)),
  "players/summary": async (db) => json(await P.directorySummary(db)),
  "players/export": async (db, a, q) => file(`players-${new Date().toISOString().slice(0, 10)}.csv`, await P.exportPlayers(db, a, q)),
  player: async (db, a, q) => json(await P.playerDetail(db, a, str(q.ref, 80))),
  forbes: async (db, _a, q) => json(await F.forbesPlayers(db, q)),
  "forbes/board": async (db, _a, q) => json(await F.forbesBoard(db, { fresh: q.fresh === "1" })),
  "economy/stats": async (db) => json(await E.economyStats(db)),
  "economy/transactions": async (db, _a, q) => json(await E.transactions(db, q)),
  "economy/suspicious": async (db, _a, q) => json(await E.suspicious(db, q)),
  "moderation/restrictions": async (db, _a, q) => json(await M.restrictions(db, q)),
  "moderation/history": async (db, _a, q) => json(await M.moderationHistory(db, q)),
  "moderation/reports": async (db, _a, q) => json(await M.openReports(db, q)),
  "moderation/report-messages": async (db, a, q) => json(await reportMessages(db, a, str(q.id, 20))),
  "game/overview": async (db) => json(await G.gameOverview(db)),
  "game/list": async (db, _a, q) => json(await G.gameList(db, str(q.view, 60), q)),
  "game/rules": async () => json(G.gameRules()),
  audit: async (db, _a, q) => json(await A.auditLog(db, q)),
  "audit/actions": async (db) => json(await A.auditActions(db)),
  "audit/entry": async (db, _a, q) => json(await A.auditEntry(db, str(q.id, 20))),
  "audit/export": async (db, a, q) => file(`audit-${new Date().toISOString().slice(0, 10)}.csv`, await A.auditExport(db, a, q)),
  "notify/history": async (db, _a, q) => json(await N.noticeHistory(db, q)),
  sug: async (db) => json(await S.overview(db)),
};

const byAction = (table) => async (db, a, b) => {
  const k = typeof b?.action === "string" && Object.hasOwn(table, b.action) ? b.action : null;
  if (!k) throw new AdminError("Unknown action.", 400);
  return json(await table[k](db, a, b));
};

export const POST = {
  "economy/money": async (db, a, b) => json(await E.moneyOp(db, a, b)),
  "economy/bulk-preview": async (db, _a, b) => json(await E.bulkPreview(db, b)),
  "economy/bulk-grant": async (db, a, b) => json(await E.bulkGrant(db, a, b)),
  "moderation/suspend": async (db, a, b) => json(await M.suspendAccount(db, a, b)),
  "moderation/restore": async (db, a, b) => json(await M.restoreAccount(db, a, b)),
  "moderation/delete": async (db, a, b) => json(await M.deleteAccount(db, a, b)),
  "moderation/warn": async (db, a, b) => json(await M.warnPlayer(db, a, b)),
  "moderation/game-suspend": async (db, a, b) => json(await M.gameSuspend(db, a, b)),
  "moderation/game-suspend-clear": async (db, a, b) => json(await M.gameSuspendClear(db, a, b)),
  "moderation/expel": async (db, a, b) => json(await M.expelPlayer(db, a, b)),
  "moderation/reinstate": async (db, a, b) => json(await M.reinstatePlayer(db, a, b)),
  "moderation/release": async (db, a, b) => json(await M.releaseFromCustody(db, a, b)),
  "moderation/reset": async (db, a, b) => json(await M.resetAttributes(db, a, b)),
  "moderation/edit": async (db, a, b) => json(await M.editCharacter(db, a, b)),
  "moderation/fix": async (db, a, b) => json(await M.fixState(db, a, b)),
  "moderation/resolve-report": async (db, a, b) => json(await resolveReport(db, a, b)),
  "forbes/exclude": async (db, a, b) => json(await F.excludeFromForbes(db, a, b)),
  "forbes/restore": async (db, a, b) => json(await F.restoreToForbes(db, a, b)),
  "forbes/recalculate": async (db, a, b) => json(await F.recalculateForbes(db, a, b)),
  "game/action": async (db, a, b) => json(await G.gameAction(db, a, str(b?.action, 60), b)),
  "notify/preview": async (db, _a, b) => json(await N.noticePreview(db, b)),
  "notify/send": async (db, a, b) => json(await N.sendNotice(db, a, b)),
  sug: byAction({ start: S.startElection, cancel: S.cancelElection, disqualify: S.disqualify, run: S.runNow }),
};

/** Same-origin guard for anything that changes data: the browser always sends Origin on a POST, and it must be this site. */
export function sameOrigin(origin, host) {
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

export const pick = (table, path) => (Object.hasOwn(table, path) ? table[path] : null);
