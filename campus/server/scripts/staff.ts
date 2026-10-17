import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { initializeWorldClock, worldSession } from "../src/oau/bridge";
import { STAFF_ROLES, type StaffRoleCode } from "@campuslife/shared/market";
import { closeDatabase, db } from "../src/database/database";
import { accounts, staffRoles } from "../src/database/schema";

const USAGE = "Usage: npm run staff -w @campuslife/server -- <grant|revoke> <rider|admin> <username>\n       npm run staff -w @campuslife/server -- list";

function isRole(value: string | undefined): value is StaffRoleCode {
  return value !== undefined && (STAFF_ROLES as readonly string[]).includes(value);
}

async function accountId(username: string): Promise<string> {
  const rows = await db.execute(sql`SELECT "userId" AS id FROM "Character" WHERE lower(name)=lower(${username}) LIMIT 1`);
  const row = rows[0];
  if (!row) throw new Error(`No OAU character called ${username}.`);
  await initializeWorldClock();
  await worldSession(String(row.id));
  return String(row.id);
}

async function main(): Promise<void> {
  const [command, role, username] = process.argv.slice(2);
  if (command === "list") {
    const rows = await db
      .select({ username: accounts.username, role: staffRoles.role, grantedAt: staffRoles.grantedAt })
      .from(staffRoles)
      .innerJoin(accounts, eq(accounts.id, staffRoles.accountId))
      .orderBy(staffRoles.role, accounts.username);
    if (!rows.length) console.log("No staff yet.");
    for (const row of rows) console.log(`${row.role.padEnd(6)} ${row.username}  (since ${row.grantedAt.toISOString().slice(0, 10)})`);
    return;
  }
  if ((command !== "grant" && command !== "revoke") || !isRole(role) || !username) throw new Error(USAGE);
  const id = await accountId(username);
  if (command === "grant") {
    await db.insert(staffRoles).values({ accountId: id, role }).onConflictDoNothing();
    console.log(`${username} is now a ${role}.`);
  } else {
    await db.delete(staffRoles).where(and(eq(staffRoles.accountId, id), eq(staffRoles.role, role)));
    console.log(`${username} is no longer a ${role}.`);
  }
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
