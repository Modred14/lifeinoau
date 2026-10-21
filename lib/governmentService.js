// lib/governmentService.js
// The student government in office: who holds which post, official announcements, and the Clerk of the Assembly.
// Every power here comes from an office row whose TERM is running right now (lib/sugRoles.js reads the clock on every call), so when a term ends
// its holders lose their powers at that instant, and nothing here can touch User.role or any application permission.
import { serverNow } from "./clock.js";
import { loadLocked, GameError, needReq } from "./gameService.js";
import { cleanText } from "./rules.js";
import { advance, notify, claim } from "./sugService.js";
import { officesOf, currentTerm } from "./sugRoles.js";
import * as R from "./sugRules.js";

export { GameError };
const targetHas = (e, name) => e?.code === "P2002" && JSON.stringify(e.meta ?? {}, (_k, v) => (typeof v === "bigint" ? v.toString() : v)).includes(name);
const CHAR_PUBLIC = { id: true, name: true, gender: true, level: true, look: true, faculty: { select: { name: true } } };
const person = (c) => (c ? { name: c.name, gender: c.gender, level: c.level, faculty: c.faculty?.name ?? "", look: c.look ?? null } : { name: "Student", gender: "M", level: 100, faculty: "", look: null });

const me = async (db, userId) => { const c = await db.character.findUnique({ where: { userId }, include: { account: true } }); if (!c) throw new GameError("Create a character first.", 404); return c; };

/** The government to show: the one in office, else the next one waiting to start, else the latest that ended. */
export async function governmentTerm(db, now = serverNow()) {
  const at = new Date(now);
  return (await currentTerm(db, now))
    ?? (await db.sugTerm.findFirst({ where: { startsAt: { gt: at } }, orderBy: { startsAt: "asc" } }))
    ?? (await db.sugTerm.findFirst({ orderBy: { startsAt: "desc" } }));
}

/** Everything the dashboard's "Government" tab shows. */
export async function getGovernment(db, userId) {
  const now = serverNow(); await advance(db, now); const c = await me(db, userId);
  const term = await governmentTerm(db, now), mine = await officesOf(db, c.id, now);
  const out = { serverNow: now, term: null, holders: {}, members: [], clerk: null, announcements: [], me: { offices: mine, announceKinds: R.announceKindsFor(mine.map((o) => o.position)), canAppointClerk: false }, announceKinds: R.ANNOUNCE_KINDS, totalSeats: R.TOTAL_ELECTED_SEATS, vacancies: [] };
  if (!term) return out;
  const state = now < +term.startsAt ? "FORMING" : now < +term.endsAt ? "ACTIVE" : "ENDED";
  const cycle = await db.sugCycle.findUnique({ where: { id: term.cycleId }, select: { number: true, title: true } });
  out.term = { id: term.id, state, startsAt: +term.startsAt, endsAt: +term.endsAt, cycleNumber: cycle?.number, title: cycle?.title };
  const rows = await db.sugAppointment.findMany({ where: { termId: term.id, status: "ACTIVE" }, orderBy: [{ position: "asc" }, { seat: "asc" }] });
  const chars = new Map((await db.character.findMany({ where: { id: { in: rows.map((r) => r.characterId) } }, select: CHAR_PUBLIC })).map((x) => [x.id, x]));
  const hold = (r) => ({ position: r.position, title: R.titleOf(r.position), seat: r.seat, kind: r.kind, since: +r.startedAt, who: person(chars.get(r.characterId)), isMe: r.characterId === c.id });
  for (const p of R.POSITIONS) if (p.key !== "HONOURABLE_MEMBER") { const r = rows.find((x) => x.position === p.key); out.holders[p.key] = r ? hold(r) : null; if (!r) out.vacancies.push(p.key); }
  out.members = rows.filter((r) => r.position === "HONOURABLE_MEMBER").map(hold);
  if (out.members.length < R.HM_SEATS) out.vacancies.push(`HONOURABLE_MEMBER x${R.HM_SEATS - out.members.length}`);
  const clerk = rows.find((r) => r.position === R.CLERK); out.clerk = clerk ? hold(clerk) : null;
  out.me.canAppointClerk = state === "ACTIVE" && (mine.some((o) => o.position === "SPEAKER") || (mine.some((o) => o.position === "DEPUTY_SPEAKER") && !out.holders.SPEAKER));
  const anns = await db.sugAnnouncement.findMany({ where: { termId: term.id }, orderBy: { id: "desc" }, take: 25 });
  out.announcements = anns.map((a) => ({ id: a.id.toString(), kind: a.kind, kindLabel: R.ANNOUNCE_KINDS[a.kind], title: a.title, body: a.body, position: a.position, positionTitle: R.titleOf(a.position), author: chars.get(a.authorId)?.name ?? null, at: +a.createdAt }));
  const missing = anns.filter((a) => !chars.has(a.authorId)).map((a) => a.authorId);
  if (missing.length) { const extra = new Map((await db.character.findMany({ where: { id: { in: missing } }, select: { id: true, name: true } })).map((x) => [x.id, x.name])); for (const a of out.announcements) a.author ??= extra.get(anns.find((x) => x.id.toString() === a.id).authorId) ?? "Student"; }
  return out;
}

