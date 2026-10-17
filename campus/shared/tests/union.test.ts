import assert from "node:assert/strict";
import { test } from "node:test";
import { BANNER_SPOTS, assignBanners, bannerFeed } from "../src/banners.ts";
import { MINUTES_PER_DAY, gameTime } from "../src/clock.ts";
import { STALLS, interiorAt } from "../src/interiors.ts";
import { PX_PER_METER, onRoad } from "../src/map.ts";
import { isBlocked } from "../src/movement.ts";
import {
  CAMPAIGN,
  CAMPAIGN_COLORS,
  CAMPAIGN_NICKS,
  CAMPAIGN_SLOGANS,
  CAMPAIGN_TRAIN,
  CONCESSIONS,
  CONGRESS,
  CONGRESS_SITE,
  DEBATE_SITE,
  ELECTION_TIMES,
  FORM_DESK,
  IMPEACH,
  MARCH,
  MOTIONS,
  PLACARDS,
  POLL_UNITS,
  RALLY_POINTS,
  RENTAL,
  RENTAL_AREAS,
  STATE_MINUTES,
  SUG_SCOPE,
  activeStates,
  ballotFor,
  campaignBanners,
  campaignGain,
  campusEffects,
  congressResult,
  congressSide,
  congressStand,
  congressesFor,
  findPost,
  identityOf,
  marchAt,
  marchBlockers,
  marchPlan,
  marchRoute,
  marchSecondsNeeded,
  marchTurnout,
  npcCandidates,
  npcHouse,
  npcSignatures,
  parseLook,
  parsePoliticsAction,
  parseUnionWorld,
  petitionFee,
  raceKey,
  rentRefusal,
  rentedBanners,
  rerunEntries,
  resultsDeclared,
  routePoint,
  settlesAt,
  showRentedBanners,
  signatureTotal,
  sittingDue,
  sittingPhase,
  srcSitting,
  stateAfterMarch,
  stateFromCongress,
  tallyRace,
  trainBonus,
  unitReturns,
  voteClosesAt,
  voteOpensAt,
  votesToRemove,
  type BallotEntry,
  type CongressSitting,
  type RentedSpot,
} from "../src/politics.ts";

const M = PX_PER_METER;
const at = (week: number, weekday: number, hour: number, minute = 0) => gameTime((week * 7 + weekday) * MINUTES_PER_DAY + hour * 60 + minute);
const president = findPost("sug-president")!;
const race = raceKey(president, SUG_SCOPE);
const noDash = (text: string) => assert.ok(!/[–—]/.test(text), text);

test("campaign identity comes only from the curated lists", () => {
  assert.deepEqual(parseLook(undefined, undefined, undefined), { nick: 0, slogan: 0, color: 0 });
  assert.deepEqual(parseLook(3, 2, 1), { nick: 3, slogan: 2, color: 1 });
  for (const bad of [[-1, 0, 0], [0, CAMPAIGN_SLOGANS.length, 0], [0, 0, CAMPAIGN_COLORS.length], [1.5, 0, 0], ["Free text", 0, 0], [0, 0, undefined], [CAMPAIGN_NICKS.length, 0, 0]]) assert.equal(parseLook(bad[0], bad[1], bad[2]), null);
  assert.equal(parsePoliticsAction({ a: "form", post: "sug-president", nick: "My own name", slogan: 0, color: 0 }), null);
  assert.deepEqual(parsePoliticsAction({ a: "form", post: "sug-president", nick: 2, slogan: 1, color: 4 }), { a: "form", post: "sug-president", look: { nick: 2, slogan: 1, color: 4 } });
  assert.deepEqual(parsePoliticsAction({ a: "form", post: "sug-president" }), { a: "form", post: "sug-president", look: { nick: 0, slogan: 0, color: 0 } });
  for (const text of [...CAMPAIGN_NICKS, ...CAMPAIGN_SLOGANS, ...CAMPAIGN_COLORS.map((c) => c.name)]) noDash(text);
  assert.equal(new Set(CAMPAIGN_NICKS).size, CAMPAIGN_NICKS.length);
  const ballot = ballotFor(4, president, SUG_SCOPE, [{ id: "abc", race, name: "@tola", effort: 90, look: { nick: 5, slogan: 3, color: 2 } }]);
  assert.deepEqual([ballot.at(-1)?.nick, ballot.at(-1)?.slogan, ballot.at(-1)?.color], [CAMPAIGN_NICKS[5], CAMPAIGN_SLOGANS[3], CAMPAIGN_COLORS[2].value]);
  assert.equal(identityOf({ nick: 999, slogan: -4, color: 1.2 }).nick, CAMPAIGN_NICKS[0]);
});

