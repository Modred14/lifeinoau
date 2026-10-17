/**
 * Light, water and health against a private server (started here, on SMOKE_PORT).
 *
 *   npx tsx scripts/smoke-conditions.ts   (from server/)
 *
 * Needs: an evening power cut in a zone with a classroom (start and end of the
 * cut), a dry-tap morning at 06:00 in a hall, and 10:00 for the clinic queue.
 * Every moment comes from the seeded schedules in shared/src/conditions.
 */
import { Client } from "@colyseus/sdk";
import {
  ACTS,
  CONDITION_SITES,
  CONDITION_STATUS,
  HEALTH,
  INTERIORS,
  MINUTES_PER_DAY,
  Msg,
  PLACES,
  POWER_ZONES,
  STUDY_SECONDS_PER_POINT,
  ServerMsg,
  VIEWING_PLACES,
  WATER,
  dryMorning,
  hasGenerator,
  outageAt,
  outagesOn,
  parseConditionsPayload,
  placesInZone,
  powerZoneOfPlace,
  standpipeOf,
  type ConditionsPayload,
  type PowerOutage,
} from "@campuslife/shared";
import { smokeAccount } from "./smoke-account";
import { SMOKE_URL, dayTotal, gameMinutesToMs, sleep, startServer, stopServer } from "./smoke-clock";
import { Actor, OAU, check, note, outside, reachOne, run, seedSave, spotsIn, until } from "./smoke-kit";

const READER = "smoke_cond_reader";
const SLEEPER = "smoke_cond_sleeper";
const PATIENT = "smoke_cond_patient";
const HEALTHY = "smoke_cond_healthy";
const FIRST_DAY = 1680;
const SEARCH_DAYS = 200;
const CASH = 3000;
const EARLIEST = 19 * 60 + 10;
const LATEST = 21 * 60 + 40;
const LEAD_MINUTES = 6;
const STUDY = ACTS.indexOf("study");
const SLEEP = ACTS.indexOf("sleep");
const profile = { school: OAU, level: "200L", department: "computer-science" };

interface Cut {
  place: number;
  outage: PowerOutage;
}

function findCut(): Cut {
  for (let day = FIRST_DAY; day < FIRST_DAY + SEARCH_DAYS; day++)
    for (const zone of POWER_ZONES)
      for (const o of outagesOn(zone.index, day)) {
        const merged = outageAt(zone.index, o.start);
        const start = o.start % MINUTES_PER_DAY;
        if (!merged || merged.start !== o.start || start < EARLIEST || start + (merged.end - merged.start) > LATEST) continue;
        if (outageAt(zone.index, o.start - LEAD_MINUTES - 2) || outageAt(zone.index, merged.end + 15)) continue;
        const place = placesInZone(zone.id).find((p) => INTERIORS[p]?.template.id === "classroom" && !hasGenerator(p) && spotsIn(p, (s) => s.kind === "study").length > 0);
        if (place !== undefined) return { place, outage: merged };
      }
  throw new Error("no evening power cut fits in the search window");
}

async function studyGaps(actor: Actor, count: number, timeoutMs: number): Promise<number[]> {
  const times: number[] = [];
  let last = actor.me.study;
  const deadline = Date.now() + timeoutMs;
  while (times.length < count + 1 && Date.now() < deadline) {
    await sleep(50);
    if (actor.me.study === last) continue;
    last = actor.me.study;
    times.push(Date.now());
  }
  return times.slice(1).map((t, i) => (t - times[i]) / 1000);
}

const average = (list: number[]) => (list.length ? list.reduce((sum, n) => sum + n, 0) / list.length : Number.NaN);
const act = (actor: Actor, site: number, settleMs = 600) => actor.tell(Msg.Conditions, { site }, settleMs);
const payload = (actor: Actor) => parseConditionsPayload(actor.last<ConditionsPayload>(ServerMsg.Conditions));

