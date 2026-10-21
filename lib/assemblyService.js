// lib/assemblyService.js
// The Student Representative Assembly: sittings, attendance, bills and motions, debate and votes.
//
// Who can do what (all of it only while the government's term is running; see lib/sugRoles.js):
//   Speaker           opens and closes sittings, puts items on the order paper, opens debate, recognises members to speak, opens and closes voting,
//                     can hand the chair to the Deputy Speaker. The Deputy Speaker does the same when the Speaker is not seated, or has not opened a sitting
//                     10 minutes after it was due, or has handed the chair over.
//   Honourable Member attends, submits bills and motions, speaks when recognised, votes (YES / NO / ABSTAIN, once, never changed).
//   Clerk             schedules sittings, gives bills and motions their numbers, keeps the attendance record, publishes the minutes.
//                     The Clerk has NO say in any result: the outcome of a vote is computed here from the recorded votes (and the database refuses
//                     votes outside voting or from anyone who is not a seated member), and only the chair can close a vote.
// Voting rule (sugRules.legislativeOutcome): a vote counts only with a quorum (a third of the seated members) present, and it passes with MORE yes than no.
// Abstentions count for neither side, and a tie fails.
import { serverNow } from "./clock.js";
import { GameError, needReq } from "./gameService.js";
import { cleanText } from "./rules.js";
import { advance, notify, claim } from "./sugService.js";
import { currentTerm, officesOf } from "./sugRoles.js";
import * as R from "./sugRules.js";

