import { coursesFor as oauCoursesFor } from "../../../../lib/curriculum.js";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { jwtVerify } from "jose";
import { BED_HALLS, adminWeek, sanitizeAdminRecord, configureWorldClock, gameMinutesAt, gameTime } from "@campuslife/shared";
import { db, worldTransaction } from "../database/database";
import { env } from "../config/env";
import { issueTicket } from "../auth/tickets";
import { accounts } from "../database/schema";
import { profiles, type Profile } from "../persistence/ProfileStore";

export const OAU_SCHOOL = "obafemi-awolowo-university-ile-ife";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const background = (value: string) => value === "NEPO" ? "nepo" : value === "LAPO" ? "hustler" : "regular";

export class WorldAccessError extends Error {}

export interface WorldStudent {
  profileId: string;
  cash: number;
  energy: number;
  fun: number;
  level: string;
  department: string;
  background: string;
  study: number;
  exams: number;
  gpTotal: number;
  lastGrade: string;
  attendance: Record<string, number[]>;
  admin: { bed?: { week: number; hall: string } | null; results: { week: number; weekday: number; score: number }[] };
}

type Identity = {
  characterId: string;
  userId: string;
  name: string;
  class: string;
  level: number;
  faculty: string;
  campusLook: string | null;
  hostel: string;
  energy: number;
  happiness: number;
  balance: string;
  expelled: boolean;
  suspendedUntilWeek: number;
  jailedUntil: Date | null;
};

async function identity(userId: string): Promise<Identity> {
  const rows = await db.execute(sql`SELECT c.id AS "characterId", c."userId", c.name, c.class::text, c.level, c.hostel, c."campusLook", c.energy, c.happiness, c.expelled, c."suspendedUntilWeek", c."jailedUntil", f.name AS faculty, a.balance::text FROM "Character" c JOIN "Faculty" f ON f.id=c."facultyId" JOIN "Account" a ON a."characterId"=c.id WHERE c."userId"=${userId}`);
  if (!rows[0]) throw new WorldAccessError("Create your OAU Life character and choose a home first.");
  const c = rows[0] as unknown as Identity;
  const week = Math.floor(gameMinutesAt(Date.now()) / 10080) + 1;
  if (!c.hostel) throw new WorldAccessError("Choose your OAU Life home first.");
  if (c.expelled) throw new WorldAccessError("This character has been expelled or withdrawn.");
  if (c.suspendedUntilWeek > week) throw new WorldAccessError("Your suspension has not ended yet.");
  if (c.jailedUntil && new Date(c.jailedUntil).getTime() > Date.now()) throw new WorldAccessError("You are in QRS custody. Return home to serve your time or pay the bill.");
  return c;
}

export async function initializeWorldClock() {
  const rows = await db.execute(sql`SELECT "campusEpoch", "campusStartWeek" FROM "GameClock" WHERE id=1`);
  const c = rows[0];
  if (!c?.campusEpoch || !c.campusStartWeek) throw new Error("Apply the OAU campus migration and seed the game clock before starting the campus server.");
  configureWorldClock(new Date(c.campusEpoch as string).getTime(), Number(c.campusStartWeek));
}

export async function worldSession(userId: string) {
  const c = await identity(userId);
  const profileId = hash(`oau:${c.characterId}`);
  await worldTransaction(async () => {
    await db.execute(sql`INSERT INTO "CampusLink" ("userId", "characterId", "profileId") VALUES (${userId},${c.characterId},${profileId}) ON CONFLICT ("userId") DO NOTHING`);
    await db.insert(accounts).values({ id: userId, username: c.name, playerId: profileId, passwordHash: "external-oau-account", recoveryHash: hash(randomUUID()) }).onConflictDoNothing();
  });
  const student = { name: c.name, school: OAU_SCHOOL, level: `${c.level}L`, department: `oau:${c.faculty}`, look: c.campusLook ?? undefined, hostel: c.hostel };
  const ticket = issueTicket({ accountId: userId, playerId: profileId, username: c.name, oau: { characterId: c.characterId, level: student.level, department: student.department, background: background(c.class), look: student.look } });
  const rows = await db.execute(sql`SELECT "campusEpoch", "campusStartWeek" FROM "GameClock" WHERE id=1`);
  return { ticket, student, clock: { epoch: new Date(rows[0].campusEpoch as string).getTime(), week: Number(rows[0].campusStartWeek) } };
}

