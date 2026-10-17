import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLUB_FUN,
  FACULTY_PERKS,
  FACULTY_TEAMS,
  INTERIORS,
  MATCH_GATE_OPENS,
  MINUTES_PER_DAY,
  PREDICT,
  PX_PER_METER,
  SIGN_SHIRT,
  SOCIAL_SITES,
  SPOTS,
  STALLS,
  ServerMsg,
  VIEWING_PLACES,
  VIEWING_SEAT_LABEL,
  calendarFor,
  gameTime,
  leagueSeason,
  matchWinner,
  matchesFor,
  parseSocial,
  pitchMatchesFor,
  showsFor,
  viewingArea,
  weekPlan,
  type CalendarEvent,
  type FootballMatch,
  type Spot,
} from "@campuslife/shared";
import { DEPARTMENT_GROUPS } from "@campuslife/shared/departments";
import { ShowGate, type Fan } from "./Shows";
import { SocialDesk, type SocialHost, type SocialPlayer } from "./shows/desk";

const STEP = 2;
const DAYS = 84;
const fan = (cash: number, extra: Partial<Fan> = {}): Fan => ({ cash, fun: 10, energy: 80, food: 50, ...extra });
const departmentOf = (faculty: number) => DEPARTMENT_GROUPS.university[faculty].departments[0].id;
const allShows = Array.from({ length: 28 }, (_, d) => showsFor(d)).flat();
const allMatches = Array.from({ length: 28 }, (_, d) => matchesFor(d)).flat();
const paidShow = allShows.find((s) => s.fee > 0 && s.kind === "concert")!;
const seatOf = (place: number) => SPOTS.slice(INTERIORS[place]!.spotStart, INTERIORS[place]!.spotEnd).find((s) => s.kind === "sit" && !!s.seat)!;
const hostel = INTERIORS[VIEWING_PLACES[0]]!;
const bench = SPOTS.slice(hostel.spotStart, hostel.spotEnd).find((s) => s.label === VIEWING_SEAT_LABEL)!;
const board = { x: hostel.ox + viewingArea(hostel.template.w).boardX * PX_PER_METER, y: hostel.oy + 1.5 * PX_PER_METER };
const firstEvent = (kind: CalendarEvent["kind"]): CalendarEvent => {
  for (let d = 0; d < DAYS; d++) {
    const hit = calendarFor(d).find((e) => e.kind === kind);
    if (hit) return hit;
  }
  throw new Error(`no ${kind} in ${DAYS} days`);
};

function sitThrough(gate: ShowGate, who: string, f: Fan, spot: Spot, from: number, to: number): string[] {
  const notes: string[] = [];
  for (let total = from; total <= to; total++) {
    const out = gate.tick(who, f, spot.kind, spot, gameTime(total), STEP);
    if (out) notes.push(...out.notices);
  }
  return notes;
}

interface World {
  desk: SocialDesk;
  gate: ShowGate;
  people: Map<string, SocialPlayer>;
  notes: Map<string, string[]>;
  sent: { id: string; type: string; payload: unknown }[];
  saves: string[];
}

function world(gate = new ShowGate()): World {
  const people = new Map<string, SocialPlayer>();
  const notes = new Map<string, string[]>();
  const sent: World["sent"] = [];
  const saves: string[] = [];
  const host: SocialHost = {
    player: (id) => people.get(id),
    players: () => people,
    name: (id) => `@${id}`,
    send: (id, type, payload) => sent.push({ id, type, payload }),
    notice: (id, text) => notes.set(id, [...(notes.get(id) ?? []), text]),
    changed: (id) => saves.push(id),
  };
  return { desk: new SocialDesk(gate, host), gate, people, notes, sent, saves };
}

const person = (at: { x: number; y: number }, extra: Partial<SocialPlayer> = {}): SocialPlayer => ({ x: at.x, y: at.y, cash: 1000, fun: 20, level: "200L", department: "", profileId: "", ...extra });

