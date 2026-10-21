// prisma/seed.js
import { PrismaClient } from "@prisma/client";
import { FACULTIES } from "../lib/faculties.js";
const db = new PrismaClient();
// Faculty names are game content, unverified against the official OAU site (see lib/faculties.js).
await db.gameClock.upsert({
  where: { id: 1 },
  update: {},
  create: { id: 1, startedAt: new Date(), campusEpoch: new Date(), campusStartWeek: 1 },
});
for (const name of [
  "WORLD",
  "LANDLORDS",
  "PARENTS",
  "DSA",
  "TRANSPORT",
  "VENUES",
  "CLINICS",
  "BUSINESS",
  "MARKET",
  "SUG", // nomination fees and campaign spending (lib/sugService.js)
])
  await db.account.upsert({
    where: { systemName: name },
    update: {},
    create: { kind: "SYSTEM", systemName: name },
  });
for (const [name, difficulty] of FACULTIES)
  await db.faculty.upsert({
    where: { name },
    update: {},
    create: { name, difficulty },
  });
console.log("seeded");
await db.$disconnect();