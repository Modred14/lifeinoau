import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONDITION_SITES,
  CONDITION_STATUS,
  GENERATOR_PLACES,
  HEALTH,
  INTERIORS,
  JACKING,
  MINUTES_PER_DAY,
  PLACES,
  READING_ROOMS,
  REAL_SECONDS_PER_GAME_MINUTE,
  SPOTS,
  VENUE_PLACE,
  WATER,
  daylight,
  dryMorning,
  freshConditions,
  gameTime,
  generatorDelay,
  isHostelPlace,
  outageAt,
  outagesOn,
  placeLight,
  powerZoneOfPlace,
  showsFor,
  standpipeOf,
  zoneHasLight,
  type ConditionsPayload,
  type PowerOutage,
  type Spot,
} from "@campuslife/shared";
import { CONDITIONS_TEXT, ConditionsDesk, UP_NEPA_FUN, type Patient } from "./Conditions";

const SEARCH_DAYS = 400;
const WHO = "a";
const hostel = PLACES.findIndex((_, i) => isHostelPlace(i));
const spotIn = (place: number, kind: string): Spot => {
  const it = INTERIORS[place]!;
  return SPOTS.slice(it.spotStart, it.spotEnd).find((s) => s.kind === kind)!;
};
const at = (dayIndex: number, minute: number) => gameTime(dayIndex * MINUTES_PER_DAY + minute);

function rig(readers = 1) {
  const notes: string[] = [];
  const sent: ConditionsPayload[] = [];
  let bits = -1;
  const desk = new ConditionsDesk({ notify: (_id, text) => notes.push(text), send: (_id, payload) => sent.push(payload), status: (_id, b) => (bits = b), readers: () => readers });
  return { desk, notes, sent, bits: () => bits };
}

function patient(x: number, y: number, extra: Partial<Patient> = {}): Patient {
  return { x, y, food: 80, energy: 80, fun: 50, cash: 5000, studySeconds: 0, profileId: "p".repeat(24), conditions: freshConditions(), ...extra };
}

function nightOutage(place: number, clearOfGenerator = 0): PowerOutage {
  const zone = powerZoneOfPlace(place).index;
  for (let d = 1; d < SEARCH_DAYS; d++) {
    for (const o of outagesOn(zone, d)) {
      const whole = outageAt(zone, o.start);
      if (whole?.start !== o.start || daylight(o.start % MINUTES_PER_DAY) > 0.2 || daylight(whole.end % MINUTES_PER_DAY) > 0.2) continue;
      if (whole.end - whole.start > clearOfGenerator + 20 && zoneHasLight(zone, o.start - 5)) return whole;
    }
  }
  throw new Error("no night outage found");
}

test("light out and Up NEPA reach a player standing in the zone", () => {
  const door = PLACES[hostel].door;
  const outage = nightOutage(hostel);
  const { desk, notes } = rig();
  const p = patient(door.x, door.y);
  desk.join(WHO, p, gameTime(outage.start - 2));
  desk.tick(WHO, p, undefined, undefined, gameTime(outage.start - 1), 1);
  assert.deepEqual(notes, []);
  desk.tick(WHO, p, undefined, undefined, gameTime(outage.start), 1);
  assert.deepEqual(notes, [CONDITIONS_TEXT.lightOut]);
  const fun = p.fun;
  desk.tick(WHO, p, undefined, undefined, gameTime(outage.end - 1), 1);
  desk.tick(WHO, p, undefined, undefined, gameTime(outage.end), 1);
  assert.deepEqual(notes, [CONDITIONS_TEXT.lightOut, CONDITIONS_TEXT.upNepa]);
  assert.equal(p.fun, fun + UP_NEPA_FUN);
});

