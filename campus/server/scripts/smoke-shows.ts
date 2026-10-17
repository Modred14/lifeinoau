/**
 * Shows, viewing centres, sport and night food against a private server.
 *
 *   npx tsx scripts/smoke-shows.ts   (from server/)
 *
 * Needs: an evening with a paid Amphi Theatre show, a football kick-off with an
 * early goal, a league fixture on a campus pitch, and the same day after 22:00.
 * Each moment is picked from the shared schedules.
 */
import { Client } from "@colyseus/sdk";
import {
  ACTS,
  AMPHI_SEAT_LABEL,
  MATCH_FEES,
  Msg,
  PLACES,
  PX_PER_METER,
  SOCIAL_SITES,
  SPECIAL_TRADES,
  SPOTS,
  STALLS,
  ServerMsg,
  TOUCHLINE_LABEL,
  VENUE_PLACE,
  VIEWING_PLACES,
  VIEWING_SEAT_LABEL,
  allShowsFor,
  gameTime,
  matchState,
  matchesFor,
  outageAt,
  outagesOn,
  powerZoneOfPlace,
  parseSocialStatus,
  pitchMatchesFor,
  placeLight,
  screenLit,
  stallHours,
  viewingArea,
  type FootballMatch,
  type PitchMatch,
  type Point,
  type Show,
} from "@campuslife/shared";
import { smokeAccount } from "./smoke-account";
import { SMOKE_URL, dayTotal, gameMinutesToMs, sleep, startServer, stopServer } from "./smoke-clock";
import { Actor, OAU, SAVE_SETTLE_MS, check, interiorOf, note, outside, patchSave, run, seedSave, until } from "./smoke-kit";

const FAN = "smoke_show_fan";
const BROKE = "smoke_show_broke";
const NIGHT = "smoke_show_night";
const TRADER = "smoke_show_buyer";
const FIRST_DAY = 1610;
const SEARCH_DAYS = 120;
const CASH = 5000;
const NIGHT_MINUTE = 22 * 60 + 10;
const EARLY_GOAL = 6;
const M = PX_PER_METER;
const profile = { school: OAU, level: "200L", department: "computer-science" };
const EAT = ACTS.indexOf("eat");
const TV = ACTS.indexOf("tv");
const SIT = ACTS.indexOf("sit");

function search<T>(pick: (day: number) => T | undefined): T {
  for (let day = FIRST_DAY; day < FIRST_DAY + SEARCH_DAYS; day++) {
    const found = pick(day);
    if (found) return found;
  }
  throw new Error("nothing matches in the search window");
}

const litAround = (place: number, from: number, to: number) => [from, Math.round((from + to) / 2), to].every((t) => placeLight(place, t).lit);

function seatsIn(place: number, label: string): number[] {
  const it = interiorOf(place);
  return Array.from({ length: it.spotEnd - it.spotStart }, (_, k) => it.spotStart + k)
    .filter((i) => SPOTS[i].label === label)
    .sort((p, q) => Math.hypot(SPOTS[p].sx - it.entry.x, SPOTS[p].sy - it.entry.y) - Math.hypot(SPOTS[q].sx - it.entry.x, SPOTS[q].sy - it.entry.y));
}

async function goTo(actor: Actor, seats: number[], skip = 0): Promise<number> {
  for (const seat of seats.slice(skip, skip + 6)) if (await actor.reach(seat)) return seat;
  return -1;
}

const social = (actor: Actor, action: Record<string, unknown>) => actor.ask(Msg.Social, action, ServerMsg.Social, 3000).then(parseSocialStatus);

