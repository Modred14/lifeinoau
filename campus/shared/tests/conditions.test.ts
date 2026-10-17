import assert from "node:assert/strict";
import { test } from "node:test";
import { MINUTES_PER_DAY, gameTime } from "../src/clock.ts";
import { STALLS, stallBlocked } from "../src/interiors.ts";
import { PLACES, PX_PER_METER, nearBuilding, onRoad } from "../src/map.ts";
import { isBlocked } from "../src/movement.ts";
import {
  CONDITION_SITES,
  CONDITION_STATUS,
  DRY_TAPS,
  GENERATOR_DELAY,
  GENERATOR_PLACES,
  HEALTH,
  JACKING,
  POWER_ZONES,
  READING_ROOMS,
  bathe,
  campusLight,
  conditionPace,
  conditionStatus,
  conditionsNow,
  cureIllness,
  darkShare,
  dryMorning,
  fallSick,
  freshConditions,
  generatorDelay,
  healthStrain,
  isHostelPlace,
  noteReading,
  npcReaders,
  outageAt,
  outagesOn,
  parseConditionsPayload,
  placeLight,
  placesInZone,
  powerZoneOfPlace,
  readingMoments,
  readingStreak,
  restInBed,
  sanitizeConditions,
  standpipeOf,
  studyMultiplier,
  tapsDry,
  tapsReturned,
  wakeUp,
  zoneHasLight,
} from "../src/conditions.ts";

const M = PX_PER_METER;
const DAYS = 120;
const days = Array.from({ length: DAYS }, (_, d) => d);
const MAX_DARK_SHARE = 0.35;
const hostels = PLACES.map((_, i) => i).filter(isHostelPlace);
const at = (dayIndex: number, minute: number) => gameTime(dayIndex * MINUTES_PER_DAY + minute);

test("the power schedule is the same every time it is asked for", () => {
  for (const zone of POWER_ZONES) {
    for (const d of days) {
      const first = JSON.stringify(outagesOn(zone.index, d));
      assert.equal(JSON.stringify(outagesOn(zone.index, d)), first);
      for (const o of outagesOn(zone.index, d)) assert.ok(o.end > o.start && Math.floor(o.start / MINUTES_PER_DAY) === d);
    }
  }
});

test("no zone is dark for more than a sane share of a day and every zone gets light out sometimes", () => {
  for (const zone of POWER_ZONES) {
    let outages = 0;
    for (const d of days) {
      assert.ok(darkShare(zone.index, d) <= MAX_DARK_SHARE, `${zone.id} day ${d}`);
      outages += outagesOn(zone.index, d).length;
    }
    assert.ok(outages > 10, zone.id);
  }
});

test("the whole campus is never dark at once", () => {
  for (let total = 0; total < DAYS * MINUTES_PER_DAY; total += 5) assert.ok(POWER_ZONES.some((z) => zoneHasLight(z.index, total)), `minute ${total}`);
});

test("zones have different schedules and evenings are the worst", () => {
  const sign = (zone: number) => JSON.stringify(days.map((d) => outagesOn(zone, d).map((o) => [o.start, o.end])));
  assert.equal(new Set(POWER_ZONES.map((z) => sign(z.index))).size, POWER_ZONES.length);
  let evening = 0;
  let rest = 0;
  for (const zone of POWER_ZONES) for (const d of days) for (const o of outagesOn(zone.index, d)) (o.start % MINUTES_PER_DAY >= 18 * 60 ? evening++ : rest++);
  assert.ok(evening > rest);
});

test("every place sits in a zone and every zone has places", () => {
  for (const zone of POWER_ZONES) assert.ok(placesInZone(zone.id).length > 0, zone.id);
  assert.equal(POWER_ZONES.filter((z) => z.hostel).length, 4);
  for (const h of hostels) assert.ok(powerZoneOfPlace(h).hostel, PLACES[h].name);
});

test("generator buildings come back after the delay and the rest stay dark", () => {
  assert.equal(GENERATOR_PLACES.length, 3);
  for (const place of GENERATOR_PLACES) {
    const zone = powerZoneOfPlace(place);
    const outage = days.flatMap((d) => outagesOn(zone.index, d)).find((o) => outageAt(zone.index, o.start)?.start === o.start);
    assert.ok(outage);
    const delay = generatorDelay(place, outage.start);
    assert.ok(delay >= GENERATOR_DELAY.shortest && delay <= GENERATOR_DELAY.longest);
    assert.equal(placeLight(place, outage.start).lit, false);
    assert.equal(placeLight(place, outage.start + delay - 1).lit, false);
    const after = placeLight(place, outage.start + delay);
    assert.deepEqual([after.lit, after.generator, after.nepa], [true, true, false]);
    const neighbour = placesInZone(zone.id).find((p) => !GENERATOR_PLACES.includes(p))!;
    assert.equal(placeLight(neighbour, outage.start + delay).lit, false);
    assert.equal(placeLight(place, outage.start - 1).nepa, true);
  }
});

