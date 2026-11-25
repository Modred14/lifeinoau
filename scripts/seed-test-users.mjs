// scripts/seed-test-users.mjs
// TEST ONLY. Creates one signed-in-able test character per kind of home (hall, Ojaja, Off-campus, a flat, a 3-bedroom and a 4-bedroom house), each owning two cars,
// for the real-browser journey (tests/e2e/home-journey.e2e.mjs). Never run it against a real database: it refuses unless DATABASE_URL points at localhost.
//   node --env-file=.env.local scripts/seed-test-users.mjs        (password for every user: "e2e-password-1")
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { drawClass, lifestyle } from "../lib/rng.js";
import { startingTransport } from "../lib/rules.js";
import { chooseHostelWithRoom } from "../lib/roomService.js";
import { currentWeek } from "../lib/clock.js";
import { cleanLook, withoutWear } from "../lib/look.js";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) { console.error("refusing: DATABASE_URL is not a local database"); process.exit(1); }
export const PASSWORD = "e2e-password-1";
export const HOMES = { hall: "Awo", ojaja: "Ojaja", offcampus: "Off-campus", flat: "2-Bedroom Flat", house3: "3-Bedroom House", house4: "4-Bedroom House" };
export const CARS = [{ modelId: "corolla-2011", color: "#c0392b" }, { modelId: "accord-2014", color: "#2c5aa0" }];
const db = new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } });
const week = await currentWeek(db), faculty = await db.faculty.findFirst();
for (const [key, hostel] of Object.entries(HOMES)) {
  const email = `e2e-${key}@example.test`;
  const old = await db.user.findUnique({ where: { email }, include: { character: true } });
  if (old?.character) { // start clean: remove the old test character and everything of it
    const id = old.character.id;
    for (const t of ["ownedCar", "wardrobeItem", "roomItem", "actionLog"]) await db[t]?.deleteMany?.({ where: { characterId: id } }).catch(() => {});
  }
  const user = old ?? await db.user.create({ data: { email, passwordHash: await bcrypt.hash(PASSWORD, 4), isAdult: true } });
  let c = await db.character.findUnique({ where: { userId: user.id } });
  if (!c) {
    const pers = ["Introvert"], cls = "NEPO";
    c = await db.$transaction(async (tx) => {
      const ch = await tx.character.create({ data: { userId: user.id, name: `E2E ${key}`, gender: "M", class: cls, personalities: pers, facultyId: faculty.id, hostel: "", transport: startingTransport(cls), look: withoutWear(cleanLook(null, "M")), lastTickWeek: week - 1, lastParentCallWeek: week, joinedWeek: week, sessionStartWeek: week, energyRefilledAt: new Date(), ...lifestyle(pers) } });
      await tx.account.create({ data: { kind: "PLAYER", characterId: ch.id, balance: 50_000_000_00n } });
      return ch;
    });
    await chooseHostelWithRoom(db, c.id, hostel);
  } else await db.character.update({ where: { id: c.id }, data: { hostel } });
  for (const car of CARS) await db.ownedCar.upsert({ where: { characterId_modelId: { characterId: c.id, modelId: car.modelId } }, update: {}, create: { characterId: c.id, modelId: car.modelId, color: car.color, pricePaid: 1n } });
  await db.character.update({ where: { id: c.id }, data: { activeCar: CARS[0].modelId, activeCarColor: CARS[0].color, placeId: "" } });
  console.log("seeded", email, hostel, c.id);
}
process.exit(0);
