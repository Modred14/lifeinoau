// lib/adminModeration.js
// Account standing and moderation. Every operation is one transaction (the change, any player notice, the audit row) through runAdminOp, needs a
// written reason, and is safe to send twice (requestId).
//
//   ACCOUNT STANDING (User.status, enforced on every request by lib/accountGate.js, and on the chat socket)
//     suspend    the account cannot sign in or use the game until a date, a number of hours, or until an administrator restores it.
//     restore    lifts a suspension, or brings an archived account back.
//     delete     ARCHIVES the account. It can no longer sign in, disappears from the map, rankings, search and messaging, its running matches are
//                voided (wagers returned) and its connections are dropped. NOTHING is erased: the character, money and the whole ledger stay, so
//                the economy still adds up and the account can be restored. (Erasing rows would delete money from the ledger and break every
//                balance check, so a real erase is deliberately not offered.)
//   GAME DISCIPLINE (the character's own penalties, the same fields the game itself uses: lib/discipline.js)
//     academic suspension, expulsion and reinstating, strikes, release from Floor O custody.
//   REPAIR   reset supported attributes, edit supported properties, clear a stuck trip, position, activity, job, hustle, sleep or match.
//
// Guards: you cannot act on yourself or on another administrator; roles can only be changed on the server (scripts/make-admin.js).
import { AdminError, REQUEST_ID, runAdminOp, reasonOf, int, str, jsonSafe, paged, page, oneOf, dateOf } from "./adminCore.js";
import { where, orderBy, like, NOW } from "./adminSql.js";
import { expulsionFields, HOUR_MS } from "./discipline.js";
import { forgetAccount, gateOf } from "./accountGate.js";
import { pingRealtime } from "./realtimeNotify.js";
import { voidMatchInTx } from "./games/matchService.js";
import { canLiveIn, cleanText } from "./rules.js";
import { JOBS } from "./jobs.js";
import { findAccount } from "./adminPlayers.js";

export const MAX_SUSPEND_HOURS = 24 * 365 * 5;
const need = (id) => { if (!REQUEST_ID.test(String(id ?? ""))) throw new AdminError("Missing requestId."); return id; };