test("standpipes, the clinic and the chemist stand in legal places", () => {
  for (const h of hostels) assert.ok(standpipeOf(h), PLACES[h].name);
  assert.equal(CONDITION_SITES.filter((s) => s.kind === "clinic").length, 1);
  assert.equal(CONDITION_SITES.filter((s) => s.kind === "chemist").length, 1);
  assert.equal(CONDITION_SITES.find((s) => s.kind === "clinic")?.name, "Campus clinic");
  CONDITION_SITES.forEach((s, i) => {
    assert.equal(s.id, i);
    assert.ok(!onRoad(s.x, s.y, 1.5 * M) && !nearBuilding(s.x, s.y, 2 * M) && isBlocked(s.x, s.y) === (s.kind === "chemist") && !stallBlocked(s.x, s.y, 1.5 * M), s.name);
    for (const p of PLACES) assert.ok(Math.hypot(p.door.x - s.x, p.door.y - s.y) >= 5 * M, `${s.name} blocks ${p.name}`);
    for (const stall of STALLS) assert.ok(Math.hypot(stall.x - s.x, stall.y - s.y) >= 5 * M);
    for (const other of CONDITION_SITES) if (other !== s) assert.ok(Math.hypot(other.x - s.x, other.y - s.y) >= 6 * M);
    for (const q of [s.stand, ...s.queue]) assert.ok(!isBlocked(q.x, q.y) && !onRoad(q.x, q.y), `${s.name} queue`);
    assert.ok(Math.hypot(PLACES[s.place].door.x - s.x, PLACES[s.place].door.y - s.y) <= 45 * M);
  });
});

test("study multipliers: half in the dark, a group bonus for night reading", () => {
  assert.equal(studyMultiplier({ lit: false, jacking: false, npcs: 0, players: 0 }), 0.5);
  assert.equal(studyMultiplier({ lit: false, jacking: true, npcs: 20, players: 4 }), 0.5);
  assert.equal(studyMultiplier({ lit: true, jacking: false, npcs: 0, players: 5 }), 1);
  assert.equal(studyMultiplier({ lit: true, jacking: true, npcs: 0, players: 0 }), 1);
  assert.equal(studyMultiplier({ lit: true, jacking: true, npcs: 12, players: 0 }), 1 + JACKING.baseBonus);
  assert.ok(Math.abs(studyMultiplier({ lit: true, jacking: true, npcs: 12, players: 2 }) - (1 + JACKING.baseBonus + 2 * JACKING.perReader)) < 1e-9);
  assert.equal(studyMultiplier({ lit: true, jacking: true, npcs: 12, players: 50 }), 1 + JACKING.maxBonus);
});

test("reading rooms fill up at night with seeded readers and moments", () => {
  assert.ok(READING_ROOMS.length >= 4);
  for (const room of READING_ROOMS) {
    for (const night of days.slice(0, 20)) {
      const readers = npcReaders(room, night);
      assert.ok(readers >= JACKING.fewestReaders && readers <= JACKING.mostReaders);
      const moments = readingMoments(room, night);
      assert.ok(moments.length >= 2);
      const from = night * MINUTES_PER_DAY + JACKING.start;
      for (const m of moments) assert.ok(m.at >= from && m.at < (night + 1) * MINUTES_PER_DAY + JACKING.end && !/[–—]/.test(m.text));
      assert.deepEqual(moments.map((m) => m.at), [...moments.map((m) => m.at)].sort((a, b) => a - b));
    }
  }
  assert.equal(npcReaders(hostels[0], 3), 0);
});

test("night readings count in a row and reset after a night off", () => {
  const log = freshConditions();
  for (let night = 10; night < 13; night++) {
    assert.equal(noteReading(log, at(night, 23 * 60), JACKING.countsAfter - 1), false);
    assert.equal(noteReading(log, at(night + 1, 60), 5), true);
    assert.equal(noteReading(log, at(night + 1, 120), 30), false);
  }
  assert.equal(readingStreak(log, at(13, 12 * 60)), 3);
  assert.equal(readingStreak(log, at(15, 12 * 60)), 0);
  assert.equal(noteReading(log, at(20, 23 * 60), JACKING.countsAfter), true);
  assert.equal(log.nights, 1);
});

test("dry taps: wake unwashed, then fetching or the taps coming back clears it", () => {
  const hostel = hostels[0];
  const zone = powerZoneOfPlace(hostel).index;
  const dryDay = days.find((d) => dryMorning(zone, d))!;
  const wetDay = days.find((d) => !dryMorning(zone, d))!;
  const share = days.filter((d) => dryMorning(zone, d)).length / DAYS;
  assert.ok(share > 0.1 && share < 0.5);
  assert.equal(tapsDry(hostel, at(dryDay, DRY_TAPS.from)), true);
  assert.equal(tapsDry(hostel, at(dryDay, DRY_TAPS.to)), false);
  assert.equal(tapsDry(READING_ROOMS[0], at(dryDay, DRY_TAPS.from)), false);

  const fresh = freshConditions();
  assert.equal(wakeUp(fresh, hostel, at(wetDay, 7 * 60)), "bathed");
  assert.equal(conditionStatus(fresh), 0);
  assert.equal(wakeUp(fresh, hostel, at(wetDay, 9 * 60)), "none");

  const log = freshConditions();
  assert.equal(wakeUp(log, hostel, at(dryDay, 15 * 60)), "none");
  assert.equal(wakeUp(log, hostel, at(dryDay, 7 * 60)), "dry");
  assert.equal(conditionStatus(log), CONDITION_STATUS.unwashed);
  assert.equal(wakeUp(log, hostel, at(dryDay, 8 * 60)), "none");
  assert.equal(tapsReturned(log, at(dryDay, DRY_TAPS.to - 1)), false);
  assert.equal(tapsReturned(log, at(dryDay, DRY_TAPS.to)), true);
  assert.equal(conditionStatus(log), 0);

  const fetcher = freshConditions();
  wakeUp(fetcher, hostel, at(dryDay, 7 * 60));
  bathe(fetcher, at(dryDay, 7 * 60 + 10));
  assert.equal(conditionStatus(fetcher), 0);
  assert.equal(tapsReturned(fetcher, at(dryDay, 12 * 60)), false);
});

