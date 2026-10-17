import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMPAIGN,
  CAMPAIGN_NICKS,
  CAMPAIGN_TRAIN,
  CELEBRATE,
  ELECTION_TIMES,
  FORM_DESK,
  IMPEACH,
  MINUTES_PER_DAY,
  PETITION,
  POLL_UNITS,
  RALLY_POINTS,
  RENTAL,
  RENTAL_AREAS,
  SUG_SCOPE,
  ServerMsg,
  congressResult,
  congressStand,
  congressStateId,
  congressesFor,
  findPost,
  formFee,
  impeachMark,
  marchAt,
  marchMark,
  marchPlan,
  marchSecondsNeeded,
  marchTurnout,
  npcCandidates,
  npcWorked,
  officeIndex,
  petitionFee,
  petitionGranted,
  pollUnit,
  raceKey,
  ralliesFor,
  settlesAt,
  signatureTotal,
  sittingDue,
  srcSitting,
  stateFromCongress,
  unitForFaculty,
  voteOpensAt,
  type UnionState,
  type PoliticsStatus,
  type UnionWorld,
} from "@campuslife/shared";
import { MemoryPoliticsStore, PoliticsDesk, type PoliticsPlayer } from "./Politics";
import { drawSecret } from "./secret";

const WEEK = 12;
const clockAt = (weekday: number, hour: number, minute = 0, week = WEEK) => (week * 7 + weekday) * MINUTES_PER_DAY + hour * 60 + minute;
const president = findPost("sug-president")!;
const deptPresident = findPost("dept-president")!;
const race = raceKey(president, SUG_SCOPE);
const profile = (id: string) => id.padEnd(64, "0");

interface Sent {
  id: string;
  type: string;
  payload: unknown;
}

function world(store = new MemoryPoliticsStore()) {
  const players = new Map<string, PoliticsPlayer>();
  const sent: Sent[] = [];
  const said: string[] = [];
  const offices = new Map<string, number>();
  const state = { clock: clockAt(0, 9), wall: 1_000_000 };
  const desk = new PoliticsDesk({
    store,
    player: (id) => players.get(id),
    players: () => players,
    name: (id) => `@${id}`,
    send: (id, type, payload) => void sent.push({ id, type, payload }),
    broadcast: (text) => void said.push(text),
    changed: () => undefined,
    earn: (id, amount) => {
      const p = players.get(id);
      if (p) p.cash += amount;
      return amount;
    },
    setOffice: (id, office) => void offices.set(id, office),
    cheer: () => undefined,
    clock: () => state.clock,
    wallClock: () => state.wall,
  });
  const join = (id: string, more: Partial<PoliticsPlayer> = {}): PoliticsPlayer => {
    const p: PoliticsPlayer = { x: FORM_DESK.x, y: FORM_DESK.y, cash: 20_000, energy: 100, fun: 50, packs: 0, gpTotal: 12, exams: 3, malpractice: 0, rusticatedUntil: 0, level: "300L", department: "law", profileId: profile(id), ...more };
    players.set(id, p);
    return p;
  };
  const notices = (id: string) => sent.filter((s) => s.id === id && s.type === ServerMsg.Notice).map((s) => String(s.payload));
  const status = (id: string) => sent.filter((s) => s.id === id && s.type === ServerMsg.Politics).at(-1)?.payload as PoliticsStatus;
  const unionWorld = (id: string) => sent.filter((s) => s.id === id && s.type === ServerMsg.Union).at(-1)?.payload as UnionWorld | undefined;
  const go = (p: PoliticsPlayer, to: { x: number; y: number }) => {
    p.x = to.x;
    p.y = to.y;
  };
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const tick = async (advanceMs = 60_000) => {
    state.wall += advanceMs;
    await desk.tick();
    await flush();
  };
  return { desk, store, players, sent, said, offices, state, join, notices, status, unionWorld, go, tick, flush };
}

type World = ReturnType<typeof world>;

