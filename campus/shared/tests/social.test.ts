import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { EVENTS, MINUTES_PER_DAY, gameTime } from "../src/clock.ts";
import { INTERIORS, INTERIOR_X0, SPOTS, STALLS } from "../src/interiors.ts";
import campus from "../src/data/campus.json";
import { AREAS, PLACES, PX_PER_METER, nearBuilding, onRoad, pointInPoly } from "../src/map.ts";
import { isBlocked } from "../src/movement.ts";
import {
  CUP_SIZE,
  FACULTY_TEAMS,
  FORECOURT_LABEL,
  GROUND_IDS,
  GYRATION,
  GYRATION_LABEL,
  PITCHES,
  PREDICT,
  RESERVED_SLOTS,
  SOCIAL_SITES,
  TOUCHLINE_LABEL,
  allShowsFor,
  batchTimes,
  calendarFor,
  canPredict,
  facultyIndexOf,
  freshBatch,
  judge,
  leagueSeason,
  matchByKey,
  matchWinner,
  matchesFor,
  nextPredictable,
  parseSocial,
  parseSocialAction,
  pitchMatchesFor,
  pitchOffset,
  pitchTitle,
  prizeFor,
  settle,
  showBanners,
  showsFor,
  specialShowsFor,
  stallHours,
  stallOpen,
  tableOf,
  weekPlan,
  whatsOn,
} from "../src/shows.ts";
import { DEPARTMENT_GROUPS } from "../src/departments.ts";

const M = PX_PER_METER;
const WEEKS = 30;
const OLD_STALLS = 110;
const OLD_STALL_HASH = "aafab4800c11e4c0";
const at = (dayIndex: number, hour: number, minute = 0) => gameTime(dayIndex * MINUTES_PER_DAY + hour * 60 + minute);
const legal = (x: number, y: number) => x < INTERIOR_X0 && !isBlocked(x, y) && !onRoad(x, y) && !nearBuilding(x, y);
const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;
const party = EVENTS.find((e) => e.id === "party")!;

test("old stall spots did not move and the new ones are appended", () => {
  assert.equal(SOCIAL_SITES.firstStall, OLD_STALLS);
  const base = STALLS[0].spot;
  const old = STALLS.slice(0, OLD_STALLS);
  const hash = createHash("sha256").update(old.map((s) => `${Math.round(s.x)}|${Math.round(s.y)}|${s.spot - base}|${Math.round(SPOTS[s.spot].x)}|${Math.round(SPOTS[s.spot].y)}`).join(";")).digest("hex").slice(0, 16);
  assert.equal(hash, OLD_STALL_HASH);
  old.forEach((s, i) => assert.equal(s.spot, base + i));
  assert.equal(SOCIAL_SITES.firstSpot, base + OLD_STALLS);
  for (const id of ["risky", "hot", "palm"] as const) {
    const index = SOCIAL_SITES.stalls[id]!;
    assert.ok(index >= OLD_STALLS && STALLS[index].spot >= SOCIAL_SITES.firstSpot, id);
    assert.ok(legal(SPOTS[STALLS[index].spot].sx, SPOTS[STALLS[index].spot].sy), id);
  }
  const addedRooms = INTERIORS.slice(campus.places.length).flatMap((room) => room ? [room.spotStart] : []);
  const outdoorEnd = Math.min(SPOTS.length, ...addedRooms);
  for (let i = SOCIAL_SITES.firstSpot; i < outdoorEnd; i++) assert.equal(SPOTS[i].place, -1);
  const alumni = PLACES.find((p) => /alumni hall/i.test(p.name))!;
  const hot = STALLS[SOCIAL_SITES.stalls.hot!];
  assert.ok(Math.hypot(hot.x - alumni.door.x, hot.y - alumni.door.y) < 60 * M);
});

