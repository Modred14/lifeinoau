import assert from "node:assert/strict";
import { test } from "node:test";
import { BED_HALLS, BUSINESS_CENTRES, MINUTES_PER_DAY, ORDINARY_HOURS, PREDICT, SPOTS, ballotPosition, classesOn, gameTime, petitionGranted, timetableFor, weekOf, type DayClass } from "@campuslife/shared";
import { centreClosed } from "./admin/centre";
import { Classes, TEST_ATTENDANCE_MARKS, type ClassStudent } from "./Classes";
import { drawSecret, setDrawSecret } from "./secret";
import { takeCashWin } from "./shows/desk";
import { bookFromSave, bookToSave, newBook } from "./shows/state";

const DEPARTMENT = "computer-science";
const LEVEL = "200L";
const SEARCH_DAYS = 400;
const SAMPLE = 300;
const OTHER_SECRET = "another-room-secret-value";

test("predict and win pays cash for two cards a week, then the count resets next week", () => {
  const book = newBook();
  const week = weekOf(21);
  const paid = Array.from({ length: PREDICT.cashWinsPerWeek + 3 }, () => takeCashWin(book, week));
  assert.equal(paid.filter(Boolean).length, PREDICT.cashWinsPerWeek);
  assert.deepEqual(paid.slice(PREDICT.cashWinsPerWeek), [false, false, false]);
  const restored = bookFromSave(JSON.parse(JSON.stringify(bookToSave(book))));
  assert.equal(takeCashWin(restored, week), false, "the cap survives a save and a restart");
  assert.equal(takeCashWin(restored, week + 1), true);
  assert.equal(bookToSave(newBook()).paid, undefined);
});

test("the bed ballot and the petition ruling depend on a secret the browser never sees", () => {
  const hall = BED_HALLS[0];
  const keys = Array.from({ length: SAMPLE }, (_, i) => `acct-${i}`);
  assert.ok(drawSecret().length > 0);
  assert.ok(keys.some((k) => ballotPosition(3, hall.place, k) !== ballotPosition(3, hall.place, k, drawSecret())));
  assert.ok(keys.every((k) => ballotPosition(3, hall.place, k, drawSecret()) === ballotPosition(3, hall.place, k, drawSecret())), "every room draws the same");
  assert.ok(keys.some((k) => petitionGranted(3, "sug:president", k) !== petitionGranted(3, "sug:president", k, drawSecret())));
  const before = keys.map((k) => ballotPosition(3, hall.place, k, drawSecret()));
  setDrawSecret(OTHER_SECRET);
  assert.notDeepEqual(keys.map((k) => ballotPosition(3, hall.place, k, drawSecret())), before);
  setDrawSecret(undefined);
  assert.deepEqual(keys.map((k) => ballotPosition(3, hall.place, k, drawSecret())), before);
});

test("a business centre that has packed for the night does no registration or photocopy", () => {
  const stand = SPOTS[BUSINESS_CENTRES[0].spot];
  assert.equal(centreClosed(stand.sx, stand.sy, gameTime(ORDINARY_HOURS.open + 60)), undefined);
  assert.match(centreClosed(stand.sx, stand.sy, gameTime(ORDINARY_HOURS.close + 30)) ?? "", /pack for the night/);
  assert.match(centreClosed(stand.sx, stand.sy, gameTime(MINUTES_PER_DAY + ORDINARY_HOURS.open - 30)) ?? "", /pack for the night/);
});

function student(): ClassStudent {
  return { department: DEPARTMENT, level: LEVEL, study: 0, weekStudy: 0, studySeconds: 0, attended: 0, weekAttended: 0, rusticatedUntil: 0, attendance: {} };
}

function dayWithClasses(): { day: number; held: DayClass[] } {
  const timetable = timetableFor(DEPARTMENT, LEVEL);
  for (let day = 0; day < SEARCH_DAYS; day++) {
    const held = classesOn(timetable, day).filter((c) => c.status !== "noshow");
    if (held.length > 0) return { day, held };
  }
  throw new Error("no class day");
}

test("attendance marks only count classes the player could have attended", () => {
  const { day, held } = dayWithClasses();
  const last = Math.max(...held.map((c) => c.end));
  const evening = gameTime(day * MINUTES_PER_DAY + last + 10);
  const host = { notify: () => {}, send: () => {} };
  const lateComer = new Classes(host);
  const late = student();
  lateComer.join("a", late, evening);
  assert.equal(lateComer.testMarks("a", late, evening), TEST_ATTENDANCE_MARKS, "logged in after every class: full marks");
  const skipper = new Classes(host);
  const absent = student();
  skipper.join("a", absent, gameTime(day * MINUTES_PER_DAY));
  assert.equal(skipper.testMarks("a", absent, evening), 0, "online all day and attended nothing");
});