await run("smoke-shows", async () => {
  const client = new Client(SMOKE_URL);
  const amphi = VENUE_PLACE.amphi;
  const show: Show = search((day) => {
    const all = allShowsFor(day).filter((s) => s.place === amphi);
    return all.find((s) => s.fee > 0 && !s.special && litAround(amphi, s.startTotal - 10, s.startTotal + 30) && !all.some((o) => o !== s && o.endTotal > s.startTotal - 30 && o.startTotal < s.endTotal));
  });
  const match: FootballMatch = search((day) => matchesFor(day).find((m, i, all) => m.tier === "normal" && m.goals[0]?.minute <= EARLY_GOAL && (i === 0 || all[i - 1].endTotal + 20 < m.startTotal - 40)));
  const pitch: PitchMatch = search((day) => pitchMatchesFor(day).find((m) => m.goals.some((g) => g.minute >= 8 && g.minute <= 40) && m.kickoff < 20 * 60));
  const hostel = VIEWING_PLACES.find((p) => [match.startTotal - 12, match.startTotal, match.startTotal + 12, match.endTotal + 2].every((t) => screenLit(p, t)));
  if (hostel === undefined) throw new Error("every hall is dark around that match");
  note(`show: ${show.title}, ₦${show.fee}, day ${show.dayIndex}. match: ${match.home.name} v ${match.away.name}, day ${match.dayIndex} at ${PLACES[hostel].name}. pitch: ${pitch.home.name} v ${pitch.away.name} on ${pitch.ground}, day ${pitch.dayIndex}`);

  // ---- 1) Amphi Theatre: seated early is free, the gate fee is taken once, no cash no entry.
  let url = await startServer(show.startTotal - 8);
  for (const name of [FAN, BROKE, NIGHT, TRADER]) await smokeAccount(url, name);
  await seedSave(FAN, { cash: CASH, at: outside(amphi) });
  await seedSave(BROKE, { cash: show.fee - 1, at: outside(amphi) });
  let fan = await Actor.join(client, url, FAN, profile);
  let broke = await Actor.join(client, url, BROKE, profile);
  check((await fan.enter(amphi)) && (await broke.enter(amphi)), "both students entered the Amphi Theatre");
  const steps = seatsIn(amphi, AMPHI_SEAT_LABEL);
  const seat = await goTo(fan, steps);
  const brokeSeat = await goTo(broke, steps, 8);
  check(seat >= 0 && brokeSeat >= 0, "both reached an amphitheatre step");
  let from = fan.mark;
  await fan.use(seat);
  const before = gameTime(fan.clock).total < show.startTotal;
  check(before && fan.me.act === SIT && fan.me.cash === CASH, `seated ${show.startTotal - fan.clock} minutes before the show and not charged (cash ${fan.me.cash})`);
  check(await fan.waitNotice(/don start\. Gate fee na ₦[\d,]+\. Sit again to pay\./, gameMinutesToMs(show.startTotal - fan.clock + 3), from), "at the start the early sitter is told to pay");
  await sleep(300);
  check(fan.me.act === 0 && fan.me.cash === CASH, `and is stood up, still not charged (act ${ACTS[fan.me.act]}, cash ${fan.me.cash})`);
  from = fan.mark;
  await fan.use(seat);
  check(fan.me.act === SIT && fan.me.cash === CASH - show.fee && fan.said(/gate fee paid/, from) !== undefined, `sitting again pays the ₦${show.fee} gate fee (cash ${fan.me.cash})`);
  await fan.stand();
  await fan.use(seat);
  check(fan.me.act === SIT && fan.me.cash === CASH - show.fee, "standing up and sitting again is not charged twice");
  from = broke.mark;
  await broke.use(brokeSeat);
  check(broke.me.act === 0 && broke.me.cash === show.fee - 1 && broke.said(/Your cash no reach/, from) !== undefined, `₦${show.fee - 1} in the pocket: refused, not seated, not charged`);
  const fun0 = fan.me.fun;
  await sleep(8000);
  check(fan.me.fun > fun0, `watching the show is fun (${fun0} to ${fan.me.fun})`);
  await fan.leave();
  await broke.leave();
  await sleep(SAVE_SETTLE_MS);
  fan = await Actor.join(client, url, FAN, profile);
  await fan.reach(seat);
  await fan.use(seat);
  check(fan.me.act === SIT && fan.me.cash === CASH - show.fee, "the ticket survives leave and rejoin: no second charge");
  await fan.leave();
  await stopServer();

  // ---- 2) Viewing centre: predict card, gate fee, kick-off, an early goal.
  const final = matchState(match, match.endTotal);
  const mine = match.goals[0].side === 0 ? match.home : match.away;
  await seedSave(FAN, { cash: CASH, at: outside(hostel) });
  await seedSave(BROKE, { cash: MATCH_FEES.normal - 10, at: outside(hostel) });
  url = await startServer(match.startTotal - 9);
  fan = await Actor.join(client, url, FAN, profile);
  broke = await Actor.join(client, url, BROKE, profile);
  check((await fan.enter(hostel)) && (await broke.enter(hostel)), `entered ${PLACES[hostel].name}`);
  from = fan.mark;
  await social(fan, { a: "predict", home: final.home, away: final.away });
  check(fan.said(/fixtures board/, from) !== undefined, "a card away from the fixtures board is refused");
  const it = interiorOf(hostel);
  const area = viewingArea(it.template.w);
  const board: Point = { x: it.ox + (area.boardX - 0.4) * M, y: it.oy + 2.4 * M };
  check(await fan.walkTo(board), `walked to the fixtures board (${Math.round((fan.me.x - it.ox) / M)}, ${Math.round((fan.me.y - it.oy) / M)} m in the room)`);
  from = fan.mark;
  let status = await social(fan, { a: "predict", home: final.home, away: final.away });
  check(status?.predict?.key === match.key && fan.said(/Card submitted/, from) !== undefined, `card in at the board: "${fan.said(/Card/, from) ?? fan.notices(from)[0] ?? ""}"`);
  from = fan.mark;
  status = await social(fan, { a: "predict", home: 9, away: 9 });
  check(status?.predict?.home === final.home && fan.said(/one card wey never settle/, from) !== undefined, "a second card is refused while one is open");
  from = fan.mark;
  status = await social(fan, { a: "club", code: mine.code });
  check(status?.club === mine.code && fan.said(/fan now/, from) !== undefined, `picked ${mine.name} as club`);
  from = fan.mark;
  status = await social(fan, { a: "club", code: "KAN" });
  check(status?.club === mine.code && fan.said(/Fan na for life/, from) !== undefined, "the club cannot be changed");
  const benches = seatsIn(hostel, VIEWING_SEAT_LABEL);
  const bench = await goTo(fan, benches);
  const brokeBench = await goTo(broke, benches, 8);
  check(bench >= 0 && brokeBench >= 0, "both reached a viewing centre bench");
  from = fan.mark;
  await fan.use(bench);
  check(fan.me.act === TV && fan.me.cash === CASH - match.fee && fan.said(/gate fee paid/, from) !== undefined, `viewing centre gate fee ₦${match.fee} paid on sitting (cash ${fan.me.cash})`);
  await fan.stand();
  await fan.use(bench);
  check(fan.me.act === TV && fan.me.cash === CASH - match.fee, "the match gate fee is charged once");
  from = broke.mark;
  await broke.use(brokeBench);
  check(broke.me.act === 0 && broke.me.cash === MATCH_FEES.normal - 10 && broke.said(/No credit/, from) !== undefined, "no cash, no seat at the viewing centre");
  from = fan.mark;
  const goalBy = gameMinutesToMs(match.startTotal + match.goals[0].minute - fan.clock + 4);
  check(await fan.waitNotice(/GOAL! /, goalBy, from), `the goal in minute ${match.goals[0].minute} reaches the room: "${fan.said(/GOAL/, from) ?? ""}"`);
  check(fan.said(new RegExp(`${mine.name} don score`), from) !== undefined, "the club fan gets the club line too");
  await fan.leave();
  await broke.leave();
  await stopServer();

  url = await startServer(match.endTotal + 1);
  fan = await Actor.join(client, url, FAN, profile);
  check(await fan.waitNotice(/Correct score!/, 8000), `after full time the exact card pays: "${fan.said(/Correct score|call the result|card cut/) ?? ""}"`);
  await sleep(400);
  status = await social(fan, { a: "status" });
  check(fan.me.cash === CASH - match.fee + 500 && status?.wins === 1 && status.predict === undefined, `₦500 prize paid once (cash ${fan.me.cash}, wins ${status?.wins})`);
  await sleep(3000);
  check(fan.me.cash === CASH - match.fee + 500, "the prize is not paid again on later ticks");
  await fan.leave();
  await stopServer();

  // ---- 3) Daytime: touchline bench during a fixture, Risky shut, ordinary stall open.
  const risky = STALLS[SOCIAL_SITES.stalls.risky ?? -1];
  const ordinary = STALLS.find((s, i) => !s.roadside && stallHours(i).special === undefined);
  if (!risky || !ordinary) throw new Error("stalls missing from the map");
  const riskyStand: Point = { x: SPOTS[risky.spot].sx, y: SPOTS[risky.spot].sy };
  const stallStand: Point = { x: SPOTS[ordinary.spot].sx, y: SPOTS[ordinary.spot].sy };
  const benchSpot = SOCIAL_SITES.touchline[pitch.ground][0];
  const price = SPOTS[ordinary.spot].price ?? 0;
  await seedSave(FAN, { cash: CASH, at: SOCIAL_SITES.benches[pitch.ground] });
  await seedSave(NIGHT, { cash: CASH, at: riskyStand });
  await seedSave(TRADER, { cash: CASH, at: stallStand });
  const goal = pitch.goals.find((g) => g.minute >= 8 && g.minute <= 40)!;
  const goalElapsed = goal.minute <= 45 ? goal.minute : goal.minute + 15;
  url = await startServer(pitch.startTotal + goalElapsed - 5);
  fan = await Actor.join(client, url, FAN, profile);
  let night = await Actor.join(client, url, NIGHT, profile);
  let trader = await Actor.join(client, url, TRADER, profile);
  check(SPOTS[benchSpot].label === TOUCHLINE_LABEL && (await fan.reach(benchSpot)), "reached a touchline bench");
  from = fan.mark;
  await fan.use(benchSpot);
  check(fan.me.act === TV && fan.me.cash === CASH && fan.said(/Free at the touchline/, from) !== undefined, `watching ${pitch.competition} from the touchline is free: "${fan.said(/touchline/, from) ?? ""}"`);
  check(await fan.waitNotice(/GOAL! /, gameMinutesToMs(9), from), `a goal on the pitch is called at the touchline: "${fan.said(/GOAL/, from) ?? ""}"`);
  from = night.mark;
  await night.use(risky.spot);
  await night.waitNotice(/Risky never open/, 20_000, from);
  check(night.me.act !== EAT && night.me.cash === CASH && night.said(/Risky never open/, from) !== undefined, `Risky refuses by day: "${night.said(/Risky/, from) ?? ""}"`);
  from = trader.mark;
  await trader.use(ordinary.spot);
  check(await until(() => trader.me.act === EAT, 20_000), `an ordinary stall sells by day (${ordinary.name})`);
  check(trader.me.cash === CASH - price, `and charges ₦${price} once (cash ${trader.me.cash})`);
  await sleep(6500);
  for (const actor of [fan, night, trader]) await actor.leave();
  await stopServer();

  // ---- 4) After 22:00 the same day: Risky sells, ordinary stalls are shut, the pitch is empty.
  await patchSave(TRADER, { cash: CASH, at: stallStand });
  url = await startServer(dayTotal(pitch.dayIndex, NIGHT_MINUTE));
  fan = await Actor.join(client, url, FAN, profile);
  night = await Actor.join(client, url, NIGHT, profile);
  trader = await Actor.join(client, url, TRADER, profile);
  from = night.mark;
  await night.use(risky.spot);
  check(await until(() => night.me.act === EAT, 20_000), "Risky sells at night");
  check(night.me.cash === CASH - SPECIAL_TRADES.risky.price, `and charges ₦${SPECIAL_TRADES.risky.price} once (cash ${night.me.cash})`);
  from = trader.mark;
  await trader.use(ordinary.spot);
  check(await trader.waitNotice(/don pack for the night/, 20_000, from), `an ordinary stall refuses at night: "${trader.said(/pack/, from) ?? ""}"`);
  check(trader.me.act !== EAT && trader.me.cash === CASH, "and nothing is charged");
  await fan.reach(benchSpot);
  from = fan.mark;
  await fan.use(benchSpot);
  check(fan.me.act !== TV && fan.said(/No match for this pitch now/, from) !== undefined, "the touchline bench refuses when no match is on");
  await sleep(6000);
  check(night.me.act === 0 && night.me.cash === CASH - SPECIAL_TRADES.risky.price, "the Risky meal finishes and is not charged again");
  for (const actor of [fan, night, trader]) await actor.leave();
  await stopServer();

  // ---- 5) NEPA takes light in the middle of a show: everything pauses until the generator starts.
  let dark: { show: Show; cut: number; gen: number } | undefined;
  for (let day = FIRST_DAY; day < FIRST_DAY + SEARCH_DAYS && !dark; day++) {
    for (const s of allShowsFor(day).filter((x) => x.place === amphi && !x.special)) {
      const o = outagesOn(powerZoneOfPlace(amphi).index, day).find((x) => x.start >= s.startTotal + 12 && x.start <= s.endTotal - 45 && !outageAt(powerZoneOfPlace(amphi).index, x.start - 12));
      const gen = o ? placeLight(amphi, o.start).generatorAt : undefined;
      if (o && gen !== undefined && gen - o.start >= 6) dark = { show: s, cut: o.start, gen };
    }
  }
  if (!dark) return note("no power cut lands in the middle of an Amphi show in the search window, blackout checks skipped");
  note(`blackout: ${dark.show.title} on day ${dark.show.dayIndex}, light goes at minute ${dark.cut % 1440}, generator ${dark.gen - dark.cut} minutes later`);
  await seedSave(FAN, { cash: CASH, at: outside(amphi), fun: 20 });
  url = await startServer(dark.cut - 6);
  fan = await Actor.join(client, url, FAN, profile);
  await fan.enter(amphi);
  const step = await goTo(fan, steps);
  from = fan.mark;
  await fan.use(step);
  check(fan.me.act === SIT && fan.me.cash === CASH - dark.show.fee && fan.clock < dark.cut, `seated and paid ₦${dark.show.fee} before the cut`);
  check(await fan.waitNotice(/Put on gen now\. Everything pause/, gameMinutesToMs(dark.cut - fan.clock + 3), from), `the room shouts when light goes: "${fan.said(/gen now/, from) ?? ""}"`);
  check(fan.said(/NEPA don take light/, from) !== undefined && fan.me.act === SIT, "light out toast, and nobody is thrown out of their seat");
  await sleep(1000);
  const paused0 = fan.me.fun;
  await sleep(6000);
  const pausedGain = fan.me.fun - paused0;
  check(await fan.waitNotice(/Gen don start/, gameMinutesToMs(dark.gen - fan.clock + 3), from), "the generator starts and the room is told");
  await sleep(1000);
  const live0 = fan.me.fun;
  await sleep(6000);
  const liveGain = fan.me.fun - live0;
  check(pausedGain <= 1 && liveGain >= pausedGain + 2, `the show gives no fun in the dark and carries on with the generator (${pausedGain} in 6s dark, ${liveGain} in 6s lit)`);
  check(fan.me.cash === CASH - dark.show.fee, "no second gate fee after the blackout");
  await fan.leave();
});