export { GameError };
const targetHas = (e, name) => e?.code === "P2002" && JSON.stringify(e.meta ?? {}, (_k, v) => (typeof v === "bigint" ? v.toString() : v)).includes(name);
const bigId = (v, what = "item") => { if (!/^\d{1,15}$/.test(String(v ?? ""))) throw new GameError(`No such ${what}.`, 404); return BigInt(v); };
const dbMessage = (e) => { const m = /vote: ([^\n]+)/.exec(e?.message ?? ""); return m ? m[1].replace(/\.$/, "") : null; };
const lockRow = (tx, table, id) => tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = $1 FOR UPDATE`, id);

// ============================================================================================================================ who is who
/** The caller's place in the Assembly this moment. Throws if there is no government in office. */
async function context(tx, userId, now) {
  const c = await tx.character.findUnique({ where: { userId } }); if (!c) throw new GameError("Create a character first.", 404);
  const term = await currentTerm(tx, now); if (!term) throw new GameError("There is no government in office, so the Assembly is not sitting.", 409);
  const mine = await officesOf(tx, c.id, now), has = (p) => mine.some((o) => o.position === p);
  return { c, term, mine, speaker: has("SPEAKER"), deputy: has("DEPUTY_SPEAKER"), clerk: has("CLERK"), member: has("HONOURABLE_MEMBER") };
}
const seatedMembers = (tx, termId) => tx.sugAppointment.count({ where: { termId, position: "HONOURABLE_MEMBER", status: "ACTIVE" } });
const speakerSeated = async (tx, termId) => (await tx.sugAppointment.count({ where: { termId, position: "SPEAKER", status: "ACTIVE" } })) > 0;

/** May this person take the chair of this sitting now? The Speaker always; the Deputy Speaker when the Speaker is absent (see the rules above). */
async function mayChair(tx, x, session, now) {
  if (x.speaker) return true;
  if (!x.deputy) return false;
  if (session.chairId === x.c.id) return true; // the Speaker handed it over
  if (!(await speakerSeated(tx, x.term.id))) return true;
  return session.status === "SCHEDULED" && now >= +session.scheduledAt + R.SPEAKER_WAIT_MS;
}
async function getSession(tx, id, termId) {
  const s = await tx.sugSession.findUnique({ where: { id: Number(id) } });
  if (!s || s.termId !== termId) throw new GameError("No such sitting.", 404);
  return s;
}
const nextSerial = async (tx, termId, kind) => { const n = await tx.sugItem.count({ where: { termId, kind, serial: { not: null } } }); return `${kind}-${String(n + 1).padStart(4, "0")}`; };

// ============================================================================================================================ reading
/** The Assembly screen: sittings, the order paper, the floor, attendance records and what this player may do right now. */
export async function getAssembly(db, userId) {
  const now = serverNow(); await advance(db, now);
  const c = await db.character.findUnique({ where: { userId } }); if (!c) throw new GameError("Create a character first.", 404);
  const term = await currentTerm(db, now);
  if (!term) return { serverNow: now, active: false, can: {} };
  const mine = await officesOf(db, c.id, now), has = (p) => mine.some((o) => o.position === p);
  const x = { speaker: has("SPEAKER"), deputy: has("DEPUTY_SPEAKER"), clerk: has("CLERK"), member: has("HONOURABLE_MEMBER") };
  const seated = await seatedMembers(db, term.id), speaker = await speakerSeated(db, term.id);
  const [sessions, items] = await Promise.all([
    db.sugSession.findMany({ where: { termId: term.id }, orderBy: [{ scheduledAt: "desc" }, { id: "desc" }], take: 20 }),
    db.sugItem.findMany({ where: { termId: term.id }, orderBy: { id: "desc" }, take: 60 }),
  ]);
  const open = sessions.find((s) => s.status === "OPEN") ?? null, ids = [...new Set([...sessions.flatMap((s) => [s.chairId, s.floorSpeakerId]), ...items.map((i) => i.authorId)].filter(Boolean))];
  const people = await db.character.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }), name = new Map(people.map((p) => [p.id, p.name]));
  const [att, myVotes] = await Promise.all([
    db.sugAttendance.findMany({ where: { sessionId: { in: sessions.map((s) => s.id) } }, select: { sessionId: true, characterId: true, status: true, source: true } }),
    db.sugLegVote.findMany({ where: { voterId: c.id, itemId: { in: items.map((i) => i.id) } }, select: { itemId: true, choice: true } }),
  ]);
  const attNames = new Map((await db.character.findMany({ where: { id: { in: [...new Set(att.map((a) => a.characterId))] } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const debate = open?.floorItemId ? await db.sugDebate.findMany({ where: { itemId: open.floorItemId }, orderBy: { id: "asc" }, take: 50 }) : [];
  const dn = new Map((await db.character.findMany({ where: { id: { in: debate.map((d) => d.speakerId) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  // attendance record per member: sittings held vs attended
  const closed = sessions.filter((s) => s.status === "CLOSED" || s.status === "OPEN"), record = new Map();
  for (const a of att) { if (!closed.some((s) => s.id === a.sessionId)) continue; const r = record.get(a.characterId) ?? { present: 0, absent: 0, excused: 0 }; r[a.status === "PRESENT" ? "present" : a.status === "EXCUSED" ? "excused" : "absent"]++; record.set(a.characterId, r); }
  const myAtt = open ? att.find((a) => a.sessionId === open.id && a.characterId === c.id) : null;
  const chairNow = open && (open.chairId === c.id);
  const sessionShape = (s) => ({ id: s.id, title: s.title, agenda: s.agenda, scheduledAt: +s.scheduledAt, status: s.status, chair: name.get(s.chairId) ?? null, openedAt: s.openedAt && +s.openedAt, closedAt: s.closedAt && +s.closedAt, minutes: s.minutes, minutesAt: s.minutesAt && +s.minutesAt,
    present: att.filter((a) => a.sessionId === s.id && a.status === "PRESENT").length, floorItemId: s.floorItemId?.toString() ?? null, floorSpeaker: name.get(s.floorSpeakerId) ?? null });
  return {
    serverNow: now, active: true, term: { id: term.id, startsAt: +term.startsAt, endsAt: +term.endsAt }, seated, quorum: R.quorumFor(seated), speakerSeated: speaker, roles: { ...x }, rules: { quorumText: "A third of the seated members must be present. It passes with more yes than no; a tie fails.", abstainText: "Abstentions count for neither side." },
    sessions: sessions.map(sessionShape), open: open ? sessionShape(open) : null, iAmChair: !!chairNow, myAttendance: myAtt?.status ?? null,
    present: open ? att.filter((a) => a.sessionId === open.id && a.status === "PRESENT").map((a) => attNames.get(a.characterId)).filter(Boolean) : [],
    items: items.map((i) => ({ id: i.id.toString(), kind: i.kind, serial: i.serial, title: i.title, body: i.body, author: name.get(i.authorId) ?? "Member", status: i.status, sessionId: i.sessionId, yes: i.yes, no: i.no, abstain: i.abstain, present: i.present, quorum: i.quorum, outcomeNote: i.outcomeNote, at: +i.createdAt, mine: i.authorId === c.id, myVote: myVotes.find((v) => v.itemId === i.id)?.choice ?? null })),
    debate: debate.map((d) => ({ id: d.id.toString(), speaker: dn.get(d.speakerId) ?? "Member", body: d.body, at: +d.createdAt })),
    attendanceRecord: [...record.entries()].map(([id, r]) => ({ name: attNames.get(id) ?? "Member", ...r })).sort((a, b) => b.present - a.present || a.name.localeCompare(b.name)),
    can: { schedule: x.clerk, submit: x.member, attend: (x.member || x.speaker || x.deputy) && !!open, chair: (x.speaker || x.deputy) },
  };
}

// ============================================================================================================================ sittings (Clerk and chair)
export async function scheduleSession(db, userId, { title, agenda, scheduledAt, requestId } = {}) {
  needReq(requestId); const now = serverNow(); await advance(db, now);
  const t = cleanText(title, R.LIMITS.title), a = cleanText(agenda, R.LIMITS.body), at = Number(scheduledAt);
  if (t.length < 3) throw new GameError("Give the sitting a title.");
  if (!Number.isFinite(at) || at < now - 60_000) throw new GameError("Choose a time that has not passed.");
  if (at > now + R.SESSION_LIMITS.scheduleAheadMax) throw new GameError("A sitting can be scheduled up to 30 days ahead.");
  try {
    return await db.$transaction(async (tx) => {
      const x = await context(tx, userId, now); if (!x.clerk) throw new GameError("Only the Clerk of the Assembly schedules sittings.", 403);
      await claim(tx, x.c.id, requestId, "sug:session");
      if (at >= +x.term.endsAt) throw new GameError("That is after the end of this government's term.");
      const s = await tx.sugSession.create({ data: { termId: x.term.id, title: t, agenda: a, scheduledAt: new Date(Math.max(at, now)), createdBy: x.c.id } });
      const members = await tx.sugAppointment.findMany({ where: { termId: x.term.id, status: "ACTIVE", position: { in: ["HONOURABLE_MEMBER", "SPEAKER", "DEPUTY_SPEAKER"] } }, select: { characterId: true } });
      await notify(tx, members.map((m) => m.characterId), `🏛️ The Clerk has scheduled a sitting: "${t}", ${new Date(s.scheduledAt).toUTCString()}.`);
      return { ok: true, id: s.id };
    });
  } catch (e) { if (targetHas(e, "requestId")) return { ok: true, duplicate: true }; throw e; }
}

export async function cancelSession(db, userId, { sessionId, requestId } = {}) {
  needReq(requestId); const now = serverNow(); await advance(db, now);
  try {
    return await db.$transaction(async (tx) => {
      const x = await context(tx, userId, now); if (!x.clerk) throw new GameError("Only the Clerk of the Assembly cancels a sitting.", 403);
      await claim(tx, x.c.id, requestId, "sug:session-cancel");
      const s = await getSession(tx, sessionId, x.term.id); if (s.status !== "SCHEDULED") throw new GameError("Only a sitting that has not opened can be cancelled.", 409);
      await tx.sugSession.update({ where: { id: s.id }, data: { status: "CANCELLED" } }); return { ok: true };
    });
  } catch (e) { if (targetHas(e, "requestId")) return { ok: true, duplicate: true }; throw e; }
}

/** Run a chair action on a sitting, under the sitting's lock so two chairs (or two taps) cannot interleave. */
async function chairAction(db, userId, sessionId, requestId, action, fn, { needOpen = true } = {}) {
  needReq(requestId); const now = serverNow(); await advance(db, now);
  try {
    return await db.$transaction(async (tx) => {
      const x = await context(tx, userId, now); await lockRow(tx, "SugSession", Number(sessionId));
      const s = await getSession(tx, sessionId, x.term.id);
      if (!(await mayChair(tx, x, s, now))) throw new GameError("Only the Speaker (or the Deputy Speaker in the Speaker's absence) can do that.", 403);
      await claim(tx, x.c.id, requestId, `sug:${action}`);
      if (needOpen && s.status !== "OPEN") throw new GameError("This sitting is not open.", 409);
      return await fn(tx, x, s, now);
    });
  } catch (e) { if (targetHas(e, "requestId")) return { ok: true, duplicate: true }; const m = dbMessage(e); if (m) throw new GameError(m, 409); throw e; }
}

export const openSession = (db, userId, { sessionId, requestId } = {}) => chairAction(db, userId, sessionId, requestId, "open", async (tx, x, s, now) => {
  if (s.status !== "SCHEDULED") throw new GameError("This sitting has already been opened or closed.", 409);
  if (now < +s.scheduledAt - 10 * 60_000) throw new GameError("It is too early to open this sitting. It opens up to 10 minutes before its time.", 409);
  if (await tx.sugSession.findFirst({ where: { termId: x.term.id, status: "OPEN" } })) throw new GameError("Another sitting is already open. Close it first.", 409);
  await tx.sugSession.update({ where: { id: s.id }, data: { status: "OPEN", chairId: x.c.id, openedAt: new Date(now) } });
  const members = await tx.sugAppointment.findMany({ where: { termId: x.term.id, status: "ACTIVE", position: { in: ["HONOURABLE_MEMBER", "SPEAKER", "DEPUTY_SPEAKER", "CLERK"] } }, select: { characterId: true } });
  await notify(tx, members.map((m) => m.characterId), `🏛️ The sitting "${s.title}" is now open. Join it in the SUG app and mark yourself present.`);
  return { ok: true };
}, { needOpen: false });

export const closeSession = (db, userId, { sessionId, requestId } = {}) => chairAction(db, userId, sessionId, requestId, "close", async (tx, x, s, now) => {
  if (await tx.sugItem.findFirst({ where: { sessionId: s.id, status: "VOTING" } })) throw new GameError("A vote is still open. Close the vote before closing the sitting.", 409);
  await tx.sugItem.updateMany({ where: { sessionId: s.id, status: "DEBATING" }, data: { status: "LISTED" } }); // an unfinished debate goes back on the order paper
  const marked = new Set((await tx.sugAttendance.findMany({ where: { sessionId: s.id }, select: { characterId: true } })).map((a) => a.characterId));
  const seated = await tx.sugAppointment.findMany({ where: { termId: x.term.id, status: "ACTIVE", position: { in: ["HONOURABLE_MEMBER", "SPEAKER", "DEPUTY_SPEAKER"] } }, select: { characterId: true } });
  const missing = seated.filter((m) => !marked.has(m.characterId));
  if (missing.length) await tx.sugAttendance.createMany({ data: missing.map((m) => ({ sessionId: s.id, characterId: m.characterId, status: "ABSENT", source: "CLERK" })), skipDuplicates: true });
  await tx.sugSession.update({ where: { id: s.id }, data: { status: "CLOSED", closedAt: new Date(now), floorItemId: null, floorSpeakerId: null } });
  return { ok: true, absent: missing.length };
});

/** The Speaker hands the chair to the Deputy Speaker for the rest of the sitting. */
export const handOver = (db, userId, { sessionId, requestId } = {}) => chairAction(db, userId, sessionId, requestId, "handover", async (tx, x, s) => {
  if (!x.speaker) throw new GameError("Only the Speaker hands over the chair.", 403);
  const dep = await tx.sugAppointment.findFirst({ where: { termId: x.term.id, position: "DEPUTY_SPEAKER", status: "ACTIVE" } });
  if (!dep) throw new GameError("There is no Deputy Speaker to hand over to.", 409);
  await tx.sugSession.update({ where: { id: s.id }, data: { chairId: dep.characterId } });
  await notify(tx, [dep.characterId], `🏛️ You now have the chair for "${s.title}".`); return { ok: true };
});

// ============================================================================================================================ attendance
/** A member marks themselves present at an open sitting. Only people seated in the Assembly can. */
export async function attend(db, userId, { sessionId } = {}) {
  const now = serverNow(); await advance(db, now);
  try {
    return await db.$transaction(async (tx) => {
      const x = await context(tx, userId, now); if (!(x.member || x.speaker || x.deputy)) throw new GameError("Only members of the Assembly attend its sittings.", 403);
      const s = await getSession(tx, sessionId, x.term.id); if (s.status !== "OPEN") throw new GameError("This sitting is not open.", 409);
      await tx.sugAttendance.upsert({ where: { sessionId_characterId: { sessionId: s.id, characterId: x.c.id } }, create: { sessionId: s.id, characterId: x.c.id, status: "PRESENT", source: "SELF" }, update: { status: "PRESENT", source: "SELF" } });
      return { ok: true };
    });
  } catch (e) { throw e; }
}

/**
 * The Clerk keeps the attendance record. The Clerk can note someone ABSENT or EXCUSED (who has not marked themselves present), never PRESENT and never over
 * a member's own PRESENT: attendance decides quorum and who may vote, and the Clerk must not be able to shape a result.
 */
export async function clerkAttendance(db, userId, { sessionId, name, status, requestId } = {}) {
  needReq(requestId); const now = serverNow(); await advance(db, now);
  if (!["ABSENT", "EXCUSED"].includes(status)) throw new GameError("The Clerk can record a member as absent or excused.");
  try {
    return await db.$transaction(async (tx) => {
      const x = await context(tx, userId, now); if (!x.clerk) throw new GameError("Only the Clerk keeps the attendance record.", 403);
      await claim(tx, x.c.id, requestId, "sug:attendance");
      const s = await getSession(tx, sessionId, x.term.id); if (s.status === "CANCELLED") throw new GameError("That sitting was cancelled.", 409);
      const t = await tx.character.findFirst({ where: { name: { equals: cleanText(name, 40), mode: "insensitive" } } }); if (!t) throw new GameError("No player with that name.", 404);
      if (!(await tx.sugAppointment.findFirst({ where: { termId: x.term.id, characterId: t.id, status: "ACTIVE", position: { in: ["HONOURABLE_MEMBER", "SPEAKER", "DEPUTY_SPEAKER"] } } }))) throw new GameError(`${t.name} is not a member of the Assembly.`, 409);
      const cur = await tx.sugAttendance.findUnique({ where: { sessionId_characterId: { sessionId: s.id, characterId: t.id } } });
      if (cur?.status === "PRESENT") throw new GameError(`${t.name} has marked themselves present. The Clerk cannot change that.`, 409);
      await tx.sugAttendance.upsert({ where: { sessionId_characterId: { sessionId: s.id, characterId: t.id } }, create: { sessionId: s.id, characterId: t.id, status, source: "CLERK" }, update: { status, source: "CLERK" } });
      return { ok: true };
    });
  } catch (e) { if (targetHas(e, "requestId")) return { ok: true, duplicate: true }; throw e; }
}

// ============================================================================================================================ bills and motions
/** A member introduces a bill or a motion. It then waits for the Clerk to register it and the chair to put it on the order paper. */
export async function submitItem(db, userId, { kind, title, body, requestId } = {}) {
  needReq(requestId); const now = serverNow(); await advance(db, now);
  if (!R.ITEM_KINDS[kind]) throw new GameError("Is it a bill or a motion?");
  const t = cleanText(title, R.LIMITS.itemTitle), b = String(body ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, R.LIMITS.itemBody);
  if (t.length < 5) throw new GameError("Give it a clear title (at least 5 characters)."); if (b.length < 20) throw new GameError("Say what it would do (at least 20 characters).");
  try {
    return await db.$transaction(async (tx) => {
      const c0 = await tx.character.findUnique({ where: { userId } }); if (c0) await tx.$queryRaw`SELECT id FROM "Character" WHERE id=${c0.id} FOR UPDATE`;
      const x = await context(tx, userId, now); if (!x.member) throw new GameError("Only Honourable Members can introduce bills and motions.", 403);
      await claim(tx, x.c.id, requestId, "sug:item");
      if ((await tx.sugItem.count({ where: { termId: x.term.id, authorId: x.c.id, status: { in: ["SUBMITTED", "REGISTERED", "LISTED"] } } })) >= 5) throw new GameError("You already have 5 items waiting. Wait for some to be dealt with.", 429);
      const it = await tx.sugItem.create({ data: { termId: x.term.id, kind, title: t, body: b, authorId: x.c.id } });
      const clerk = await tx.sugAppointment.findFirst({ where: { termId: x.term.id, position: R.CLERK, status: "ACTIVE" } });
      if (clerk) await notify(tx, [clerk.characterId], `📄 ${x.c.name} submitted a ${R.ITEM_KINDS[kind].toLowerCase()}: "${t}". Register it so it can be listed.`);
      return { ok: true, id: it.id.toString() };
    });
  } catch (e) { if (targetHas(e, "requestId")) return { ok: true, duplicate: true }; throw e; }
}

export async function withdrawItem(db, userId, { itemId, requestId } = {}) {
  needReq(requestId); const id = bigId(itemId), now = serverNow(); await advance(db, now);
  try {
    return await db.$transaction(async (tx) => {
      const x = await context(tx, userId, now); await lockRow(tx, "SugItem", id);
      await claim(tx, x.c.id, requestId, "sug:item-withdraw");
      const it = await tx.sugItem.findUnique({ where: { id } });
      if (!it || it.termId !== x.term.id || it.authorId !== x.c.id) throw new GameError("That is not your item.", 404);
      if (!["SUBMITTED", "REGISTERED", "LISTED"].includes(it.status)) throw new GameError("It is already being debated or has been decided.", 409);
      await tx.sugItem.update({ where: { id }, data: { status: "WITHDRAWN", closedAt: new Date(now) } }); return { ok: true };
    });
  } catch (e) { if (targetHas(e, "requestId")) return { ok: true, duplicate: true }; throw e; }
}

/** The Clerk registers a submitted item: it gets its number (BILL-0001). The Clerk records; the chair decides what is heard. */
export async function registerItem(db, userId, { itemId, requestId } = {}) {
  needReq(requestId); const id = bigId(itemId), now = serverNow(); await advance(db, now);
  try {
    return await db.$transaction(async (tx) => {
      const x = await context(tx, userId, now); if (!x.clerk) throw new GameError("Only the Clerk registers bills and motions.", 403);
      await claim(tx, x.c.id, requestId, "sug:item-register");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"sug:serial:" + x.term.id}))`; await lockRow(tx, "SugItem", id);
      const it = await tx.sugItem.findUnique({ where: { id } });
      if (!it || it.termId !== x.term.id) throw new GameError("No such item.", 404);
      if (it.status !== "SUBMITTED") throw new GameError("That item has already been registered.", 409);
      const serial = await nextSerial(tx, x.term.id, it.kind);
      await tx.sugItem.update({ where: { id }, data: { status: "REGISTERED", serial, registeredBy: x.c.id, registeredAt: new Date(now) } });
      await notify(tx, [it.authorId], `📄 Your ${R.ITEM_KINDS[it.kind].toLowerCase()} "${it.title}" was registered as ${serial}.`);
      return { ok: true, serial };
    });
  } catch (e) { if (targetHas(e, "requestId")) return { ok: true, duplicate: true }; throw e; }
}

