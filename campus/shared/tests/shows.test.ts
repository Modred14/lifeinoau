import assert from "node:assert/strict";
import { test } from "node:test";
import { EVENTS, MINUTES_PER_DAY, gameTime } from "../src/clock.ts";
import { PLACES } from "../src/map.ts";
import {
  HALF_MINUTES,
  MATCH_FEES,
  MATCH_MINUTES,
  RESERVED_SLOTS,
  SHOW_KINDS,
  VENUE_PLACE,
  VIEWING_PLACES,
  currentMatch,
  currentShows,
  matchState,
  matchesFor,
  nextShows,
  showBanners,
  showsFor,
  whatsOn,
  type ShowKind,
} from "../src/shows.ts";

const WEEKS = 6;
const days = Array.from({ length: WEEKS * 7 }, (_, d) => d);

test("the programme is the same every time it is asked for", () => {
  for (const d of days) {
    const again = JSON.stringify(showsFor(d));
    assert.equal(JSON.stringify(showsFor(d)), again);
    assert.deepEqual(matchesFor(d), matchesFor(d));
  }
  assert.notEqual(JSON.stringify(showsFor(1).map((s) => s.title + s.act)), JSON.stringify(showsFor(8).map((s) => s.title + s.act)) + "x");
});

test("both venues have shows every week and every show type appears", () => {
  const kinds = new Set<ShowKind>();
  for (let week = 0; week < WEEKS; week++) {
    const shows = days.slice(week * 7, week * 7 + 7).flatMap(showsFor);
    assert.ok(shows.filter((s) => s.venue === "amphi").length >= 5);
    assert.ok(shows.filter((s) => s.venue === "oduduwa").length >= 6);
    for (const s of shows) {
      kinds.add(s.kind);
      assert.equal(s.place, VENUE_PLACE[s.venue]);
      assert.ok(s.title && s.act && s.end > s.start && s.end <= MINUTES_PER_DAY && s.fee >= 0 && s.fun > 0);
      assert.ok(!/[—–]/.test(s.title + s.act));
      for (const m of s.moments) assert.ok(m.at > 0 && m.at < s.end - s.start && m.text.length > 5 && !m.text.includes("{"));
      for (let i = 1; i < s.moments.length; i++) assert.ok(s.moments[i].at >= s.moments[i - 1].at);
    }
    assert.ok(shows.some((s) => s.fee === 0) && shows.some((s) => s.fee > 0));
  }
  assert.deepEqual([...kinds].sort(), (Object.keys(SHOW_KINDS) as ShowKind[]).sort());
  assert.ok(showsFor(2).concat(showsFor(4), showsFor(5)).some((s) => s.kind === "concert" || s.kind === "comedy"));
  for (const d of days) for (const s of showsFor(d)) if (s.kind === "concert" || s.kind === "comedy") assert.match(s.moments[0].text, /DOBALE/);
});

test("no two shows overlap in one venue", () => {
  for (const d of days) {
    const shows = showsFor(d);
    for (const a of shows) for (const b of shows) if (a !== b && a.place === b.place) assert.ok(a.endTotal <= b.startTotal || b.endTotal <= a.startTotal, `${a.title} clashes with ${b.title}`);
  }
});

test("the reserved Thursday evening at the Amphi Theatre stays empty", () => {
  assert.ok(RESERVED_SLOTS.some((r) => r.venue === "amphi" && r.weekday === 3 && /press night/i.test(r.holder)));
  for (const d of days) {
    for (const r of RESERVED_SLOTS) {
      if (d % 7 !== r.weekday) continue;
      for (const s of showsFor(d)) if (s.venue === r.venue) assert.ok(s.end <= r.start || s.start >= r.end, `${s.title} is in the reserved slot`);
    }
  }
});

test("nothing runs against the SUB night party", () => {
  const party = EVENTS.find((e) => e.id === "party")!;
  const sub = PLACES.findIndex((p) => party.where.test(p.name));
  for (const d of days) {
    for (const s of showsFor(d)) {
      assert.notEqual(s.place, sub);
      if (party.weekdays.includes(d % 7)) assert.ok(s.end <= party.start, `${s.title} runs into the party`);
      if (party.weekdays.includes((d + 6) % 7)) assert.ok(s.start >= party.end - MINUTES_PER_DAY);
    }
  }
});

