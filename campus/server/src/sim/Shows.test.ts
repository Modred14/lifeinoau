import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INTERIORS,
  MATCH_AFTER,
  MATCH_GATE_OPENS,
  MINUTES_PER_DAY,
  SPOTS,
  VENUE_PLACE,
  VIEWING_PLACES,
  VIEWING_SEAT_LABEL,
  gameTime,
  matchState,
  matchesFor,
  showsFor,
  type FootballMatch,
  type Show,
  type Spot,
} from "@campuslife/shared";
import { ShowGate, showAnnouncements, type Fan } from "./Shows";

const DAYS = 28;
const STEP = 2;
const spotsOf = (place: number, keep: (s: Spot) => boolean) => {
  const it = INTERIORS[place]!;
  return SPOTS.slice(it.spotStart, it.spotEnd).filter(keep);
};
const allShows = Array.from({ length: DAYS }, (_, d) => showsFor(d)).flat();
const allMatches = Array.from({ length: DAYS }, (_, d) => matchesFor(d)).flat();
const paidShow = allShows.find((s) => s.fee > 0 && s.kind === "concert")!;
const freeShow = allShows.find((s) => s.fee === 0)!;
const seatAt = (s: Show) => spotsOf(s.place, (x) => x.kind === "sit" && !!x.seat)[0];
const bench = spotsOf(VIEWING_PLACES[0], (s) => s.label === VIEWING_SEAT_LABEL)[0];
const scored = allMatches.find((m) => m.goals.length >= 2)!;
const fan = (cash: number): Fan => ({ cash, fun: 10, energy: 80 });

function sitThrough(gate: ShowGate, who: string, f: Fan, spot: Spot, from: number, to: number): string[] {
  const notes: string[] = [];
  for (let total = from; total <= to; total++) {
    const out = gate.tick(who, f, spot.kind, spot, gameTime(total), STEP);
    if (out) notes.push(...out.notices);
  }
  return notes;
}

test("the gate fee is charged once per show", () => {
  const gate = new ShowGate();
  const f = fan(5000);
  const seat = seatAt(paidShow);
  const now = gameTime(paidShow.startTotal + 10);
  const first = gate.admit("a", f, seat, now);
  assert.equal(f.cash, 5000 - paidShow.fee);
  assert.match(first.text ?? "", /gate fee paid/);
  assert.deepEqual(gate.admit("a", f, seat, gameTime(paidShow.startTotal + 20)), {});
  sitThrough(gate, "a", f, seat, paidShow.startTotal + 10, paidShow.endTotal - 1);
  assert.equal(f.cash, 5000 - paidShow.fee);
  const other = fan(5000);
  gate.admit("b", other, seat, now);
  assert.equal(other.cash, 5000 - paidShow.fee);
});

test("no cash, no entry, and nothing is taken", () => {
  const gate = new ShowGate();
  const f = fan(paidShow.fee - 1);
  const refused = gate.admit("a", f, seatAt(paidShow), gameTime(paidShow.startTotal + 1));
  assert.ok(refused.refuse && /gate fee/.test(refused.refuse));
  assert.equal(f.cash, paidShow.fee - 1);
  const free = gate.admit("a", fan(0), seatAt(freeShow), gameTime(freeShow.startTotal + 1));
  assert.equal(free.refuse, undefined);
});

test("outside show times the venues are quiet halls", () => {
  const gate = new ShowGate();
  const f = fan(100);
  const seat = seatAt(paidShow);
  const quiet = gameTime(paidShow.dayIndex * MINUTES_PER_DAY + 9 * 60);
  assert.deepEqual(gate.admit("a", f, seat, quiet), {});
  assert.equal(gate.tick("a", f, "sit", seat, quiet, STEP), undefined);
  assert.equal(f.cash, 100);
  const lectureSeat = SPOTS.find((s) => s.kind === "study" && s.place >= 0)!;
  assert.deepEqual(gate.admit("a", f, lectureSeat, gameTime(paidShow.startTotal + 1)), {});
});

test("someone already seated is never charged in tick: they stand up and pay by sitting again", () => {
  const gate = new ShowGate();
  const seat = seatAt(paidShow);
  const rich = fan(3000);
  const start = gate.tick("rich", rich, "sit", seat, gameTime(paidShow.startTotal), STEP)!;
  assert.equal(start.leave, true);
  assert.match(start.notices[0], /Sit again to pay/);
  assert.equal(rich.cash, 3000);
  assert.match(gate.admit("rich", rich, seat, gameTime(paidShow.startTotal + 1)).text ?? "", /gate fee paid/);
  assert.equal(rich.cash, 3000 - paidShow.fee);
  assert.equal(gate.tick("rich", rich, "sit", seat, gameTime(paidShow.startTotal + 2), STEP)!.leave, false);
  const early = fan(1000);
  const gateOpens = gate.tick("early", early, "tv", bench, gameTime(scored.startTotal - MATCH_GATE_OPENS + 1), STEP)!;
  assert.equal(gateOpens.leave, true);
  assert.equal(early.cash, 1000);
  const free = fan(0);
  assert.equal(gate.tick("free", free, "sit", seatAt(freeShow), gameTime(freeShow.startTotal), STEP)!.leave, false);
});

