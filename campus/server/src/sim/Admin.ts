import {
  HANDOUT_TEXT,
  REGISTRATION,
  RESULT_TEXT,
  addHandout,
  adminWeek,
  atBusinessCentre,
  classesOn,
  courseAttendance,
  gameMinutesAt,
  gameTime,
  gradeFor,
  handoutClassStudy,
  handoutTestMarks,
  holdsBed,
  isRegistered,
  parseAdminAction,
  portalRush,
  publicBallotOpen,
  recordResult,
  registrationOpen,
  resultRemark,
  rollAdminWeek,
  testCourseOn,
  timetableFor,
  timetableWithCarryOvers,
  tryBuyHandout,
  tryRegister,
  unregisteredPenalty,
  type DayClass,
  type GameTime,
  type HandoutSource,
  type RegistrationVia,
  type StudentTimetable,
} from "@campuslife/shared";
import { BedDesk } from "./admin/beds";
import { centreClosed } from "./admin/centre";
import { ShiftRunner } from "./admin/shifts";
import { ADMIN_NOTICE, type AdminHost, type AdminStudent } from "./admin/types";

export type { AdminHost, AdminStudent } from "./admin/types";

interface Seat {
  week: number;
  dayIndex: number;
  classes: DayClass[];
  said: Set<string>;
}

const MAX_STUDY = 65535;
const NO_DAY = -1;

export class AdminDesk {
  private seats = new Map<string, Seat>();
  private beds: BedDesk;
  private shifts: ShiftRunner;
  private clock: () => GameTime;

  constructor(private host: AdminHost) {
    this.clock = host.now ?? (() => gameTime(gameMinutesAt(Date.now())));
    this.beds = new BedDesk(host, (id, student) => this.saved(id, student));
    this.shifts = new ShiftRunner(host, (id, student) => this.sync(id, student));
  }

  join(id: string, student: AdminStudent, now: GameTime = this.clock()) {
    this.seats.delete(id);
    this.seatFor(id, student, now);
    this.beds.joined(student, adminWeek(now));
    this.sync(id, student);
  }

  leave(id: string) {
    this.seats.delete(id);
    this.shifts.drop(id);
  }

  bedsHeld(week: number, place: number): number {
    return this.beds.holders(week, place);
  }

  timetable(student: AdminStudent, now: GameTime = this.clock()): StudentTimetable {
    return timetableWithCarryOvers(timetableFor(student.department, student.level), student.admin, adminWeek(now));
  }

  handle(id: string, student: AdminStudent, raw: unknown, now: GameTime = this.clock()) {
    const action = parseAdminAction(raw);
    if (!action) return;
    this.seatFor(id, student, now);
    switch (action.a) {
      case "sync":
        return this.sync(id, student);
      case "register":
        return this.register(id, student, now, "portal");
      case "centre":
        return this.register(id, student, now, "centre");
      case "ballot": {
        const result = this.beds.ballot(id, student, action.hall, now);
        if (result instanceof Promise) return result.then((changed) => { if (changed) this.saved(id, student); });
        if (result) this.saved(id, student);
        return;
      }
      case "handout":
        return this.handout(id, student, now, action.code, "rep");
      case "copy":
        return this.handout(id, student, now, action.code, "copy");
      case "hustle":
        return this.shifts.start(id, student, action.id, now);
      case "stop":
        return this.shifts.stop(id, student);
    }
  }

  tick(id: string, student: AdminStudent, now: GameTime, dt: number) {
    const seat = this.seatFor(id, student, now);
    this.remind(id, student, seat, now);
    if (this.beds.sleep(id, student, now, dt, (key, text) => this.say(id, seat, key, text))) this.saved(id, student);
    this.creditHandouts(id, student, seat, now);
    this.shifts.tick(id, student, now, dt);
  }

  testMarks(id: string, student: AdminStudent, now: GameTime = this.clock()): number {
    const penalty = unregisteredPenalty(student.admin, now.total);
    if (penalty > 0) this.host.notify(id, RESULT_TEXT.adviser(penalty));
    const course = testCourseOn(timetableFor(student.department, student.level), now.dayIndex);
    return (course ? handoutTestMarks(student.admin, adminWeek(now), course) : 0) - penalty;
  }

  testDone(id: string, student: AdminStudent, score: number, now: GameTime = this.clock()) {
    const course = testCourseOn(timetableFor(student.department, student.level), now.dayIndex);
    if (!course) return;
    const { result, carried } = recordResult(student.admin, adminWeek(now), now.weekday, course, score);
    this.host.notify(id, RESULT_TEXT.sheet(result.code, result.score, gradeFor(result.score).grade, resultRemark(result.score)));
    if (carried) this.host.notify(id, RESULT_TEXT.carry(result.code));
    this.saved(id, student);
  }