test("tickets persist in one small column and a restart does not charge again", () => {
  const gate = new ShowGate();
  const f = fan(5000);
  const seat = seatOf(paidShow.place);
  gate.admit("acct", f, seat, gameTime(paidShow.startTotal + 5));
  sitThrough(gate, "acct", f, seat, paidShow.startTotal + 5, paidShow.startTotal + 40);
  assert.equal(f.cash, 5000 - paidShow.fee);
  const saved = JSON.parse(JSON.stringify(gate.save("acct"))) as unknown;
  const shape = parseSocial(saved);
  assert.deepEqual(Object.keys(shape.tickets ?? {}), [paidShow.key]);
  assert.equal(shape.tickets![paidShow.key].length, 5);
  assert.equal(shape.tickets![paidShow.key][4], paidShow.dayIndex);
  assert.ok(JSON.stringify(saved).length < 200);
  const seen = paidShow.moments.filter((m) => paidShow.startTotal + m.at <= paidShow.startTotal + 40).length;
  assert.equal(shape.tickets![paidShow.key][2], seen);

  const restarted = new ShowGate();
  restarted.load("acct", saved);
  assert.deepEqual(restarted.admit("acct", f, seat, gameTime(paidShow.startTotal + 41)), {});
  const notes = sitThrough(restarted, "acct", f, seat, paidShow.startTotal + 41, paidShow.endTotal - 1);
  assert.equal(f.cash, 5000 - paidShow.fee);
  assert.equal(notes.filter((n) => /You were there/.test(n)).length, 1);
  assert.equal(notes.length, paidShow.moments.length - seen + 1);

  const match = allMatches.find((m) => m.goals.length >= 2)!;
  const m1 = new ShowGate();
  const g = fan(1000);
  m1.admit("acct", g, bench, gameTime(match.startTotal - 5));
  sitThrough(m1, "acct", g, bench, match.startTotal, match.startTotal + 50);
  const m2 = new ShowGate();
  m2.load("acct", JSON.parse(JSON.stringify(m1.save("acct"))));
  assert.deepEqual(m2.admit("acct", g, bench, gameTime(match.startTotal + 51)), {});
  const rest = sitThrough(m2, "acct", g, bench, match.startTotal + 51, match.endTotal + 5);
  assert.equal(g.cash, 1000 - match.fee);
  assert.equal(rest.filter((n) => /Half time/.test(n)).length, 0);
  assert.equal(rest.filter((n) => /Full time/.test(n)).length, 1);
  const blank = new ShowGate();
  blank.load("acct", undefined);
  assert.equal(blank.admit("acct", fan(0), bench, gameTime(match.startTotal + 3)).refuse !== undefined, true);
});

test("the ticket book is dropped on leave and old tickets expire, not valid ones", () => {
  const gate = new ShowGate();
  const book = gate.book("acct");
  const day = 10;
  const many = allMatches.slice(0, 20);
  const f = fan(100000);
  for (let i = 0; i < 20; i++) {
    const m = { ...many[i], key: `m${day}:x${i}` };
    book.tickets.set(m.key, { seconds: 0, bonus: false, moments: 0, goals: 0, half: false, full: false, day });
  }
  gate.admit("acct", f, seatOf(paidShow.place), gameTime(paidShow.startTotal + 1));
  assert.equal(book.tickets.size, paidShow.dayIndex > day + 1 ? 1 : 21);
  book.tickets.clear();
  for (let i = 0; i < 20; i++) book.tickets.set(`same${i}`, { seconds: 0, bonus: false, moments: 0, goals: 0, half: false, full: false, day: paidShow.dayIndex });
  book.tickets.set("old", { seconds: 0, bonus: false, moments: 0, goals: 0, half: false, full: false, day: paidShow.dayIndex - 3 });
  gate.admit("acct", f, seatOf(paidShow.place), gameTime(paidShow.startTotal + 1));
  assert.equal(book.tickets.size, 21);
  assert.ok(!book.tickets.has("old") && book.tickets.has("same0") && book.tickets.has(paidShow.key));
  assert.equal(gate.size, 1);
  gate.forget("acct");
  assert.equal(gate.size, 0);
});