async function contest(w: World, id: string, more: Partial<PoliticsPlayer> = {}, look = { nick: 0, slogan: 0, color: 0 }) {
  const p = w.join(id, more);
  await w.desk.handle(id, { a: "form", post: president.id, ...look });
  return p;
}

async function elect(w: World, id = "tola", votes = 40) {
  const p = await contest(w, id);
  const mine = w.store.candidacies.find((c) => c.accountId === p.profileId)!;
  for (let i = 0; i < votes; i++) await w.store.vote(profile(`v${i}x`), WEEK, race, mine.id, false);
  return p;
}

test("a candidate picks a curated nickname, slogan and colour with the form", async () => {
  const w = world();
  w.join("bad");
  await w.desk.handle("bad", { a: "form", post: president.id, nick: "Free text", slogan: 0, color: 0 });
  await w.desk.handle("bad", { a: "form", post: president.id, nick: 9999, slogan: 0, color: 0 });
  assert.equal(w.store.candidacies.length, 0);
  await contest(w, "tola", {}, { nick: 4, slogan: 2, color: 5 });
  assert.deepEqual(w.store.candidacies[0].look, { nick: 4, slogan: 2, color: 5 });
  assert.deepEqual(w.status("tola").mine?.look, { nick: 4, slogan: 2, color: 5 });
  assert.deepEqual(w.status("tola").players[0].look, { nick: 4, slogan: 2, color: 5 });
  assert.ok(w.said.some((s) => s.includes(`"${CAMPAIGN_NICKS[4]}"`)));
});

test("banner spots: pay per spot, no double rent, limited per area and per camp", async () => {
  const w = world();
  const tola = await contest(w, "tola");
  const awo = RENTAL_AREAS.find((a) => a.id === "awo")!;
  const cash = tola.cash;
  w.join("fan");
  await w.desk.handle("fan", { a: "rent", area: awo.id });
  assert.match(w.notices("fan").at(-1)!, /Only candidates/);
  await w.desk.handle("tola", { a: "rent", area: "moon" });
  assert.equal(tola.cash, cash);
  await w.desk.handle("tola", { a: "rent", area: awo.id });
  assert.equal(tola.cash, cash - awo.price);
  assert.deepEqual(w.status("tola").mine?.rented, [awo.id]);
  assert.equal(w.unionWorld("fan")?.rentals.length, 1);
  assert.equal(w.unionWorld("fan")?.rentals[0].name, "@tola");
  await w.desk.handle("tola", { a: "rent", area: awo.id });
  assert.match(w.notices("tola").at(-1)!, /already up/);
  assert.equal(tola.cash, cash - awo.price);
  assert.equal(w.store.rented.length, 1);
  for (const id of ["b", "c"]) {
    await contest(w, id);
    await w.desk.handle(id, { a: "rent", area: awo.id });
  }
  assert.equal(w.store.rented.filter((r) => r.area === awo.id).length, RENTAL.perArea);
  assert.deepEqual(w.store.rented.map((r) => r.slot).sort(), [0, 1, 2]);
  const late = await contest(w, "d");
  const before = late.cash;
  await w.desk.handle("d", { a: "rent", area: awo.id });
  assert.match(w.notices("d").at(-1)!, /taken/);
  assert.equal(late.cash, before);
  const others = RENTAL_AREAS.filter((a) => a.id !== awo.id).slice(0, RENTAL.perCandidate);
  tola.cash = 100_000;
  for (const area of others) await w.desk.handle("tola", { a: "rent", area: area.id });
  assert.equal(w.store.rented.filter((r) => r.candidacyId === w.store.candidacies[0].id).length, RENTAL.perCandidate);
  assert.match(w.notices("tola").at(-1)!, new RegExp(`${RENTAL.perCandidate} rented spots`));
  w.state.clock = clockAt(3, 19);
  await w.desk.handle("d", { a: "rent", area: others[0].id });
  assert.match(w.notices("d").at(-1)!, /Thursday 6 pm/);
});

