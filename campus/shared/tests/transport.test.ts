import assert from "node:assert/strict";
import test from "node:test";
import raw from "../src/data/school-transport.json";
import { findSchool, listSchools } from "../src/schools";
import {
  DEFAULT_TRANSPORT,
  HAIL_MIN_RIDE_PX,
  PAID_MODES,
  TRANSPORT_DATA,
  TRANSPORT_DATABASE_SOURCE,
  checkHail,
  collectOverrides,
  fareFor,
  parseTransportConfig,
  parseTransportData,
  parseTransportEntry,
  partFare,
  transportFor,
  type HailRequest,
  type TransportData,
  type TransportOverride,
} from "../src/transport";
import { PX_PER_METER } from "../src/map";

const OAU = "obafemi-awolowo-university-ile-ife";
const KM = 1000 * PX_PER_METER;

test("every entry in school-transport.json validates", () => {
  const data = parseTransportData(raw);
  const entries = [data.default, ...Object.values(data.byType), ...Object.values(data.byState), ...Object.values(data.schools)];
  assert.ok(entries.length > 10);
  for (const entry of entries) {
    assert.ok(parseTransportEntry(entry));
    assert.ok(entry.source.length > 0);
    if (entry.modes) assert.ok(entry.modes.includes("walk"));
    if (entry.verified) assert.match(entry.source, /^https?:\/\//);
  }
  for (const mode of PAID_MODES) assert.ok(data.default.fares[mode]);
});

test("every school, type and state key exists in schools.json", () => {
  const schools = listSchools();
  const states = new Set(schools.map((s) => s.state));
  const types = new Set<string>(schools.map((s) => s.type));
  for (const id of Object.keys(TRANSPORT_DATA.schools)) assert.ok(findSchool(id), `unknown school id ${id}`);
  for (const state of Object.keys(TRANSPORT_DATA.byState)) assert.ok(states.has(state), `unknown state ${state}`);
  for (const type of Object.keys(TRANSPORT_DATA.byType)) assert.ok(types.has(type), `unknown type ${type}`);
});

test("a broken file is rejected", () => {
  assert.throws(() => parseTransportData({ default: { modes: ["walk", "jetpack"], fares: {}, verified: false, source: "default" }, byType: {}, byState: {}, schools: {} }));
  assert.throws(() => parseTransportData({ ...raw, schools: { x: { modes: ["walk"], verified: "yes", source: "default" } } }));
  assert.equal(parseTransportEntry({ verified: false, source: "default", fares: { okada: { base: 200, perKm: 0, max: 100 } } }), null);
});

const sample: TransportData = parseTransportData({
  default: {
    modes: ["walk", "okada"],
    fares: { okada: { base: 100, perKm: 0, max: 100 }, keke: { base: 200, perKm: 0, max: 200 }, shuttle: { base: 50, perKm: 0, max: 50 }, bus: { base: 60, perKm: 0, max: 60 } },
    verified: false,
    source: "default",
  },
  byType: { university: { modes: ["walk", "okada", "bus"], fares: { bus: { base: 70, perKm: 0, max: 70 } }, verified: false, source: "type" } },
  byState: { "Osun State": { modes: ["walk", "keke"], verified: false, source: "state" } },
  schools: { [OAU]: { fares: { keke: { base: 300, perKm: 0, max: 300 } }, verified: true, source: "https://example.org/oau" } },
});

test("layers merge in order: default, type, state, school, database", () => {
  assert.deepEqual(transportFor(null, undefined, sample).modes, ["walk", "okada"]);
  assert.deepEqual(transportFor({ id: "x", type: "university" }, undefined, sample).modes, ["walk", "okada", "bus"]);
  const stateWins = transportFor({ id: "x", type: "university", state: "Osun State" }, undefined, sample);
  assert.deepEqual(stateWins.modes, ["walk", "keke"]);
  assert.equal(stateWins.fares.bus.base, 70);
  assert.equal(stateWins.source, "state");
  const school = transportFor({ id: OAU, type: "university", state: "Osun State" }, undefined, sample);
  assert.deepEqual(school.modes, ["walk", "keke"]);
  assert.equal(school.fares.keke.base, 300);
  assert.equal(school.fares.okada.base, 100);
  assert.equal(school.verified, true);
  const overrides = new Map<string, TransportOverride>([[OAU, { schoolId: OAU, modes: ["walk", "okada", "shuttle"], fares: { okada: { base: 500, perKm: 0, max: 500 } }, enabled: true }]]);
  const live = transportFor({ id: OAU, type: "university", state: "Osun State" }, overrides, sample);
  assert.deepEqual(live.modes, ["walk", "okada", "shuttle"]);
  assert.equal(live.fares.okada.base, 500);
  assert.equal(live.fares.keke.base, 300);
  assert.equal(live.source, TRANSPORT_DATABASE_SOURCE);
  overrides.set(OAU, { schoolId: OAU, modes: ["walk"], fares: null, enabled: false });
  assert.deepEqual(transportFor({ id: OAU, type: "university", state: "Osun State" }, overrides, sample).modes, ["walk", "keke"]);
});

test("real data: OAU has no okada, an unknown school gets the default", () => {
  const oau = transportFor(findSchool(OAU));
  assert.ok(!oau.modes.includes("okada"));
  assert.ok(oau.modes.includes("keke") && oau.modes.includes("shuttle"));
  assert.equal(oau.verified, true);
  assert.equal(transportFor("no-such-school").source, "default");
  assert.deepEqual(parseTransportConfig(JSON.parse(JSON.stringify(oau))), oau);
  for (const s of listSchools()) assert.ok(transportFor(s).modes.includes("walk"));
});

test("bad database rows are ignored and reported", () => {
  const bad: string[] = [];
  const rows: unknown[] = [
    { schoolId: OAU, modes: ["walk", "okada"], fares: { okada: { base: 250, perKm: 50, max: 600 } }, enabled: true },
    { schoolId: "university-of-ibadan", modes: ["walk", "helicopter"], fares: null, enabled: true },
    { schoolId: "university-of-lagos", modes: null, fares: { okada: { base: -5, perKm: 0, max: 10 } }, enabled: true },
    { schoolId: "not-a-school", modes: ["walk"], fares: null, enabled: true },
    { schoolId: "university-of-benin", modes: null, fares: null, enabled: "yes" },
    null,
    "junk",
  ];
  const overrides = collectOverrides(rows, (id) => findSchool(id) !== undefined, (_row, why) => bad.push(why));
  assert.deepEqual([...overrides.keys()], [OAU]);
  assert.equal(bad.length, 6);
  const live = transportFor(findSchool(OAU), overrides);
  assert.ok(live.modes.includes("okada"));
  assert.equal(fareFor(live, "okada", 0), 250);
  assert.deepEqual(collectOverrides([], () => true, () => assert.fail("empty table")).size, 0);
});

test("fares follow the rule and stay inside base and max", () => {
  const config = transportFor(null, undefined, parseTransportData({ ...raw, default: { ...raw.default, fares: { ...raw.default.fares, okada: { base: 150, perKm: 100, max: 400 } } } }));
  assert.equal(fareFor(config, "okada", 0), 150);
  assert.equal(fareFor(config, "okada", 1 * KM), 250);
  assert.equal(fareFor(config, "okada", 1.4 * KM), 300);
  assert.equal(fareFor(config, "okada", 9 * KM), 400);
  assert.equal(partFare(config, "okada", 400, 0), 150);
  assert.equal(partFare(config, "okada", 400, 0.5), 200);
  assert.equal(partFare(config, "okada", 400, 1), 400);
});

const ask = (over: Partial<HailRequest>): HailRequest => ({ mode: "okada", cash: 5000, riding: false, driving: false, inside: false, hailing: false, rideDistancePx: 1 * KM, freeVehicle: true, ...over });

test("hail rules", () => {
  const config = DEFAULT_TRANSPORT;
  const oau = transportFor(findSchool(OAU));
  const fare = fareFor(config, "okada", 1 * KM);
  assert.deepEqual(checkHail(config, ask({})), { ok: true, mode: "okada", fare });
  assert.deepEqual(checkHail(oau, ask({})), { ok: false, reason: "banned", mode: "okada" });
  assert.equal(checkHail(oau, ask({ mode: "keke" })).ok, true);
  assert.deepEqual(checkHail(config, ask({ mode: "shuttle" })), { ok: false, reason: "mode" });
  assert.deepEqual(checkHail(config, ask({ mode: 7 })), { ok: false, reason: "mode" });
  assert.deepEqual(checkHail(config, ask({ cash: fare - 1 })), { ok: false, reason: "cash", mode: "okada", fare });
  assert.equal(checkHail(config, ask({ cash: fare })).ok, true);
  assert.deepEqual(checkHail(config, ask({ riding: true })), { ok: false, reason: "riding", mode: "okada" });
  assert.deepEqual(checkHail(config, ask({ driving: true })), { ok: false, reason: "riding", mode: "okada" });
  assert.deepEqual(checkHail(config, ask({ inside: true })), { ok: false, reason: "inside", mode: "okada" });
  assert.deepEqual(checkHail(config, ask({ hailing: true })), { ok: false, reason: "hailing", mode: "okada" });
  assert.deepEqual(checkHail(config, ask({ rideDistancePx: null })), { ok: false, reason: "unreachable", mode: "okada" });
  assert.deepEqual(checkHail(config, ask({ rideDistancePx: HAIL_MIN_RIDE_PX - 1 })), { ok: false, reason: "near", mode: "okada" });
  assert.deepEqual(checkHail(config, ask({ freeVehicle: false })), { ok: false, reason: "none", mode: "okada", fare });
});