test("studying in a dark room earns half until the generator starts", () => {
  const library = GENERATOR_PLACES.find((g) => INTERIORS[g]?.template.id === "library")!;
  const outage = nightOutage(library, 12);
  const delay = generatorDelay(library, outage.start);
  const seat = spotIn(library, "study");
  const { desk, notes } = rig();
  const p = patient(seat.x, seat.y);
  const early = gameTime(outage.start + 1);
  desk.join(WHO, p, early);
  desk.tick(WHO, p, seat, "study", early, 1);
  const tocExtra = early.minute >= 22 * 60 || early.minute < 4 * 60 ? 1.5 : 1;
  assert.ok(Math.abs(p.studySeconds + 0.5 * tocExtra) < 1e-9);
  assert.ok(notes.includes(CONDITIONS_TEXT.darkStudy));
  const before = p.studySeconds;
  const late = gameTime(outage.start + delay);
  desk.tick(WHO, p, seat, "study", late, 1);
  assert.ok(p.studySeconds >= before);
  assert.ok(notes.includes(CONDITIONS_TEXT.genOn));
  const sleeper = patient(seat.x, seat.y);
  desk.tick("b", sleeper, spotIn(hostel, "sleep"), "sleep", early, 1);
  assert.equal(sleeper.studySeconds, 0);
});

test("night reading in a lit reading room gives the group bonus and costs energy", () => {
  const room = READING_ROOMS.find((r) => INTERIORS[r])!;
  const zone = powerZoneOfPlace(room).index;
  let night = 2;
  while (!zoneHasLight(zone, night * MINUTES_PER_DAY + 23 * 60)) night++;
  const now = at(night, 23 * 60);
  const seat = spotIn(room, "study");
  const alone = rig(1);
  const p = patient(seat.x, seat.y);
  alone.desk.join(WHO, p, now);
  alone.desk.tick(WHO, p, seat, "study", now, 1);
  assert.ok(Math.abs(p.studySeconds - JACKING.baseBonus * 1.5) < 1e-9);
  assert.ok(p.energy < 80 && Math.abs(80 - p.energy - JACKING.energyCost) < 1e-9);
  assert.ok(alone.notes.some((n) => n.includes("Jacking at")));
  const group = rig(4);
  const q = patient(seat.x, seat.y);
  group.desk.join(WHO, q, now);
  group.desk.tick(WHO, q, seat, "study", now, 1);
  assert.ok(q.studySeconds > p.studySeconds);
  const day = at(night, 14 * 60);
  if (zoneHasLight(zone, day.total)) {
    const r = patient(seat.x, seat.y);
    alone.desk.tick("c", r, seat, "study", day, 1);
    assert.equal(r.studySeconds, 0);
  }
  for (let minute = 0; minute < JACKING.countsAfter + 2; minute++) alone.desk.tick(WHO, p, seat, "study", gameTime(now.total + minute), REAL_SECONDS_PER_GAME_MINUTE);
  assert.equal(p.conditions.nights, 1);
});

test("a dry morning: wake unwashed, fetch water at the standpipe, status clears", () => {
  const zone = powerZoneOfPlace(hostel).index;
  let day = 2;
  while (!dryMorning(zone, day)) day++;
  const bed = spotIn(hostel, "sleep");
  const { desk, notes, bits } = rig();
  const p = patient(bed.x, bed.y);
  desk.join(WHO, p, at(day, 6 * 60));
  desk.tick(WHO, p, bed, "sleep", at(day, 6 * 60), 1);
  desk.tick(WHO, p, undefined, undefined, at(day, 6 * 60 + 1), 1);
  assert.ok(notes.includes(CONDITIONS_TEXT.dryTaps));
  assert.equal(bits(), CONDITION_STATUS.unwashed);
  const pipe = standpipeOf(hostel)!;
  desk.act(WHO, p, { site: pipe.id }, at(day, 6 * 60 + 2));
  assert.ok(notes.includes(CONDITIONS_TEXT.tooFar));
  p.x = pipe.stand.x;
  p.y = pipe.stand.y;
  desk.act(WHO, p, { site: "pipe" }, at(day, 6 * 60 + 2));
  desk.act(WHO, p, { site: pipe.id }, at(day, 6 * 60 + 2));
  for (let s = 0; s < WATER.fetchSeconds; s++) desk.tick(WHO, p, undefined, undefined, at(day, 6 * 60 + 3), 1);
  assert.ok(notes.includes(CONDITIONS_TEXT.fetched));
  assert.equal(bits(), 0);
  desk.act(WHO, p, { site: pipe.id }, at(day, 6 * 60 + 9));
  assert.equal(notes.at(-1), CONDITIONS_TEXT.noNeedWater);

  const lazy = rig();
  const q = patient(bed.x, bed.y);
  lazy.desk.join(WHO, q, at(day, 6 * 60));
  lazy.desk.tick(WHO, q, bed, "sleep", at(day, 6 * 60), 1);
  lazy.desk.tick(WHO, q, undefined, undefined, at(day, 6 * 60 + 1), 1);
  const fun = q.fun;
  lazy.desk.tick(WHO, q, undefined, undefined, at(day, 9 * 60), 1);
  assert.ok(q.fun < fun && fun - q.fun < 1);
  lazy.desk.tick(WHO, q, undefined, undefined, at(day, 10 * 60), 1);
  assert.ok(lazy.notes.includes(CONDITIONS_TEXT.tapsBack));
  assert.equal(lazy.bits(), 0);
});

