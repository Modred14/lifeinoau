import { sql } from "drizzle-orm";
import { bigint, char, doublePrecision, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const players = pgTable(
  "players",
  {
    id: char("id", { length: 64 }).primaryKey(),
    name: text("name").notNull(),
    background: text("background").notNull(),
    school: text("school"),
    level: text("level"),
    department: text("department"),
    cash: bigint("cash", { mode: "number" }).notNull(),
    debt: doublePrecision("debt").notNull().default(0),
    study: doublePrecision("study").notNull().default(0),
    studySeconds: doublePrecision("study_seconds").notNull().default(0),
    packs: doublePrecision("packs").notNull().default(0),
    skillDrive: doublePrecision("skill_drive").notNull().default(0),
    skillCook: doublePrecision("skill_cook").notNull().default(0),
    skillTeach: doublePrecision("skill_teach").notNull().default(0),
    food: doublePrecision("food").notNull(),
    energy: doublePrecision("energy").notNull(),
    fun: doublePrecision("fun").notNull(),
    lastAllowanceAt: doublePrecision("last_allowance_at").notNull().default(0),
    attended: doublePrecision("attended").notNull().default(0),
    gpTotal: doublePrecision("gp_total").notNull().default(0),
    exams: doublePrecision("exams").notNull().default(0),
    lastGrade: text("last_grade").notNull().default(""),
    malpractice: doublePrecision("malpractice").notNull().default(0),
    rusticatedUntil: doublePrecision("rusticated_until").notNull().default(0),
    weekStudy: doublePrecision("week_study").notNull().default(0),
    weekAttended: doublePrecision("week_attended").notNull().default(0),
    attendance: jsonb("attendance").$type<Record<string, number[]>>().notNull().default({}),
    admin: jsonb("admin").$type<Record<string, unknown>>().notNull().default({}),
    posX: doublePrecision("pos_x"),
    posY: doublePrecision("pos_y"),
    phone: text("phone"),
    conditions: jsonb("conditions").$type<Record<string, unknown>>().notNull().default({}),
    social: jsonb("social").$type<Record<string, unknown>>().notNull().default({}),
    written: text("written")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("players_school_idx").on(table.school)],
);

export type PlayerRow = typeof players.$inferSelect;
export type NewPlayerRow = typeof players.$inferInsert;
