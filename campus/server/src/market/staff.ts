import { eq } from "drizzle-orm";
import type { StaffRoleCode } from "@campuslife/shared/market";
import { db } from "../database/database";
import { staffRoles } from "../database/schema";

export async function rolesOf(accountId: string): Promise<StaffRoleCode[]> {
  const rows = await db.select({ role: staffRoles.role }).from(staffRoles).where(eq(staffRoles.accountId, accountId));
  return rows.map((r) => r.role);
}