test("predict and win pays an exact score, pays less for the right winner and never takes a stake", () => {
  const match = allMatches.find((m) => m.goals.length >= 1 && m.goals.filter((g) => g.side === 0).length * 2 !== m.goals.length)!;
  const home = match.goals.filter((g) => g.side === 0).length;
  const away = match.goals.length - home;
  const before = gameTime(match.startTotal - 20);
  const after = gameTime(match.endTotal);
  const w = world();
  w.people.set("exact", person(board));
  w.people.set("winner", person(board));
  w.people.set("wrong", person(board));
  w.people.set("far", person({ x: board.x, y: board.y + 12 * PX_PER_METER }));
  w.people.set("late", person(board));
  w.desk.handle("exact", { a: "predict", home, away }, before);
  w.desk.handle("winner", { a: "predict", home: home + (home > away ? 2 : 0), away: away + (away > home ? 2 : 0) }, before);
  w.desk.handle("wrong", { a: "predict", home: away, away: home }, before);
  w.desk.handle("far", { a: "predict", home, away }, before);
  w.desk.handle("late", { a: "predict", home, away }, gameTime(match.startTotal + 1));
  for (const id of ["exact", "winner", "wrong", "far"]) assert.equal(w.people.get(id)!.cash, 1000, "the card is free");
  assert.match(w.notes.get("far")![0], /fixtures board/);
  assert.equal(w.gate.book("far").predict, undefined);
  assert.notEqual(w.gate.book("late").predict?.key, match.key);
  assert.equal(w.gate.book("exact").predict?.key, match.key);
  w.desk.handle("exact", { a: "predict", home: 9, away: 9 }, before);
  assert.deepEqual(w.gate.book("exact").predict, { key: match.key, home, away });
  w.people.delete("late");
  w.desk.tick(gameTime(match.endTotal - 1));
  assert.equal(w.people.get("exact")!.cash, 1000);
  w.desk.tick(after);
  w.desk.tick(after);
  assert.equal(w.people.get("exact")!.cash, 1000 + PREDICT.exact);
  assert.equal(w.people.get("winner")!.cash, 1000 + PREDICT.outcome);
  assert.equal(w.people.get("wrong")!.cash, 1000);
  assert.equal(w.gate.book("exact").predict, undefined);
  assert.equal(w.gate.book("exact").wins, 1);
  assert.ok(w.saves.includes("exact") && w.sent.some((s) => s.id === "exact" && s.type === ServerMsg.Social));

  const restart = new ShowGate();
  const again = world(restart);
  const carried = world();
  carried.people.set("p", person(board));
  carried.desk.handle("p", { a: "predict", home, away }, before);
  restart.load("p", JSON.parse(JSON.stringify(carried.gate.save("p"))));
  again.people.set("p", person(board));
  again.desk.tick(after);
  assert.equal(again.people.get("p")!.cash, 1000 + PREDICT.exact);
});

test("a supported club is chosen once and changes how a result feels", () => {
  const match = allMatches.find((m) => m.goals.filter((g) => g.side === 0).length > m.goals.filter((g) => g.side === 1).length)!;
  const w = world();
  w.people.set("a", person(board));
  w.desk.handle("a", { a: "club", code: "NOPE" }, gameTime(0));
  assert.equal(w.gate.book("a").club, "");
  w.desk.handle("a", { a: "club", code: match.home.code }, gameTime(0));
  w.desk.handle("a", { a: "club", code: match.away.code }, gameTime(0));
  assert.equal(w.gate.book("a").club, match.home.code);
  assert.match(w.notes.get("a")!.at(-1)!, /already choose/);

  const watch = (club: string) => {
    const gate = new ShowGate();
    gate.book("x").club = club;
    const f = fan(1000);
    gate.admit("x", f, bench, gameTime(match.startTotal - MATCH_GATE_OPENS + 1));
    return { f, notes: sitThrough(gate, "x", f, bench, match.startTotal, match.endTotal + 2) };
  };
  const neutral = watch("");
  const winner = watch(match.home.code);
  const loser = watch(match.away.code);
  assert.ok(winner.f.fun > neutral.f.fun + CLUB_FUN.win - 0.001);
  assert.ok(Math.abs(neutral.f.fun - CLUB_FUN.loss - loser.f.fun) < 0.001);
  assert.ok(winner.notes.some((n) => /win am/.test(n)) && winner.notes.some((n) => /don score!/.test(n)));
  assert.ok(loser.notes.some((n) => /lose\./.test(n)) && loser.notes.some((n) => /Dem don score/.test(n)));
  assert.ok(!neutral.notes.some((n) => /win am|lose\./.test(n)));
});

