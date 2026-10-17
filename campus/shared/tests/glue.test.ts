import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONCESSIONS,
  CONDITION_STATUS,
  FACULTY_TEAMS,
  MINUTES_PER_DAY,
  POWER_ZONES,
  SPOTS,
  STALLS,
  STATUS_MARK,
  applyCampusStates,
  boycottAt,
  classesOn,
  closedText,
  concessionFare,
  emptyAdminRecord,
  fareWithFactor,
  gameTime,
  lightReliefs,
  myClassesOn,
  orderRefusal,
  outagesOn,
  setLightRelief,
  stallHours,
  statusMarks,
  timetableFor,
  vendorOpen,
  weekPlan,
  withStatus,
  type PowerOutage,
  type UnionState,
} from "../src/index";
import { facultyWeek } from "../src/banners/art-notices";

const DEPARTMENT = "computer-science";
const LEVEL = "200L";
const SEARCH_DAYS = 120;
const EVENING = 18 * 60;
const HOUR = 60;

const state = (kind: UnionState["kind"], from: number, until: number, concession = ""): UnionState => ({ id: `t:${kind}:${from}`, kind, issue: "the test issue", from, until, concession });

function eveningOutage(hostel: boolean, longerThan = 0): PowerOutage {
  for (let day = 0; day < SEARCH_DAYS; day++) {
    for (const zone of POWER_ZONES) {
      if (zone.hostel !== hostel) continue;
      const found = outagesOn(zone.index, day).find((o) => o.start % MINUTES_PER_DAY >= EVENING && o.end - o.start > longerThan);
      if (found) return found;
    }
  }
  throw new Error("no evening outage in the search window");
}

test("the extra light hour shortens hostel night outages only while the concession lasts", () => {
  setLightRelief([]);
  const long = eveningOutage(true, HOUR);
  const short = outagesOn(long.zone, Math.floor(long.start / MINUTES_PER_DAY)).length;
  const academic = eveningOutage(false);
  const day = Math.floor(long.start / MINUTES_PER_DAY);
  const light = CONCESSIONS.find((c) => c.lightHours > 0);
  assert.ok(light, "one concession gives light");
  const deal = state("concession", day * MINUTES_PER_DAY, (day + 3) * MINUTES_PER_DAY, light.id);
  assert.deepEqual(lightReliefs([deal, state("boycott", 0, 10)]), [{ from: deal.from, until: deal.until, hours: light.lightHours }]);

  applyCampusStates([deal]);
  const eased = outagesOn(long.zone, day).find((o) => o.start === long.start);
  assert.ok(eased, "a long outage is shortened, not removed");
  assert.equal(eased.end, long.end - light.lightHours * HOUR);
  assert.ok(outagesOn(long.zone, day).length <= short);
  const untouched = outagesOn(academic.zone, Math.floor(academic.start / MINUTES_PER_DAY)).find((o) => o.start === academic.start);
  assert.equal(untouched?.end, academic.end, "academic zones get no relief");
  for (const o of outagesOn(long.zone, day)) if (o.start % MINUTES_PER_DAY < EVENING) assert.ok(o.end > o.start, "day outages stay");

  applyCampusStates([state("concession", (day + 10) * MINUTES_PER_DAY, (day + 13) * MINUTES_PER_DAY, light.id)]);
  assert.equal(outagesOn(long.zone, day).find((o) => o.start === long.start)?.end, long.end, "outside the window nothing changes");
  applyCampusStates([]);
  assert.equal(outagesOn(long.zone, day).find((o) => o.start === long.start)?.end, long.end);
});

test("the fare concession gives one fare everywhere it is asked", () => {
  const fare = CONCESSIONS.find((c) => c.fareFactor < 1);
  assert.ok(fare);
  const deal = state("concession", 1000, 2000, fare.id);
  assert.equal(concessionFare(150, [deal], 1500), Math.round(150 * fare.fareFactor));
  assert.equal(concessionFare(150, [deal], 1500), fareWithFactor(150, fare.fareFactor));
  assert.equal(concessionFare(150, [deal], 2000), 150);
  assert.equal(concessionFare(150, [], 1500), 150);
  assert.equal(fareWithFactor(0, fare.fareFactor), 0);
});

test("a boycott is on only between its start and end", () => {
  const strike = state("boycott", 500, 900);
  assert.equal(boycottAt([strike], 499), false);
  assert.equal(boycottAt([strike], 500), true);
  assert.equal(boycottAt([strike], 900), false);
  assert.equal(boycottAt([state("dialogue", 500, 900)], 600), false);
});

test("delivery refuses a stall that has packed for the night and never an indoor counter", () => {
  const stall = STALLS.findIndex((_s, i) => stallHours(i).special === undefined);
  assert.ok(stall >= 0, "there is an ordinary stall");
  const spot = STALLS[stall].spot;
  const night = gameTime(3 * MINUTES_PER_DAY + 23 * 60 + 30);
  const noon = gameTime(3 * MINUTES_PER_DAY + 12 * 60);
  assert.equal(vendorOpen(spot, noon), true);
  assert.equal(orderRefusal(spot, noon), undefined);
  assert.equal(vendorOpen(spot, night), false);
  assert.equal(orderRefusal(spot, night), closedText(stall));
  const indoor = SPOTS.findIndex((s) => s.kind === "eat" && s.place >= 0);
  assert.ok(indoor >= 0);
  assert.equal(vendorOpen(indoor, night), true);
  assert.equal(orderRefusal(indoor, night), undefined);
});

test("status marks follow the synced bitmask", () => {
  assert.equal(statusMarks(0), "");
  assert.equal(statusMarks(undefined), "");
  assert.equal(statusMarks(CONDITION_STATUS.sick), STATUS_MARK.sick);
  assert.equal(statusMarks(CONDITION_STATUS.sick | CONDITION_STATUS.unwashed), `${STATUS_MARK.sick}${STATUS_MARK.unwashed}`);
  assert.equal(withStatus("Tunde", 0), "Tunde");
  assert.equal(withStatus("Tunde · SUG President", CONDITION_STATUS.unwashed), `Tunde · SUG President ${STATUS_MARK.unwashed}`);
});

test("the faculty week banner names the faculty the social calendar is celebrating", () => {
  for (let week = 0; week < FACULTY_TEAMS.length + 2; week++) {
    const team = FACULTY_TEAMS[weekPlan(week).faculty];
    const art = facultyWeek(gameTime(week * 7 * MINUTES_PER_DAY + 600)).find((a) => a.id.includes("faculty-week"));
    assert.ok(team && art, `week ${week} has a faculty and a banner`);
    assert.ok(art.title.startsWith(team.name), `${art.title} names ${team.name}`);
    if (team.place >= 0) assert.equal(art.near, team.place);
  }
});

test("a carry-over adds one extra class to the week the player sees", () => {
  const tt = timetableFor(DEPARTMENT, LEVEL);
  const week = 9;
  const record = emptyAdminRecord();
  record.carry.push({ code: tt.courses[0].code, week });
  const me = { department: DEPARTMENT, level: LEVEL, admin: record };
  let plain = 0;
  let mine = 0;
  for (let weekday = 0; weekday < 5; weekday++) {
    const t = gameTime((week * 7 + weekday) * MINUTES_PER_DAY + 60);
    plain += classesOn(tt, t.dayIndex).length;
    mine += myClassesOn(me, t).length;
  }
  assert.equal(mine, plain + 1);
  const other = gameTime(((week + 1) * 7 + 1) * MINUTES_PER_DAY);
  assert.equal(myClassesOn(me, other).length, classesOn(tt, other.dayIndex).length, "only in the carry-over week");
});