  private seatFor(id: string, student: AdminStudent, now: GameTime): Seat {
    const week = adminWeek(now);
    let seat = this.seats.get(id);
    if (!seat) this.seats.set(id, (seat = { week: NO_DAY, dayIndex: NO_DAY, classes: [], said: new Set() }));
    if (seat.week !== week) {
      seat.week = week;
      seat.said.clear();
      const record = student.admin;
      let changed = rollAdminWeek(record, week);
      if (record.ballot.week !== week) {
        record.ballot = { week, from: now.total, tried: false };
        changed = true;
      }
      if (changed) this.saved(id, student);
    }
    if (seat.dayIndex !== now.dayIndex) {
      seat.dayIndex = now.dayIndex;
      seat.classes = classesOn(this.timetable(student, now), now.dayIndex);
    }
    return seat;
  }

  private say(id: string, seat: Seat, key: string, text: string) {
    if (seat.said.has(key)) return;
    seat.said.add(key);
    this.host.notify(id, text);
  }

  private remind(id: string, student: AdminStudent, seat: Seat, now: GameTime) {
    const record = student.admin;
    if (!isRegistered(record, seat.week)) {
      if (!registrationOpen(now.total)) this.say(id, seat, "reg-missed", ADMIN_NOTICE.regMissed(REGISTRATION.lateFine, REGISTRATION.testPenalty));
      else if (portalRush(now.total)) this.say(id, seat, "reg-rush", ADMIN_NOTICE.regRush);
      else this.say(id, seat, "reg-open", ADMIN_NOTICE.regOpen);
    }
    if (!holdsBed(record, seat.week) && !record.ballot.tried && publicBallotOpen(now.total)) this.say(id, seat, "ballot", ADMIN_NOTICE.ballotOpen);
  }

  private register(id: string, student: AdminStudent, now: GameTime, via: RegistrationVia) {
    if (via === "centre" && !atBusinessCentre(student.x, student.y)) return this.host.notify(id, ADMIN_NOTICE.needCentre);
    const shut = via === "centre" ? centreClosed(student.x, student.y, now) : undefined;
    if (shut) return this.host.notify(id, shut);
    const outcome = tryRegister(student.admin, now.total, student.cash, via);
    if (!outcome.ok) return this.host.notify(id, outcome.text);
    student.cash -= outcome.cost;
    student.admin.reg = { week: adminWeek(now), late: outcome.late, by: via };
    this.host.notify(id, via === "centre" ? ADMIN_NOTICE.centreRan(outcome.cost) : ADMIN_NOTICE.registered(outcome.late, outcome.cost));
    this.saved(id, student);
  }

  private handout(id: string, student: AdminStudent, now: GameTime, code: string, source: HandoutSource) {
    if (source === "copy" && !atBusinessCentre(student.x, student.y)) return this.host.notify(id, ADMIN_NOTICE.needCentre);
    const shut = source === "copy" ? centreClosed(student.x, student.y, now) : undefined;
    if (shut) return this.host.notify(id, shut);
    const week = adminWeek(now);
    const outcome = tryBuyHandout(student.admin, week, timetableFor(student.department, student.level).courses, code, source, student.cash);
    if (!outcome.ok) return this.host.notify(id, outcome.text);
    student.cash -= outcome.price;
    addHandout(student.admin, week, code, source);
    this.host.notify(id, source === "rep" ? HANDOUT_TEXT.bought(code, outcome.price, outcome.favour) : HANDOUT_TEXT.copied(code, outcome.price));
    this.saved(id, student);
  }

  private creditHandouts(id: string, student: AdminStudent, seat: Seat, now: GameTime) {
    if (student.admin.handouts.held.length === 0) return;
    for (const c of seat.classes) {
      if (courseAttendance(student.attendance, c.course.code).lastSigned !== c.session) continue;
      const bonus = handoutClassStudy(student.admin, adminWeek(now), c.course.code, c.session);
      if (bonus <= 0) continue;
      student.study = Math.min(MAX_STUDY, student.study + bonus);
      student.weekStudy = Math.min(MAX_STUDY, student.weekStudy + bonus);
      this.host.notify(id, HANDOUT_TEXT.helped(c.course.code));
      this.saved(id, student);
    }
  }

  private saved(id: string, student: AdminStudent) {
    this.host.changed(id);
    this.sync(id, student);
  }

  private sync(id: string, student: AdminStudent) {
    this.host.send(id, { department: student.department, level: student.level, record: student.admin, shift: this.shifts.of(id) });
  }
}