/** Lock and load the target, refusing yourself and other administrators. */
async function target(tx, adminId, ref, { needCharacter = false, allowAdmin = false } = {}) {
  const { userId, characterId } = await findAccount(tx, ref);
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true, status: true, statusUntil: true } });
  if (user.id === adminId) throw new AdminError("You cannot do this to your own account.", 403);
  if (user.role === "ADMIN" && !allowAdmin) throw new AdminError("Administrators cannot be moderated from the dashboard.", 403);
  let character = null;
  if (characterId) {
    await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${characterId} FOR UPDATE`;
    character = await tx.character.findUnique({ where: { id: characterId } });
  }
  if (needCharacter && !character) throw new AdminError("This account has no character yet.", 409);
  return { user, character, label: character?.name ?? user.email };
}
const note = (tx, characterId, body) => tx.notification.create({ data: { characterId, kind: "ADMIN", body: cleanText(body, 300) } });

/** After the commit: this server forgets the cached verdict and the realtime server drops the player's connections. */
async function afterAccountChange(userId, characterId) {
  forgetAccount(userId);
  if (characterId) await pingRealtime({ type: "kick", characterId }).catch(() => {});
}

// ---------------------------------------------------------------- account standing
export async function suspendAccount(db, adminId, { ref, reason, hours, until, indefinite, requestId }) {
  need(requestId); const why = reasonOf(reason);
  let end = null;
  if (indefinite === true) end = null;
  else if (until) { end = dateOf(until); if (!end || +end <= Date.now()) throw new AdminError("The end date must be in the future."); }
  else { const h = int(hours, { min: 1, max: MAX_SUSPEND_HOURS }); if (h == null) throw new AdminError(`Choose how long: 1 to ${MAX_SUSPEND_HOURS} hours, an end date, or until restored.`); end = new Date(Date.now() + h * HOUR_MS); }
  if (end && +end - Date.now() > MAX_SUSPEND_HOURS * HOUR_MS) throw new AdminError("That is longer than five years. Choose until restored instead.");
  let ids;
  const r = await runAdminOp(db, adminId, { action: "ACCOUNT:SUSPEND", target: String(ref ?? "").slice(0, 40), requestId }, async (tx) => {
    const t = await target(tx, adminId, ref);
    if (t.user.status === "DELETED") throw new AdminError("This account is archived. Restore it first.", 409);
    await tx.user.update({ where: { id: t.user.id }, data: { status: "SUSPENDED", statusReason: why, statusUntil: end, statusAt: new Date(), statusBy: adminId } });
    ids = { u: t.user.id, c: t.character?.id };
    return { target: t.character?.id ?? t.user.id, detail: { player: t.label, reason: why, until: end, indefinite: !end, previousStatus: t.user.status } };
  });
  if (!r.duplicate) await afterAccountChange(ids.u, ids.c);
  return r;
}

export async function restoreAccount(db, adminId, { ref, reason, requestId }) {
  need(requestId); const why = reasonOf(reason);
  let ids;
  const r = await runAdminOp(db, adminId, { action: "ACCOUNT:RESTORE", target: String(ref ?? "").slice(0, 40), requestId }, async (tx) => {
    const t = await target(tx, adminId, ref, { allowAdmin: true });
    if (t.user.status === "ACTIVE") throw new AdminError("This account is already active.", 409);
    await tx.user.update({ where: { id: t.user.id }, data: { status: "ACTIVE", statusReason: null, statusUntil: null, statusAt: new Date(), statusBy: adminId } });
    if (t.character) await note(tx, t.character.id, "Your account has been restored. Welcome back.");
    ids = { u: t.user.id };
    return { target: t.character?.id ?? t.user.id, detail: { player: t.label, reason: why, previousStatus: t.user.status } };
  });
  if (!r.duplicate) forgetAccount(ids.u);
  return r;
}

/** Archive an account. `confirmName` must be the player's name (or the email for an account with no character): typing it is the confirmation. */
export async function deleteAccount(db, adminId, { ref, reason, confirmName, requestId }) {
  need(requestId); const why = reasonOf(reason);
  let ids, voided = 0;
  const r = await runAdminOp(db, adminId, { action: "ACCOUNT:DELETE", target: String(ref ?? "").slice(0, 40), requestId }, async (tx) => {
    const t = await target(tx, adminId, ref);
    if (t.user.status === "DELETED") throw new AdminError("This account is already archived.", 409);
    if (String(confirmName ?? "").trim().toLowerCase() !== String(t.label).toLowerCase()) throw new AdminError(`Type ${t.label} exactly to confirm.`);
    const c = t.character;
    if (c) {
      // matches the player is in: running ones are voided through the game's own settlement (both wagers go back), invitations are cancelled
      const live = await tx.gameMatch.findMany({ where: { status: { in: ["ACTIVE", "INVITED"] }, OR: [{ hostId: c.id }, { guestId: c.id }] } });
      for (const m of live) {
        if (m.status === "ACTIVE") { await voidMatchInTx(tx, m, "A player's account was closed. Every wager was returned."); voided++; }
        else await tx.gameMatch.update({ where: { id: m.id }, data: { status: "CANCELLED", result: "CANCELLED", reason: "A player's account was closed.", finishedAt: new Date() } });
      }
      await tx.gameQueue.deleteMany({ where: { characterId: c.id } });
      // off the map straight away (no ping can arrive any more, but a stale one would otherwise linger for a minute)
      await tx.character.update({ where: { id: c.id }, data: { placeAt: null, inAt: null, tripAt: null, inPlace: "", inX: null, inZ: null } });
    }
    await tx.user.update({ where: { id: t.user.id }, data: { status: "DELETED", statusReason: why, statusUntil: null, statusAt: new Date(), statusBy: adminId } });
    ids = { u: t.user.id, c: c?.id };
    return { target: c?.id ?? t.user.id, detail: { player: t.label, reason: why, previousStatus: t.user.status, matchesVoided: voided, kept: "character, balance and ledger are retained (archived)" } };
  });
  if (!r.duplicate) await afterAccountChange(ids.u, ids.c);
  return { ...r, matchesVoided: voided };
}

// ---------------------------------------------------------------- warnings and discipline
export async function warnPlayer(db, adminId, { ref, message, requestId }) {
  need(requestId); const text = reasonOf(message, { min: 5, max: 240, what: "A warning message" });
  return runAdminOp(db, adminId, { action: "WARN", target: String(ref ?? "").slice(0, 40), requestId }, async (tx) => {
    const t = await target(tx, adminId, ref, { needCharacter: true });
    await note(tx, t.character.id, `Warning from the administrators: ${text}`);
    const prior = await tx.auditLog.count({ where: { action: "WARN", target: t.character.id, status: "OK" } });
    return { target: t.character.id, detail: { player: t.label, message: text, warningNumber: prior + 1 }, result: { warningNumber: prior + 1 } };
  });
}

export async function gameSuspend(db, adminId, { ref, hours, reason, requestId }) {
  need(requestId); const why = reasonOf(reason), h = int(hours, { min: 1, max: 24 * 30 });
  if (h == null) throw new AdminError("Choose 1 to 720 hours.");
  return runAdminOp(db, adminId, { action: "GAME:SUSPEND", target: String(ref ?? "").slice(0, 40), requestId }, async (tx) => {
    const t = await target(tx, adminId, ref, { needCharacter: true }), now = Date.now();
    await tx.character.update({ where: { id: t.character.id }, data: { suspendedAt: new Date(now), suspendedUntil: new Date(now + h * HOUR_MS) } });
    await note(tx, t.character.id, `You have been suspended from your studies for ${h} hour${h === 1 ? "" : "s"}. ${why}`);
    return { target: t.character.id, detail: { player: t.label, hours: h, reason: why } };
  });
}
export async function gameSuspendClear(db, adminId, { ref, reason, requestId }) {
  need(requestId); const why = reasonOf(reason);
  return runAdminOp(db, adminId, { action: "GAME:UNSUSPEND", target: String(ref ?? "").slice(0, 40), requestId }, async (tx) => {
    const t = await target(tx, adminId, ref, { needCharacter: true });
    await tx.character.update({ where: { id: t.character.id }, data: { suspendedAt: null, suspendedUntil: null } });
    await note(tx, t.character.id, "Your academic suspension has been lifted.");
    return { target: t.character.id, detail: { player: t.label, reason: why } };
  });
}
export async function expelPlayer(db, adminId, { ref, reason, requestId }) {
  need(requestId); const why = reasonOf(reason);
  return runAdminOp(db, adminId, { action: "GAME:EXPEL", target: String(ref ?? "").slice(0, 40), requestId }, async (tx) => {
    const t = await target(tx, adminId, ref, { needCharacter: true });
    if (t.character.expelled) throw new AdminError("This player is already expelled.", 409);
    await tx.character.update({ where: { id: t.character.id }, data: expulsionFields(Date.now()) });
    await note(tx, t.character.id, `You have been expelled. ${why}`);
    return { target: t.character.id, detail: { player: t.label, reason: why } };
  });
}
/** Undo an expulsion before it ends: no restart at 100L, the player simply carries on. */
export async function reinstatePlayer(db, adminId, { ref, reason, requestId }) {
  need(requestId); const why = reasonOf(reason);
  return runAdminOp(db, adminId, { action: "GAME:REINSTATE", target: String(ref ?? "").slice(0, 40), requestId }, async (tx) => {
    const t = await target(tx, adminId, ref, { needCharacter: true });
    if (!t.character.expelled) throw new AdminError("This player is not expelled.", 409);
    await tx.character.update({ where: { id: t.character.id }, data: { expelled: false, expelledAt: null, expelledUntil: null } });
    await note(tx, t.character.id, "Your expulsion has been reversed. You can carry on with your studies.");
    return { target: t.character.id, detail: { player: t.label, reason: why } };
  });
}
export async function releaseFromCustody(db, adminId, { ref, reason, requestId }) {
  need(requestId); const why = reasonOf(reason);
  return runAdminOp(db, adminId, { action: "GAME:RELEASE", target: String(ref ?? "").slice(0, 40), requestId }, async (tx) => {
    const t = await target(tx, adminId, ref, { needCharacter: true });
    if (!(t.character.jailedUntil && +t.character.jailedUntil > Date.now())) throw new AdminError("This player is not in custody.", 409);
    await tx.character.update({ where: { id: t.character.id }, data: { jailedUntil: null, inPlace: "", inX: null, inZ: null, inAt: null } }); // what the game does when a sentence ends
    const n = await tx.floorZero.updateMany({ where: { characterId: t.character.id, status: "JAILED" }, data: { status: "SERVED" } });
    await note(tx, t.character.id, "You have been released from Floor O (N-QRS Custody).");
    return { target: t.character.id, detail: { player: t.label, reason: why, records: n.count } };
  });
}

// ---------------------------------------------------------------- repair: resets, edits, stuck states
export const RESET_DEFAULTS = { health: 80, energy: 90, happiness: 60, academics: 40, popularity: 10, suspicion: 0, strikes: 0, failedSessions: 0 };
export const STAT_KEYS = ["health", "energy", "happiness", "academics", "popularity", "suspicion"];

export async function resetAttributes(db, adminId, { ref, fields, reason, requestId }) {
  need(requestId); const why = reasonOf(reason);
  const keys = [...new Set(Array.isArray(fields) ? fields : [])].filter((k) => Object.hasOwn(RESET_DEFAULTS, k));
  if (!keys.length) throw new AdminError("Choose at least one attribute to reset.");
  return runAdminOp(db, adminId, { action: "CHARACTER:RESET", target: String(ref ?? "").slice(0, 40), requestId }, async (tx) => {
    const t = await target(tx, adminId, ref, { needCharacter: true });
    const before = Object.fromEntries(keys.map((k) => [k, t.character[k]]));
    await tx.character.update({ where: { id: t.character.id }, data: Object.fromEntries(keys.map((k) => [k, RESET_DEFAULTS[k]])) });
    return { target: t.character.id, detail: { player: t.label, reason: why, before, after: Object.fromEntries(keys.map((k) => [k, RESET_DEFAULTS[k]])) } };
  });
}

const EDITABLE = {
  health: (v) => int(v, { min: 0, max: 100 }), energy: (v) => int(v, { min: 0, max: 100 }), happiness: (v) => int(v, { min: 0, max: 100 }),
  academics: (v) => int(v, { min: 0, max: 100 }), popularity: (v) => int(v, { min: 0, max: 100 }), suspicion: (v) => int(v, { min: 0, max: 100 }),
  strikes: (v) => int(v, { min: 0, max: 20 }), failedSessions: (v) => int(v, { min: 0, max: 2 }),
  level: (v) => { const n = int(v, { min: 100, max: 500 }); return n != null && n % 100 === 0 ? n : null; },
};
export const EDITABLE_KEYS = [...Object.keys(EDITABLE), "hostel", "jobKey"];

/** Change supported properties (all validated against the game's own ranges). */
export async function editCharacter(db, adminId, { ref, set, reason, requestId }) {
  need(requestId); const why = reasonOf(reason);
  if (!set || typeof set !== "object") throw new AdminError("Nothing to change.");
  const keys = Object.keys(set).filter((k) => EDITABLE_KEYS.includes(k));
  if (!keys.length) throw new AdminError("Choose at least one property to change.");
  return runAdminOp(db, adminId, { action: "CHARACTER:EDIT", target: String(ref ?? "").slice(0, 40), requestId }, async (tx) => {
    const t = await target(tx, adminId, ref, { needCharacter: true });
    const data = {};
    for (const k of keys) {
      if (EDITABLE[k]) { const v = EDITABLE[k](set[k]); if (v == null) throw new AdminError(`${k} is not a valid value.`); data[k] = v; }
      else if (k === "hostel") { const h = str(set.hostel, 40); if (!canLiveIn(t.character.gender, h)) throw new AdminError(`${h || "That"} is not a home this player can live in.`); data.hostel = h; }
      else if (k === "jobKey") {
        if (set.jobKey === null || set.jobKey === "") Object.assign(data, { jobKey: null, jobXp: 0 });
        else { const j = str(set.jobKey, 40); if (!Object.hasOwn(JOBS, j)) throw new AdminError("That is not a job in the game."); data.jobKey = j; }
      }
    }
    const before = Object.fromEntries(Object.keys(data).map((k) => [k, t.character[k]]));
    await tx.character.update({ where: { id: t.character.id }, data });
    return { target: t.character.id, detail: { player: t.label, reason: why, before, after: data } };
  });
}

export const FIXES = {
  travel: "Clear a stuck trip",
  position: "Send to their home (clears map and building position)",
  activity: "Cancel a stuck activity, job shift or hustle",
  sleep: "Wake from sleep",
  match: "Void any running match (wagers returned)",
  energy: "Refill energy to 100",
};
export async function fixState(db, adminId, { ref, fix, reason, requestId }) {
  need(requestId); const why = reasonOf(reason);
  if (!Object.hasOwn(FIXES, fix)) throw new AdminError("Unknown repair.");
  return runAdminOp(db, adminId, { action: "FIX:" + fix.toUpperCase(), target: String(ref ?? "").slice(0, 40), requestId }, async (tx) => {
    const t = await target(tx, adminId, ref, { needCharacter: true }), id = t.character.id, now = new Date(), changed = {};
    if (fix === "travel") await tx.character.update({ where: { id }, data: { tripAt: null, tripX: null, tripZ: null, tripH: null, tripMode: "" } });
    else if (fix === "position") {
      if (t.character.jailedUntil && +t.character.jailedUntil > Date.now()) throw new AdminError("This player is in custody. Release them first.", 409);
      await tx.character.update({ where: { id }, data: { placeId: "", placeAt: null, inPlace: "", inX: null, inZ: null, inAt: null, tripAt: null, tripX: null, tripZ: null, tripH: null, tripMode: "" } });
    } else if (fix === "activity") {
      changed.activities = (await tx.activityRun.updateMany({ where: { characterId: id, status: "RUNNING" }, data: { status: "CANCELLED", finishedAt: now } })).count;
      changed.shifts = (await tx.jobShift.updateMany({ where: { characterId: id, status: "ACTIVE" }, data: { status: "ABANDONED", claimedAt: now } })).count;
      changed.hustles = (await tx.hustleRun.updateMany({ where: { characterId: id, status: "ACTIVE" }, data: { status: "ABANDONED", finishedAt: now } })).count;
      if (!changed.activities && !changed.shifts && !changed.hustles) throw new AdminError("Nothing is running for this player.", 409);
    } else if (fix === "sleep") {
      if (!t.character.sleepingSince) throw new AdminError("This player is not asleep.", 409);
      await tx.character.update({ where: { id }, data: { sleepingSince: null, sleepingBed: null } });
    } else if (fix === "match") {
      const live = await tx.gameMatch.findMany({ where: { status: "ACTIVE", OR: [{ hostId: id }, { guestId: id }] } });
      if (!live.length) throw new AdminError("This player is not in a running match.", 409);
      for (const m of live) await voidMatchInTx(tx, m, "An administrator cancelled the match. Every wager was returned.");
      changed.matches = live.length;
    } else if (fix === "energy") await tx.character.update({ where: { id }, data: { energy: 100, energyRefilledAt: now } });
    return { target: id, detail: { player: t.label, fix, reason: why, ...changed }, result: changed };
  });
}

// ---------------------------------------------------------------- reading: restrictions and history
/** Every account that is currently restricted, and why. Filter: all | account | suspended | deleted | academic | expelled | custody */
export async function restrictions(db, q = {}) {
  const p = page(q), w = where(), kind = oneOf(q.kind, ["account", "suspended", "deleted", "academic", "expelled", "custody"]);
  const any = `(u.status = 'DELETED' OR (u.status = 'SUSPENDED' AND (u."statusUntil" IS NULL OR u."statusUntil" > ${NOW})) OR c."suspendedUntil" > ${NOW} OR (c.expelled AND (c."expelledUntil" IS NULL OR c."expelledUntil" > ${NOW})) OR c."jailedUntil" > ${NOW})`;
  w.add(any);
  if (kind === "account") w.add(`(u.status = 'DELETED' OR (u.status = 'SUSPENDED' AND (u."statusUntil" IS NULL OR u."statusUntil" > ${NOW})))`);
  else if (kind === "suspended") w.add(`u.status = 'SUSPENDED' AND (u."statusUntil" IS NULL OR u."statusUntil" > ${NOW})`);
  else if (kind === "deleted") w.add(`u.status = 'DELETED'`);
  else if (kind === "academic") w.add(`c."suspendedUntil" > ${NOW}`);
  else if (kind === "expelled") w.add(`c.expelled AND (c."expelledUntil" IS NULL OR c."expelledUntil" > ${NOW})`);
  else if (kind === "custody") w.add(`c."jailedUntil" > ${NOW}`);
  const text = str(q.q, 60); if (text) w.add(`(c.name ILIKE ? ESCAPE '\\' OR u.email ILIKE ? ESCAPE '\\')`, like(text), like(text));
  const FROM = `FROM "User" u LEFT JOIN "Character" c ON c."userId" = u.id ${w.clause()}`;
  const [rows, [n]] = await Promise.all([
    db.$queryRawUnsafe(`SELECT u.id AS "userId", c.id AS "characterId", c.name, u.status, u."statusReason", u."statusUntil", u."statusAt", u."statusBy", c."suspendedUntil", c.expelled, c."expelledUntil", c."jailedUntil"
      ${FROM} ORDER BY GREATEST(u."statusAt", c."suspendedUntil", c."expelledAt", c."jailedUntil") DESC NULLS LAST, u.id LIMIT ${p.pageSize} OFFSET ${p.offset}`, ...w.values),
    db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n ${FROM}`, ...w.values),
  ]);
  const now = Date.now();
  return jsonSafe(paged(rows.map((r) => {
    const g = gateOf({ status: r.status, statusUntil: r.statusUntil, statusReason: r.statusReason }, now), list = [];
    if (r.status === "DELETED") list.push({ kind: "Archived", detail: r.statusReason });
    else if (!g.ok) list.push({ kind: "Account suspended", until: r.statusUntil, detail: r.statusReason });
    if (r.suspendedUntil && +new Date(r.suspendedUntil) > now) list.push({ kind: "Academic suspension", until: r.suspendedUntil });
    if (r.expelled && (!r.expelledUntil || +new Date(r.expelledUntil) > now)) list.push({ kind: "Expelled", until: r.expelledUntil });
    if (r.jailedUntil && +new Date(r.jailedUntil) > now) list.push({ kind: "In custody", until: r.jailedUntil });
    return { userId: r.userId, characterId: r.characterId, name: r.name, restrictions: list, setBy: r.statusBy, setAt: r.statusAt };
  }), n.n, p));
}

