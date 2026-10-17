import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMPAIGN,
  CAMPAIGN_MATERIALS,
  DEBATE_SITE,
  FORM_DESK,
  GATHERING_SITES,
  MINUTES_PER_DAY,
  RALLY_POINTS,
  SUG_SCOPE,
  ServerMsg,
  ELECTION_TIMES,
  alutaFor,
  campaignGain,
  findPost,
  formFee,
  npcCandidates,
  officeIndex,
  pollUnit,
  raceKey,
  unitForFaculty,
  type PoliticsStatus,
} from "@campuslife/shared";
import { MemoryPoliticsStore, PoliticsDesk, type PoliticsPlayer } from "./Politics";

const WEEK = 12;
const clockAt = (weekday: number, hour: number, minute = 0, week = WEEK) => (week * 7 + weekday) * MINUTES_PER_DAY + hour * 60 + minute;
const president = findPost("sug-president")!;
const welfare = findPost("sug-welfare")!;
const deptPresident = findPost("dept-president")!;
const race = raceKey(president, SUG_SCOPE);

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
    const p: PoliticsPlayer = { x: FORM_DESK.x, y: FORM_DESK.y, cash: 20_000, energy: 100, fun: 50, packs: 0, gpTotal: 12, exams: 3, malpractice: 0, rusticatedUntil: 0, level: "300L", department: "law", profileId: id.padEnd(64, "0"), ...more };
    players.set(id, p);
    return p;
  };
  const notices = (id: string) => sent.filter((s) => s.id === id && s.type === ServerMsg.Notice).map((s) => String(s.payload));
  const status = (id: string) => sent.filter((s) => s.id === id && s.type === ServerMsg.Politics).at(-1)?.payload as PoliticsStatus;
  const go = (p: PoliticsPlayer, to: { x: number; y: number }) => {
    p.x = to.x;
    p.y = to.y;
  };
  const tick = async (advanceMs = 60_000) => {
    state.wall += advanceMs;
    await desk.tick();
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { desk, store, players, sent, said, offices, state, join, notices, status, go, tick };
}

test("a form needs the right day, the SUIEC desk, a clean record and the fee", async () => {
  const w = world();
  const tola = w.join("tola");
  w.state.clock = clockAt(2, 9);
  await w.desk.handle("tola", { a: "form", post: president.id });
  assert.match(w.notices("tola").at(-1)!, /Monday 8 am/);
  w.state.clock = clockAt(0, 9);
  w.go(tola, RALLY_POINTS[0]);
  await w.desk.handle("tola", { a: "form", post: president.id });
  assert.match(w.notices("tola").at(-1)!, /SUIEC desk/);
  w.go(tola, FORM_DESK);
  tola.malpractice = 1;
  await w.desk.handle("tola", { a: "form", post: president.id });
  assert.match(w.notices("tola").at(-1)!, /malpractice/);
  tola.malpractice = 0;
  tola.gpTotal = 6;
  await w.desk.handle("tola", { a: "form", post: president.id });
  assert.match(w.notices("tola").at(-1)!, /CGPA/);
  tola.gpTotal = 12;
  tola.cash = 100;
  await w.desk.handle("tola", { a: "form", post: president.id });
  assert.equal(tola.cash, 100);
  assert.equal(w.store.candidacies.length, 0);
  tola.cash = 20_000;
  await w.desk.handle("tola", { a: "form", post: president.id });
  assert.equal(tola.cash, 20_000 - formFee(president, "300L"));
  assert.equal(w.store.candidacies[0].race, race);
  assert.equal(w.status("tola").mine?.race, race);
  assert.ok(w.said.some((s) => /@tola has picked the SUG President form/.test(s)));
  await w.desk.handle("tola", { a: "form", post: welfare.id });
  assert.equal(w.store.candidacies.length, 1);
  assert.equal(tola.cash, 20_000 - formFee(president, "300L"));
});