test("the rent comes back when the register fails mid-rent", async () => {
  const w = world();
  const tola = await contest(w, "tola");
  const cash = tola.cash;
  w.store.rent = async () => {
    throw new Error("down");
  };
  await w.desk.handle("tola", { a: "rent", area: "awo" });
  assert.equal(tola.cash, cash);
});

test("results come in unit by unit and end with the declaration", async () => {
  const w = world();
  const tola = await elect(w);
  w.state.clock = clockAt(4, 18);
  await w.tick();
  const lines = () => w.said.filter((s) => s.startsWith("📊"));
  assert.equal(lines().length, 0);
  let seenMid = false;
  for (let m = ELECTION_TIMES.results; m <= ELECTION_TIMES.declaration; m++) {
    w.state.clock = WEEK * 7 * MINUTES_PER_DAY + m;
    await w.tick(2000);
    if (m === ELECTION_TIMES.results + 12) {
      await w.desk.handle("tola", { a: "status" });
      const mid = w.status("tola");
      assert.equal(mid.declared, false);
      assert.deepEqual(mid.results, []);
      assert.equal(mid.returns[0].units.length, lines().length);
      assert.ok(mid.returns[0].units.length > 0 && mid.returns[0].units.length < POLL_UNITS.length);
      seenMid = true;
    }
    if (m < ELECTION_TIMES.declaration) assert.ok(!w.said.some((s) => /declares/.test(s)));
  }
  assert.ok(seenMid);
  assert.equal(lines().length, POLL_UNITS.length);
  assert.equal(new Set(lines()).size, POLL_UNITS.length);
  assert.equal(w.said.filter((s) => /declares @tola the new SUG President/.test(s)).length, 1);
  assert.ok(w.said.findIndex((s) => /declares/.test(s)) > w.said.lastIndexOf(lines().at(-1)!));
  assert.ok(w.notices("tola").some((n) => /You won/.test(n)));
  await w.desk.handle("tola", { a: "status" });
  assert.deepEqual([w.status("tola").declared, w.status("tola").outcome, w.status("tola").returns.length], [true, "won", 0]);
  await w.desk.handle("tola", { a: "celebrate" });
  await w.desk.handle("tola", { a: "celebrate" });
  assert.equal(tola.fun, 50 + CELEBRATE.fun);
  assert.equal(w.said.filter((s) => /celebrating/.test(s)).length, 1);
  await w.desk.handle("tola", { a: "petition" });
  assert.match(w.notices("tola").at(-1)!, /Nothing to petition/);
});

test("a new room on Saturday does not declare the result again", async () => {
  const store = new MemoryPoliticsStore();
  const a = world(store);
  await elect(a);
  a.state.clock = WEEK * 7 * MINUTES_PER_DAY + ELECTION_TIMES.declaration;
  await a.tick();
  assert.equal(a.said.filter((s) => /declares/.test(s)).length, 1);
  const b = world(store);
  b.join("late");
  for (const clock of [clockAt(4, 19), clockAt(5, 12), clockAt(6, 12)]) {
    b.state.clock = clock;
    await b.tick();
  }
  assert.equal(b.said.filter((s) => /declares|^📊/.test(s)).length, 0);
  assert.equal(store.rows.length, 1);
});