test("watching gives fun, costs a little energy, has its moments and a you were there bonus", () => {
  const gate = new ShowGate();
  const f = fan(5000);
  const seat = seatAt(paidShow);
  gate.admit("a", f, seat, gameTime(paidShow.startTotal));
  const notes = sitThrough(gate, "a", f, seat, paidShow.startTotal, paidShow.endTotal - 1);
  assert.ok(f.fun > 200, "a full show should fill fun");
  assert.ok(f.energy < 80);
  assert.equal(notes.filter((n) => /DOBALE/.test(n)).length, 1);
  assert.equal(notes.filter((n) => /You were there/.test(n)).length, 1);
  assert.equal(notes.length, paidShow.moments.length + 1);
  const late = fan(5000);
  gate.admit("late", late, seat, gameTime(paidShow.endTotal - 5));
  const lateNotes = sitThrough(gate, "late", late, seat, paidShow.endTotal - 5, paidShow.endTotal - 1);
  assert.deepEqual(lateNotes, []);
});

test("dancing in front of the stage counts at a concert", () => {
  const gate = new ShowGate();
  const f = fan(5000);
  const floor = spotsOf(paidShow.place, (s) => s.kind === "dance")[0];
  assert.ok(gate.admit("a", f, floor, gameTime(paidShow.startTotal + 30)).text);
  const before = f.fun;
  gate.tick("a", f, "dance", floor, gameTime(paidShow.startTotal + 31), STEP);
  assert.ok(f.fun > before);
  const play = allShows.find((s) => !s.dance && s.fee > 0)!;
  const quiet = spotsOf(play.place, (s) => s.kind === "dance")[0];
  assert.deepEqual(gate.admit("b", fan(5000), quiet, gameTime(play.startTotal + 30)), {});
});

test("a match charges once, calls goals in order, half time and full time", () => {
  const gate = new ShowGate();
  const f = fan(1000);
  const m: FootballMatch = scored;
  const paid = gate.admit("a", f, bench, gameTime(m.startTotal - MATCH_GATE_OPENS + 1));
  assert.match(paid.text ?? "", /kicks off/);
  assert.equal(f.cash, 1000 - m.fee);
  const notes = sitThrough(gate, "a", f, bench, m.startTotal - 5, m.endTotal + MATCH_AFTER - 1);
  assert.equal(f.cash, 1000 - m.fee);
  const goals = notes.filter((n) => /GOAL/.test(n));
  assert.equal(goals.length, m.goals.length);
  let home = 0;
  let away = 0;
  m.goals.forEach((g, i) => {
    if (g.side === 0) home++;
    else away++;
    assert.ok(goals[i].includes(`${m.home.name} ${home} to ${away} ${m.away.name}`), goals[i]);
  });
  assert.equal(notes.filter((n) => /Half time/.test(n)).length, 1);
  assert.equal(notes.filter((n) => /Full time/.test(n)).length, 1);
  assert.equal(notes.filter((n) => /start reach end/.test(n)).length, 1);
  assert.ok(notes.findIndex((n) => /Half time/.test(n)) < notes.findIndex((n) => /Full time/.test(n)));
  assert.ok(f.fun > 100 && f.energy < 80);
  const end = matchState(m, m.endTotal);
  assert.ok(notes.find((n) => /Full time/.test(n))!.includes(`${end.home} to ${end.away}`));
});

test("the viewing centre is a free TV room when no match is on", () => {
  const gate = new ShowGate();
  const f = fan(0);
  const quiet = gameTime(scored.dayIndex * MINUTES_PER_DAY + 4 * 60);
  assert.deepEqual(gate.admit("a", f, bench, quiet), {});
  assert.equal(gate.tick("a", f, "tv", bench, quiet, STEP), undefined);
  assert.ok(gate.admit("a", f, bench, gameTime(scored.startTotal + 3)).refuse);
  const late = fan(1000);
  const joined = gate.admit("late", late, bench, gameTime(scored.startTotal + 100));
  assert.match(joined.text ?? "", /minutes gone/);
  const notes = sitThrough(gate, "late", late, bench, scored.startTotal + 100, scored.startTotal + 103);
  assert.equal(notes.filter((n) => /GOAL/.test(n)).length, scored.goals.filter((g) => g.minute > 85 && g.minute <= 88).length);
});

test("shows and big matches are announced an hour before and at the start", () => {
  const soon = showAnnouncements(gameTime(paidShow.startTotal - 40));
  assert.ok(soon.some((a) => a.key === `show:soon:${paidShow.key}` && a.text.includes(paidShow.title) && a.text.includes("Gate")));
  assert.ok(showAnnouncements(gameTime(paidShow.startTotal + 1)).some((a) => a.key === `show:start:${paidShow.key}`));
  assert.ok(!showAnnouncements(gameTime(paidShow.startTotal + 30)).some((a) => a.key.endsWith(paidShow.key)));
  const big = allMatches.find((m) => m.tier !== "normal")!;
  const small = allMatches.find((m) => m.tier === "normal")!;
  assert.ok(showAnnouncements(gameTime(big.startTotal - 45)).some((a) => a.key === `match:soon:${big.key}`));
  assert.ok(showAnnouncements(gameTime(big.startTotal + 2)).some((a) => a.key === `match:start:${big.key}`));
  assert.ok(!showAnnouncements(gameTime(small.startTotal + 2)).some((a) => a.key.includes(small.key)));
  for (let total = 0; total < 7 * MINUTES_PER_DAY; total += 7) for (const a of showAnnouncements(gameTime(total))) assert.ok(!/[—–]/.test(a.text));
  assert.equal(VENUE_PLACE.amphi >= 0 && VENUE_PLACE.oduduwa >= 0, true);
});
