import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONGRESS_SITE,
  ELECTION_TIMES,
  GIST_LIMIT,
  GIST_SOON_MINUTES,
  MAP_HEIGHT_PX,
  MAP_WIDTH_PX,
  MINUTES_PER_DAY,
  PLACES,
  POWER_ZONES,
  REGISTRATION,
  SOCIAL_SITES,
  WEEK_MINUTES,
  ballotWindow,
  campusGist,
  classesOn,
  congressesFor,
  emptyAdminRecord,
  gameTime,
  gistActions,
  marchPlan,
  markSigned,
  nextShows,
  outagesOn,
  pitchMatchesFor,
  placesInZone,
  setLightRelief,
  timetableFor,
  type AttendanceBook,
  type GistItem,
  type GistMe,
  type UnionState,
} from "../src/index";

const DEPARTMENT = "computer-science";
const LEVEL = "200L";
const WEEK = 12;
const SEARCH_DAYS = 200;
const DOOR_SLACK = 200;
const tt = timetableFor(DEPARTMENT, LEVEL);
const weekStart = WEEK * WEEK_MINUTES;

const me = (extra: Partial<GistMe> = {}): GistMe => ({ department: DEPARTMENT, level: LEVEL, ...extra });
const registered = () => {
  const record = emptyAdminRecord();
  record.reg = { week: WEEK, late: false, by: "portal" };
  record.bed = { week: WEEK, hall: "any" };
  return record;
};
const of = (items: GistItem[], kind: GistItem["kind"]) => items.filter((item) => item.kind === kind);

function classDay(match: (status: string) => boolean = (s) => s === "holds"): { day: number; index: number } {
  for (let day = WEEK * 7; day < WEEK * 7 + SEARCH_DAYS; day++) {
    const all = classesOn(tt, day);
    if (all.length > 0 && match(all[0].status)) return { day, index: 0 };
  }
  throw new Error("no class day found");
}

test("the gist is ranked, capped, unique and the same for the same clock", () => {
  setLightRelief([]);
  for (let step = 0; step < 7 * 24; step += 5) {
    const t = gameTime(weekStart + step * 60 + 7);
    const items = campusGist(t, me({ admin: emptyAdminRecord(), at: PLACES[0].door }));
    assert.ok(items.length <= GIST_LIMIT);
    assert.equal(new Set(items.map((i) => i.id)).size, items.length);
    assert.deepEqual(items, campusGist(t, me({ admin: emptyAdminRecord(), at: PLACES[0].door })));
    for (let k = 1; k < items.length; k++) assert.ok(items[k - 1].priority >= items[k].priority, "sorted by priority");
    for (const item of items) {
      assert.ok(item.title.length > 0 && item.detail.length > 0, item.id);
      assert.ok(item.end > item.start, `${item.id} ends after it starts`);
      assert.ok(!/[–—]/.test(`${item.title}${item.detail}`), `${item.id} has no long dashes`);
      if (item.door) assert.ok(Math.abs(item.door.x - MAP_WIDTH_PX / 2) <= MAP_WIDTH_PX / 2 + DOOR_SLACK && Math.abs(item.door.y - MAP_HEIGHT_PX / 2) <= MAP_HEIGHT_PX / 2 + DOOR_SLACK, `${item.id} points at the campus`);
      if (item.live) assert.ok(item.start <= t.total || item.kind === "portal" || item.kind === "food", `${item.id} live means started`);
    }
  }
});

test("my next class leads to its venue and turns live when the lecturer is in", () => {
  const { day } = classDay();
  const c = classesOn(tt, day)[0];
  const before = campusGist(gameTime(day * MINUTES_PER_DAY + c.start - 20), me({ admin: registered() }));
  const next = of(before, "class")[0];
  assert.ok(next, "a class item shows before the class");
  assert.ok(next.title.includes(c.course.code));
  assert.deepEqual(next.door, PLACES[c.place].door);
  assert.equal(next.live, false);
  const during = of(campusGist(gameTime(day * MINUTES_PER_DAY + c.begins + 5), me({ admin: registered() })), "class")[0];
  assert.equal(during.live, true);
  assert.equal(during.act, true);
  const book: AttendanceBook = {};
  markSigned(book, c.course.code, c.session);
  const signed = of(campusGist(gameTime(day * MINUTES_PER_DAY + c.begins + 5), me({ admin: registered(), book })), "class")[0];
  assert.equal(signed.act, false, "a signed class no longer asks for action");
  assert.equal(signed.live, true);
});

test("a boycott replaces the class item and asks nobody to attend", () => {
  const { day } = classDay();
  const c = classesOn(tt, day)[0];
  const t = gameTime(day * MINUTES_PER_DAY + c.start - 20);
  const strike: UnionState = { id: "c:test", kind: "boycott", issue: "the fee hike", from: t.total - 100, until: t.total + 3 * MINUTES_PER_DAY, concession: "" };
  const classes = of(campusGist(t, me({ admin: registered(), states: [strike] })), "class");
  assert.equal(classes.length, 1);
  assert.ok(classes[0].title.includes("Boycott"));
  assert.equal(classes[0].act, false);
  assert.equal(classes[0].door, undefined);
});

test("election day tells an unvoted student where to vote and stops asking after", () => {
  const t = gameTime(weekStart + ELECTION_TIMES.pollsOpen + 30);
  const fresh = campusGist(t, me({ admin: registered() }));
  const vote = of(fresh, "election").find((i) => i.act);
  assert.ok(vote, "voting is an action");
  assert.ok(vote.door, "with a polling unit to walk to");
  assert.equal(fresh[0].id, vote.id, "and it is the top item");
  const done = campusGist(t, me({ admin: registered(), voted: true }));
  assert.equal(of(done, "election").some((i) => i.act), false);
  const forms = campusGist(gameTime(weekStart + ELECTION_TIMES.formsOpen + 30), me({ admin: registered() }));
  assert.ok(of(forms, "election").some((i) => i.id === "election:forms"));
  assert.equal(of(campusGist(gameTime(weekStart + ELECTION_TIMES.formsOpen + 30), me({ admin: registered(), contesting: true })), "election").some((i) => i.id === "election:forms"), false);
});

