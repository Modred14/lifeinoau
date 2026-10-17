import { HUSTLES, HUSTLE_LIMITS, HUSTLE_TEXT, finishHustle, hustlePay, hustleRefusal, hustleSite, type AdminShift, type GameTime, type HustleId } from "@campuslife/shared";
import type { AdminHost, AdminStudent } from "./types";

interface Shift {
  id: HustleId;
  site: number;
  x: number;
  y: number;
  left: number;
}

const busy = (student: AdminStudent) => student.act !== undefined || student.ride >= 0 || student.driving >= 0;

export class ShiftRunner {
  private shifts = new Map<string, Shift>();

  constructor(
    private host: AdminHost,
    private sync: (id: string, student: AdminStudent) => void,
  ) {}

  of(id: string): AdminShift | undefined {
    const shift = this.shifts.get(id);
    return shift && { id: shift.id, left: Math.max(0, Math.ceil(shift.left)) };
  }

  start(id: string, student: AdminStudent, hustle: HustleId, now: GameTime) {
    const spec = HUSTLES[hustle];
    if (this.shifts.has(id) || busy(student)) return this.host.notify(id, HUSTLE_TEXT.busy);
    const site = hustleSite(hustle, student.x, student.y);
    if (site === undefined) return this.host.notify(id, HUSTLE_TEXT.place(spec));
    const refusal = hustleRefusal(hustle, student.admin, now, student.energy);
    if (refusal) return this.host.notify(id, refusal);
    this.shifts.set(id, { id: hustle, site, x: student.x, y: student.y, left: spec.seconds });
    this.host.notify(id, HUSTLE_TEXT.started(spec));
    this.sync(id, student);
  }

  stop(id: string, student: AdminStudent) {
    if (!this.shifts.delete(id)) return;
    this.host.notify(id, HUSTLE_TEXT.left);
    this.sync(id, student);
  }

  drop(id: string) {
    this.shifts.delete(id);
  }

  tick(id: string, student: AdminStudent, now: GameTime, dt: number) {
    const shift = this.shifts.get(id);
    if (!shift) return;
    if (busy(student) || Math.hypot(student.x - shift.x, student.y - shift.y) > HUSTLE_LIMITS.leave) return this.stop(id, student);
    const spec = HUSTLES[shift.id];
    const step = Math.min(dt, shift.left);
    student.energy = Math.max(0, student.energy - (spec.energy / spec.seconds) * step);
    shift.left -= dt;
    if (shift.left > 0) return;
    this.shifts.delete(id);
    const pay = hustlePay(shift.id, student.admin.skills[shift.id], shift.site, now);
    finishHustle(student.admin, shift.id, now.dayIndex);
    const pocket = pay > 0 ? this.host.earn(id, pay) : 0;
    this.host.notify(id, pay > 0 ? HUSTLE_TEXT.paid(spec, pay, pocket) : HUSTLE_TEXT.quiet);
    this.host.changed(id);
    this.sync(id, student);
  }
}