/** The chair puts a registered item on the order paper of the open sitting. */
export const listItem = (db, userId, { sessionId, itemId, requestId } = {}) => chairAction(db, userId, sessionId, requestId, "item-list", async (tx, x, s, now) => {
  const id = bigId(itemId); await lockRow(tx, "SugItem", id);
  const it = await tx.sugItem.findUnique({ where: { id } });
  if (!it || it.termId !== x.term.id) throw new GameError("No such item.", 404);
  if (it.status !== "REGISTERED") throw new GameError(it.status === "SUBMITTED" ? "The Clerk has not registered it yet." : "It cannot be listed now.", 409);
  await tx.sugItem.update({ where: { id }, data: { status: "LISTED", sessionId: s.id } }); return { ok: true };
});

/** The chair opens debate on a listed item (one at a time). */
export const openDebate = (db, userId, { sessionId, itemId, requestId } = {}) => chairAction(db, userId, sessionId, requestId, "debate-open", async (tx, x, s) => {
  const id = bigId(itemId); await lockRow(tx, "SugItem", id);
  const it = await tx.sugItem.findUnique({ where: { id } });
  if (!it || it.sessionId !== s.id || it.status !== "LISTED") throw new GameError("That item is not on this sitting's order paper.", 409);
  if (s.floorItemId && s.floorItemId !== id) throw new GameError("Another item is on the floor. Finish it first.", 409);
  await tx.sugItem.update({ where: { id }, data: { status: "DEBATING" } });
  await tx.sugSession.update({ where: { id: s.id }, data: { floorItemId: id, floorSpeakerId: null } }); return { ok: true };
});