/** The public list of everyone who holds an office right now (used for titles beside names). */
export async function currentOfficeholders(db, now = serverNow()) {
  const t = await currentTerm(db, now); if (!t) return [];
  return db.sugAppointment.findMany({ where: { termId: t.id, status: "ACTIVE" }, select: { characterId: true, position: true } });
}

// ============================================================================================================================ announcements
/**
 * Publish an official announcement. Allowed only to a holder whose term is running, and only the kinds that office is allowed
 * (see ANNOUNCE_PERMS in lib/sugRules.js): the Director of Socials announces parties, the Director of Sports competitions, and so on.
 * Everyone gets it as a notification. A short cooldown and a daily limit stop one office spamming the whole student body.
 */
export async function announce(db, userId, { kind, title, body, requestId } = {}) {
  needReq(requestId);
  if (!R.ANNOUNCE_KINDS[kind]) throw new GameError("Choose what kind of announcement this is.");
  const t = cleanText(title, R.LIMITS.announceTitle), b = cleanText(body, R.LIMITS.announceBody);
  if (t.length < 3) throw new GameError("Give the announcement a title."); if (b.length < 10) throw new GameError("Write a little more in the announcement.");
  const now = serverNow(); await advance(db, now);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId), offices = await officesOf(tx, c.id, now);
      await claim(tx, c.id, requestId, "sug:announce");
      if (!offices.length) throw new GameError("Only members of the current student government can publish announcements.", 403);
      const mayDo = offices.filter((o) => (R.ANNOUNCE_PERMS[o.position] ?? []).includes(kind));
      if (!mayDo.length) throw new GameError(`Your office (${offices[0].title}) cannot publish a ${R.ANNOUNCE_KINDS[kind].toLowerCase()}. ${R.announceKindsFor(offices.map((o) => o.position)).length ? "You can publish: " + R.announceKindsFor(offices.map((o) => o.position)).map((k) => R.ANNOUNCE_KINDS[k].toLowerCase()).join(", ") + "." : ""}`.trim(), 403);
      const since = new Date(now - 86_400_000), recent = await tx.sugAnnouncement.findMany({ where: { authorId: c.id, createdAt: { gte: since } }, orderBy: { id: "desc" }, select: { createdAt: true } });
      if (recent.length && now - +recent[0].createdAt < R.ANNOUNCE_COOLDOWN_MS) throw new GameError(`Wait ${Math.ceil((R.ANNOUNCE_COOLDOWN_MS - (now - +recent[0].createdAt)) / 60_000)} minutes before the next announcement.`, 429);
      if (recent.length >= R.ANNOUNCE_DAILY_MAX) throw new GameError("You have reached today's limit of announcements.", 429);
      const post = mayDo[0].position;
      const a = await tx.sugAnnouncement.create({ data: { termId: mayDo[0].termId, authorId: c.id, position: post, kind, title: t, body: b } });
      const line = `📢 ${R.titleOf(post)} · ${t}: ${b}`.slice(0, 300);
      await tx.$executeRaw`INSERT INTO "Notification" ("characterId","kind","body") SELECT id, 'SUG', ${line} FROM "Character" WHERE graduated = false AND id <> ${c.id}`;
      return { ok: true, id: a.id.toString() };
    });
  } catch (e) { if (targetHas(e, "requestId")) return { ok: true, duplicate: true }; throw e; }
}

