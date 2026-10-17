/**
 * Classes and attendance against a private server (started here, on SMOKE_PORT).
 *
 *   npx tsx scripts/smoke-classes.ts   (from server/)
 *
 * Needs: a weekday with a sheet class, a weekday with a plain class, and 16:00
 * on a weekday for the daily test. The days are picked from the shared timetable.
 */
import { Client } from "@colyseus/sdk";
import {
  ACTS,
  ATTENDANCE_MINUTES,
  EVENTS,
  Msg,
  PLACES,
  SPOTS,
  ServerMsg,
  classesOn,
  courseAttendance,
  eventPlace,
  parseClassesPayload,
  signedSession,
  timetableFor,
  type ClassesPayload,
  type DayClass,
} from "@campuslife/shared";
import { smokeAccount } from "./smoke-account";
import { SMOKE_URL, dayTotal, gameMinutesToMs, sleep, startServer, stopServer } from "./smoke-clock";
import { Actor, OAU, SAVE_SETTLE_MS, check, interiorOf, note, outside, patchSave, run, seedSave } from "./smoke-kit";

const NAME = "smoke_classes";
const DEPARTMENT = "computer-science";
const LEVEL = "100L";
const FIRST_DAY = 1400;
const SEARCH_DAYS = 400;
const START_CASH = 3000;
const STUDY = ACTS.indexOf("study");
const EXAM = ACTS.indexOf("exam");
const profile = { school: OAU, level: LEVEL, department: DEPARTMENT };

const timetable = timetableFor(DEPARTMENT, LEVEL);

function findClass(wanted: (c: DayClass) => boolean, after = FIRST_DAY): { day: number; c: DayClass } {
  for (let day = after; day < after + SEARCH_DAYS; day++) {
    const c = classesOn(timetable, day).find((k) => k.status !== "noshow" && wanted(k));
    if (c) return { day, c };
  }
  throw new Error("no class matches in the search window");
}

async function sitIn(actor: Actor, place: number): Promise<number> {
  const it = interiorOf(place);
  const seats = Array.from({ length: it.spotEnd - it.spotStart }, (_, k) => it.spotStart + k).filter((i) => SPOTS[i].kind === "study");
  for (const seat of [seats[seats.length - 4], seats[Math.floor(seats.length / 2)], seats[0]]) {
    if (seat === undefined || !(await actor.reach(seat))) continue;
    await actor.use(seat);
    if (actor.me.spot === seat + 1) return seat;
  }
  return -1;
}

const book = (actor: Actor, from = 0) => parseClassesPayload(actor.last<ClassesPayload>(ServerMsg.Classes, from));