/** The chair gives a present member the floor. */
export const recognise = (db, userId, { sessionId, name, requestId } = {}) => chairAction(db, userId, sessionId, requestId, "recognise", async (tx, x, s) => {
  if (!s.floorItemId) throw new GameError("No item is on the floor.", 409);
  const it = await tx.sugItem.findUnique({ where: { id: s.floorItemId } }); if (!it || it.status !== "DEBATING") throw new GameError("The item is not in debate.", 409);
  const t = await tx.character.findFirst({ where: { name: { equals: cleanText(name, 40), mode: "insensitive" } } }); if (!t) throw new GameError("No player with that name.", 404);
  const ok = await tx.sugAttendance.findUnique({ where: { sessionId_characterId: { sessionId: s.id, characterId: t.id } } });
  if (!ok || ok.status !== "PRESENT") throw new GameError(`${t.name} is not present at this sitting.`, 409);
  if (!(await tx.sugAppointment.findFirst({ where: { termId: x.term.id, characterId: t.id, status: "ACTIVE", position: "HONOURABLE_MEMBER" } }))) throw new GameError(`${t.name} is not an Honourable Member.`, 409);
  await tx.sugSession.update({ where: { id: s.id }, data: { floorSpeakerId: t.id } });
  await notify(tx, [t.id], `🏛️ The chair has recognised you. Speak on "${it.title}" in the SUG app.`); return { ok: true, speaker: t.name };
});