test("the pitches sit on the fields by the Sports Centre and the Main bowl", () => {
  for (const ground of GROUND_IDS) {
    const pitch = PITCHES[ground]!;
    assert.ok(pitch, ground);
    const area = AREAS[pitch.area];
    assert.equal(area.kind, "field");
    assert.match(PLACES[pitch.place].name, ground === "sports" ? /sports centre/i : /main bowl/i);
    assert.ok(pointInPoly(PLACES[pitch.place].label.x, PLACES[pitch.place].label.y, area.poly));
    assert.ok(pitch.length >= 60 * M && pitch.width >= 38 * M && pitch.length > pitch.width);
    for (const along of [-1, 1])
      for (const across of [-1, 1]) {
        const corner = pitchOffset(pitch, (along * pitch.length) / 2, (across * pitch.width) / 2);
        assert.ok(pointInPoly(corner.x, corner.y, area.poly) && !onRoad(corner.x, corner.y) && !isBlocked(corner.x, corner.y));
      }
    const seats = SOCIAL_SITES.touchline[ground];
    assert.equal(seats.length, 12);
    for (const i of seats) {
      const s = SPOTS[i];
      assert.equal(s.label, TOUCHLINE_LABEL);
      assert.ok(legal(s.sx, s.sy) && legal(s.x, s.y));
      const d = Math.hypot(s.x - pitch.cx, s.y - pitch.cy);
      assert.ok(d > pitch.width / 2 && d < pitch.length / 2 + 12 * M);
    }
  }
  assert.notEqual(PITCHES.sports!.area, PITCHES.bowl!.area);
});

test("league fixtures are deterministic, every faculty plays and nobody plays itself", () => {
  assert.equal(FACULTY_TEAMS.length, DEPARTMENT_GROUPS.university.length);
  assert.deepEqual(FACULTY_TEAMS.map((t) => t.label), DEPARTMENT_GROUPS.university.map((g) => g.label));
  assert.equal(new Set(FACULTY_TEAMS.map((t) => t.code)).size, FACULTY_TEAMS.length);
  for (let season = 0; season < 6; season++) {
    const s = leagueSeason(season);
    const games = new Map<number, number>();
    for (const m of s.league) {
      assert.notEqual(m.teams[0], m.teams[1]);
      for (const team of m.teams) games.set(team, (games.get(team) ?? 0) + 1);
      assert.ok(m.kickoff >= 12 * 60 && m.kickoff + 105 <= 18 * 60, "afternoon fixture");
      assert.match(PLACES[m.place].name, /sports centre|main bowl/i);
      assert.equal(m.fee, 0);
    }
    for (const team of FACULTY_TEAMS) assert.ok((games.get(team.index) ?? 0) >= 2, `${team.name} plays in season ${season}`);
    const slots = new Set<string>();
    const busy = new Set<string>();
    for (const m of s.matches) {
      assert.ok(!slots.has(`${m.startTotal}:${m.ground}`), "one match per pitch at a time");
      slots.add(`${m.startTotal}:${m.ground}`);
      for (const team of m.teams) {
        assert.ok(!busy.has(`${m.startTotal}:${team}`));
        busy.add(`${m.startTotal}:${team}`);
      }
    }
  }
  const before = JSON.stringify(leagueSeason(2));
  for (let season = 20; season < 30; season++) leagueSeason(season);
  assert.equal(JSON.stringify(leagueSeason(2)), before);
  const day = leagueSeason(0).league[0].dayIndex;
  assert.ok(pitchMatchesFor(day).length >= 3);
  assert.deepEqual(pitchMatchesFor(day).map((m) => m.key), pitchMatchesFor(day).map((m) => m.key));
});