test("registration and the bed ballot show while the player can still act", () => {
  const monday = gameTime(weekStart + 9 * 60);
  const open = of(campusGist(monday, me({ admin: emptyAdminRecord() })), "portal");
  assert.equal(open.length, 1);
  assert.equal(open[0].act, true);
  assert.equal(open[0].end, weekStart + REGISTRATION.closeMinute);
  assert.equal(of(campusGist(monday, me({ admin: registered() })), "portal").length, 0);
  assert.equal(of(campusGist(monday, me()), "portal").length, 0, "nothing is claimed before the record arrives");
  const late = of(campusGist(gameTime(weekStart + REGISTRATION.closeMinute + 60), me({ admin: emptyAdminRecord() })), "portal");
  assert.ok(late[0].id.includes("late"));

  const window = ballotWindow();
  const record = emptyAdminRecord();
  record.reg = { week: WEEK, late: false, by: "portal" };
  const during = of(campusGist(gameTime(weekStart + window.start + 5), me({ admin: record })), "hostel");
  assert.equal(during.length, 1);
  assert.equal(during[0].act, true);
  const soon = of(campusGist(gameTime(weekStart + window.start - 30), me({ admin: record })), "hostel");
  assert.equal(soon[0]?.live, false);
  assert.equal(of(campusGist(gameTime(weekStart + window.start + 5), me({ admin: registered() })), "hostel").length, 0);
});

test("a sitting congress and a live march are things to join", () => {
  const sitting = congressesFor(WEEK)[0];
  assert.ok(sitting);
  const live = of(campusGist(gameTime(sitting.start + 5), me({ admin: registered() })), "congress").find((i) => i.act);
  assert.ok(live);
  assert.deepEqual(live.door, { x: CONGRESS_SITE.x, y: CONGRESS_SITE.y });
  const before = of(campusGist(gameTime(sitting.start - 60), me({ admin: registered() })), "congress");
  assert.equal(before[0]?.live, false);

  const protest: UnionState = { id: "c:march-test", kind: "protest", issue: "the bus fare increase", from: weekStart + 20 * 60, until: weekStart + 3 * MINUTES_PER_DAY, concession: "" };
  const plan = marchPlan(protest);
  const marching = of(campusGist(gameTime(plan.start + 3), me({ admin: registered(), states: [protest] })), "march");
  assert.equal(marching.length, 1);
  assert.equal(marching[0].act, true);
  assert.ok(marching[0].door);
  const forming = of(campusGist(gameTime(plan.forms - 45), me({ admin: registered(), states: [protest] })), "march");
  assert.equal(forming[0]?.live, false);
});

test("shows inside two hours and today's league fixture are listed", () => {
  const show = nextShows(gameTime(weekStart), 1)[0];
  assert.ok(show);
  const far = campusGist(gameTime(show.startTotal - GIST_SOON_MINUTES - 30), me({ admin: registered() }));
  assert.equal(far.some((i) => i.id === `show:${show.key}`), false);
  const near = campusGist(gameTime(show.startTotal - 30), me({ admin: registered() })).find((i) => i.id === `show:${show.key}`);
  assert.ok(near, "the show is in the gist half an hour before");
  assert.equal(near.live, false);
  assert.deepEqual(near.door, PLACES[show.place].door);
  const on = campusGist(gameTime(show.startTotal + 2), me({ admin: registered() })).find((i) => i.id === `show:${show.key}`);
  assert.equal(on?.live, true);

  let day = WEEK * 7;
  while (pitchMatchesFor(day).length === 0 && day < WEEK * 7 + SEARCH_DAYS) day++;
  const fixture = pitchMatchesFor(day)[0];
  assert.ok(fixture, "a league fixture exists");
  const morning = campusGist(gameTime(day * MINUTES_PER_DAY + 6 * 60), me({ admin: registered() }));
  assert.ok(of(morning, "sport").some((i) => i.id === `pitch:${fixture.key}`), "today's fixture shows from the morning");
});

test("light out shows for the zone the player is in, and night food when Risky opens", () => {
  const zone = POWER_ZONES.find((z) => z.hostel && placesInZone(z.id).length > 0);
  assert.ok(zone);
  let outage = undefined as ReturnType<typeof outagesOn>[number] | undefined;
  for (let day = WEEK * 7; day < WEEK * 7 + SEARCH_DAYS && !outage; day++) outage = outagesOn(zone.index, day)[0];
  assert.ok(outage);
  const place = placesInZone(zone.id)[0];
  const dark = of(campusGist(gameTime(outage.start + 5), me({ admin: registered(), place })), "light");
  assert.equal(dark.length, 1);
  assert.equal(dark[0].live, true);
  assert.ok(dark[0].title.includes(zone.name));
  assert.equal(of(campusGist(gameTime(outage.start + 5), me({ admin: registered() })), "light").length, 0, "no zone known, no claim");

  const night = campusGist(gameTime(weekStart + 23 * 60), me({ admin: registered() }));
  if (SOCIAL_SITES.stalls.risky !== undefined) assert.ok(of(night, "food").some((i) => i.id.startsWith("food:risky")));
  assert.equal(of(campusGist(gameTime(weekStart + 12 * 60), me({ admin: registered() })), "food").some((i) => i.id.startsWith("food:risky")), false);
  assert.ok(gistActions(night).every((i) => i.act));
});