test("faculty and department forms follow the student's own department", async () => {
  const w = world();
  w.join("ada", { department: "computer-science" });
  w.join("nodept", { department: "" });
  await w.desk.handle("ada", { a: "form", post: deptPresident.id });
  assert.equal(w.store.candidacies[0].race, "dept-president@computer-science");
  await w.desk.handle("nodept", { a: "form", post: deptPresident.id });
  assert.match(w.notices("nodept").at(-1)!, /department/);
  assert.equal(w.store.candidacies.length, 1);
});

test("a late form on Tuesday morning costs more", async () => {
  const w = world();
  const p = w.join("late");
  w.state.clock = clockAt(1, 9);
  await w.desk.handle("late", { a: "form", post: president.id });
  assert.equal(p.cash, 20_000 - formFee(president, "300L", true));
});

test("the fee comes back when the register is down", async () => {
  const w = world();
  const p = w.join("tola");
  w.store.down = true;
  await w.desk.handle("tola", { a: "form", post: president.id });
  assert.equal(p.cash, 20_000);
  assert.match(w.notices("tola").at(-1)!, /offline/);
  assert.equal(w.status("tola").ok, false);
  w.store.down = false;
  await w.desk.handle("tola", { a: "status" });
  assert.equal(w.status("tola").ok, true);
});

test("campaigning is a timed stop that costs energy and cash and fades per hall each day", async () => {
  const w = world();
  const p = w.join("tola");
  await w.desk.handle("tola", { a: "form", post: president.id });
  const cash = p.cash;
  const awo = RALLY_POINTS[0];
  w.go(p, awo);
  await w.desk.handle("tola", { a: "campaign", site: awo.id });
  assert.match(w.notices("tola").at(-1)!, /Tuesday/);
  w.state.clock = clockAt(1, 7);
  await w.desk.handle("tola", { a: "campaign", site: awo.id });
  assert.equal(p.cash, cash);
  assert.ok(w.status("tola").mine!.speakingMs > 0);
  await w.desk.handle("tola", { a: "campaign", site: awo.id });
  assert.match(w.notices("tola").at(-1)!, /still speaking/);
  await w.tick(CAMPAIGN.speechMs);
  assert.equal(p.cash, cash - CAMPAIGN.cost);
  assert.equal(p.energy, 100 - CAMPAIGN.energy);
  assert.equal(w.store.candidacies[0].support[awo.id], CAMPAIGN.gain);
  await w.desk.handle("tola", { a: "campaign", site: awo.id });
  assert.match(w.notices("tola").at(-1)!, /breath/);
  const stop = async () => {
    w.state.wall += CAMPAIGN.cooldownMs;
    p.energy = 100;
    await w.desk.handle("tola", { a: "campaign", site: awo.id });
    await w.tick(CAMPAIGN.speechMs);
  };
  await stop();
  const second = w.store.candidacies[0].support[awo.id] - CAMPAIGN.gain;
  assert.equal(second, campaignGain("sug", CAMPAIGN.gain, false, 1));
  assert.ok(second < CAMPAIGN.gain);
  w.state.wall += CAMPAIGN.cooldownMs;
  await w.desk.handle("tola", { a: "campaign", site: awo.id });
  w.go(p, RALLY_POINTS[3]);
  const before = p.cash;
  await w.tick(CAMPAIGN.speechMs);
  assert.match(w.notices("tola").at(-1)!, /walked off/);
  assert.equal(p.cash, before);
  w.go(p, awo);
  w.state.clock = clockAt(2, 7);
  const dayOne = w.store.candidacies[0].support[awo.id];
  await stop();
  assert.equal(w.store.candidacies[0].support[awo.id] - dayOne, CAMPAIGN.gain);
  for (let i = 0; i < 40; i++) await stop();
  assert.equal(w.store.candidacies[0].support[awo.id], CAMPAIGN.hallCap);
  assert.match(w.notices("tola").at(-1)!, /hear you finish/);
  w.join("idle");
  w.go(w.players.get("idle")!, awo);
  await w.desk.handle("idle", { a: "campaign", site: awo.id });
  assert.match(w.notices("idle").at(-1)!, /not contesting/);
});