// ============================================================================================================================ the Clerk
/**
 * The Speaker (or the Deputy Speaker while there is no Speaker) appoints the Clerk of the Assembly: an administrative role, not an elected one, so it
 * is never on a ballot. Any eligible student who holds no other office this term can be Clerk. Appointing a new Clerk ends the old one's appointment.
 */
export async function appointClerk(db, userId, { name, requestId } = {}) {
  needReq(requestId);
  const now = serverNow(); await advance(db, now);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId), term = await currentTerm(tx, now);
      await claim(tx, c.id, requestId, "sug:clerk");
      if (!term) throw new GameError("There is no government in office. A Clerk can be appointed once a term has begun.", 409);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"sug:clerk:" + term.id}))`;
      const mine = await officesOf(tx, c.id, now), speaker = mine.some((o) => o.position === "SPEAKER"), deputy = mine.some((o) => o.position === "DEPUTY_SPEAKER");
      const speakerSeated = await tx.sugAppointment.count({ where: { termId: term.id, position: "SPEAKER", status: "ACTIVE" } });
      if (!speaker && !(deputy && !speakerSeated)) throw new GameError("Only the Speaker of the Assembly appoints the Clerk.", 403);
      const n = cleanText(name, 40); if (!n) throw new GameError("Name the student to appoint.");
      const target = await tx.character.findFirst({ where: { name: { equals: n, mode: "insensitive" } } });
      if (!target) throw new GameError("No player with that name.", 404);
      const bad = R.voterIssues(target, now); if (bad.length) throw new GameError(`${target.name} cannot be appointed right now.`, 409);
      const held = await tx.sugAppointment.findFirst({ where: { termId: term.id, characterId: target.id, status: "ACTIVE" } });
      if (held && held.position !== R.CLERK) throw new GameError(`${target.name} already holds office as ${R.titleOf(held.position)} and cannot also be Clerk.`, 409);
      if (held) throw new GameError(`${target.name} is already the Clerk.`, 409);
      await tx.sugAppointment.updateMany({ where: { termId: term.id, position: R.CLERK, status: "ACTIVE" }, data: { status: "REVOKED", endedAt: new Date(now) } });
      await tx.sugAppointment.create({ data: { termId: term.id, characterId: target.id, position: R.CLERK, seat: 1, kind: "APPOINTED", appointedBy: c.id } });
      await notify(tx, [target.id], `📎 ${c.name} has appointed you Clerk of the Assembly. Open the SUG app to manage sessions, attendance and minutes.`);
      return { ok: true, clerk: target.name };
    });
  } catch (e) { if (targetHas(e, "requestId")) return { ok: true, duplicate: true }; throw e; }
}

/** The Speaker ends the Clerk's appointment. */
export async function revokeClerk(db, userId, { requestId } = {}) {
  needReq(requestId); const now = serverNow(); await advance(db, now);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId), term = await currentTerm(tx, now), mine = await officesOf(tx, c.id, now);
      await claim(tx, c.id, requestId, "sug:clerk-revoke");
      if (!term || !mine.some((o) => o.position === "SPEAKER" || o.position === "DEPUTY_SPEAKER")) throw new GameError("Only the Speaker of the Assembly can do this.", 403);
      const cur = await tx.sugAppointment.findFirst({ where: { termId: term.id, position: R.CLERK, status: "ACTIVE" } });
      if (!cur) throw new GameError("There is no Clerk to remove.", 409);
      await tx.sugAppointment.update({ where: { id: cur.id }, data: { status: "REVOKED", endedAt: new Date(now) } });
      await notify(tx, [cur.characterId], "📎 Your appointment as Clerk of the Assembly has ended.");
      return { ok: true };
    });
  } catch (e) { if (targetHas(e, "requestId")) return { ok: true, duplicate: true }; throw e; }
}