test("a loser can petition SUIEC once for a fee, and a re-run is seeded", async () => {
  const seen = new Set<boolean>();
  for (let attempt = 0; attempt < 80 && seen.size < 2; attempt++) {
    const w = world();
    const tola = await contest(w, "tola");
    const mine = w.store.candidacies[0];
    w.state.clock = clockAt(4, 18, 5);
    await w.desk.handle("tola", { a: "petition" });
    assert.match(w.notices("tola").at(-1)!, /not declared/);
    w.state.clock = WEEK * 7 * MINUTES_PER_DAY + ELECTION_TIMES.declaration + 1;
    await w.tick();
    assert.ok(w.notices("tola").some((n) => /You lost/.test(n)));
    const cash = tola.cash;
    await w.desk.handle("tola", { a: "celebrate" });
    assert.match(w.notices("tola").at(-1)!, /Only the winner/);
    await w.desk.handle("tola", { a: "petition" });
    await w.desk.handle("tola", { a: "petition" });
    assert.equal(tola.cash, cash - petitionFee(president));
    assert.ok(w.status("tola").marks.includes(PETITION.mark));
    const granted = petitionGranted(WEEK, race, mine.id, drawSecret());
    seen.add(granted);
    assert.equal(w.store.rerunRaces.length, granted ? 1 : 0);
    assert.equal(w.said.filter((s) => /re-run/.test(s)).length, granted ? 1 : 0);
    assert.ok(w.status("tola").results.some((r) => r.race === race));
  }
  assert.equal(seen.size, 2);
  const w = world();
  await contest(w, "tola");
  w.state.clock = clockAt(5, 11);
  await w.desk.handle("tola", { a: "petition" });
  assert.match(w.notices("tola").at(-1)!, /closed petitions/);
});

test("a winner who was offline at the swearing-in gets the stipend once at next login", async () => {
  const store = new MemoryPoliticsStore();
  const a = world(store);
  await elect(a);
  a.state.clock = clockAt(4, 18, 1);
  await a.tick();
  a.desk.left("tola");
  a.players.delete("tola");
  a.state.clock = clockAt(5, 10, 1);
  await a.tick();
  await a.tick();
  assert.equal(store.rows[0].stipendPaid, false);
  const b = world(store);
  b.state.clock = clockAt(1, 9, 0, WEEK + 1);
  await b.tick();
  const back = b.join("tola", { cash: 0 });
  b.desk.joined("tola");
  await b.flush();
  b.desk.joined("tola");
  await b.tick();
  await b.tick();
  assert.equal(back.cash, president.stipend);
  assert.equal(store.rows[0].stipendPaid, true);
  assert.equal(b.offices.get("tola"), officeIndex(president));
  assert.equal(b.notices("tola").filter((n) => /stipend/.test(n)).length, 1);
});

test("a stipend missed for the whole term is still paid once, without the title", async () => {
  const store = new MemoryPoliticsStore();
  const a = world(store);
  await elect(a);
  a.state.clock = clockAt(4, 18, 1);
  await a.tick();
  const b = world(store);
  b.state.clock = clockAt(6, 12, 0, WEEK + 1);
  await b.tick();
  const back = b.join("tola", { cash: 0 });
  b.desk.joined("tola");
  await b.flush();
  b.desk.joined("tola");
  await b.flush();
  assert.equal(back.cash, president.stipend);
  assert.equal(b.offices.get("tola") ?? 0, 0);
  const c = world(store);
  c.state.clock = clockAt(6, 12, 0, WEEK + 5);
  const old = c.join("tola", { cash: 0 });
  c.desk.joined("tola");
  await c.flush();
  assert.equal(old.cash, 0);
});

class SlowStore extends MemoryPoliticsStore {
  release: () => void = () => undefined;
  private gate = new Promise<void>((resolve) => (this.release = resolve));
  override async claimStipend(cycle: number, raceId: string, accountId: string) {
    await this.gate;
    return super.claimStipend(cycle, raceId, accountId);
  }
}

test("the stipend follows the account when the player reconnects during the claim", async () => {
  const store = new SlowStore();
  const w = world(store);
  const tola = await elect(w);
  w.state.clock = clockAt(4, 18, 1);
  await w.tick();
  w.state.clock = clockAt(5, 10, 1);
  await w.tick();
  const cash = tola.cash;
  w.players.delete("tola");
  w.players.set("tola-again", tola);
  store.release();
  await w.flush();
  await w.flush();
  assert.equal(tola.cash, cash + president.stipend);
  assert.ok(w.notices("tola-again").some((n) => /stipend/.test(n)));
  assert.equal(store.rows[0].stipendPaid, true);
});