test("campaign materials raise reach once each", async () => {
  const w = world();
  const p = w.join("tola");
  await w.desk.handle("tola", { a: "form", post: president.id });
  const van = CAMPAIGN_MATERIALS.find((m) => m.id === "van")!;
  const cash = p.cash;
  await w.desk.handle("tola", { a: "material", item: van.id });
  await w.desk.handle("tola", { a: "material", item: van.id });
  await w.desk.handle("tola", { a: "material", item: "helicopter" });
  assert.equal(p.cash, cash - van.price);
  assert.deepEqual(w.store.candidacies[0].materials, [van.id]);
});

test("a student endorses one candidate a week and never themselves", async () => {
  const w = world();
  w.join("tola");
  w.join("fan");
  await w.desk.handle("tola", { a: "form", post: president.id });
  const mine = w.store.candidacies[0].id;
  await w.desk.handle("tola", { a: "endorse", post: president.id, c: mine });
  assert.equal(w.store.endorsements.length, 0);
  await w.desk.handle("fan", { a: "endorse", post: president.id, c: "nobody" });
  assert.equal(w.store.endorsements.length, 0);
  await w.desk.handle("fan", { a: "endorse", post: president.id, c: mine });
  await w.desk.handle("fan", { a: "endorse", post: welfare.id, c: "n0" });
  assert.equal(w.store.endorsements.length, 1);
  assert.equal(w.status("fan").endorsed, `${race}#${mine}`);
  assert.equal(w.status("fan").endorsements[`${race}#${mine}`], 1);
});

test("one vote per account per post, in person, while polls are open", async () => {
  const w = world();
  const p = w.join("voter");
  const unit = pollUnit("sub");
  const field = npcCandidates(WEEK, president, SUG_SCOPE).filter((c) => !c.disqualified);
  w.go(p, unit);
  w.state.clock = clockAt(4, 7);
  await w.desk.handle("voter", { a: "vote", post: president.id, c: field[0].id });
  assert.equal(w.store.votes.length, 0);
  w.state.clock = clockAt(4, 9);
  w.go(p, RALLY_POINTS[2]);
  await w.desk.handle("voter", { a: "vote", post: president.id, c: field[0].id });
  assert.match(w.notices("voter").at(-1)!, /polling unit/);
  w.go(p, unit);
  await w.desk.handle("voter", { a: "vote", post: president.id, c: "ghost" });
  assert.equal(w.store.votes.length, 0);
  await w.desk.handle("voter", { a: "vote", post: president.id, c: field[0].id });
  await w.desk.handle("voter", { a: "vote", post: president.id, c: field[1].id });
  assert.equal(w.store.votes.length, 1);
  assert.match(w.notices("voter").at(-1)!, /One student, one vote/);
  await w.desk.handle("voter", { a: "vote", post: welfare.id, c: npcCandidates(WEEK, welfare, SUG_SCOPE).find((c) => !c.disqualified)!.id });
  assert.equal(w.store.votes.length, 2);
  assert.deepEqual(w.status("voter").voted.sort(), [race, raceKey(welfare, SUG_SCOPE)].sort());
  await w.desk.handle("voter", { a: "vote", post: deptPresident.id, c: "n0" });
  assert.equal(w.store.votes.length, 2);
  w.go(p, unitForFaculty("law"));
  const dept = npcCandidates(WEEK, deptPresident, "law").find((c) => !c.disqualified)!;
  await w.desk.handle("voter", { a: "vote", post: deptPresident.id, c: dept.id });
  assert.equal(w.store.votes.length, 3);
  w.state.clock = clockAt(4, 16);
  await w.desk.handle("voter", { a: "vote", post: findPost("sug-vp")!.id, c: "n0" });
  assert.equal(w.store.votes.length, 3);
});