test("sickness comes from long strain or too many night readings and never from a healthy week", () => {
  const healthy = freshConditions();
  for (let hour = 0; hour < 24 * 14; hour++) {
    healthStrain(healthy, 60, 60, 60);
    assert.equal(fallSick(healthy, gameTime(hour * 60), 77), "");
  }
  const hungry = freshConditions();
  let caught = "";
  for (let hour = 0; hour < 24 * 14 && !caught; hour++) {
    healthStrain(hungry, 5, 60, 60);
    caught = fallSick(hungry, gameTime(hour * 60), 77);
  }
  assert.ok(caught === "malaria" || caught === "typhoid");
  assert.ok(hungry.sickSince >= HEALTH.weakAfter - 60);
  assert.equal(conditionStatus(hungry), CONDITION_STATUS.sick);
  assert.equal(fallSick(hungry, gameTime(hungry.sickSince + 600), 78), "");

  const reader = freshConditions();
  reader.nights = HEALTH.nightsFor;
  reader.lastNight = 40;
  let fever = "";
  for (let hour = 0; hour < 48 && !fever; hour++) fever = fallSick(reader, gameTime(41 * MINUTES_PER_DAY + hour * 60), 5);
  assert.equal(fever, "malaria");
});

test("resting in bed and medicine both cure, and immunity follows", () => {
  const rested = { ...freshConditions(), illness: "malaria" as const };
  const now = gameTime(5000);
  assert.equal(restInBed(rested, HEALTH.restCureSeconds - 1, now), false);
  assert.equal(conditionPace(conditionStatus(rested)), HEALTH.walkPace);
  assert.equal(restInBed(rested, 1, now), true);
  assert.equal(conditionStatus(rested), 0);
  assert.equal(conditionPace(conditionStatus(rested)), 1);
  assert.equal(restInBed(rested, 500, now), false);

  const dosed = { ...freshConditions(), illness: "typhoid" as const, weak: HEALTH.weakAfter * 2, nights: 5 };
  cureIllness(dosed, now);
  assert.deepEqual([dosed.illness, dosed.weak, dosed.nights], ["", 0, 0]);
  dosed.weak = HEALTH.weakAfter;
  assert.equal(fallSick(dosed, gameTime(now.total + HEALTH.immuneMinutes - 60), 1), "");
});

test("saved conditions are cleaned and payloads parse", () => {
  assert.deepEqual(sanitizeConditions(undefined), freshConditions());
  assert.deepEqual(sanitizeConditions({ illness: "flu", nights: "many", rest: -4, unwashed: 1 }), freshConditions());
  const kept = sanitizeConditions({ ...freshConditions(), illness: "typhoid", unwashed: true, nights: 2 });
  assert.deepEqual([kept.illness, kept.unwashed, kept.nights], ["typhoid", true, 2]);
  assert.equal(parseConditionsPayload("x"), undefined);
  const payload = parseConditionsPayload({ illness: "malaria", unwashed: true, nights: 2, rest: 0.4, task: { kind: "clinic", site: 8, ends: 900, number: 12 } });
  assert.deepEqual(payload, { illness: "malaria", unwashed: true, nights: 2, rest: 0.4, task: { kind: "clinic", site: 8, ends: 900, number: 12 } });
  assert.equal(parseConditionsPayload({ task: { kind: "dance", site: 1, ends: 2 } })?.task, undefined);
});

test("the status lines read plainly", () => {
  for (const d of days.slice(0, 14)) {
    for (let minute = 0; minute < MINUTES_PER_DAY; minute += 45) {
      const t = at(d, minute);
      const lines = [...campusLight(t.total).map((z) => z.text)];
      for (const place of [hostels[0], READING_ROOMS[0], GENERATOR_PLACES[0]]) {
        const now = conditionsNow(t, place);
        lines.push(now.lightText, now.waterText, now.readingText);
        assert.equal(now.light === "off", !placeLight(place, t.total).lit);
      }
      for (const line of lines) assert.ok(!/[–—]|undefined|NaN/.test(line), line);
    }
  }
  assert.ok(conditionsNow(at(3, 600), -1, PLACES[hostels[0]].door).zone.hostel);
});