test("congress counts students by the side they stand on and stores the campus state", async () => {
  let cycle = 3;
  while (congressesFor(cycle)[0].motion !== "fees") cycle++;
  const sitting = congressesFor(cycle)[0];
  const w = world();
  const ayes = Array.from({ length: 30 }, (_v, k) => w.join(`aye${k}x`));
  const waverer = w.join("waverer");
  w.join("away");
  w.state.clock = sitting.start + 1;
  await w.tick();
  assert.ok(w.said.some((s) => /Congress is sitting/.test(s)));
  for (const p of ayes) w.go(p, congressStand("aye"));
  w.go(waverer, congressStand("nay"));
  w.state.clock = voteOpensAt(sitting) + 1;
  await w.tick();
  assert.ok(w.said.some((s) => /Speaker has put the question/.test(s)));
  assert.deepEqual(await w.store.sides(sitting.id), { aye: 30, nay: 1 });
  assert.equal(ayes[0].fun, 60);
  w.go(waverer, FORM_DESK);
  await w.tick();
  await w.tick();
  assert.deepEqual(await w.store.sides(sitting.id), { aye: 30, nay: 0 });
  assert.equal(ayes[0].fun, 60);
  w.state.clock = settlesAt(sitting);
  await w.tick();
  await w.tick();
  const expected = stateFromCongress(sitting, congressResult(sitting, { aye: 30, nay: 0 }));
  assert.equal(expected.kind, "boycott");
  assert.deepEqual(w.store.campus, [expected]);
  assert.equal(w.said.filter((s) => /Congress on the fee hike/.test(s)).length, 1);
  assert.ok(w.said.some((s) => /boycott of lectures/.test(s)));
  assert.deepEqual(w.desk.campusStates().map((s) => s.id), [congressStateId(sitting)]);
  assert.equal(w.desk.campusEffects().boycott, true);
  assert.deepEqual(w.unionWorld("away")?.states, [expected]);
  w.state.clock = expected.until;
  assert.equal(w.desk.campusEffects().boycott, false);
  const twin = world(w.store);
  twin.join("other");
  twin.state.clock = settlesAt(sitting) + 5;
  await twin.tick();
  await twin.tick();
  assert.equal(w.store.campus.length, 1);
  assert.equal(twin.said.filter((s) => /Congress on/.test(s)).length, 0);
  assert.equal(twin.said.filter((s) => /boycott of lectures/.test(s)).length, 1, "a room that did not settle the sitting still hears the result once");
});

test("the President's call opens a sitting that every room sees", async () => {
  const w = world();
  const tola = await elect(w);
  w.state.clock = clockAt(4, 18, 1);
  await w.tick();
  w.state.clock = clockAt(5, 12);
  await w.tick();
  w.go(tola, RALLY_POINTS[0]);
  await w.desk.handle("tola", { a: "power" });
  const called = w.unionWorld("tola")?.called;
  assert.equal(called?.start, clockAt(5, 12));
  assert.equal(called?.called, true);
  w.go(tola, congressStand("nay"));
  w.state.clock = voteOpensAt(called!) + 1;
  await w.tick();
  w.state.clock = settlesAt(called!);
  await w.tick();
  await w.tick();
  assert.equal(w.store.campus.length, 1);
  assert.equal(w.store.campus[0].id, congressStateId(called!));
});

async function protest(w: World): Promise<UnionState> {
  const state: UnionState = { id: "c:test", kind: "protest", issue: "the bus fare increase", from: clockAt(0, 19, 47), until: 0, concession: "" };
  state.until = marchPlan(state).end;
  await w.store.addState(state);
  return state;
}

