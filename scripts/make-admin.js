// scripts/make-admin.js
// Usage: node scripts/make-admin.js you@example.com   (run on the server; there is deliberately no API for this)
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient(), email = (process.argv[2] ?? "").trim().toLowerCase();
const u = email && await db.user.findUnique({ where: { email } });
if (!u) { console.error("No user with that email."); process.exit(1); }
await db.user.update({ where: { id: u.id }, data: { role: "ADMIN" } });
await db.auditLog.create({ data: { actorId: "SYSTEM", action: "MAKE_ADMIN", target: u.id } });
console.log("Done:", email, "is now ADMIN"); await db.$disconnect();
