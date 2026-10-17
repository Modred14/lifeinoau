/**
 * School admin against a private server (started here, on SMOKE_PORT).
 *
 *   npx tsx scripts/smoke-admin.ts   (from server/)
 *
 * Needs: a Tuesday in the ballot window with the portal up (registration, handouts, bed
 * ballot, a typing shift) and the Thursday after it (late fine, closed ballot).
 */
import { Client } from "@colyseus/sdk";
import {
  ACTS,
  BED_HALLS,
  BED_SPACE,
  INTERIOR_X0,
  PLACES,
  PORTER_RAID,
  HANDOUT,
  HUSTLES,
  HUSTLE_LIMITS,
  Msg,
  REGISTRATION,
  ServerMsg,
  ballotPosition,
  hustlePay,
  gameTime,
  nearestBusinessCentre,
  parseAdminPayload,
  portalStatus,
  raidFor,
  timetableFor,
  SPAWN_POINT,
  type AdminPayload,
} from "@campuslife/shared";
import { smokeAccount } from "./smoke-account";
import { SMOKE_URL, dayTotal, gameMinutesToMs, sleep, startServer, stopServer, totalAt } from "./smoke-clock";
import { Actor, OAU, check, clearBeds, note, outside, patchSave, playerIdOf, reachOne, run, seedSave, spotsIn, until } from "./smoke-kit";

const CYCLE = 210;
const A = "smoke_admin_a";
const B = "smoke_admin_b";
const C = "smoke_admin_c";
const DEPARTMENT = "computer-science";
const LEVEL = "100L";
const CASH = 6000;
const CALM_MINUTES = 14;
const SLEEP = ACTS.indexOf("sleep");
const profile = { school: OAU, level: LEVEL, department: DEPARTMENT };
const courses = timetableFor(DEPARTMENT, LEVEL).courses;
const centre = nearestBusinessCentre(SPAWN_POINT.x, SPAWN_POINT.y);
if (!centre) throw new Error("no business centre on the map");

function portalUpFrom(start: number, end: number): number {
  for (let t = start; t < end; t++) {
    let calm = true;
    for (let k = 0; k < CALM_MINUTES && calm; k++) calm = portalStatus(t + k).state === "up";
    if (calm) return t;
  }
  throw new Error("the portal is never up for long enough in that window");
}

const send = (actor: Actor, action: Record<string, unknown>) => actor.ask<AdminPayload>(Msg.Admin, action, ServerMsg.Admin, 3000).then((raw) => parseAdminPayload(raw));