test("students who walk with the march are counted and turnout decides the outcome", async () => {
  const w = world();
  const state = await protest(w);
  const plan = marchPlan(state);
  const marcher = w.join("marcher");
  const watcher = w.join("watcher");
  w.state.clock = plan.forms + 1;
  await w.tick();
  assert.ok(w.said.some((s) => /forming at the Anglo-Moz/.test(s)));
  assert.deepEqual(w.desk.roadCrowd([marcher]), [marcher]);
  const needed = marchSecondsNeeded(plan);
  for (let k = 0; k * 2 <= needed + 4; k++) {
    w.state.clock = plan.start + 1 + k;
    w.go(marcher, marchAt(plan, w.state.clock));
    await w.tick(2000);
  }
  assert.equal(w.desk.roadCrowd([marcher]).length, 4);
  assert.ok(w.notices("marcher").some((n) => /You marched/.test(n)));
  assert.ok(marcher.fun > 50 && marcher.energy < 100);
  assert.equal(watcher.fun, 50);
  assert.equal(await w.store.countMark(marchMark(plan.id)), 1);
  for (let i = 0; i < 6; i++) await w.store.mark(profile(`m${i}`), WEEK, marchMark(plan.id));
  w.state.clock = plan.end;
  await w.tick();
  await w.tick();
  const turnout = marchTurnout(plan.id, 7);
  assert.equal(turnout.agreed, true);
  const after = w.store.campus.find((s) => s.id === `after:${plan.id}`)!;
  assert.equal(after.kind, "concession");
  assert.equal(w.said.filter((s) => /reached the Main Gate/.test(s)).length, 1);
  assert.ok(w.said.some((s) => /Management has agreed/.test(s)));
  assert.equal(w.desk.roadCrowd([marcher]).length, 1);
});

test("a thin march changes nothing and a relief pack is collected once", async () => {
  let id = 0;
  while (marchTurnout(`c:thin${id}`, 0).agreed) id++;
  const w = world();
  const state: UnionState = { id: `c:thin${id}`, kind: "protest", issue: "hostel maintenance", from: clockAt(0, 19, 47), until: 0, concession: "" };
  const plan = marchPlan(state);
  await w.store.addState({ ...state, until: plan.end });
  const p = w.join("p");
  w.state.clock = plan.end;
  await w.tick();
  await w.tick();
  assert.equal(w.store.campus.at(-1)?.kind, "standoff");
  assert.equal(w.desk.fareFactor(), 1);
  await w.desk.handle("p", { a: "relief" });
  assert.equal(p.packs, 0);
  await w.store.addState({ id: "after:packs", kind: "concession", issue: "x", from: w.state.clock, until: w.state.clock + 100, concession: "packs" });
  await w.store.addState({ id: "after:fare", kind: "concession", issue: "x", from: w.state.clock, until: w.state.clock + 100, concession: "fare" });
  await w.tick();
  assert.ok(w.desk.fareFactor() < 1);
  w.go(p, RALLY_POINTS[2]);
  await w.desk.handle("p", { a: "relief" });
  assert.equal(p.packs, 0);
  w.go(p, FORM_DESK);
  await w.desk.handle("p", { a: "relief" });
  await w.desk.handle("p", { a: "relief" });
  assert.equal(p.packs, 1);
  assert.ok(w.status("p").claimed.includes("relief:after:packs") || w.status("p").marks.includes("relief:after:packs"));
});