test("seeded candidates use fixed invented names", () => {
  const names = new Set<string>();
  for (let cycle = 0; cycle < 12; cycle++) for (const c of npcCandidates(cycle, president, SUG_SCOPE)) names.add(c.name);
  for (const name of names) assert.ok(name.split(" ").length === 2 && name.split(" ")[1].length >= 9, name);
  for (let cycle = 0; cycle < 40; cycle++) assert.ok(npcCandidates(cycle, president, SUG_SCOPE).every((c) => c.nick !== "Comrade Zuma" && c.faculty));
});

test("banner rental limits: unknown area, twice, per camp and full", () => {
  const area = RENTAL_AREAS[1].id;
  assert.equal(rentRefusal("moon", [], 0), "area");
  assert.equal(rentRefusal(area, [area], 1), "twice");
  assert.equal(rentRefusal(area, RENTAL_AREAS.slice(2, 2 + RENTAL.perCandidate).map((a) => a.id), 0), "limit");
  assert.equal(rentRefusal(area, [], RENTAL.perArea), "full");
  assert.equal(rentRefusal(area, [], RENTAL.perArea - 1), null);
  for (const a of RENTAL_AREAS) assert.ok(a.price > 0 && BANNER_SPOTS.some((s) => s.place === a.place), a.name);
});

test("rented banners carry the camp identity, hang near their area and join the feed only in campaign days", () => {
  const spots: RentedSpot[] = [{ area: "awo", slot: 0, candidacy: "abc", name: "@tola", race, look: { nick: 2, slogan: 1, color: 3 } }];
  const [art] = rentedBanners(6, spots);
  assert.equal(art.near, RENTAL_AREAS.find((a) => a.id === "awo")!.place);
  assert.equal(art.title, `Vote "${CAMPAIGN_NICKS[2]}"`);
  assert.equal(art.color, CAMPAIGN_COLORS[3].value);
  assert.deepEqual(rentedBanners(6, [{ ...spots[0], area: "nowhere" }]), []);
  showRentedBanners(6, spots);
  const day = at(6, 2, 10);
  assert.ok(bannerFeed(day).some((a) => a.id === art.id));
  const hung = assignBanners(BANNER_SPOTS, bannerFeed(day), day);
  assert.ok(BANNER_SPOTS.some((s, i) => s.place === art.near && hung[i].some((a) => a.id === art.id)));
  assert.ok(!bannerFeed(at(6, 5, 10)).some((a) => a.id === art.id));
  assert.ok(!bannerFeed(at(7, 2, 10)).some((a) => a.id === art.id));
  showRentedBanners(-1, []);
  assert.ok(!bannerFeed(day).some((a) => a.id === art.id));
});