/** The recognised member speaks. One speech per recognition. */
export async function speak(db, userId, { itemId, body, requestId } = {}) {
  needReq(requestId); const id = bigId(itemId), now = serverNow(); await advance(db, now);
  const b = cleanText(body, R.LIMITS.speech); if (b.length < 3) throw new GameError("Say something first.");
  try {
    return await db.$transaction(async (tx) => {
      const x = await context(tx, userId, now); if (!x.member) throw new GameError("Only Honourable Members debate.", 403);
      await claim(tx, x.c.id, requestId, "sug:speak");
      await lockRow(tx, "SugItem", id);
      const it = await tx.sugItem.findUnique({ where: { id } }), s = it?.sessionId ? await tx.sugSession.findUnique({ where: { id: it.sessionId } }) : null;
      if (!it || !s || s.status !== "OPEN" || it.status !== "DEBATING" || s.floorItemId !== id) throw new GameError("That item is not in debate.", 409);
      if (s.floorSpeakerId !== x.c.id) throw new GameError("The chair has not given you the floor.", 403);
      await tx.sugDebate.create({ data: { itemId: id, speakerId: x.c.id, body: b } });
      await tx.sugSession.update({ where: { id: s.id }, data: { floorSpeakerId: null } }); return { ok: true };
    });
  } catch (e) { if (targetHas(e, "requestId")) return { ok: true, duplicate: true }; throw e; }
}

