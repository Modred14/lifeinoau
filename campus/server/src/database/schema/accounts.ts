import { char, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique("accounts_username_unique"),
  passwordHash: text("password_hash").notNull(),
  recoveryHash: char("recovery_hash", { length: 64 }).notNull(),
  playerId: char("player_id", { length: 64 }).notNull().unique("accounts_player_id_unique"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: char("id", { length: 64 }).primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("sessions_account_idx").on(table.accountId), index("sessions_expires_idx").on(table.expiresAt)],
);

export type AccountRow = typeof accounts.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