export async function authenticateOau(token: unknown) {
  if (typeof token !== "string") throw new WorldAccessError("Sign in to OAU Life.");
  const { payload } = await jwtVerify(token, new TextEncoder().encode(env.SESSION_SECRET), { algorithms: ["HS256"] });
  if (typeof payload.sub !== "string") throw new WorldAccessError("Sign in to OAU Life.");
  await worldSession(payload.sub);
  const rows = await db.execute(sql`SELECT * FROM accounts WHERE id=${payload.sub}`);
  const row = rows[0];
  if (!row) throw new WorldAccessError("Sign in to OAU Life.");
  return { id: String(row.id), username: String(row.username), passwordHash: String(row.password_hash), recoveryHash: String(row.recovery_hash), playerId: String(row.player_id), createdAt: new Date(row.created_at as string), passwordChangedAt: new Date(row.password_changed_at as string) };
}

export async function linkedProfile(profileId: string, saved?: Profile): Promise<Profile> {
  const rows = await db.execute(sql`SELECT "userId" FROM "CampusLink" WHERE "profileId"=${profileId}`);
  if (!rows[0]) throw new WorldAccessError("This save does not belong to an OAU Life account.");
  const c = await identity(String(rows[0].userId));
  const base = saved ?? { name: c.name, background: background(c.class), cash: 0, debt: 0, study: 0, studySeconds: 0, packs: 0, skills: { drive: 0, cook: 0, teach: 0 }, food: 80, energy: c.energy, fun: c.happiness, lastAllowanceAt: Date.now(), attended: 0, gpTotal: 0, exams: 0, lastGrade: "", malpractice: 0, rusticatedUntil: 0, weekStudy: 0, weekAttended: 0, attendance: {}, written: [] };
  const admin = sanitizeAdminRecord(base.admin);
  const hallName = c.hostel === "Awo" ? "Awolowo" : c.hostel;
  const hall = BED_HALLS.find((h) => h.name.toLowerCase().startsWith(hallName.toLowerCase()));
  if (hall) admin.bed = { week: adminWeek(gameTime(gameMinutesAt(Date.now()))), hall: hall.name };
  const grades = await db.execute(sql`SELECT "gradePoint" FROM "ExamResult" WHERE "characterId"=${c.characterId}`);
  return { ...base, admin: admin as unknown as Record<string, unknown>, name: c.name, background: background(c.class), school: OAU_SCHOOL, level: `${c.level}L`, department: `oau:${c.faculty}`, cash: Number(c.balance) / 100, energy: c.energy, fun: c.happiness, gpTotal: grades.reduce((n, row) => n + Number(row.gradePoint), 0), exams: grades.length };
}