const MOD = ["ACCOUNT:%", "WARN", "GAME:%", "FIX:%", "CHARACTER:%", "RESOLVE_REPORT:%"];
/** Moderation history across the platform, newest first (or for one player with `player=`). */
export async function moderationHistory(db, q = {}) {
  const p = page(q), w = where();
  w.add(`(${MOD.map(() => "a.action LIKE ?").join(" OR ")})`, ...MOD);
  const pl = str(q.player, 40); if (pl) w.add(`(a.target = ?)`, pl);
  const FROM = `FROM "AuditLog" a LEFT JOIN "Character" c ON c.id = a.target LEFT JOIN "Character" ac ON ac."userId" = a."actorId" ${w.clause()}`;
  const [rows, [n]] = await Promise.all([
    db.$queryRawUnsafe(`SELECT a.id, a."createdAt", a.action, a.status, a.error, a.detail, a."actorId", a.target, c.name AS "targetName", ac.name AS "actorName" ${FROM} ORDER BY a.id DESC LIMIT ${p.pageSize} OFFSET ${p.offset}`, ...w.values),
    db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n ${FROM}`, ...w.values),
  ]);
  return jsonSafe(paged(rows.map((r) => ({ id: String(r.id), at: r.createdAt, action: r.action, status: r.status, error: r.error, detail: r.detail, actorId: r.actorId, actor: r.actorName ?? r.actorId, target: r.target, targetName: r.targetName })), n.n, p));
}

// ---------------------------------------------------------------- reports (the game's own player reports, resolved with the same audit and idempotency)
export async function openReports(db, q = {}) {
  const status = oneOf(q.status, ["OPEN", "DISMISSED", "ACTIONED"], "OPEN"), p = page(q);
  const [rows, [n]] = await Promise.all([
    db.$queryRawUnsafe(`SELECT r.id, r.reason, r.status, r."createdAt", rp.name AS reporter, rp.id AS "reporterId", t.name AS target, t.id AS "targetId" FROM "Report" r JOIN "Character" rp ON rp.id = r."reporterId" JOIN "Character" t ON t.id = r."targetId"
      WHERE r.status = $1 ORDER BY r.id ${status === "OPEN" ? "ASC" : "DESC"} LIMIT ${p.pageSize} OFFSET ${p.offset}`, status),
    db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "Report" WHERE status = $1`, status),
  ]);
  return jsonSafe(paged(rows.map((r) => ({ ...r, id: String(r.id) })), n.n, p));
}

