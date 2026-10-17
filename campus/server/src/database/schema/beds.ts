import { integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const bedSpaces = pgTable(
  "bed_spaces",
  {
    week: integer("week").notNull(),
    hall: text("hall").notNull(),
    slot: integer("slot").notNull(),
    accountId: text("account_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: "bed_spaces_week_hall_slot_pk", columns: [table.week, table.hall, table.slot] }), uniqueIndex("bed_spaces_week_account_unique").on(table.week, table.accountId)],
);