test("the Dean's Cup bracket moves winners forward to one champion", () => {
  for (let season = 0; season < 8; season++) {
    const s = leagueSeason(season);
    assert.equal(s.quarters.length, CUP_SIZE / 2);
    assert.equal(s.semis.length, 2);
    assert.ok(s.final);
    assert.deepEqual(s.qualifiers, tableOf(s.league).slice(0, CUP_SIZE).map((r) => r.team));
    assert.deepEqual([...s.quarters.flatMap((m) => m.teams)].sort((a, b) => a - b), [...s.qualifiers].sort((a, b) => a - b));
    const winner = (m: (typeof s.quarters)[number]) => {
      const side = matchWinner(m);
      assert.notEqual(side, -1, "a knockout match always has a winner");
      return m.teams[side as 0 | 1];
    };
    s.semis.forEach((semi, i) => {
      assert.deepEqual(semi.teams, [winner(s.quarters[i * 2]), winner(s.quarters[i * 2 + 1])]);
      assert.ok(semi.startTotal >= semi.knownAt && semi.knownAt >= s.quarters[i * 2].endTotal);
      assert.match(pitchTitle(semi, semi.knownAt - 1), /Winner QF/);
      assert.equal(pitchTitle(semi, semi.knownAt), `${semi.home.name} v ${semi.away.name}`);
    });
    assert.deepEqual(s.final!.teams, [winner(s.semis[0]), winner(s.semis[1])]);
    assert.equal(s.champion, winner(s.final!));
    assert.ok(s.final!.startTotal > Math.max(...s.semis.map((m) => m.endTotal)));
    assert.ok(Math.min(...s.quarters.map((m) => m.startTotal)) > Math.max(...s.league.map((m) => m.endTotal)));
    assert.match(s.final!.competition, /Dean's Cup/);
  }
});

test("faculty weeks rotate and the calendar keeps clear of Press Night and the SUB party", () => {
  const n = FACULTY_TEAMS.length;
  assert.equal(new Set(Array.from({ length: n }, (_, w) => weekPlan(w).faculty)).size, n);
  assert.equal(weekPlan(n).faculty, weekPlan(0).faculty);
  let unions = 0;
  let matrics = 0;
  let signouts = 0;
  let gyrations = 0;
  for (let week = 0; week < WEEKS; week++) {
    const plan = weekPlan(week);
    const kinds = new Map<string, number>();
    for (let d = week * 7; d < week * 7 + 7; d++) {
      const weekday = d % 7;
      for (const e of calendarFor(d)) {
        kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
        assert.ok(PLACES[e.place] && e.end > e.start && e.end <= MINUTES_PER_DAY);
        assert.ok(!/[—–]/.test(e.title + e.detail + e.where));
        if (/student union/i.test(PLACES[e.place].name) && party.weekdays.includes(weekday)) assert.ok(!overlaps(e.start, e.end, party.start, party.end), `${e.kind} clashes with the SUB party`);
        if (e.kind === "gyration") assert.ok(GYRATION.weekdays.includes(weekday as 0 | 2 | 6) && e.start >= 18 * 60);
        if (["cultural", "oldschool", "novelty", "dinner"].includes(e.kind)) assert.equal(e.faculty, plan.faculty);
      }
      for (const s of specialShowsFor(d)) {
        for (const r of RESERVED_SLOTS) assert.ok(!(r.venue === s.venue && r.weekday === weekday && overlaps(s.start, s.end, r.start, r.end)), `${s.title} clashes with ${r.holder}`);
        if (party.weekdays.includes(weekday)) assert.ok(!overlaps(s.start, s.end + 30, party.start, party.end));
        for (const regular of showsFor(d)) assert.ok(regular.venue !== s.venue || !overlaps(s.start, s.end, regular.start, regular.end), `${s.title} overlaps ${regular.title}`);
        assert.ok(allShowsFor(d).includes(s));
      }
      assert.equal(new Set(allShowsFor(d).map((s) => s.key)).size, allShowsFor(d).length);
    }
    for (const kind of ["cultural", "oldschool", "novelty", "dinner"]) assert.equal(kinds.get(kind), 1, `week ${week} has one ${kind}`);
    assert.equal(kinds.get("rave") ?? 0, plan.union ? 1 : 0);
    assert.equal(kinds.get("games") ?? 0, plan.union ? 1 : 0);
    assert.equal(kinds.get("matric") ?? 0, plan.matric ? 1 : 0);
    assert.equal(kinds.get("signout") ?? 0, plan.signout ? 1 : 0);
    assert.equal(kinds.get("gyration") ?? 0, plan.gyration >= 0 ? 1 : 0);
    unions += plan.union ? 1 : 0;
    matrics += plan.matric ? 1 : 0;
    signouts += plan.signout ? 1 : 0;
    gyrations += plan.gyration >= 0 ? 1 : 0;
  }
  assert.equal(unions, WEEKS / 6);
  assert.equal(matrics, WEEKS / 5);
  assert.equal(signouts, WEEKS / 5);
  assert.ok(gyrations > WEEKS / 3 && gyrations < WEEKS);
  assert.deepEqual(weekPlan(7), weekPlan(7));
});

test("sign-out finalists, the gyration circle and the forecourt stand on legal ground", () => {
  const union = PLACES.find((p) => /student union/i.test(p.name))!;
  const nearUnion = SOCIAL_SITES.finalists.filter((f) => /student union/i.test(PLACES[f.place].name));
  assert.ok(nearUnion.length >= 5);
  assert.ok(SOCIAL_SITES.finalists.some((f) => /faculty/i.test(PLACES[f.place].name)));
  for (const f of SOCIAL_SITES.finalists) {
    assert.ok(legal(f.x, f.y), `finalist at ${Math.round(f.x)},${Math.round(f.y)}`);
    assert.ok(Math.hypot(f.x - PLACES[f.place].door.x, f.y - PLACES[f.place].door.y) < 30 * M);
  }
  const ring = SOCIAL_SITES.gyration!;
  assert.ok(ring && ring.spots.length >= 8);
  assert.ok(Math.hypot(ring.x - union.door.x, ring.y - union.door.y) < 90 * M);
  assert.ok(legal(ring.x, ring.y));
  for (const i of ring.spots) {
    assert.equal(SPOTS[i].label, GYRATION_LABEL);
    assert.equal(SPOTS[i].kind, "dance");
    assert.ok(legal(SPOTS[i].x, SPOTS[i].y));
  }
  const palm = STALLS[SOCIAL_SITES.stalls.palm!];
  assert.ok(Math.hypot(palm.x - ring.x, palm.y - ring.y) < 25 * M && Math.hypot(palm.x - ring.x, palm.y - ring.y) > ring.radius);
  const forecourt = SOCIAL_SITES.forecourt!;
  assert.ok(forecourt.spots.length >= 4);
  for (const i of forecourt.spots) assert.ok(SPOTS[i].label === FORECOURT_LABEL && legal(SPOTS[i].x, SPOTS[i].y));
});

test("stall opening hours: traders close at night, Risky owns the small hours", () => {
  const risky = SOCIAL_SITES.stalls.risky!;
  const hot = SOCIAL_SITES.stalls.hot!;
  const palm = SOCIAL_SITES.stalls.palm!;
  assert.ok(stallOpen(0, at(2, 12)) && stallOpen(OLD_STALLS - 1, at(2, 21, 59)));
  assert.ok(!stallOpen(0, at(2, 22)) && !stallOpen(0, at(2, 3)) && !stallOpen(OLD_STALLS - 1, at(2, 5, 59)));
  assert.ok(stallOpen(risky, at(2, 22)) && stallOpen(risky, at(2, 0, 30)) && stallOpen(risky, at(2, 3)));
  assert.ok(!stallOpen(risky, at(2, 4)) && !stallOpen(risky, at(2, 12)));
  assert.ok(stallOpen(hot, at(2, 16)) && stallOpen(hot, at(2, 20, 59)) && !stallOpen(hot, at(2, 21)) && !stallOpen(hot, at(2, 9)));
  for (let hour = 0; hour < 4; hour++) assert.deepEqual(STALLS.map((_, i) => i).filter((i) => stallOpen(i, at(3, hour, 10))), [risky]);
  assert.equal(stallHours(risky).special, "risky");
  let night: number | undefined;
  for (let d = 0; d < 60 && night === undefined; d++) if (calendarFor(d).some((e) => e.kind === "gyration")) night = d;
  assert.ok(night !== undefined);
  assert.ok(stallOpen(palm, at(night!, 21)) && !stallOpen(palm, at(night!, 12)) && !stallOpen(palm, at(night! + 1, 21)) === !calendarFor(night! + 1).some((e) => e.kind === "gyration"));
  for (let d = 0; d < 14; d++) {
    const times = batchTimes(d);
    assert.ok(times.length >= 4);
    assert.deepEqual(times, batchTimes(d));
    for (const minute of times) {
      assert.ok(minute >= 16 * 60 && minute < 21 * 60);
      assert.ok(freshBatch(gameTime(d * MINUTES_PER_DAY + minute)));
    }
    assert.ok(!freshBatch(at(d, 10)));
  }
});

test("predict and win: free card, exact score beats the right winner", () => {
  assert.equal(judge({ key: "k", home: 2, away: 1 }, 2, 1), "exact");
  assert.equal(judge({ key: "k", home: 3, away: 0 }, 2, 1), "outcome");
  assert.equal(judge({ key: "k", home: 1, away: 1 }, 0, 0), "outcome");
  assert.equal(judge({ key: "k", home: 0, away: 1 }, 2, 1), "miss");
  assert.equal(judge({ key: "k", home: 1, away: 1 }, 2, 1), "miss");
  assert.ok(prizeFor("exact") > prizeFor("outcome") && prizeFor("outcome") > 0 && prizeFor("miss") === 0);
  assert.equal(prizeFor("exact"), PREDICT.exact);
  const match = matchesFor(5)[0];
  assert.equal(matchByKey(match.key), match);
  assert.equal(matchByKey("nonsense"), undefined);
  assert.ok(canPredict(match, match.startTotal - 1) && !canPredict(match, match.startTotal));
  const home = match.goals.filter((g) => g.side === 0).length;
  const away = match.goals.length - home;
  assert.equal(settle({ key: match.key, home, away }, match.endTotal - 1), undefined);
  const done = settle({ key: match.key, home, away }, match.endTotal);
  assert.ok(done && done !== "void" && done.result === "exact" && done.prize === PREDICT.exact);
  assert.equal(settle({ key: "m999999:7", home: 0, away: 0 }, 0), "void");
  const t = gameTime(match.startTotal);
  const next = nextPredictable(t);
  assert.ok(next && next.startTotal > t.total);
});

test("new events reach the what's on list and the banners", () => {
  let pitch = 0;
  let events = 0;
  for (let d = 0; d < 28; d++) {
    const t = at(d, 9);
    const banners = showBanners(t);
    assert.equal(new Set(banners.map((b) => b.id)).size, banners.length);
    for (const b of banners) assert.ok(b.near !== undefined && PLACES[b.near] && !/[—–]/.test(b.title + b.lines.join("")));
    pitch += banners.filter((b) => b.id.startsWith("pitch:")).length;
    events += banners.filter((b) => b.id.startsWith("event:")).length;
    for (const item of whatsOn(t)) if (item.go) assert.ok(Number.isFinite(item.go.x + item.go.y));
  }
  assert.ok(pitch > 20 && events > 8);
  const list = whatsOn(at(1, 9));
  assert.ok(list.some((i) => i.type === "pitch") && list.some((i) => i.title === "Freshers' Matriculation"));
  assert.ok(specialShowsFor(1).some((s) => /Cultural Day/.test(s.title) && /amphi/i.test(PLACES[s.place].name)));
  assert.ok(specialShowsFor(6).some((s) => /Dinner and Awards Night/.test(s.title) && /oduduwa/i.test(PLACES[s.place].name)));
});

test("saved social data and client actions are sanitised", () => {
  assert.deepEqual(parseSocial(null), {});
  assert.deepEqual(parseSocial({ tickets: { a: [1, 2, 3, 4, 5], bad: [1, 2], worse: "x" }, club: 7, predict: { key: "m1:0", home: 2, away: 99 }, shirt: -3, wins: 2.9 }), { tickets: { a: [1, 2, 3, 4, 5] }, predict: { key: "m1:0", home: 2, away: 9 }, wins: 2 });
  assert.deepEqual(parseSocialAction({ a: "predict", home: 2, away: 1 }), { a: "predict", home: 2, away: 1 });
  assert.equal(parseSocialAction({ a: "predict", home: 2.5, away: 1 }), null);
  assert.equal(parseSocialAction({ a: "predict", home: -1, away: 1 }), null);
  assert.equal(parseSocialAction({ a: "club", code: "TOOLONGCODE" }), null);
  assert.equal(parseSocialAction({ a: "sign", i: "0" }), null);
  assert.equal(parseSocialAction("status"), null);
  const law = DEPARTMENT_GROUPS.university.find((g) => g.label === "Law")!.departments[0].id;
  assert.equal(FACULTY_TEAMS[facultyIndexOf(law)].label, "Law");
  assert.equal(facultyIndexOf("other"), -1);
  assert.equal(facultyIndexOf(undefined), -1);
});
