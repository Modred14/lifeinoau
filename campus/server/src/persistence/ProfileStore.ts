import { createHash } from "node:crypto";
import { eq, getTableColumns, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "../database/database";
import { players, type NewPlayerRow, type PlayerRow } from "../database/schema";

export interface Profile {
  name: string;
  background: string;
  school?: string;
  level?: string;
  department?: string;
  cash: number;
  debt: number;
  study: number;
  studySeconds: number;
  packs: number;
  skills: { drive: number; cook: number; teach: number };
  food: number;
  energy: number;
  fun: number;
  lastAllowanceAt: number;
  attended: number;
  gpTotal: number;
  exams: number;
  lastGrade: string;
  malpractice: number;
  rusticatedUntil: number;
  weekStudy: number;
  weekAttended: number;
  attendance?: Record<string, number[]>;
  admin?: Record<string, unknown>;
  written: string[];
  x?: number;
  y?: number;
  phone?: string;
  conditions?: Record<string, unknown>;
  social?: Record<string, unknown>;
}

type Pending = Profile | null;

const KEY_RE = /^[A-Za-z0-9-]{20,64}$/;
const WRITE_DELAY_MS = 1000;
const RETRY_DELAY_MS = 5000;
const UPSERT_CHUNK = 100;
const FLUSH_ATTEMPTS = 3;

function toProfile(row: PlayerRow): Profile {
  return {
    name: row.name,
    background: row.background,
    school: row.school ?? undefined,
    level: row.level ?? undefined,
    department: row.department ?? undefined,
    cash: row.cash,
    debt: row.debt,
    study: row.study,
    studySeconds: row.studySeconds,
    packs: row.packs,
    skills: { drive: row.skillDrive, cook: row.skillCook, teach: row.skillTeach },
    food: row.food,
    energy: row.energy,
    fun: row.fun,
    lastAllowanceAt: row.lastAllowanceAt,
    attended: row.attended,
    gpTotal: row.gpTotal,
    exams: row.exams,
    lastGrade: row.lastGrade,
    malpractice: row.malpractice,
    rusticatedUntil: row.rusticatedUntil,
    weekStudy: row.weekStudy,
    weekAttended: row.weekAttended,
    attendance: row.attendance ?? {},
    admin: row.admin ?? {},
    written: row.written,
    x: row.posX ?? undefined,
    y: row.posY ?? undefined,
    phone: row.phone ?? undefined,
    conditions: row.conditions ?? {},
    social: row.social ?? {},
  };
}

export function toRow(id: string, p: Profile, now: Date): NewPlayerRow {
  return {
    id,
    name: p.name,
    background: p.background,
    school: p.school ?? null,
    level: p.level ?? null,
    department: p.department ?? null,
    cash: Math.floor(p.cash),
    debt: p.debt,
    study: p.study,
    studySeconds: p.studySeconds,
    packs: p.packs,
    skillDrive: p.skills.drive,
    skillCook: p.skills.cook,
    skillTeach: p.skills.teach,
    food: p.food,
    energy: p.energy,
    fun: p.fun,
    lastAllowanceAt: p.lastAllowanceAt,
    attended: p.attended,
    gpTotal: p.gpTotal,
    exams: p.exams,
    lastGrade: p.lastGrade,
    malpractice: p.malpractice,
    rusticatedUntil: p.rusticatedUntil,
    weekStudy: p.weekStudy,
    weekAttended: p.weekAttended,
    attendance: p.attendance ?? {},
    admin: p.admin ?? {},
    written: p.written,
    posX: p.x ?? null,
    posY: p.y ?? null,
    phone: p.phone ?? null,
    conditions: p.conditions ?? {},
    social: p.social ?? {},
    updatedAt: now,
  };
}

const KEEP_ON_UPDATE = new Set(["id", "createdAt"]);
const UPDATE_SET: Record<string, SQL> = Object.fromEntries(
  Object.entries(getTableColumns(players))
    .filter(([key]) => !KEEP_ON_UPDATE.has(key))
    .map(([key, column]) => [key, sql.raw(`excluded."${column.name}"`)]),
);

export class ProfileStore {
  private pending = new Map<string, Pending>();
  private inflight = new Map<string, Pending>();
  private timer?: NodeJS.Timeout;
  private draining?: Promise<void>;

  static idFor(key: unknown): string | null {
    if (typeof key !== "string" || !KEY_RE.test(key)) return null;
    return createHash("sha256").update(key).digest("hex");
  }

  async load(id: string): Promise<Profile | undefined> {
    for (const queue of [this.pending, this.inflight]) {
      if (queue.has(id)) return queue.get(id) ?? undefined;
    }
    const [row] = await db.select().from(players).where(eq(players.id, id)).limit(1);
    return row ? toProfile(row) : undefined;
  }

  async writeNow(id: string, profile: Profile) {
    await db.insert(players).values(toRow(id, profile, new Date())).onConflictDoUpdate({ target: players.id, set: UPDATE_SET });
  }

  save(id: string, profile: Profile) {
    this.pending.set(id, profile);
    this.schedule(WRITE_DELAY_MS);
  }

  delete(id: string) {
    this.pending.set(id, null);
    this.schedule(WRITE_DELAY_MS);
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    for (let attempt = 1; attempt <= FLUSH_ATTEMPTS && (this.pending.size > 0 || this.draining); attempt++) {
      try {
        await this.drain();
      } catch (err) {
        console.error(`[profiles] flush attempt ${attempt} failed`, err);
      }
    }
    if (this.pending.size > 0) console.error(`[profiles] ${this.pending.size} save(s) could not be written`);
  }

  private schedule(delay: number) {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.drain().catch((err: unknown) => {
        console.error("[profiles] write failed, will retry", err);
        this.schedule(RETRY_DELAY_MS);
      });
    }, delay);
  }

  private drain(): Promise<void> {
    this.draining ??= this.writeAll().finally(() => {
      this.draining = undefined;
    });
    return this.draining;
  }

  private async writeAll() {
    while (this.pending.size > 0) {
      const batch = this.pending;
      this.inflight = batch;
      this.pending = new Map();
      try {
        await this.write(batch);
      } catch (err) {
        for (const [id, value] of batch) if (!this.pending.has(id)) this.pending.set(id, value);
        throw err;
      } finally {
        this.inflight = new Map();
      }
    }
  }

  private async write(batch: Map<string, Pending>) {
    const now = new Date();
    const removed: string[] = [];
    const rows: NewPlayerRow[] = [];
    for (const [id, value] of batch) {
      if (value) rows.push(toRow(id, value, now));
      else removed.push(id);
    }
    await db.transaction(async (tx) => {
      if (removed.length > 0) await tx.delete(players).where(inArray(players.id, removed));
      for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
        await tx
          .insert(players)
          .values(rows.slice(i, i + UPSERT_CHUNK))
          .onConflictDoUpdate({ target: players.id, set: UPDATE_SET });
      }
    });
  }
}

export const profiles = new ProfileStore();