test("the debate crowd becomes informed voters and candidates speak once", async () => {
  const w = world();
  const tola = w.join("tola");
  const fan = w.join("fan");
  await w.desk.handle("tola", { a: "form", post: president.id });
  w.go(tola, DEBATE_SITE);
  w.go(fan, DEBATE_SITE);
  await w.desk.handle("fan", { a: "attend" });
  assert.equal(fan.fun, 50);
  w.state.clock = clockAt(3, 20);
  await w.desk.handle("fan", { a: "attend" });
  await w.desk.handle("fan", { a: "attend" });
  assert.ok(fan.fun > 50 && fan.fun < 70);
  await w.desk.handle("tola", { a: "speak" });
  await w.desk.handle("tola", { a: "speak" });
  assert.equal(w.store.candidacies[0].spoke, true);
  assert.ok(w.status("tola").mine!.effort > 0);
  w.state.clock = clockAt(4, 9);
  w.go(fan, pollUnit("sub"));
  await w.desk.handle("fan", { a: "vote", post: president.id, c: w.store.candidacies[0].id });
  assert.equal(w.store.votes[0].informed, true);
});

async function electTola(w: ReturnType<typeof world>) {
  const tola = w.join("tola");
  await w.desk.handle("tola", { a: "form", post: president.id });
  w.go(tola, pollUnit("sub"));
  w.state.clock = clockAt(4, 9);
  for (let i = 0; i < 40; i++) await w.store.vote(`v${i}x`.padEnd(64, "0"), WEEK, race, w.store.candidacies[0].id, false);
  return tola;
}

test("results are counted once and the winner is seated", async () => {
  const w = world();
  await electTola(w);
  w.state.clock = clockAt(4, 17);
  await w.tick();
  assert.equal(w.store.rows.length, 0);
  assert.deepEqual(w.status("tola")?.results ?? [], []);
  w.state.clock = clockAt(4, 18, 1);
  await w.tick();
  await w.tick();
  assert.equal(w.store.rows.length, 1);
  assert.equal(w.store.rows[0].accountId, w.players.get("tola")!.profileId);
  assert.ok(!w.said.some((s) => /declares/.test(s)));
  await w.desk.handle("tola", { a: "status" });
  assert.deepEqual(w.status("tola").results, []);
  w.state.clock = WEEK * 7 * MINUTES_PER_DAY + ELECTION_TIMES.declaration;
  await w.tick();
  assert.ok(w.said.some((s) => /declares @tola the new SUG President/.test(s)));
  await w.desk.handle("tola", { a: "status" });
  const result = w.status("tola").results.find((r) => r.race === race)!;
  assert.equal(result.winner, w.store.candidacies[0].id);
  assert.equal(result.rows[0].real, 40);
  assert.equal(w.offices.get("tola") ?? 0, 0);
});

test("the stipend is paid once, even with two rooms and a restart", async () => {
  const store = new MemoryPoliticsStore();
  const a = world(store);
  const tola = await electTola(a);
  const before = tola.cash;
  const b = world(store);
  const twin = b.join("tola");
  twin.cash = 0;
  for (const w of [a, b]) w.state.clock = clockAt(4, 18, 1);
  await Promise.all([a.tick(), b.tick()]);
  assert.equal(store.rows.length, 1);
  assert.equal(tola.cash, before);
  for (const w of [a, b]) w.state.clock = clockAt(5, 10, 1);
  await Promise.all([a.tick(), b.tick()]);
  await Promise.all([a.tick(), b.tick()]);
  assert.equal(tola.cash + twin.cash, before + president.stipend);
  assert.equal(a.offices.get("tola"), officeIndex(president));
  assert.equal(store.rows[0].stipendPaid, true);
  const c = world(store);
  const again = c.join("tola");
  again.cash = 0;
  c.state.clock = clockAt(6, 12);
  await c.tick();
  c.desk.joined("tola");
  await c.tick();
  assert.equal(again.cash, 0);
  assert.equal(c.offices.get("tola"), officeIndex(president));
  c.state.clock = clockAt(2, 12, 0, WEEK + 1);
  await c.tick();
  assert.equal(c.offices.get("tola"), officeIndex(president));
  await c.desk.handle("tola", { a: "status" });
  assert.equal(c.status("tola").office?.race, race);
  assert.ok(c.status("tola").holders.some((h) => h.race === race && h.mine && !h.npc));
  c.state.clock = clockAt(5, 11, 0, WEEK + 1);
  await c.tick();
  assert.equal(c.offices.get("tola"), 0);
});