await run("smoke-classes", async () => {
  const client = new Client(SMOKE_URL);
  const sheet = findClass((c) => c.sheet !== undefined && c.status !== "late");
  const plain = findClass((c) => c.sheet === undefined && c.snap === undefined && c.status === "holds", sheet.day + 1);
  note(`sheet class ${sheet.c.course.code} at ${PLACES[sheet.c.place].name}, plain class ${plain.c.course.code} at ${PLACES[plain.c.place].name}`);

  // ---- 1) Sheet day: sitting before the sheet does not sign, the sheet does.
  let url = await startServer(dayTotal(sheet.day, sheet.c.sheet! - 7));
  await smokeAccount(url, NAME);
  await seedSave(NAME, { cash: START_CASH, at: outside(sheet.c.place) });
  let a = await Actor.join(client, url, NAME, profile);
  const first = await a.ask<ClassesPayload>(Msg.Classes, undefined, ServerMsg.Classes);
  check(first?.department === DEPARTMENT && first.level === LEVEL, `Classes payload carries the department and level (${first?.department}, ${first?.level})`);
  check(Object.keys(parseClassesPayload(first)?.book ?? { x: 1 }).length === 0, "a new student starts with an empty attendance book");
  check(await a.enter(sheet.c.place), `entered ${PLACES[sheet.c.place].name}`);
  const seatA = await sitIn(a, sheet.c.place);
  check(seatA >= 0 && a.me.act === STUDY, `sat in a class seat (act ${ACTS[a.me.act]})`);
  const early = a.clock % 1440 < sheet.c.sheet!;
  check(!early || a.me.attended === 0, `no attendance before the sheet goes round (seated at minute ${a.clock % 1440}, sheet at ${sheet.c.sheet})`);
  check(await a.waitNotice(/attendance sheet is going round/, gameMinutesToMs(12)), "the sheet notice arrives");
  check(await a.waitNotice(new RegExp(`Attendance signed: ${sheet.c.course.code}`), gameMinutesToMs(6)), "sitting during the sheet signs attendance");
  await sleep(300);
  check(a.me.attended === 1 && a.me.study >= 3, `attended is 1 and study points went up (${a.me.attended}, ${a.me.study})`);
  check(signedSession(book(a)?.book ?? {}, sheet.c.course.code, sheet.c.session), "the pushed book has this session signed");
  await a.stand();
  await a.use(seatA);
  await sleep(1500);
  check(a.me.attended === 1, "standing up and sitting again in the same sheet window does not sign twice");
  await a.leave();
  await stopServer();

  // ---- 2) Plain class: 45 game minutes in the seat, then it survives leave and rejoin.
  await patchSave(NAME, { at: outside(plain.c.place) });
  url = await startServer(dayTotal(plain.day, plain.c.begins + 1));
  a = await Actor.join(client, url, NAME, profile);
  check(a.me.attended === 1, "attendance from the sheet day was saved across a server restart");
  check(await a.enter(plain.c.place), `entered ${PLACES[plain.c.place].name}`);
  const seatB = await sitIn(a, plain.c.place);
  const satAt = a.clock;
  check(seatB >= 0 && a.me.act === STUDY, "sat in the plain class");
  await sleep(gameMinutesToMs(ATTENDANCE_MINUTES - 8));
  check(a.me.attended === 1, `not marked after ${a.clock - satAt} game minutes`);
  check(await a.waitNotice(new RegExp(`Attendance signed: ${plain.c.course.code}`), gameMinutesToMs(14)), `marked after about ${ATTENDANCE_MINUTES} game minutes (took ${a.clock - satAt})`);
  await sleep(300);
  check(a.me.attended === 2 && a.me.weekAttended >= 1, `attended is 2 (${a.me.attended}, this week ${a.me.weekAttended})`);
  const afterPlain = courseAttendance(book(a)?.book ?? {}, plain.c.course.code);
  check(afterPlain.signed >= 1 && afterPlain.lastSigned === plain.c.session, `book: ${plain.c.course.code} signed ${afterPlain.signed} of ${afterPlain.held}`);
  await a.leave();
  await sleep(SAVE_SETTLE_MS);
  a = await Actor.join(client, url, NAME, profile);
  const back = await a.ask<ClassesPayload>(Msg.Classes, undefined, ServerMsg.Classes);
  check(a.me.attended === 2, `attended survives leave and rejoin (${a.me.attended})`);
  check(signedSession(parseClassesPayload(back)?.book ?? {}, plain.c.course.code, plain.c.session) && signedSession(parseClassesPayload(back)?.book ?? {}, sheet.c.course.code, sheet.c.session), "both signed sessions are still in the book after rejoining");
  await a.leave();
  await stopServer();

  // ---- 3) The daily test at 16:00 still starts and gives a grade.
  const exam = EVENTS.find((e) => e.id === "exam")!;
  const hall = eventPlace(exam);
  await patchSave(NAME, { at: outside(hall) });
  url = await startServer(dayTotal(plain.day, exam.start + 1));
  a = await Actor.join(client, url, NAME, profile);
  check(await a.enter(hall), `entered ${PLACES[hall].name} at 16:01`);
  const from = a.mark;
  const seatC = await sitIn(a, hall);
  check(seatC >= 0 && a.me.act === EXAM, `sitting in the hall starts the test (act ${ACTS[a.me.act]})`);
  check(a.said(/Test started/, from) !== undefined, "the test start notice arrives");
  await sleep(12_000);
  await a.stand(800);
  check(a.said(/Result: \d+% · [A-F]\. CGPA now \d\.\d\d/, from) !== undefined, `a result arrives: "${a.said(/Result:/, from) ?? ""}"`);
  check(a.me.exams === 1 && /^[A-F]$/.test(a.me.lastGrade), `one exam on record, grade ${a.me.lastGrade}, CGPA ${(a.me.cgpa / 100).toFixed(2)}`);
  check(a.said(/^🧾 [A-Z]{3} ?\d+/, from) !== undefined, `the result sheet names the course: "${a.said(/^🧾/, from) ?? ""}"`);
  const again = a.mark;
  await a.use(seatC);
  check(a.me.act !== EXAM && a.said(/already written/, again) !== undefined && a.me.exams === 1, "the test cannot be written twice in a day");
  await a.leave();
});