test("enough signatures bring an SRC sitting that removes or clears a seeded officer", async () => {
  const outcomes = new Set<boolean>();
  for (let week = 4; week < 40 && outcomes.size < 2; week++) {
    const w = world();
    w.state.clock = clockAt(1, 12, 0, week + 1);
    await w.tick();
    const record = { usedPower: npcWorked(week, race), turnoutFell: false, minutesInOffice: w.state.clock - (week * 7 * MINUTES_PER_DAY + ELECTION_TIMES.swearingIn) };
    let signers = 0;
    while (!sittingDue(signatureTotal(week, race, record, signers))) signers++;
    assert.ok(signers >= 1);
    for (let k = 0; k < signers; k++) {
      w.join(`s${k}x`);
      assert.equal(w.store.removals.length, 0);
      await w.desk.handle(`s${k}x`, { a: "sign", race });
    }
    w.join("s0", { profileId: profile("s0x") });
    await w.desk.handle("s0", { a: "sign", race });
    assert.match(w.notices("s0").at(-1)!, /already/);
    assert.equal([...w.store.marks].filter((m) => m.endsWith(impeachMark(race))).length, signers);
    assert.equal(w.store.removals.length, 1);
    const vote = srcSitting(week, race, record);
    outcomes.add(vote.removed);
    assert.equal(w.store.removals[0].removed, vote.removed);
    assert.equal(w.said.filter((s) => s.startsWith("⚖️")).length, 1);
    const holder = w.status("s0").holders.find((h) => h.race === race)!;
    assert.equal(holder.name === w.store.removals[0].successor, vote.removed);
    assert.equal(w.status("s0").impeachments.length, 1);
    assert.ok(w.status("s0").signed.includes(race));
  }
  assert.equal(outcomes.size, 2);
});

test("an idle player President can be removed and loses the title, and cannot sign against themselves", async () => {
  let removedOnce = false;
  for (let attempt = 0; attempt < 3 && !removedOnce; attempt++) {
    const w = world();
    await elect(w);
    w.state.clock = clockAt(4, 18, 1);
    await w.tick();
    w.state.clock = clockAt(1, 12, 0, WEEK + 1);
    await w.tick();
    await w.tick();
    assert.equal(w.offices.get("tola"), officeIndex(president));
    await w.desk.handle("tola", { a: "sign", race });
    assert.match(w.notices("tola").at(-1)!, /against yourself/);
    const record = { usedPower: false, turnoutFell: false, minutesInOffice: w.state.clock - (WEEK * 7 * MINUTES_PER_DAY + ELECTION_TIMES.swearingIn) };
    for (let k = 0; w.store.removals.length === 0 && k < 20; k++) {
      w.join(`s${k}x`);
      await w.desk.handle(`s${k}x`, { a: "sign", race });
    }
    w.join("s0");
    await w.desk.handle("s0", { a: "status" });
    const vote = srcSitting(WEEK, race, record);
    assert.equal(w.store.removals[0].removed, vote.removed);
    assert.equal(w.store.removals[0].ousted, "@tola");
    if (!vote.removed) {
      assert.equal(w.offices.get("tola"), officeIndex(president));
      break;
    }
    removedOnce = true;
    assert.equal(w.offices.get("tola"), 0);
    assert.equal(w.store.rows.length, 0);
    assert.notEqual(w.status("s0").holders.find((h) => h.race === race)?.name, "@tola");
  }
  assert.ok(removedOnce);
});

test("two candidates at one rally make a campaign train", async () => {
  const w = world();
  const a = await contest(w, "a");
  const b = await contest(w, "b");
  const solo = await contest(w, "solo");
  const rally = ralliesFor(WEEK)[0];
  const site = RALLY_POINTS[rally.site];
  w.state.clock = WEEK * 7 * MINUTES_PER_DAY + rally.start + 5;
  for (const p of [a, b]) w.go(p, site);
  w.go(solo, RALLY_POINTS[(rally.site + 1) % RALLY_POINTS.length]);
  await w.desk.handle("a", { a: "campaign", site: site.id });
  await w.tick(CAMPAIGN.speechMs);
  await w.desk.handle("b", { a: "campaign", site: site.id });
  await w.desk.handle("solo", { a: "campaign", site: RALLY_POINTS[(rally.site + 1) % RALLY_POINTS.length].id });
  await w.tick(CAMPAIGN.speechMs);
  const support = (id: string) => w.store.candidacies.find((c) => c.accountId === profile(id))!.support;
  assert.equal(support("a")[CAMPAIGN_TRAIN.key], CAMPAIGN_TRAIN.bonus);
  assert.equal(support("b")[CAMPAIGN_TRAIN.key], CAMPAIGN_TRAIN.bonus);
  assert.equal(support("a")[site.id], CAMPAIGN.gain * CAMPAIGN.rallyFactor);
  assert.equal(support("solo")[CAMPAIGN_TRAIN.key], undefined);
  for (const id of ["a", "b"]) assert.ok(w.notices(id).some((n) => /Campaign train/.test(n)));
  w.state.wall += CAMPAIGN_TRAIN.windowMs + CAMPAIGN.cooldownMs;
  await w.desk.handle("a", { a: "campaign", site: site.id });
  await w.tick(CAMPAIGN.speechMs);
  assert.equal(support("a")[CAMPAIGN_TRAIN.key], CAMPAIGN_TRAIN.bonus);
});

