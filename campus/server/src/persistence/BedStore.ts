import { and, eq } from "drizzle-orm";
import { db } from "../database/database";
import { bedSpaces } from "../database/schema/beds";
import type { BedStore } from "../sim/admin/types";

export class PgBedStore implements BedStore {
  async hallOf(week: number, accountId: string): Promise<string | undefined> {
    const [held] = await db.select({ hall: bedSpaces.hall }).from(bedSpaces).where(and(eq(bedSpaces.week, week), eq(bedSpaces.accountId, accountId))).limit(1);
    return held?.hall;
  }

  async claim(week: number, hall: string, beds: number, accountId: string): Promise<boolean> {
    for (let slot = 1; slot <= beds; slot++) {
      const held = await this.hallOf(week, accountId);
      if (held !== undefined) return held === hall;
      const added = await db.insert(bedSpaces).values({ week, hall, slot, accountId }).onConflictDoNothing().returning({ slot: bedSpaces.slot });
      if (added.length > 0) return true;
    }
    return false;
  }

  async release(accountId: string): Promise<void> {
    await db.delete(bedSpaces).where(eq(bedSpaces.accountId, accountId));
  }
}

export const bedStore: BedStore = new PgBedStore();