await run("smoke-conditions", async () => {
  const client = new Client(SMOKE_URL);
  const cut = findCut();
  const cutDay = Math.floor(cut.outage.start / MINUTES_PER_DAY);
  note(`power cut: ${powerZoneOfPlace(cut.place).name} zone, day ${cutDay}, ${cut.outage.end - cut.outage.start} minutes, reading in ${PLACES[cut.place].name}`);

  // ---- 1) Light goes: toast, then reading in the dark earns at half speed.
  let url = await startServer(cut.outage.start - LEAD_MINUTES);
  for (const name of [READER, SLEEPER, PATIENT, HEALTHY]) await smokeAccount(url, name);
  await seedSave(READER, { cash: CASH, at: outside(cut.place) });
  let reader = await Actor.join(client, url, READER, profile);
  check(await reader.enter(cut.place), `entered ${PLACES[cut.place].name}`);
  const desks = spotsIn(cut.place, (s) => s.kind === "study");
  const desk = await reachOne(reader, desks);
  await reader.use(desk);
  check(desk >= 0 && reader.me.act === STUDY && reader.clock < cut.outage.start, `reading at a desk ${cut.outage.start - reader.clock} minutes before the cut`);
  let from = reader.mark;
  check(await reader.waitNotice(/NEPA don take light again/, gameMinutesToMs(cut.outage.start - reader.clock + 3), from), "light out toast when the zone loses power");
  check(await reader.waitNotice(/Half study till light comes/, 5000, from), "reading in the dark is announced as half speed");
  const dark = await studyGaps(reader, 2, 70_000);
  const darkGap = average(dark);
  check(dark.length === 2 && Math.abs(darkGap - STUDY_SECONDS_PER_POINT * 2) <= 2, `in the dark a study point takes about ${STUDY_SECONDS_PER_POINT * 2}s (measured ${dark.map((n) => n.toFixed(1)).join(", ")})`);
  await reader.leave();
  await stopServer();

  // ---- 2) Light returns: Up NEPA, and the rate doubles back.
  url = await startServer(cut.outage.end - 4);
  reader = await Actor.join(client, url, READER, profile);
  await reader.reach(desk);
  await reader.use(desk);
  check(reader.me.act === STUDY && reader.clock < cut.outage.end, "back at the desk before the light returns");
  from = reader.mark;
  const fun0 = reader.me.fun;
  check(await reader.waitNotice(/Up NEPA! Light don come back/, gameMinutesToMs(cut.outage.end - reader.clock + 3), from), "Up NEPA toast when power returns");
  await sleep(1200);
  check(reader.me.fun >= fun0 + 2, `Up NEPA lifts fun (${fun0} to ${reader.me.fun})`);
  const lit = await studyGaps(reader, 2, 40_000);
  const litGap = average(lit);
  check(lit.length === 2 && Math.abs(litGap - STUDY_SECONDS_PER_POINT) <= 1.5, `with light a study point takes about ${STUDY_SECONDS_PER_POINT}s (measured ${lit.map((n) => n.toFixed(1)).join(", ")})`);
  check(darkGap / litGap > 1.7 && darkGap / litGap < 2.3, `the dark rate is half the lit rate (ratio ${(darkGap / litGap).toFixed(2)})`);
  await reader.leave();
  await stopServer();

  // ---- 3) 06:00 on a dry morning: wake with no water, fetch at the standpipe. Clinic and chemist are shut.
  const clinic = CONDITION_SITES.find((s) => s.kind === "clinic");
  const chemist = CONDITION_SITES.find((s) => s.kind === "chemist");
  if (!clinic || !chemist) throw new Error("clinic or chemist missing from the map");
  let dry: { day: number; hall: number } | undefined;
  for (let day = FIRST_DAY; day < FIRST_DAY + SEARCH_DAYS && !dry; day++) {
    const hall = VIEWING_PLACES.find((h) => dryMorning(powerZoneOfPlace(h).index, day) && standpipeOf(h));
    if (hall !== undefined) dry = { day, hall };
  }
  if (!dry) throw new Error("no dry morning in the search window");
  const pipe = standpipeOf(dry.hall)!;
  const morning = dayTotal(dry.day, 6 * 60);
  await seedSave(SLEEPER, { cash: CASH, at: pipe.stand, energy: 55 });
  await seedSave(PATIENT, { cash: CASH, at: clinic.stand, conditions: { illness: "malaria", sickSince: morning - 60 } });
  await seedSave(HEALTHY, { cash: CASH, at: clinic.stand });
  url = await startServer(morning);
  let sleeper = await Actor.join(client, url, SLEEPER, profile);
  let patient = await Actor.join(client, url, PATIENT, profile);
  const healthy = await Actor.join(client, url, HEALTHY, profile);

  from = healthy.mark;
  await act(healthy, clinic.id);
  check(healthy.said(/You no sick/, from) !== undefined, "a healthy student is turned back at the clinic");
  check((patient.me.status & CONDITION_STATUS.sick) > 0 && payload(patient)?.illness === "malaria", "the sick student shows as sick (status bit and payload)");
  from = patient.mark;
  await act(patient, clinic.id);
  check(patient.said(/Campus clinic opens 08:00 to 16:00/, from) !== undefined && payload(patient)?.task === undefined, `the clinic refuses at 06:00: "${patient.notices(from)[0] ?? ""}"`);
  check(await patient.walkTo(chemist.stand), "walked to the chemist");
  from = patient.mark;
  await act(patient, chemist.id);
  check(patient.said(/Chemist don close/, from) !== undefined && patient.me.cash === CASH, `the chemist refuses before 07:00: "${patient.notices(from)[0] ?? ""}"`);

  from = sleeper.mark;
  await act(sleeper, pipe.id);
  check(sleeper.said(/don baff already/, from) !== undefined, "the standpipe is not needed before the dry wake-up");
  check(await sleeper.enter(dry.hall), `entered ${PLACES[dry.hall].name}`);
  from = sleeper.mark;
  await act(sleeper, pipe.id);
  check(sleeper.said(/Move closer first/, from) !== undefined, "fetching from inside the hall is refused");
  const bed = await reachOne(sleeper, spotsIn(dry.hall, (s) => s.kind === "sleep"));
  await sleeper.use(bed);
  check(bed >= 0 && sleeper.me.act === SLEEP, "lying on a bed");
  await sleep(3500);
  from = sleeper.mark;
  const funBefore = sleeper.me.fun;
  await sleeper.stand(1500);
  check(sleeper.said(/No water for tap/, from) !== undefined, `waking on a dry morning: "${sleeper.said(/water/, from) ?? ""}"`);
  check((sleeper.me.status & CONDITION_STATUS.unwashed) > 0 && payload(sleeper)?.unwashed === true && sleeper.me.fun <= funBefore - WATER.wakeDryFun + 1, `unwashed is set and fun dropped (${funBefore} to ${sleeper.me.fun})`);
  check((await sleeper.exit()) && (await sleeper.walkTo(pipe.stand)), "walked out to the standpipe");
  from = sleeper.mark;
  await act(sleeper, pipe.id);
  check(sleeper.said(/You dey fetch water/, from) !== undefined && payload(sleeper)?.task?.kind === "fetch", "fetching starts at the standpipe");
  await sleeper.walkTo(outside(dry.hall));
  await sleep(1500);
  check(sleeper.said(/waka comot before e finish/, from) !== undefined && (sleeper.me.status & CONDITION_STATUS.unwashed) > 0, "walking off mid-fetch cancels it");
  await sleeper.walkTo(pipe.stand);
  from = sleeper.mark;
  await act(sleeper, pipe.id);
  check(await sleeper.waitNotice(/You fetch water, you baff/, (WATER.fetchSeconds + 4) * 1000, from), `staying ${WATER.fetchSeconds}s finishes the fetch`);
  await sleep(1200);
  check((sleeper.me.status & CONDITION_STATUS.unwashed) === 0 && payload(sleeper)?.unwashed === false, "unwashed is cleared");
  for (const actor of [sleeper, patient, healthy]) await actor.leave();
  await stopServer();

  // ---- 4) 10:00: the clinic gives a number, walking off loses it, the chemist cures for cash.
  await seedSave(PATIENT, { cash: CASH, at: clinic.stand, conditions: { illness: "malaria", sickSince: morning - 60 } });
  url = await startServer(dayTotal(dry.day, 10 * 60));
  patient = await Actor.join(client, url, PATIENT, profile);
  from = patient.mark;
  await act(patient, clinic.id);
  const ticket = payload(patient)?.task;
  check(patient.said(/you be number \d+\. About \d+ minutes/, from) !== undefined && ticket?.kind === "clinic", `inside hours the clinic gives a number: "${patient.said(/number/, from) ?? ""}"`);
  check(await patient.walkTo(chemist.stand), "walked off to the chemist");
  const gone = await until(() => patient.said(/Your number don pass/, from) !== undefined, 4000);
  const distance = Math.hypot(chemist.stand.x - clinic.stand.x, chemist.stand.y - clinic.stand.y);
  check(gone, `leaving the clinic queue loses the number (chemist is ${Math.round(distance / 20)} m away)`);
  from = patient.mark;
  await act(patient, chemist.id);
  check(patient.said(/chemist dey count your drugs/, from) !== undefined, "the chemist starts counting");
  check(await patient.waitNotice(/You buy drugs for ₦800\. You are fine again/, (HEALTH.chemistSeconds + 4) * 1000, from), "the drugs cure the illness");
  await sleep(1200);
  check(patient.me.cash === CASH - HEALTH.chemistPrice && (patient.me.status & CONDITION_STATUS.sick) === 0 && payload(patient)?.illness === "", `₦${HEALTH.chemistPrice} charged once and the sick flag is gone (cash ${patient.me.cash})`);
  from = patient.mark;
  await act(patient, chemist.id);
  check(patient.said(/You no sick/, from) !== undefined && patient.me.cash === CASH - HEALTH.chemistPrice, "a cured student cannot buy again");
  await patient.leave();
  sleeper = await Actor.join(client, url, SLEEPER, profile);
  check((sleeper.me.status & CONDITION_STATUS.unwashed) === 0, "the bath survives a server restart");
  await sleeper.leave();
});