test("faculty posters prefer their own faculty and winners stay hidden until the declaration", () => {
  const art = campaignBanners(at(6, 2, 10));
  const faculty = art.filter((a) => a.near !== undefined);
  assert.ok(faculty.length >= 6);
  for (const a of faculty) assert.ok(POLL_UNITS.some((u) => u.place === a.near));
  assert.ok(art.some((a) => a.near === undefined && a.tone === "campaign"));
  assert.ok(!campaignBanners(at(6, 4, 18, 5)).some((a) => /CONGRATULATIONS/.test(a.title)));
  assert.equal(resultsDeclared(at(6, 4, 18, 5)), false);
  assert.ok(campaignBanners(gameTime(6 * 7 * MINUTES_PER_DAY + ELECTION_TIMES.declaration)).some((a) => /CONGRATULATIONS/.test(a.title)));
});

test("unit returns come in order before the declaration and add up to the final tally", () => {
  for (const cycle of [3, 8, 21]) {
    const field = npcCandidates(cycle, president, SUG_SCOPE);
    const entries: BallotEntry[] = [...field.map((c) => ({ id: c.id, name: c.name, npc: true, base: c.base, endorsements: 0, votes: 0, informed: 0, disqualified: c.disqualified })), { id: "me", name: "@tola", npc: false, base: 233, endorsements: 2, votes: 7, informed: 3 }];
    const result = tallyRace(cycle, race, president, entries);
    const units = unitReturns(cycle, result);
    assert.equal(units.length, POLL_UNITS.length);
    assert.deepEqual(unitReturns(cycle, result), units);
    for (let i = 1; i < units.length; i++) assert.ok(units[i].at > units[i - 1].at);
    assert.ok(units[0].at > ELECTION_TIMES.results && units.at(-1)!.at < ELECTION_TIMES.declaration);
    for (const row of result.rows) {
      assert.equal(units.reduce((sum, u) => sum + (u.rows.find((r) => r.id === row.id)?.votes ?? 0), 0), row.total);
      assert.ok(units.every((u) => (u.rows.find((r) => r.id === row.id)?.votes ?? -1) >= 0));
    }
  }
  const dept = findPost("dept-president")!;
  const single = unitReturns(4, tallyRace(4, raceKey(dept, "law"), dept, [{ id: "a", name: "A", npc: true, base: 40, endorsements: 0, votes: 0, informed: 0 }, { id: "b", name: "B", npc: true, base: 31, endorsements: 0, votes: 0, informed: 0 }]));
  assert.equal(single.length, 1);
  assert.deepEqual(single[0].rows.map((r) => r.votes).sort((a, b) => b - a), [40, 31]);
});

test("a re-run only moves the seeded candidates and a petition costs half the form", () => {
  const entries: BallotEntry[] = [{ id: "n0", name: "N", npc: true, base: 400, endorsements: 0, votes: 0, informed: 0 }, { id: "me", name: "@tola", npc: false, base: 233, endorsements: 0, votes: 4, informed: 0 }];
  const again = rerunEntries(5, race, entries);
  assert.deepEqual(again[1], entries[1]);
  assert.ok(again[0].base >= 300 && again[0].base <= 460);
  assert.deepEqual(rerunEntries(5, race, entries), again);
  assert.equal(petitionFee(president), president.fee / 2);
});

const sitting = (id: string, motion = "light-water"): CongressSitting => ({ id, start: 50_000, motion, called: false });

test("congress sits once or twice a week on seeded evenings with a real motion", () => {
  const counts = new Set<number>();
  for (let cycle = 0; cycle < 30; cycle++) {
    const list = congressesFor(cycle);
    counts.add(list.length);
    assert.deepEqual(congressesFor(cycle), list);
    assert.equal(new Set(list.map((s) => s.motion)).size, list.length);
    for (const s of list) {
      const t = gameTime(s.start);
      assert.equal(Math.floor(t.dayIndex / 7), cycle);
      assert.equal(t.hour, CONGRESS.hour);
      assert.ok(CONGRESS.days.includes(t.weekday) && MOTIONS.some((m) => m.id === s.motion));
    }
  }
  assert.deepEqual([...counts].sort(), [1, 2]);
  for (const m of MOTIONS) noDash(`${m.issue} ${m.question}`);
});