test("the touchline is free, calls the goals and cheers your own faculty", () => {
  const season = leagueSeason(0);
  const match = season.league.find((m) => matchWinner(m) >= 0 && m.goals.length >= 1)!;
  const winner = match.teams[matchWinner(match) as 0 | 1];
  const loser = match.teams[matchWinner(match) === 0 ? 1 : 0];
  const seat = SPOTS[SOCIAL_SITES.touchline[match.ground][0]];
  const other = SPOTS[SOCIAL_SITES.touchline[match.ground === "sports" ? "bowl" : "sports"][0]];
  const quiet = gameTime(match.dayIndex * MINUTES_PER_DAY + 8 * 60);
  const gate = new ShowGate();
  assert.match(gate.admit("a", fan(0), seat, quiet).refuse ?? "", /No match/);
  if (!pitchMatchesFor(match.dayIndex).some((m) => m.ground !== match.ground && m.startTotal === match.startTotal)) assert.ok(gate.admit("a", fan(0), other, gameTime(match.startTotal + 5)).refuse);
  const watch = (department: string) => {
    const g = new ShowGate();
    const f = fan(0, { department });
    assert.match(g.admit("x", f, seat, gameTime(match.startTotal - 5)).text ?? "", /Free at the touchline/);
    const notes = sitThrough(g, "x", f, seat, match.startTotal - 5, match.endTotal + 12);
    return { f, notes };
  };
  const proud = watch(departmentOf(winner));
  const sad = watch(departmentOf(loser));
  assert.equal(proud.f.cash, 0);
  assert.equal(proud.notes.filter((n) => /GOAL/.test(n)).length, match.goals.length);
  assert.equal(proud.notes.filter((n) => /Full time/.test(n)).length, 1);
  assert.ok(proud.notes.some((n) => n.includes(FACULTY_TEAMS[winner].name) && /don win/.test(n)));
  assert.ok(!sad.notes.some((n) => /don win/.test(n)));
  assert.ok(Math.abs(proud.f.fun - sad.f.fun - FACULTY_PERKS.winFun) < 0.001);
  assert.ok(proud.f.fun > 10);
  const last = [...pitchMatchesFor(match.dayIndex)].reverse().find((m) => m.ground === match.ground)!;
  const lastSeat = fan(0);
  const g2 = new ShowGate();
  g2.admit("y", lastSeat, seat, gameTime(last.startTotal + 1));
  assert.match(sitThrough(g2, "y", lastSeat, seat, last.startTotal + 1, last.endTotal + 12).at(-1)!, /Match don finish/);
});

test("gyration, palm wine and the Union Week forecourt only run during their events", () => {
  const night = firstEvent("gyration");
  const ring = SPOTS[SOCIAL_SITES.gyration!.spots[0]];
  const palm = SPOTS[STALLS[SOCIAL_SITES.stalls.palm!].spot];
  const gate = new ShowGate();
  const f = fan(1000);
  assert.match(gate.admit("a", f, ring, gameTime(night.startTotal - 30)).refuse ?? "", /shrine/);
  assert.match(gate.admit("a", f, palm, gameTime(night.startTotal - 30)).refuse ?? "", /gyration night/);
  assert.equal(gate.admit("a", f, palm, gameTime(night.startTotal + 10)).refuse, undefined);
  assert.match(gate.admit("a", f, ring, gameTime(night.startTotal + 10)).text ?? "", /gyration/);
  const before = f.fun;
  const live = gate.tick("a", f, "dance", ring, gameTime(night.startTotal + 11), STEP)!;
  assert.ok(!live.leave && f.fun > before);
  assert.equal(gate.tick("a", f, "dance", ring, gameTime(night.endTotal), STEP)!.leave, true);
  assert.equal(f.cash, 1000);

  const games = firstEvent("games");
  const table = SPOTS[SOCIAL_SITES.forecourt!.spots[0]];
  const g = fan(0, { food: 40 });
  assert.ok(gate.admit("b", g, table, gameTime(games.startTotal - 1)).refuse);
  assert.match(gate.admit("b", g, table, gameTime(games.startTotal + 1)).text ?? "", /jollof/);
  assert.ok((g.food ?? 0) > 40);
  const fed = g.food;
  assert.deepEqual(gate.admit("b", g, table, gameTime(games.startTotal + 30)), {});
  assert.equal(g.food, fed);
  assert.equal(gate.tick("b", g, "play", table, gameTime(games.endTotal + 1), STEP)!.leave, true);
});

