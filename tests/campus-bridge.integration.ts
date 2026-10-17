import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { sql } from "drizzle-orm";
import { initializeWorldClock, linkedProfile, settleWorld, type WorldStudent } from "../campus/server/src/oau/bridge";
import { closeDatabase, db } from "../campus/server/src/database/database";
import { profiles, type Profile } from "../campus/server/src/persistence/ProfileStore";
import { coursesFor } from "../lib/curriculum.js";
import { configureWorldClock, gameMinutesAt } from "@campuslife/shared";
import { transfer, verifyBalance } from "../lib/ledger.js";

assert.match(process.env.DATABASE_URL ?? "", /localhost:5432\/lifeinoau_campus_integration(?:\?|$)/);
const prisma = new PrismaClient();
try {
  await initializeWorldClock();
  const user = await prisma.user.findFirstOrThrow({ where: { email: { startsWith: "campus_b_", endsWith: "@example.invalid" } }, orderBy: { createdAt: "desc" }, include: { character: { include: { faculty: true, account: true } } } });
  const session = await import("../campus/server/src/oau/bridge").then((m) => m.worldSession(user.id));
  const link = await prisma.campusLink.findUniqueOrThrow({ where: { userId: user.id } });
  const profile = await linkedProfile(link.profileId, await profiles.load(link.profileId));
  assert.equal((profile.admin?.bed as { hall: string }).hall, "Awolowo Hall");
  const sim = { ...profile, profileId: link.profileId, attendance: profile.attendance ?? {}, admin: profile.admin ?? {} } as unknown as WorldStudent;
  const students = new Map([["fixture", sim]]);
  const getProfile = () => sim as unknown as Profile;
  const run = (action: string, mutate: () => Promise<void> | void) => settleWorld(students, getProfile, () => undefined, action, mutate);
  const account = user.character!.account!;
  const balance = async () => (await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).balance;
  const world = await prisma.account.findUniqueOrThrow({ where: { systemName: "WORLD" } });
  await transfer(prisma, { fromId: world.id, toId: account.id, amount: 100000n, memo: "Local integration fixture", key: `campus-test:${crypto.randomUUID()}`, week: 1 });
  const original = await balance();
  const ledgerCount = await prisma.ledgerEntry.count({ where: { OR: [{ debitAccountId: account.id }, { creditAccountId: account.id }] } });
  await assert.rejects(run("rollback fixture", async () => {
    sim.cash -= 123;
    await db.execute(sql`UPDATE "Character" SET happiness=13 WHERE id=${user.character!.id}`);
    throw new Error("fixture rollback");
  }), /fixture rollback/);
  assert.equal(await balance(), original);
  assert.equal((await prisma.character.findUniqueOrThrow({ where: { id: user.character!.id } })).happiness, user.character!.happiness);
  assert.equal(await prisma.ledgerEntry.count({ where: { OR: [{ debitAccountId: account.id }, { creditAccountId: account.id }] } }), ledgerCount);
  const another = { ...sim };
  await Promise.all([
    run("concurrent fixture one", () => { sim.cash -= 100; }),
    settleWorld(new Map([["other", another]]), () => another as unknown as Profile, () => undefined, "concurrent fixture two", () => { another.cash -= 100; }),
  ]);
  assert.equal(await balance(), original - 20000n);
  await assert.rejects(run("invalid debit fixture", () => { sim.cash = -1; }), /invalid balance/);
  assert.equal(await balance(), original - 20000n);
  const week = Math.floor(gameMinutesAt(Date.now()) / 10080) + 1;
  const course = coursesFor(user.character!.faculty.name, user.character!.level)[0].code;
  await run("class fixture", () => {
    sim.study += 4;
    sim.attendance[course] = [(sim.attendance[course]?.[0] ?? 0) + 1, 1, 1, 1];
  });
  const progress = await prisma.courseProgress.findFirstOrThrow({ where: { characterId: user.character!.id, code: course, sessionStartWeek: user.character!.sessionStartWeek } });
  assert.ok(progress.prep >= 8);
  assert.equal(progress.lastAttendWeek, week);
  await run("repeated attendance fixture", () => { sim.attendance[course][0]++; });
  const repeated = await prisma.courseProgress.findUniqueOrThrow({ where: { characterId_sessionStartWeek_code: { characterId: user.character!.id, sessionStartWeek: user.character!.sessionStartWeek, code: course } } });
  assert.equal(repeated.attended, progress.attended);
  await prisma.examResult.upsert({ where: { characterId_gameWeek: { characterId: user.character!.id, gameWeek: week } }, create: { characterId: user.character!.id, gameWeek: week, level: user.character!.level, score: 65, gradePoint: 4, cheated: false, caught: false, missed: false }, update: { score: 65, gradePoint: 4 } });
  await run("original exam refresh fixture", () => {});
  assert.ok(sim.exams > 0);
  assert.ok(sim.gpTotal >= 4);
  const examWeek = user.character!.joinedWeek + 5;
  configureWorldClock(Date.now() - 5 * 1440 * 2000, examWeek);
  await run("physical exam fixture", () => {
    sim.exams++;
    sim.admin.results.push({ week: examWeek - 1, weekday: 5, score: 75 });
  });
  const physical = await prisma.examResult.findUniqueOrThrow({ where: { characterId_gameWeek: { characterId: user.character!.id, gameWeek: examWeek } } });
  assert.equal(physical.score, 75);
  assert.equal(physical.gradePoint, 5);
  assert.ok((await verifyBalance(prisma, account.id)).ok);
  assert.equal(session.student.school, "obafemi-awolowo-university-ile-ife");
  console.log("PASS: transaction rollback, concurrent purchases, invalid debit protection, existing hostel, physical class credit, attendance replay, original results refresh and physical OAU exam credit.");
} finally {
  await prisma.$disconnect();
  await closeDatabase();
}