test("congress phases, sides of the ground and the vote maths", () => {
  const s = sitting("s:9:0");
  assert.deepEqual([s.start - 1, s.start, voteOpensAt(s), voteClosesAt(s), settlesAt(s)].map((m) => sittingPhase(s, m)), ["before", "gather", "vote", "count", "done"]);
  const aye = congressStand("aye");
  const nay = congressStand("nay");
  assert.equal(congressSide(aye), "aye");
  assert.equal(congressSide(nay), "nay");
  assert.equal(congressSide(CONGRESS_SITE), null);
  assert.equal(congressSide({ x: aye.x + CONGRESS.reach * 3, y: aye.y }), null);
  for (const p of [aye, nay]) assert.ok(!isBlocked(p.x, p.y) && !interiorAt(p.x, p.y));
  const house = npcHouse(s);
  assert.ok(house.aye + house.nay >= CONGRESS.npc[0] && house.aye + house.nay <= CONGRESS.npc[1]);
  const quiet = congressResult(s, { aye: 0, nay: 0 });
  assert.deepEqual([quiet.aye, quiet.nay], [house.aye, house.nay]);
  const swing = Math.ceil((Math.abs(house.aye - house.nay) + 1) / CONGRESS.playerWeight);
  const carried = congressResult(s, { aye: swing, nay: 0 });
  const lost = congressResult(s, { aye: 0, nay: swing });
  assert.deepEqual([carried.carried, carried.outcome], [true, "protest"]);
  assert.deepEqual([lost.carried, lost.outcome], [false, "dialogue"]);
  assert.equal(carried.aye, house.aye + swing * CONGRESS.playerWeight);
  const tie = congressResult(s, { aye: 0, nay: 0 });
  assert.equal(tie.carried, tie.aye > tie.nay);
});

test("congress outcomes become campus states that expire", () => {
  const boycott = stateFromCongress(sitting("s:9:1", "fees"), { aye: 9, nay: 1, carried: true, outcome: "boycott" });
  assert.equal(boycott.until - boycott.from, STATE_MINUTES.boycott);
  assert.equal(boycott.from, settlesAt(sitting("s:9:1")));
  const talk = stateFromCongress(sitting("s:9:1", "fees"), { aye: 1, nay: 9, carried: false, outcome: "dialogue" });
  assert.equal(talk.until - talk.from, STATE_MINUTES.dialogue);
  assert.deepEqual(campusEffects([boycott], boycott.from), { boycott: true, protest: false, fareFactor: 1, extraLightHours: 0, reliefPacks: 0, relief: "" });
  assert.equal(campusEffects([boycott], boycott.until - 1).boycott, true);
  assert.equal(campusEffects([boycott], boycott.until).boycott, false);
  assert.equal(campusEffects([boycott], boycott.from - 1).boycott, false);
  assert.equal(campusEffects([talk], talk.from + 5).boycott, false);
  assert.deepEqual(activeStates([boycott, talk], boycott.until), []);
  const protest = stateFromCongress(sitting("s:9:2"), { aye: 9, nay: 1, carried: true, outcome: "protest" });
  assert.equal(protest.until, marchPlan(protest).end);
  assert.equal(campusEffects([protest], protest.from).protest, true);
  assert.deepEqual(parseUnionWorld({ cycle: 3, rentals: [{ area: "awo" }], states: [boycott, { id: 1 }], called: null }), { cycle: 3, rentals: [], states: [boycott], called: null });
});