test("the President calls Congress once and students join it once", async () => {
  const w = world();
  const tola = await electTola(w);
  const fan = w.join("fan");
  w.state.clock = clockAt(5, 12);
  await w.tick();
  await w.desk.handle("tola", { a: "power" });
  assert.match(w.notices("tola").at(-1)!, /Go to Awolowo Hall/);
  w.go(tola, GATHERING_SITES.awo);
  await w.desk.handle("tola", { a: "power" });
  assert.ok(w.said.some((s) => /Congress!/.test(s)));
  assert.equal(w.store.rows[0].powerUsedAt, clockAt(5, 12));
  const calls = w.said.filter((s) => /Congress!/.test(s)).length;
  await w.desk.handle("tola", { a: "power" });
  assert.equal(w.said.filter((s) => /Congress!/.test(s)).length, calls);
  await w.desk.handle("fan", { a: "join", g: race });
  assert.equal(fan.fun, 50);
  w.go(fan, GATHERING_SITES.awo);
  await w.desk.handle("fan", { a: "join", g: race });
  await w.desk.handle("fan", { a: "join", g: race });
  assert.equal(fan.fun, 64);
  assert.equal(w.status("fan").gatherings.some((g) => g.id === race), true);
  w.state.clock = clockAt(5, 14);
  await w.desk.handle("fan", { a: "status" });
  assert.equal(w.status("fan").gatherings.some((g) => g.id === race), false);
});

test("a second room hears about a power used elsewhere", async () => {
  const store = new MemoryPoliticsStore();
  const a = world(store);
  const tola = await electTola(a);
  const b = world(store);
  for (const w of [a, b]) w.state.clock = clockAt(5, 12);
  await a.tick();
  await b.tick();
  a.go(tola, GATHERING_SITES.awo);
  await a.desk.handle("tola", { a: "power" });
  await b.tick();
  assert.equal(b.said.filter((s) => /Congress!/.test(s)).length, 1);
  await a.tick();
  assert.equal(a.said.filter((s) => /Congress!/.test(s)).length, 1);
});

test("the Welfare Officer shares packs with students nearby", async () => {
  const w = world();
  const boss = w.join("boss");
  const near = w.join("near");
  const far = w.join("far");
  w.go(far, RALLY_POINTS[4]);
  await w.store.seat([{ cycle: WEEK, race: raceKey(welfare, SUG_SCOPE), accountId: boss.profileId, name: "@boss", stipend: 0, stipendPaid: true, powerUsedAt: null }]);
  w.state.clock = clockAt(6, 12);
  await w.tick();
  await w.desk.handle("boss", { a: "power" });
  await w.desk.handle("boss", { a: "power" });
  assert.deepEqual([boss.packs, near.packs, far.packs], [1, 1, 0]);
});

test("aluta weeks let students join once for fun", async () => {
  let week = 0;
  while (!alutaFor(week)) week++;
  const aluta = alutaFor(week)!;
  const w = world();
  const p = w.join("comrade");
  w.state.clock = week * 7 * MINUTES_PER_DAY + aluta.start + 5;
  await w.tick();
  assert.ok(w.said.some((s) => s.includes(aluta.notice.replace(/^\S+\s/, ""))));
  w.go(p, GATHERING_SITES[aluta.site]);
  await w.desk.handle("comrade", { a: "join", g: "aluta" });
  await w.desk.handle("comrade", { a: "join", g: "aluta" });
  assert.equal(p.fun, 50 + aluta.fun);
});

test("bad payloads and strangers are ignored", async () => {
  const w = world();
  w.join("tola");
  for (const bad of [null, 3, "form", {}, { a: "form" }, { a: "vote", post: 1, c: 2 }, { a: "x" }]) await w.desk.handle("tola", bad);
  await w.desk.handle("ghost", { a: "status" });
  assert.equal(w.sent.length, 0);
  assert.equal(w.store.candidacies.length, 0);
});

test("news lines are announced once in their window", async () => {
  const w = world();
  w.state.clock = clockAt(4, 8, 2);
  await w.tick();
  await w.tick();
  assert.equal(w.said.filter((s) => /Polls are open/.test(s)).length, 1);
});