await run("smoke-admin", async () => {
  const client = new Client(SMOKE_URL);
  const monday = portalUpFrom(totalAt({ cycle: CYCLE, weekday: 1, hour: 9, minute: 5 }), totalAt({ cycle: CYCLE, weekday: 1, hour: 14 }));
  let url = await startServer(monday);
  for (const name of [A, B, C]) {
    await smokeAccount(url, name);
    await seedSave(name, { cash: CASH, at: centre.at });
  }
  await clearBeds([A, B, C]);
  const idA = await playerIdOf(A);
  const idC = await playerIdOf(C);
  const winHall = BED_HALLS.find((h) => ballotPosition(CYCLE, h.place, idA) <= h.beds);
  const loseHall = BED_HALLS.find((h) => ballotPosition(CYCLE, h.place, idC) > h.beds);

  // ---- Tuesday: registration, handouts, ballot, hustle.
  let a = await Actor.join(client, url, A, profile);
  let b = await Actor.join(client, url, B, profile);
  const c = await Actor.join(client, url, C, profile);
  const start = await send(a, { a: "sync" });
  check(start?.record.reg === null && start.department === DEPARTMENT, "Admin sync: not registered yet, department on the payload");
  check(a.said(/Course registration is open/) !== undefined, "the registration reminder arrives on join");

  let from = a.mark;
  let rec = await send(a, { a: "register" });
  check(rec?.record.reg?.week === CYCLE && rec.record.reg.late === false && a.me.cash === CASH, `registered inside the window for free (cash ${a.me.cash})`);
  check(a.said(/Courses registered for this semester\.$/, from) !== undefined, `notice: "${a.said(/registered/, from) ?? ""}"`);
  from = a.mark;
  await send(a, { a: "register" });
  check(a.said(/don register for this semester already/, from) !== undefined && a.me.cash === CASH, "registering twice is refused");

  const code = courses[0].code;
  from = a.mark;
  rec = await send(a, { a: "handout", code });
  await sleep(300);
  check(rec?.record.handouts.held.includes(code) === true && a.me.cash === CASH - HANDOUT.repPrice, `bought the ${code} handout from the class rep, cash down by ₦${HANDOUT.repPrice} (${a.me.cash})`);
  from = a.mark;
  await send(a, { a: "handout", code });
  await sleep(300);
  check(a.said(/handout already/, from) !== undefined && a.me.cash === CASH - HANDOUT.repPrice, "buying the same handout again is refused and costs nothing");
  from = a.mark;
  await send(a, { a: "handout", code: "XYZ 999" });
  check(a.said(/no dey your list/, from) !== undefined && a.me.cash === CASH - HANDOUT.repPrice, "a course that is not yours is refused");
  const second = courses[1].code;
  rec = await send(a, { a: "copy", code: second });
  await sleep(300);
  let spent = HANDOUT.repPrice + HANDOUT.copyPrice;
  check(rec?.record.handouts.held.includes(second) === true && a.me.cash === CASH - spent, `photocopied ${second} at the business centre for ₦${HANDOUT.copyPrice}`);

  if (winHall) {
    from = a.mark;
    await send(a, { a: "ballot", hall: winHall.place });
    await until(() => parseAdminPayload(a.last<AdminPayload>(ServerMsg.Admin, from))?.record.bed !== null, 4000);
    await sleep(300);
    rec = parseAdminPayload(a.last<AdminPayload>(ServerMsg.Admin, from));
    spent += BED_SPACE.fee;
    check(rec?.record.bed?.hall === winHall.name && a.me.cash === CASH - spent, `won a bed in ${winHall.name} inside the ballot window, fee ₦${BED_SPACE.fee} charged once (cash ${a.me.cash})`);
    from = a.mark;
    await send(a, { a: "ballot", hall: winHall.place });
    await sleep(300);
    check(a.said(/already hold a bed space/, from) !== undefined && a.me.cash === CASH - spent, "a second ballot is refused and not charged");
  } else note("no hall where this account's ticket wins this week, bed win path skipped");
  if (loseHall) {
    let fromC = c.mark;
    const lost = await send(c, { a: "ballot", hall: loseHall.place });
    await sleep(300);
    check(lost?.record.bed === null && lost.record.ballot.tried && c.me.cash === CASH && c.said(/Bed spaces exhausted/, fromC) !== undefined, `a losing ticket in ${loseHall.name} gets no bed and pays nothing`);
    fromC = c.mark;
    await send(c, { a: "ballot", hall: (winHall ?? loseHall).place });
    check(c.said(/don ballot this semester already/, fromC) !== undefined && c.me.cash === CASH, "one ballot try per week");
  } else note("every hall would be a win for the second account, losing path skipped");
  await c.leave();

  const spec = HUSTLES.typing;
  const cashBefore = a.me.cash;
  from = a.mark;
  const started = await send(a, { a: "hustle", id: "typing" });
  check(started?.shift?.id === "typing" && a.said(/Shift started/, from) !== undefined, `typing shift started at the business centre (${started?.shift?.left}s left)`);
  from = a.mark;
  await send(a, { a: "hustle", id: "typing" });
  check(a.said(/Finish what you dey do first/, from) !== undefined, "a second shift on top is refused");
  await sleep(10_000);
  check(a.me.cash === cashBefore, "no pay before the shift ends");
  from = a.mark;
  const paid = await a.waitNotice(/Typing and printing: ₦/, (spec.seconds - 10 + 6) * 1000, from);
  await sleep(600);
  const pay = hustlePay("typing", 0, centre.index, gameTime(a.clock));
  check(paid && a.me.cash === cashBefore + pay, `shift finished and paid ₦${pay} (cash ${cashBefore} to ${a.me.cash})`);
  await sleep(3000);
  const afterShift = await send(a, { a: "sync" });
  check(a.me.cash === cashBefore + pay && afterShift?.shift === undefined, "paid once, and the shift is over");
  check(afterShift?.record.hustle.done.typing === 1 && afterShift.record.skills.typing === spec.skillGain, `one typing shift on record, skill ${afterShift?.record.skills.typing}`);

  from = a.mark;
  await send(a, { a: "hustle", id: "typing" });
  await sleep(500);
  const away = { x: a.me.x + HUSTLE_LIMITS.leave * 1.8, y: a.me.y };
  const walked = (await a.walkTo(away)) || (await a.walkTo({ x: a.me.x - HUSTLE_LIMITS.leave * 3.6, y: a.me.y })) || (await a.walkTo({ x: a.me.x, y: a.me.y + HUSTLE_LIMITS.leave * 1.8 }));
  await sleep(1500);
  if (walked) check(a.said(/waka comot before the shift finish/, from) !== undefined && a.me.cash === cashBefore + pay, "walking off mid-shift ends it with no pay");
  else note("could not walk clear of the kiosk, the walk-off check was skipped");
  from = a.mark;
  await send(a, { a: "hustle", id: "hair" });
  check(a.said(/weekend work|Go to any hostel room first/i, from) !== undefined, `hair is refused on a Tuesday outside a hostel: "${a.notices(from)[0] ?? ""}"`);
  const mondayCash = a.me.cash;
  await a.leave();
  await b.leave();
  await stopServer();

  // ---- Thursday: late fine, closed ballot, and the first day's records still there.
  const thursday = portalUpFrom(totalAt({ cycle: CYCLE, weekday: 3, hour: 10 }), totalAt({ cycle: CYCLE, weekday: 3, hour: 15 }));
  url = await startServer(thursday);
  b = await Actor.join(client, url, B, profile);
  await sleep(1500);
  check(b.said(/you missed registration\. Late fine is ₦1,000/) !== undefined, "after Tuesday 18:00 the course adviser says registration was missed");
  from = b.mark;
  const late = await send(b, { a: "register" });
  await sleep(300);
  check(late?.record.reg?.late === true && b.me.cash === CASH - REGISTRATION.lateFine, `late registration charges the ₦${REGISTRATION.lateFine} fine once (cash ${b.me.cash})`);
  check(b.said(/Late fine paid\. You paid ₦1,000/, from) !== undefined, `notice: "${b.said(/registered/, from) ?? ""}"`);
  from = b.mark;
  await send(b, { a: "register" });
  await sleep(300);
  check(b.me.cash === CASH - REGISTRATION.lateFine && b.said(/already/, from) !== undefined, "a second late registration is refused and not charged");
  from = b.mark;
  await send(b, { a: "ballot", hall: BED_HALLS[0].place });
  await sleep(300);
  check(b.said(/Ballot is closed/, from) !== undefined && b.me.cash === CASH - REGISTRATION.lateFine, "the bed ballot is closed outside its window");
  a = await Actor.join(client, url, A, profile);
  const kept = await send(a, { a: "sync" });
  check(kept?.record.reg?.week === CYCLE && kept.record.handouts.held.length === 2 && a.me.cash === mondayCash, "registration, handouts and cash survive a server restart");
  if (winHall) check(kept?.record.bed?.hall === winHall.name, "the bed space is still held on Thursday");
  check(kept?.record.hustle.done.typing === 0 || kept?.record.hustle.day !== gameTime(a.clock).dayIndex, "the daily shift count is for the first day, not carried into Thursday");
  await a.leave();
  await b.leave();
  await stopServer();

  // ---- A night with a porter raid: the squatter is fined once and put out, the bed owner sleeps on.
  let raid: { day: number; hall: number; start: number } | undefined;
  for (let day = CYCLE * 7; day < CYCLE * 7 + 7 && !raid; day++) {
    for (const hall of winHall ? [winHall, ...BED_HALLS] : BED_HALLS) {
      const roll = raidFor(day, hall.place);
      if (!roll.raid || (day === CYCLE * 7 && hall === winHall)) continue;
      raid = { day, hall: hall.place, start: roll.start };
      break;
    }
  }
  if (!raid) return note("no porter raid this week, the raid checks were skipped");
  const owner = winHall?.place === raid.hall;
  await patchSave(C, { at: outside(raid.hall), energy: 30 });
  if (owner) await patchSave(A, { at: outside(raid.hall), energy: 30 });
  url = await startServer(dayTotal(raid.day, raid.start - 5));
  const squatter = await Actor.join(client, url, C, profile);
  const cashC = squatter.me.cash;
  check(await squatter.enter(raid.hall), `the squatter entered ${PLACES[raid.hall].name} before the raid`);
  const beds = spotsIn(raid.hall, (s) => s.kind === "sleep");
  const bedC = await reachOne(squatter, beds);
  from = squatter.mark;
  await squatter.use(bedC);
  check(squatter.me.act === SLEEP && (await squatter.waitNotice(/You dey squat here/, 3000, from)), "sleeping without a bed space is squatting");
  let resident: Actor | undefined;
  if (owner) {
    resident = await Actor.join(client, url, A, profile);
    await resident.enter(raid.hall);
    const bedA = await reachOne(resident, beds, 3);
    const fromA = resident.mark;
    await resident.use(bedA);
    check(resident.me.act === SLEEP && (await resident.waitNotice(/Your own bed space/, 3000, fromA)), "the bed owner is told it is their own bed");
  } else note("the raid is not in the hall where the first account holds a bed, owner check skipped");
  check(await squatter.waitNotice(/Porter dey come! Squatters out of .*You paid ₦300 fine/, gameMinutesToMs(dayTotal(raid.day, raid.start) - squatter.clock + 4), from), `the porter raid lands: "${squatter.said(/Porter/, from) ?? ""}"`);
  await sleep(600);
  check(squatter.me.act === 0 && squatter.me.x < INTERIOR_X0 && squatter.me.cash === cashC - PORTER_RAID.fine, `the squatter is outside and ₦${PORTER_RAID.fine} poorer (cash ${squatter.me.cash})`);
  if (resident) check(resident.me.act === SLEEP && resident.said(/Porter/) === undefined, "the bed owner sleeps through the raid");
  await squatter.enter(raid.hall);
  await squatter.reach(bedC);
  await squatter.use(bedC);
  await sleep(5000);
  check(squatter.me.act === SLEEP && squatter.me.cash === cashC - PORTER_RAID.fine, "going back to bed the same night is not fined again");
  await squatter.leave();
  await resident?.leave();
  if (winHall) {
    const reborn = await Actor.join(client, url, A, { ...profile, fresh: true });
    await sleep(2000);
    const after = await send(reborn, { a: "sync" });
    check(after?.record.bed === null, `a new life (fresh save, cash back to ₦${reborn.me.cash}) does not keep the old bed for free (bed: ${after?.record.bed?.hall ?? "none"})`);
    await reborn.leave();
  }
});
