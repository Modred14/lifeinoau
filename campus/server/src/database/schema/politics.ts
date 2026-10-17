import { sql } from "drizzle-orm";
import { boolean, char, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const politicsCandidacies = pgTable(
  "politics_candidacies",
  {
    id: text("id").primaryKey(),
    accountId: char("account_id", { length: 64 }).notNull(),
    cycle: integer("cycle").notNull(),
    race: text("race").notNull(),
    name: text("name").notNull(),
    support: jsonb("support").$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
    materials: text("materials").array().notNull().default(sql`'{}'::text[]`),
    spoke: boolean("spoke").notNull().default(false),
    nick: integer("nick").notNull().default(0),
    slogan: integer("slogan").notNull().default(0),
    color: integer("color").notNull().default(0),
    stops: jsonb("stops").$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("politics_candidacies_account_cycle_unique").on(table.accountId, table.cycle), index("politics_candidacies_cycle_race_idx").on(table.cycle, table.race)],
);

export const politicsVotes = pgTable(
  "politics_votes",
  {
    accountId: char("account_id", { length: 64 }).notNull(),
    cycle: integer("cycle").notNull(),
    race: text("race").notNull(),
    candidate: text("candidate").notNull(),
    informed: boolean("informed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: "politics_votes_account_cycle_race_pk", columns: [table.accountId, table.cycle, table.race] }), index("politics_votes_cycle_race_idx").on(table.cycle, table.race)],
);

export const politicsEndorsements = pgTable(
  "politics_endorsements",
  {
    accountId: char("account_id", { length: 64 }).notNull(),
    cycle: integer("cycle").notNull(),
    race: text("race").notNull(),
    candidate: text("candidate").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: "politics_endorsements_account_cycle_pk", columns: [table.accountId, table.cycle] }), index("politics_endorsements_cycle_race_idx").on(table.cycle, table.race)],
);

export const politicsMarks = pgTable(
  "politics_marks",
  {
    accountId: char("account_id", { length: 64 }).notNull(),
    cycle: integer("cycle").notNull(),
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: "politics_marks_account_cycle_kind_pk", columns: [table.accountId, table.cycle, table.kind] })],
);

export const politicsOffices = pgTable(
  "politics_offices",
  {
    cycle: integer("cycle").notNull(),
    race: text("race").notNull(),
    accountId: char("account_id", { length: 64 }).notNull(),
    name: text("name").notNull(),
    stipend: integer("stipend").notNull().default(0),
    stipendPaid: boolean("stipend_paid").notNull().default(false),
    powerUsedAt: integer("power_used_at"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: "politics_offices_cycle_race_pk", columns: [table.cycle, table.race] }), index("politics_offices_account_idx").on(table.accountId)],
);

export const politicsRentals = pgTable(
  "politics_rentals",
  {
    cycle: integer("cycle").notNull(),
    area: text("area").notNull(),
    slot: integer("slot").notNull(),
    candidacyId: text("candidacy_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: "politics_rentals_cycle_area_slot_pk", columns: [table.cycle, table.area, table.slot] }), uniqueIndex("politics_rentals_cycle_area_candidacy_unique").on(table.cycle, table.area, table.candidacyId)],
);

export const politicsReruns = pgTable(
  "politics_reruns",
  {
    cycle: integer("cycle").notNull(),
    race: text("race").notNull(),
    by: text("by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: "politics_reruns_cycle_race_pk", columns: [table.cycle, table.race] })],
);

export const politicsCampusStates = pgTable(
  "politics_campus_states",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    issue: text("issue").notNull().default(""),
    startsAt: integer("starts_at").notNull(),
    endsAt: integer("ends_at").notNull(),
    concession: text("concession").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("politics_campus_states_ends_idx").on(table.endsAt)],
);

export const politicsCongressSides = pgTable(
  "politics_congress_sides",
  {
    sitting: text("sitting").notNull(),
    accountId: char("account_id", { length: 64 }).notNull(),
    side: text("side").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: "politics_congress_sides_sitting_account_pk", columns: [table.sitting, table.accountId] })],
);

export const politicsImpeachments = pgTable(
  "politics_impeachments",
  {
    cycle: integer("cycle").notNull(),
    race: text("race").notNull(),
    ousted: text("ousted").notNull().default(""),
    successor: text("successor").notNull().default(""),
    successorAccount: char("successor_account", { length: 64 }),
    removed: boolean("removed").notNull().default(false),
    at: integer("at").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: "politics_impeachments_cycle_race_pk", columns: [table.cycle, table.race] })],
);

export type PoliticsCandidacyRow = typeof politicsCandidacies.$inferSelect;
export type PoliticsOfficeRow = typeof politicsOffices.$inferSelect;