function fallIll(run: ReturnType<typeof rig>, p: Patient, from: number): number {
  p.food = 3;
  let total = from;
  run.desk.join(WHO, p, gameTime(total));
  while (!p.conditions.illness && total < from + 30 * MINUTES_PER_DAY) {
    total += 60;
    p.food = 3;
    run.desk.tick(WHO, p, undefined, undefined, gameTime(total), 60 * REAL_SECONDS_PER_GAME_MINUTE);
  }
  assert.ok(p.conditions.illness);
  assert.equal(run.bits(), CONDITION_STATUS.sick);
  assert.ok(run.notes.some((n) => n.includes("don catch you")));
  p.food = 80;
  p.energy = 80;
  return total;
}

test("long hunger brings sickness, and bed rest cures it", () => {
  const run = rig();
  const bed = spotIn(hostel, "sleep");
  const p = patient(bed.x, bed.y);
  const total = fallIll(run, p, 3 * MINUTES_PER_DAY + 13 * 60);
  const energy = p.energy;
  run.desk.tick(WHO, p, undefined, undefined, gameTime(total + 1), 10);
  assert.ok(Math.abs(energy - p.energy - HEALTH.energyDrain * 10) < 1e-9);
  for (let s = 0; s < HEALTH.restCureSeconds; s++) run.desk.tick(WHO, p, bed, "sleep", gameTime(total + 2), 1);
  assert.equal(p.conditions.illness, "");
  assert.ok(run.notes.includes(CONDITIONS_TEXT.restCure));
  assert.equal(run.bits(), 0);
  assert.equal(run.sent.at(-1)?.illness, "");
});