export async function settleWorld<T>(students: Map<string, WorldStudent>, getProfile: (id: string) => Profile, look: (id: string) => string | undefined, action: string, mutate: () => Promise<T> | T): Promise<T> {
  return worldTransaction(async () => {
    const ids = [...students.values()].map((s) => s.profileId).sort();
    if (!ids.length) return mutate();
    const links = await db.execute(sql`SELECT "characterId", "profileId" FROM "CampusLink" WHERE "profileId" IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) ORDER BY "characterId"`);
    const chars = links.map((l) => String(l.characterId));
    if (chars.length !== ids.length) throw new WorldAccessError("OAU Life account link is missing.");
    await db.execute(sql`SELECT id FROM "Character" WHERE id IN (${sql.join(chars.map((id) => sql`${id}`), sql`, `)}) ORDER BY id FOR UPDATE`);
    const rows = await db.execute(sql`SELECT c.id, c.level, c.hostel, c.energy, c.happiness, c.expelled, c."suspendedUntilWeek", c."jailedUntil", c."sessionStartWeek", c."joinedWeek", (SELECT count(*) FROM "ExamResult" e WHERE e."characterId"=c.id) AS "examCount", (SELECT COALESCE(sum(e."gradePoint"),0) FROM "ExamResult" e WHERE e."characterId"=c.id) AS "gradeTotal", a.id AS "accountId", a.balance::text, l."profileId" FROM "Character" c JOIN "Account" a ON a."characterId"=c.id JOIN "CampusLink" l ON l."characterId"=c.id WHERE c.id IN (${sql.join(chars.map((id) => sql`${id}`), sql`, `)}) ORDER BY a.id FOR UPDATE OF a`);
    const byProfile = new Map(rows.map((r) => [String(r.profileId), r]));
    const before = new Map<string, { cash: number; study: number; attendance: string; exams: number }>();
    const week = Math.floor(gameMinutesAt(Date.now()) / 10080) + 1;
    for (const [id, s] of students) {
      const c = byProfile.get(s.profileId);
      if (!c) throw new WorldAccessError("OAU Life account is missing.");
      if (c.expelled || Number(c.suspendedUntilWeek) > week || c.jailedUntil && new Date(c.jailedUntil as string).getTime() > Date.now()) throw new WorldAccessError("Your OAU Life status changed. Return home to continue.");
      s.cash = Number(c.balance) / 100;
      s.energy = Number(c.energy);
      s.fun = Number(c.happiness);
      s.level = `${c.level}L`;
      s.exams = Number(c.examCount);
      s.gpTotal = Number(c.gradeTotal);
      const home = c.hostel === "Awo" ? "Awolowo" : String(c.hostel);
      const hall = BED_HALLS.find((h) => h.name.toLowerCase().startsWith(home.toLowerCase()));
      if (hall) s.admin.bed = { week: week - 1, hall: hall.name };
      before.set(id, { cash: s.cash, study: s.study, attendance: JSON.stringify(s.attendance), exams: s.exams });
    }
    const out = await mutate();
    const systems = await db.execute(sql`SELECT id FROM "Account" WHERE "systemName"='WORLD'`);
    if (!systems[0]) throw new Error("Seed the OAU Life system accounts.");
    for (const [id, s] of students) {
      const c = byProfile.get(s.profileId)!;
      const b = before.get(id)!;
      const delta = Math.round(s.cash * 100) - Math.round(b.cash * 100);
      if (!Number.isSafeInteger(delta) || s.cash < 0) throw new Error("Campus activity produced an invalid balance.");
      if (delta) {
        const amount = String(Math.abs(delta));
        const from = delta < 0 ? String(c.accountId) : String(systems[0].id);
        const to = delta > 0 ? String(c.accountId) : String(systems[0].id);
        await db.execute(sql`INSERT INTO "LedgerEntry" ("idempotencyKey","debitAccountId","creditAccountId",amount,memo,"gameWeek") VALUES (${`campus:${randomUUID()}`},${from},${to},${amount}::bigint,${`Campus ${action}`},${week})`);
        await db.execute(sql`UPDATE "Account" SET balance=balance+${delta}::bigint WHERE id=${String(c.accountId)}`);
      }
      await db.execute(sql`UPDATE "Character" SET energy=${Math.round(s.energy)}, happiness=${Math.round(s.fun)}, "campusLook"=${look(id) ?? null} WHERE id=${String(c.id)}`);
      if (s.study > b.study || JSON.stringify(s.attendance) !== b.attendance) {
        for (const course of oauCoursesFor(s.department.slice(4), Number(c.level))) {
          const code = course.code;
          const sessions = s.attendance[code] ?? [];
          const old = (JSON.parse(b.attendance) as Record<string, number[]>)[code] ?? [];
          const attended = (sessions[0] ?? 0) > (old[0] ?? 0) ? 1 : 0;
          const prep = Math.min(100, Math.max(0, s.study - b.study) * 2);
          await db.execute(sql`INSERT INTO "CourseProgress" ("characterId","sessionStartWeek",code,attended,prep,"lastAttendWeek") VALUES (${String(c.id)},${Number(c.sessionStartWeek)},${code},${attended},${prep},${attended ? week : null}) ON CONFLICT ("characterId","sessionStartWeek",code) DO UPDATE SET attended="CourseProgress".attended+CASE WHEN ${attended}>0 AND "CourseProgress"."lastAttendWeek" IS DISTINCT FROM ${week} THEN 1 ELSE 0 END, prep=LEAST(100,"CourseProgress".prep+${prep}), "lastAttendWeek"=CASE WHEN ${attended}>0 THEN ${week} ELSE "CourseProgress"."lastAttendWeek" END`);
        }
      }
      if (s.exams > b.exams) {
        const result = s.admin.results.at(-1);
        if (result) {
          const key = `${week}:${result.weekday}`;
          await db.execute(sql`INSERT INTO "CampusAssessment" ("characterId",key,"gameWeek",score) VALUES (${String(c.id)},${key},${week},${result.score}) ON CONFLICT ("characterId",key) DO NOTHING`);
          const relativeWeek = week - Number(c.joinedWeek) + 1;
          if (relativeWeek > 0 && relativeWeek % 6 === 0 && result.weekday === 5) {
            const marks = await db.execute(sql`SELECT score FROM "CampusAssessment" WHERE "characterId"=${String(c.id)} AND "gameWeek"=${week}`);
            const score = Math.round(marks.reduce((n, m) => n + Number(m.score), 0) / Math.max(1, marks.length));
            const gp = score >= 70 ? 5 : score >= 60 ? 4 : score >= 50 ? 3 : score >= 45 ? 2 : score >= 40 ? 1 : 0;
            await db.execute(sql`INSERT INTO "ExamResult" ("characterId","gameWeek",level,score,"gradePoint",cheated,caught,missed) VALUES (${String(c.id)},${week},${Number(c.level)},${score},${gp},false,false,false) ON CONFLICT ("characterId","gameWeek") DO NOTHING`);
          }
        }
        const grades = await db.execute(sql`SELECT "gradePoint" FROM "ExamResult" WHERE "characterId"=${String(c.id)}`);
        s.exams = grades.length;
        s.gpTotal = grades.reduce((n, row) => n + Number(row.gradePoint), 0);
      }
      await profiles.writeNow(s.profileId, getProfile(id));
    }
    return out;
  });
}
