// A real Prisma client for the administrator console's database tests. They TRUNCATE and refill the game tables, so DATABASE_URL must be a throwaway database.
import { PrismaClient } from "@prisma/client";
export function makeDb() {
  if (!/(localhost|127\.0\.0\.1).*\/\w*(_test|_dev)\b/.test(process.env.DATABASE_URL ?? "")) throw new Error("Refusing to run: DATABASE_URL must point at a local database whose name ends in _test or _dev, because these tests delete data.");
  const db = new PrismaClient({ transactionOptions: { maxWait: 15000, timeout: 60000 } });
  db.end = () => db.$disconnect();
  return db;
}
