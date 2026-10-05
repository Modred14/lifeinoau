// prisma/seed.js
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
// verified:false until each name is checked against the official OAU site.
const FACULTIES = [["College of Health Sciences",1.3],["Administration",.9],["Agriculture",.9],["Arts",.8],["Computer Science",1.2],
  ["Education",.8],["Environmental Design & Management",1.1],["Law",1.2],["Pharmacy",1.3],["Science",1.1],["Social Sciences",.9],["Technology",1.3]];
await db.gameClock.upsert({ where: { id: 1 }, update: {}, create: { id: 1, startedAt: new Date() } });
for (const name of ["WORLD", "LANDLORDS", "PARENTS", "DSA", "TRANSPORT", "VENUES", "CLINICS", "BUSINESS", "MARKET"])
  await db.account.upsert({ where: { systemName: name }, update: {}, create: { kind: "SYSTEM", systemName: name } });
for (const [name, difficulty] of FACULTIES)
  await db.faculty.upsert({ where: { name }, update: {}, create: { name, difficulty } });
console.log("seeded"); await db.$disconnect();
