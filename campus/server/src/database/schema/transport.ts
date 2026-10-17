import { boolean, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const schoolTransport = pgTable("school_transport", {
  schoolId: text("school_id").primaryKey(),
  modes: text("modes").array(),
  fares: jsonb("fares").$type<unknown>(),
  enabled: boolean("enabled").notNull().default(true),
  note: text("note"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SchoolTransportRow = typeof schoolTransport.$inferSelect;
export type NewSchoolTransportRow = typeof schoolTransport.$inferInsert;