test("the march walks real roads from Anglo-Moz through the SUB to the gate", () => {
  const route = marchRoute();
  assert.ok(route.length > 500 * M && route.subAt > 100 * M && route.subAt < route.length);
  const start = routePoint(0);
  const sub = routePoint(route.subAt);
  assert.ok(Math.hypot(start.x - RALLY_POINTS.at(-1)!.x, start.y - RALLY_POINTS.at(-1)!.y) < 60 * M);
  assert.ok(Math.hypot(sub.x - FORM_DESK.x, sub.y - FORM_DESK.y) < 60 * M);
  let off = 0;
  let samples = 0;
  for (let d = 0; d <= route.length; d += 5 * M) {
    const p = routePoint(d);
    samples++;
    if (!onRoad(p.x, p.y, 3 * M)) off++;
    assert.ok(!interiorAt(p.x, p.y));
  }
  assert.equal(off, 0, `${off} of ${samples} route samples are away from a road`);
});

test("the march timetable is deterministic and moves at walking pace", () => {
  const state = { id: "c:s:9:0", issue: "light and water in the hostels", from: 9 * 7 * MINUTES_PER_DAY + 19 * 60 + 47 };
  const plan = marchPlan(state);
  assert.deepEqual(marchPlan(state), plan);
  const forms = gameTime(plan.forms);
  assert.equal(forms.dayIndex, gameTime(state.from).dayIndex + 1);
  assert.ok(MARCH.hours.includes(forms.hour) && forms.minute % 60 === 0);
  assert.ok(plan.forms < plan.start && plan.start < plan.reachSub && plan.reachSub < plan.leaveSub && plan.leaveSub < plan.end);
  assert.deepEqual([plan.forms - 1, plan.forms, plan.start, plan.reachSub, plan.leaveSub, plan.end].map((m) => marchAt(plan, m).phase), ["before", "forming", "walking", "holding", "walking", "done"]);
  const a = marchAt(plan, plan.start + 10);
  const b = marchAt(plan, plan.start + 11);
  const step = Math.hypot(b.x - a.x, b.y - a.y) / M;
  assert.ok(step > 2 && step < 12, `${step} m a game minute`);
  assert.deepEqual(marchAt(plan, plan.start + 10), a);
  assert.equal(marchBlockers(plan, plan.forms + 1).length, 0);
  assert.ok(marchBlockers(plan, plan.start + 10).every((p) => onRoad(p.x, p.y, 3 * M)));
  assert.ok(marchSecondsNeeded(plan) > 30 && marchSecondsNeeded(plan) < 600);
  for (const text of PLACARDS) {
    noDash(text);
    assert.ok(!/fight|burn|kill|stone|war/i.test(text));
  }
});

test("turnout decides whether management agrees", () => {
  const plan = marchPlan({ id: "c:s:9:0", issue: "the bus fare increase", from: 100_000 });
  const alone = marchTurnout(plan.id, 0);
  assert.ok(alone.npc >= MARCH.npc[0] && alone.npc <= MARCH.npc[1]);
  assert.equal(alone.agreed, alone.npc >= MARCH.need);
  const need = Math.max(0, Math.ceil((MARCH.need - alone.npc) / MARCH.playerWeight));
  assert.equal(marchTurnout(plan.id, need).agreed, true);
  if (need > 0) assert.equal(marchTurnout(plan.id, need - 1).agreed, false);
  const big = marchTurnout(plan.id, 20);
  assert.equal(big.total, big.npc + 20 * MARCH.playerWeight);
  const won = stateAfterMarch(plan, big);
  assert.equal(won.kind, "concession");
  assert.ok(CONCESSIONS.some((c) => c.id === won.concession));
  assert.equal(won.from, plan.end);
  assert.equal(won.until - won.from, STATE_MINUTES.concession);
  const effects = campusEffects([won], won.from + 1);
  assert.ok(effects.fareFactor < 1 || effects.extraLightHours > 0 || effects.reliefPacks > 0);
  assert.deepEqual(campusEffects([won], won.until), { boycott: false, protest: false, fareFactor: 1, extraLightHours: 0, reliefPacks: 0, relief: "" });
  const lost = stateAfterMarch(plan, { npc: 100, real: 0, total: 100, agreed: false });
  assert.deepEqual([lost.kind, lost.concession], ["standoff", ""]);
  const outcomes = new Set(Array.from({ length: 40 }, (_v, k) => marchTurnout(`c:s:${k}:0`, 0).agreed));
  assert.equal(outcomes.size, 2);
});