test("the server enforces stall hours and the fresh puff-puff batch", () => {
  const gate = new ShowGate();
  const ordinary = SPOTS[STALLS[0].spot];
  const risky = SPOTS[STALLS[SOCIAL_SITES.stalls.risky!].spot];
  const hot = SPOTS[STALLS[SOCIAL_SITES.stalls.hot!].spot];
  const at = (hour: number, minute = 0) => gameTime(3 * MINUTES_PER_DAY + hour * 60 + minute);
  assert.match(gate.admit("a", fan(5000), ordinary, at(23, 30)).refuse ?? "", /pack for the night/);
  assert.deepEqual(gate.admit("a", fan(5000), ordinary, at(12)), {});
  assert.deepEqual(gate.admit("a", fan(5000), risky, at(1)), {});
  assert.match(gate.admit("a", fan(5000), risky, at(13)).refuse ?? "", /Risky never open/);
  assert.match(gate.admit("a", fan(5000), hot, at(10)).refuse ?? "", /As E Dey Hot/);
  let fresh = 0;
  let plain = 0;
  for (let minute = 0; minute < 5 * 60; minute++) {
    const f = fan(5000);
    const out = gate.admit("a", f, hot, at(16, minute));
    assert.equal(out.refuse, undefined);
    assert.equal(f.cash, 5000);
    if (out.text) {
      fresh++;
      assert.ok(/Fresh batch/.test(out.text) && f.fun > 10);
    } else plain++;
  }
  assert.ok(fresh > 30 && plain > 100);
  const counter = SPOTS.find((s) => s.kind === "eat" && s.place >= 0)!;
  assert.deepEqual(gate.admit("a", fan(5000), counter, at(2)), {});
});

test("sign-out day: sign a finalist's shirt once, and finalists collect signatures", () => {
  const day = firstEvent("signout");
  const now = gameTime(day.startTotal + 30);
  const spot = SOCIAL_SITES.finalists[0];
  const w = world();
  w.people.set("fresher", person(spot));
  w.people.set("finalist", person({ x: spot.x + 2 * PX_PER_METER, y: spot.y }, { level: "400L" }));
  w.people.set("faraway", person({ x: spot.x + 200 * PX_PER_METER, y: spot.y }, { level: "500L" }));
  w.desk.handle("fresher", { a: "sign", i: 0 }, gameTime(day.startTotal - 60));
  assert.match(w.notes.get("fresher")![0], /never reach/);
  assert.equal(w.people.get("fresher")!.fun, 20);
  w.desk.handle("fresher", { a: "sign", i: 0 }, now);
  assert.equal(w.people.get("fresher")!.fun, 20 + SIGN_SHIRT.fun);
  assert.equal(w.gate.book("finalist").shirt, 1);
  assert.match(w.notes.get("finalist")![0], /@fresher don sign your shirt\. 1 signature now/);
  assert.equal(w.gate.book("faraway").shirt, 0);
  w.desk.handle("fresher", { a: "sign", i: 0 }, now);
  assert.equal(w.people.get("fresher")!.fun, 20 + SIGN_SHIRT.fun);
  assert.match(w.notes.get("fresher")!.at(-1)!, /already/);
  w.desk.handle("fresher", { a: "sign", i: 5 }, now);
  assert.match(w.notes.get("fresher")!.at(-1)!, /closer/);
  w.desk.handle("finalist", { a: "sign", i: 0 }, now);
  assert.equal(w.gate.book("finalist").shirt, 2);
  assert.deepEqual(w.desk.status("finalist", now), { club: "", predict: undefined, wins: 0, shirt: 2, finalist: true, faculty: -1, signed: [0] });
  assert.equal(w.desk.status("finalist", gameTime(now.total + MINUTES_PER_DAY))!.shirt, 0);
});

test("faculty week greets its own students once each morning", () => {
  const week = 3;
  const faculty = weekPlan(week).faculty;
  const w = world();
  w.people.set("mine", person(board, { department: departmentOf(faculty) }));
  w.people.set("other", person(board, { department: departmentOf((faculty + 1) % FACULTY_TEAMS.length) }));
  const monday = week * 7;
  w.desk.tick(gameTime(monday * MINUTES_PER_DAY + 6 * 60));
  assert.equal(w.notes.get("mine"), undefined);
  w.desk.tick(gameTime(monday * MINUTES_PER_DAY + 7 * 60));
  w.desk.tick(gameTime(monday * MINUTES_PER_DAY + 9 * 60));
  assert.equal(w.notes.get("mine")!.length, 1);
  assert.ok(w.notes.get("mine")![0].includes(`${FACULTY_TEAMS[faculty].name} Week`));
  assert.equal(w.people.get("mine")!.fun, 20 + FACULTY_PERKS.toastFun);
  assert.equal(w.notes.get("other"), undefined);
  const thursday = monday + 3;
  w.desk.tick(gameTime(thursday * MINUTES_PER_DAY + 8 * 60));
  assert.equal(w.people.get("mine")!.fun, 20 + FACULTY_PERKS.toastFun * 2 + FACULTY_PERKS.weekFun);
  assert.ok(w.notes.get("mine")!.some((n) => /Old School Day/.test(n)));
  const saved = parseSocial(JSON.parse(JSON.stringify(w.gate.save("mine"))));
  assert.equal(saved.toast, thursday);
});