test("the chemist cures fast for money and the clinic cures free after a wait", () => {
  const chemist = CONDITION_SITES.find((s) => s.kind === "chemist")!;
  const clinic = CONDITION_SITES.find((s) => s.kind === "clinic")!;
  const noon = (total: number) => (Math.floor(total / MINUTES_PER_DAY) + 1) * MINUTES_PER_DAY + 12 * 60;

  const paid = rig();
  const p = patient(chemist.stand.x, chemist.stand.y);
  let total = noon(fallIll(paid, p, 5 * MINUTES_PER_DAY));
  paid.desk.act(WHO, p, { site: chemist.id }, gameTime(total - 12 * 60 + 60));
  assert.equal(paid.notes.at(-1), CONDITIONS_TEXT.chemistShut);
  p.cash = HEALTH.chemistPrice - 1;
  paid.desk.act(WHO, p, { site: chemist.id }, gameTime(total));
  assert.equal(paid.notes.at(-1), CONDITIONS_TEXT.chemistBroke);
  p.cash = 2000;
  paid.desk.act(WHO, p, { site: chemist.id }, gameTime(total));
  assert.equal(paid.sent.at(-1)?.task?.kind, "chemist");
  for (let s = 0; s < HEALTH.chemistSeconds; s++) paid.desk.tick(WHO, p, undefined, undefined, gameTime(total), 1);
  assert.deepEqual([p.conditions.illness, p.cash, paid.bits()], ["", 2000 - HEALTH.chemistPrice, 0]);
  paid.desk.act(WHO, p, { site: chemist.id }, gameTime(total));
  assert.equal(paid.notes.at(-1), CONDITIONS_TEXT.notSick);

  const free = rig();
  const q = patient(clinic.stand.x, clinic.stand.y);
  total = noon(fallIll(free, q, 9 * MINUTES_PER_DAY));
  free.desk.act(WHO, q, { site: clinic.id }, gameTime(total + 5 * 60));
  assert.equal(free.notes.at(-1), CONDITIONS_TEXT.clinicShut);
  free.desk.act(WHO, q, { site: clinic.id }, gameTime(total));
  const task = free.sent.at(-1)?.task;
  assert.equal(task?.kind, "clinic");
  assert.ok(task!.ends - total >= HEALTH.clinicShortest && task!.ends - total <= HEALTH.clinicLongest && task!.number! > 0);
  q.x += 400;
  free.desk.tick(WHO, q, undefined, undefined, gameTime(total + 1), 1);
  assert.equal(free.notes.at(-1), CONDITIONS_TEXT.leftQueue);
  assert.ok(q.conditions.illness);
  q.x -= 400;
  free.desk.act(WHO, q, { site: clinic.id }, gameTime(total + 2));
  const cash = q.cash;
  for (let m = 0; m <= HEALTH.clinicLongest && q.conditions.illness; m++) free.desk.tick(WHO, q, undefined, undefined, gameTime(total + 2 + m), REAL_SECONDS_PER_GAME_MINUTE);
  assert.deepEqual([q.conditions.illness, q.cash, free.bits()], ["", cash, 0]);
  assert.equal(free.notes.at(-1), CONDITIONS_TEXT.clinicDone);
  assert.equal(free.sent.at(-1)?.task, undefined);
});

test("a show pauses in the dark and comes back on the generator", () => {
  const venues = Object.values(VENUE_PLACE);
  let found: { place: number; start: number; delay: number } | undefined;
  for (let d = 1; d < SEARCH_DAYS * 3 && !found; d++) {
    for (const show of showsFor(d)) {
      if (!venues.includes(show.place)) continue;
      const zone = powerZoneOfPlace(show.place).index;
      const outage = outagesOn(zone, d).find((o) => o.start > show.startTotal && o.start + 15 < show.endTotal && outageAt(zone, o.start)?.start === o.start);
      if (outage) found = { place: show.place, start: outage.start, delay: generatorDelay(show.place, outage.start) };
    }
  }
  assert.ok(found);
  const seat = spotIn(found.place, "sit");
  const { desk, notes } = rig();
  const p = patient(seat.x, seat.y);
  desk.join(WHO, p, gameTime(found.start - 1));
  assert.equal(desk.blackout(WHO, seat, gameTime(found.start - 1)), false);
  assert.equal(desk.blackout(WHO, seat, gameTime(found.start)), true);
  assert.equal(desk.blackout(WHO, seat, gameTime(found.start + 1)), true);
  assert.equal(notes.filter((n) => n === CONDITIONS_TEXT.putOnGen).length, 1);
  assert.equal(placeLight(found.place, found.start + found.delay).lit, true);
  assert.equal(desk.blackout(WHO, seat, gameTime(found.start + found.delay)), false);
  assert.equal(desk.blackout(WHO, spotIn(hostel, "sleep"), gameTime(found.start)), false);
});

test("a client that missed the first push can ask for its conditions again", () => {
  const { desk, sent } = rig();
  const who = patient(0, 0);
  const now = at(3, 600);
  desk.join(WHO, who, now);
  assert.equal(sent.length, 1);
  assert.equal(desk.resend(WHO, who, { site: 0 }, now), false, "a site visit is not a sync request");
  assert.equal(sent.length, 1);
  assert.equal(desk.resend(WHO, who, { sync: true }, now), true);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], sent[0]);
});