/** The chair opens the vote on the item on the floor. The number of members present is counted by the server from the attendance record. */
export const openVoting = (db, userId, { sessionId, itemId, requestId } = {}) => chairAction(db, userId, sessionId, requestId, "vote-open", async (tx, x, s, now) => {
  const id = bigId(itemId); await lockRow(tx, "SugItem", id);
  const it = await tx.sugItem.findUnique({ where: { id } });
  if (!it || it.sessionId !== s.id || it.status !== "DEBATING" || s.floorItemId !== id) throw new GameError("Only the item in debate can be put to the vote.", 409);
  await tx.sugItem.update({ where: { id }, data: { status: "VOTING", votingOpenedAt: new Date(now) } });
  await tx.sugSession.update({ where: { id: s.id }, data: { floorSpeakerId: null } });
  const present = await presentMembers(tx, s.id, x.term.id);
  await notify(tx, present, `🗳️ A vote is open on "${it.title}". Cast yours in the SUG app.`); return { ok: true };
});
const presentMembers = async (tx, sessionId, termId) => {
  const ids = (await tx.sugAttendance.findMany({ where: { sessionId, status: "PRESENT" }, select: { characterId: true } })).map((a) => a.characterId);
  return (await tx.sugAppointment.findMany({ where: { termId, status: "ACTIVE", position: "HONOURABLE_MEMBER", characterId: { in: ids } }, select: { characterId: true } })).map((a) => a.characterId);
};

