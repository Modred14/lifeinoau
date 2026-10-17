import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SOUND, parseSound } from "../lib/settings";
import { Ambience, MAX_VOICES, birdDensity, duckFactor, masterLevel, nightCallRate, nightLevel, planBirdCall, planNightCall, planWindow } from "./ambience";
import { INDOOR_DUCK, MASTER_CEILING, MIN_CALL_GAP } from "./ambience/plan";
import { PAN_SPREAD, PITCH_CEILING, PITCH_FLOOR } from "./ambience/species";

const DAWN = 7 * 60;
const NOON = 12 * 60;
const DUSK = 18 * 60 + 45;
const MIDNIGHT = 0;

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("birds are densest at dawn, steady at noon and thinner at dusk", () => {
  const dawn = birdDensity(DAWN, 0.84);
  const noon = birdDensity(NOON, 1);
  const dusk = birdDensity(DUSK, 0.5);
  assert.ok(dawn > noon);
  assert.ok(noon > dusk);
  assert.ok(dusk > 0);
  assert.equal(birdDensity(15 * 60, 1), noon);
});

test("night has no birds and day has no crickets", () => {
  assert.equal(birdDensity(MIDNIGHT, 0), 0);
  assert.equal(birdDensity(23 * 60, 1), 0);
  assert.equal(birdDensity(NOON, 0), 0);
  assert.ok(nightLevel(0) > 0);
  assert.equal(nightLevel(0), 1);
  assert.ok(nightCallRate(0) > 0);
  assert.equal(nightLevel(1), 0);
  assert.equal(nightLevel(0.35), 0);
  assert.equal(nightCallRate(1), 0);
  assert.ok(nightLevel(0.1) > nightLevel(0.3));
});

test("bad clock or light values stay silent instead of breaking", () => {
  assert.equal(birdDensity(Number.NaN, 1), 0);
  assert.equal(birdDensity(NOON, Number.NaN), 0);
  assert.equal(birdDensity(NOON + 1440, 1), birdDensity(NOON, 1));
});

test("indoors ducks the outdoor mix to a whisper", () => {
  assert.equal(duckFactor(false), 1);
  assert.equal(duckFactor(true), INDOOR_DUCK);
  assert.ok(INDOOR_DUCK > 0 && INDOOR_DUCK <= 0.1);
});

test("master level follows volume, stays gentle and mutes when off", () => {
  assert.equal(masterLevel({ enabled: false, volume: 1 }), 0);
  assert.equal(masterLevel({ enabled: true, volume: 0 }), 0);
  assert.equal(masterLevel({ enabled: true, volume: 1 }), MASTER_CEILING);
  assert.equal(masterLevel({ enabled: true, volume: 7 }), MASTER_CEILING);
  assert.ok(masterLevel({ enabled: true, volume: 0.3 }) < masterLevel({ enabled: true, volume: 0.6 }));
});

test("the call planner is deterministic and respects the rate", () => {
  const first = planWindow(10, 40, 1.4, seeded(7));
  const again = planWindow(10, 40, 1.4, seeded(7));
  assert.deepEqual(first, again);
  assert.ok(first.times.length > 15 && first.times.length < 80);
  assert.ok(first.times.every((at) => at >= 10 && at < 40));
  assert.ok(first.cursor >= 40);
  for (let i = 1; i < first.times.length; i++) assert.ok(first.times[i] - first.times[i - 1] >= MIN_CALL_GAP - 1e-9);
  assert.ok(planWindow(10, 40, 0.4, seeded(7)).times.length < first.times.length);
  assert.deepEqual(planWindow(10, 40, 0, seeded(7)), { times: [], cursor: 40 });
});

test("planned calls vary but stay inside safe pitch, pan and level", () => {
  const random = seeded(42);
  const voices = new Set<string>();
  const shapes = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const call = i % 5 === 0 ? planNightCall(random) : planBirdCall(random);
    voices.add(call.voice);
    shapes.add(`${call.voice}:${call.notes.length}:${Math.round(call.notes[0].from)}`);
    assert.ok(call.notes.length >= 1);
    assert.ok(call.level > 0 && call.level <= 0.25);
    assert.ok(Math.abs(call.pan) <= PAN_SPREAD);
    assert.ok(call.length > 0 && call.length < 4);
    for (const note of call.notes) {
      assert.ok(note.length > 0);
      assert.ok(note.from >= PITCH_FLOOR && note.from <= PITCH_CEILING);
      assert.ok(note.to >= PITCH_FLOOR && note.to <= PITCH_CEILING);
    }
  }
  assert.equal(voices.size, 7);
  assert.ok(shapes.size > 200);
  assert.deepEqual(planBirdCall(seeded(3)), planBirdCall(seeded(3)));
});

test("saved sound settings are parsed and clamped", () => {
  assert.deepEqual(parseSound(null), DEFAULT_SOUND);
  assert.deepEqual(parseSound("not json"), DEFAULT_SOUND);
  assert.deepEqual(parseSound("[]").enabled, DEFAULT_SOUND.enabled);
  assert.deepEqual(parseSound('{"enabled":false,"volume":0.25}'), { enabled: false, volume: 0.25 });
  assert.equal(parseSound('{"volume":9}').volume, 1);
  assert.equal(parseSound('{"volume":-3}').volume, 0);
  assert.equal(parseSound('{"volume":"loud"}').volume, DEFAULT_SOUND.volume);
  assert.equal(parseSound('{"enabled":"yes"}').enabled, DEFAULT_SOUND.enabled);
  assert.ok(DEFAULT_SOUND.enabled);
});

test("the engine stays silent and safe without a browser", () => {
  const ambience = new Ambience(DEFAULT_SOUND);
  ambience.setSettings({ enabled: false, volume: 0.2 });
  ambience.update({ daylight: 0, minuteOfDay: MIDNIGHT, indoors: true, traffic: 1 });
  ambience.dispose();
  ambience.dispose();
  assert.ok(MAX_VOICES <= 8);
});