test("impeachment needs enough signatures and a two thirds SRC vote", () => {
  const worked = { usedPower: true, turnoutFell: false, minutesInOffice: 3 * MINUTES_PER_DAY };
  const idle = { usedPower: false, turnoutFell: true, minutesInOffice: 3 * MINUTES_PER_DAY };
  const fresh = { usedPower: false, turnoutFell: false, minutesInOffice: 60 };
  const base = npcSignatures(7, race, worked);
  assert.ok(base >= IMPEACH.npc[0] && base <= IMPEACH.npc[1]);
  assert.equal(npcSignatures(7, race, fresh), base);
  assert.equal(npcSignatures(7, race, idle), base + IMPEACH.idleBoost + IMPEACH.turnoutBoost);
  assert.equal(signatureTotal(7, race, worked, 3), base + 3 * IMPEACH.playerWeight);
  assert.equal(sittingDue(IMPEACH.threshold - 1), false);
  assert.equal(sittingDue(IMPEACH.threshold), true);
  assert.equal(sittingDue(signatureTotal(7, race, worked, 0)), false);
  assert.equal(votesToRemove(), 21);
  let removedIdle = 0;
  let removedWorked = 0;
  for (let term = 0; term < 60; term++) {
    const bad = srcSitting(term, race, idle);
    const good = srcSitting(term, race, worked);
    assert.equal(bad.remove + bad.keep, IMPEACH.house);
    assert.equal(bad.removed, bad.remove >= votesToRemove());
    assert.ok(bad.remove >= good.remove);
    assert.deepEqual(srcSitting(term, race, idle), bad);
    removedIdle += Number(bad.removed);
    removedWorked += Number(good.removed);
  }
  assert.ok(removedIdle > 40, `${removedIdle}`);
  assert.equal(removedWorked, 0);
});

test("campaign stops fade in one hall on one day and the train bonus is capped", () => {
  const gains = [0, 1, 2, 3, 4, 5].map((stops) => campaignGain("sug", 0, false, stops));
  assert.equal(gains[0], CAMPAIGN.gain);
  for (let i = 1; i < gains.length; i++) assert.ok(gains[i] <= gains[i - 1] && gains[i] >= CAMPAIGN.minGain);
  assert.ok(gains[2] < gains[0] / 2);
  assert.equal(campaignGain("sug", 0, true, 1), Math.round(CAMPAIGN.gain * CAMPAIGN.rallyFactor * CAMPAIGN.fade));
  assert.equal(campaignGain("sug", CAMPAIGN.hallCap, false, 0), 0);
  assert.equal(trainBonus("sug", 0), CAMPAIGN_TRAIN.bonus);
  assert.equal(trainBonus("sug", CAMPAIGN_TRAIN.cap - 3), 3);
  assert.equal(trainBonus("sug", CAMPAIGN_TRAIN.cap), 0);
  assert.ok(trainBonus("dept", 0) < trainBonus("sug", 0));
});

test("election sites keep clear of stalls and banners keep clear of them", () => {
  const sites = [...POLL_UNITS, ...RALLY_POINTS, FORM_DESK, DEBATE_SITE];
  for (const site of sites) {
    for (const stall of STALLS) assert.ok(Math.hypot(stall.x - site.x, stall.y - site.y) >= 6 * M, `${site.name} sits on a stall`);
    for (const spot of BANNER_SPOTS) if (spot.kind !== "cross") assert.ok(Math.hypot(spot.x - site.x, spot.y - site.y) >= 4 * M, `${site.name} is ${(Math.hypot(spot.x - site.x, spot.y - site.y) / M).toFixed(1)} m from a ${spot.kind}`);
  }
});