test("current and next shows follow the clock", () => {
  const first = showsFor(2)[0];
  assert.deepEqual(currentShows(gameTime(first.startTotal - 1)).filter((s) => s.key === first.key), []);
  assert.ok(currentShows(gameTime(first.startTotal)).some((s) => s.key === first.key));
  assert.ok(!currentShows(gameTime(first.endTotal)).some((s) => s.key === first.key));
  const next = nextShows(gameTime(3 * MINUTES_PER_DAY), 5);
  assert.equal(next.length, 5);
  for (let i = 1; i < next.length; i++) assert.ok(next[i].startTotal >= next[i - 1].startTotal);
  assert.ok(next[0].startTotal > 3 * MINUTES_PER_DAY);
});

test("match scores are stable and goals arrive in order", () => {
  let matches = 0;
  let big = 0;
  for (const d of days) {
    for (const m of matchesFor(d)) {
      matches++;
      if (m.tier !== "normal") big++;
      assert.notEqual(m.home.name, m.away.name);
      assert.equal(m.fee, MATCH_FEES[m.tier]);
      assert.equal(m.endTotal - m.startTotal, MATCH_MINUTES);
      for (let i = 1; i < m.goals.length; i++) assert.ok(m.goals[i].minute > m.goals[i - 1].minute);
      let last = 0;
      for (let total = m.startTotal - 5; total <= m.endTotal + 5; total++) {
        const s = matchState(m, total);
        assert.ok(s.home + s.away >= last && s.home + s.away - last <= 1, "score went backwards or jumped");
        last = s.home + s.away;
        assert.deepEqual(matchState(m, total), s);
      }
      const end = matchState(m, m.endTotal);
      assert.equal(end.phase, "full");
      assert.equal(end.home, m.goals.filter((g) => g.side === 0).length);
      assert.equal(end.away, m.goals.filter((g) => g.side === 1).length);
      assert.equal(matchState(m, m.startTotal + HALF_MINUTES).phase, "half");
      assert.equal(matchState(m, m.startTotal - 1).phase, "soon");
      assert.equal(currentMatch(gameTime(m.startTotal + 10))?.key, m.key);
    }
  }
  assert.ok(matches >= WEEKS * 7 && big >= WEEKS * 2);
  assert.ok(days.some((d) => matchesFor(d).some((m) => m.tier === "final")));
  assert.equal(currentMatch(gameTime(4 * 60)), undefined);
});

test("banners and the what's on list have items on a normal week", () => {
  assert.deepEqual(VIEWING_PLACES, PLACES.flatMap((place, index) => place.kind === "hostel" ? [index] : []));
  for (let d = 0; d < 7; d++) {
    const t = gameTime(d * MINUTES_PER_DAY + 9 * 60);
    const banners = showBanners(t);
    assert.ok(banners.length >= 2, `day ${d} has ${banners.length} banners`);
    assert.equal(new Set(banners.map((b) => b.id)).size, banners.length);
    for (const b of banners) {
      assert.ok(b.title && b.lines.length >= 2 && b.near !== undefined && PLACES[b.near] && b.weight >= 1);
      assert.ok(b.tone === "show" || b.tone === "sport");
      assert.ok(!/[—–]/.test(b.title + b.lines.join("") + (b.footer ?? "")));
    }
    const list = whatsOn(t, PLACES[61].door);
    assert.ok(list.length >= 3, `day ${d} has ${list.length} things on`);
    for (let i = 1; i < list.length; i++) assert.ok(list[i].startTotal >= list[i - 1].startTotal);
    for (const item of list) {
      assert.ok(item.endTotal > t.total && item.venue && Number.isFinite(item.door.x + item.door.y));
      assert.deepEqual(item.door, PLACES[item.place].door);
      if (item.type === "match") assert.equal(item.place, 61);
    }
  }
  const sat = showBanners(gameTime(5 * MINUTES_PER_DAY + 9 * 60));
  assert.ok(sat.some((b) => b.tone === "sport"));
  const live = showsFor(2)[0];
  assert.ok(whatsOn(gameTime(live.startTotal + 5)).find((i) => i.id === live.key)?.live);
});