test("a campaign stop never drives cash or energy below zero", async () => {
  const w = world();
  const p = await contest(w, "tola");
  w.go(p, RALLY_POINTS[0]);
  w.state.clock = clockAt(1, 7);
  await w.desk.handle("tola", { a: "campaign", site: RALLY_POINTS[0].id });
  p.cash = CAMPAIGN.cost - 1;
  await w.tick(CAMPAIGN.speechMs);
  assert.equal(p.cash, CAMPAIGN.cost - 1);
  assert.equal(w.store.candidacies[0].support[RALLY_POINTS[0].id], undefined);
  p.cash = CAMPAIGN.cost;
  p.energy = CAMPAIGN.energy - 1;
  w.state.wall += CAMPAIGN.cooldownMs;
  await w.desk.handle("tola", { a: "campaign", site: RALLY_POINTS[0].id });
  assert.match(w.notices("tola").at(-1)!, /tired/);
  p.energy = CAMPAIGN.energy;
  await w.desk.handle("tola", { a: "campaign", site: RALLY_POINTS[0].id });
  p.energy = 1;
  await w.tick(CAMPAIGN.speechMs);
  assert.deepEqual([p.cash, p.energy], [CAMPAIGN.cost, 1]);
});

test("the department is bound for the week, so rejoining with another one opens no new ballot", async () => {
  const w = world();
  const p = w.join("voter", { department: "law" });
  w.state.clock = clockAt(4, 9);
  w.go(p, unitForFaculty("law"));
  const lawPick = npcCandidates(WEEK, deptPresident, "law").find((c) => !c.disqualified)!;
  await w.desk.handle("voter", { a: "vote", post: deptPresident.id, c: lawPick.id });
  assert.equal(w.store.votes.length, 1);
  w.desk.left("voter");
  w.players.delete("voter");
  const again = w.join("voter2", { department: "computer-science", profileId: p.profileId });
  const csPick = npcCandidates(WEEK, deptPresident, "computer-science").find((c) => !c.disqualified)!;
  for (const unit of POLL_UNITS) {
    w.go(again, unit);
    await w.desk.handle("voter2", { a: "vote", post: deptPresident.id, c: csPick.id });
    await w.desk.handle("voter2", { a: "form", post: deptPresident.id });
  }
  assert.equal(w.store.votes.length, 1);
  assert.equal(w.store.votes[0].race, "dept-president@law");
  assert.equal(w.status("voter2").department, "law");
  assert.equal(w.store.candidacies.length, 0);
  w.go(again, pollUnit("sub"));
  const head = npcCandidates(WEEK, president, SUG_SCOPE).find((c) => !c.disqualified)!;
  await w.desk.handle("voter2", { a: "vote", post: president.id, c: head.id });
  assert.equal(w.store.votes.length, 2);
  const next = world(w.store);
  const moved = next.join("voter3", { department: "computer-science", profileId: p.profileId });
  next.state.clock = clockAt(0, 9, 0, WEEK + 1);
  await next.desk.handle("voter3", { a: "form", post: deptPresident.id });
  assert.equal(next.store.candidacies[0]?.race, "dept-president@computer-science");
  assert.equal(moved.cash, 20_000 - formFee(deptPresident, "300L"));
});