/** A present Honourable Member votes. One vote per member per item, never changed (the database refuses a second one, and any vote outside voting). */
export async function legVote(db, userId, { itemId, choice, requestId } = {}) {
  needReq(requestId); const id = bigId(itemId), now = serverNow(); await advance(db, now);
  if (!["YES", "NO", "ABSTAIN"].includes(choice)) throw new GameError("Vote yes, no or abstain.");
  try {
    return await db.$transaction(async (tx) => {
      const x = await context(tx, userId, now); if (!x.member) throw new GameError("Only Honourable Members vote on bills and motions.", 403);
      await claim(tx, x.c.id, requestId, "sug:legvote");
      await lockRow(tx, "SugItem", id);
      const it = await tx.sugItem.findUnique({ where: { id } }), s = it?.sessionId ? await tx.sugSession.findUnique({ where: { id: it.sessionId } }) : null;
      if (!it || it.termId !== x.term.id || it.status !== "VOTING" || !s || s.status !== "OPEN") throw new GameError("That item is not open for voting.", 409);
      const here = await tx.sugAttendance.findUnique({ where: { sessionId_characterId: { sessionId: s.id, characterId: x.c.id } } });
      if (!here || here.status !== "PRESENT") throw new GameError("You must be present at the sitting to vote. Mark yourself present first.", 403);
      if (await tx.sugLegVote.findUnique({ where: { itemId_voterId: { itemId: id, voterId: x.c.id } } })) throw new GameError("You have already voted on this.", 409);
      await tx.sugLegVote.create({ data: { itemId: id, voterId: x.c.id, choice } });
      return { ok: true };
    });
  } catch (e) {
    if (targetHas(e, "requestId")) return { ok: true, duplicate: true };
    if (targetHas(e, "voterId")) throw new GameError("You have already voted on this.", 409);
    const m = dbMessage(e); if (m) throw new GameError(m, 409); throw e;
  }
}

/** The chair closes the vote. The result is COMPUTED here from the recorded votes and the attendance record; nobody types it in. */
export const closeVoting = (db, userId, { sessionId, itemId, requestId } = {}) => chairAction(db, userId, sessionId, requestId, "vote-close", async (tx, x, s, now) => {
  const id = bigId(itemId); await lockRow(tx, "SugItem", id); // votes lock the same row, so none can land half way through the count
  const it = await tx.sugItem.findUnique({ where: { id } });
  if (!it || it.sessionId !== s.id || it.status !== "VOTING") throw new GameError("That item is not being voted on.", 409);
  const votes = await tx.sugLegVote.groupBy({ by: ["choice"], where: { itemId: id }, _count: { _all: true } }), n = (k) => votes.find((v) => v.choice === k)?._count._all ?? 0;
  const yes = n("YES"), no = n("NO"), abstain = n("ABSTAIN"), present = (await presentMembers(tx, s.id, x.term.id)).length, seated = await seatedMembers(tx, x.term.id);
  const out = R.legislativeOutcome({ yes, no, abstain, present, seated });
  await tx.sugItem.update({ where: { id }, data: { status: out.passed ? "PASSED" : "FAILED", yes, no, abstain, present, quorum: out.quorum, outcomeNote: out.note, closedAt: new Date(now) } });
  await tx.sugSession.update({ where: { id: s.id }, data: { floorItemId: null, floorSpeakerId: null } });
  await notify(tx, [it.authorId], `🏛️ ${R.ITEM_KINDS[it.kind]} "${it.title}" ${out.passed ? "passed" : "did not pass"}. ${out.note}`);
  return { ok: true, passed: out.passed, yes, no, abstain, present, quorum: out.quorum, note: out.note };
});

/** The Clerk publishes the minutes of a closed sitting (once). */
export async function publishMinutes(db, userId, { sessionId, minutes, requestId } = {}) {
  needReq(requestId); const now = serverNow(); await advance(db, now);
  const m = String(minutes ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, R.LIMITS.minutes); if (m.length < 20) throw new GameError("Write the minutes (at least 20 characters).");
  try {
    return await db.$transaction(async (tx) => {
      const x = await context(tx, userId, now); if (!x.clerk) throw new GameError("Only the Clerk publishes the minutes.", 403);
      await claim(tx, x.c.id, requestId, "sug:minutes");
      await lockRow(tx, "SugSession", Number(sessionId)); const s = await getSession(tx, sessionId, x.term.id);
      if (s.status !== "CLOSED") throw new GameError("Minutes are published after the sitting has closed.", 409); if (s.minutes) throw new GameError("The minutes of this sitting have already been published.", 409);
      await tx.sugSession.update({ where: { id: s.id }, data: { minutes: m, minutesBy: x.c.id, minutesAt: new Date(now) } }); return { ok: true };
    });
  } catch (e) { if (targetHas(e, "requestId")) return { ok: true, duplicate: true }; throw e; }
}