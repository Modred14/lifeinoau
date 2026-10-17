/**
 * Union politics against a private server (started here, on SMOKE_PORT).
 *
 *   npx tsx scripts/smoke-politics.ts   (from server/)
 *
 * One election week, in order: Monday 11:02 (forms, aluta sit-out, endorsements),
 * Tuesday 10:02 (campaign at a rally), Thursday 19:02 (Press Night), Friday 08:02
 * (voting), Friday 17:57 (results at 18:00, declaration at 18:24), Saturday 10:01
 * (swearing-in, stipend, office power) and Saturday 19:28 (congress vote).
 */
import { Client } from "@colyseus/sdk";
import {
  CAMPAIGN,
  CAMPAIGN_MATERIALS,
  CELEBRATE,
  DEBATE_FUN,
  DEBATE_SITE,
  ELECTION_TIMES,
  FORM_DESK,
  Msg,
  POLITICS_REACH,
  RALLY_POINTS,
  SUB_UNIT,
  SUG_SCOPE,
  ServerMsg,
  WEEK_MINUTES,
  alutaFor,
  ballotFor,
  campaignGain,
  congressResult,
  congressStand,
  congressStateId,
  congressesFor,
  effortOf,
  entryScore,
  facultyOf,
  findPost,
  formFee,
  formPayload,
  npcCandidates,
  officeIndex,
  parsePoliticsStatus,
  parseUnionWorld,
  pollUnit,
  raceKey,
  ralliesFor,
  resultLine,
  settlesAt,
  unitForFaculty,
  voteOpensAt,
  type Point,
  type PoliticsStatus,
} from "@campuslife/shared";
import { smokeAccount } from "./smoke-account";
import { SMOKE_URL, gameMinutesToMs, sleep, startServer, stopServer, totalAt } from "./smoke-clock";
import { Actor, OAU, SAVE_SETTLE_MS, check, clearPolitics, note, patchSave, run, seedSave, until } from "./smoke-kit";

const CYCLE = 377;
const CANDIDATE = "smoke_pol_cand";
const VOTERS = ["smoke_pol_v1", "smoke_pol_v2", "smoke_pol_v3"];
const EVERYONE = [CANDIDATE, ...VOTERS];
const DEPARTMENT = "computer-science";
const OTHER_DEPARTMENT = "law";
const LEVEL = "200L";
const CASH = 8000;
const POST_ID = "dept-gensec";
const profile = { school: OAU, level: LEVEL, department: DEPARTMENT };
const post = findPost(POST_ID)!;
const head = findPost("sug-president")!;
const race = raceKey(post, DEPARTMENT);
const faculty = facultyOf(DEPARTMENT)!;
const deptUnit = unitForFaculty(faculty.key);
const week = CYCLE * WEEK_MINUTES;

const ask = (actor: Actor, action: Record<string, unknown>) => actor.ask(Msg.Politics, action, ServerMsg.Politics, 5000).then((raw) => parsePoliticsStatus(raw) ?? undefined);
const place = async (names: readonly string[], at: Point) => {
  for (const name of names) await patchSave(name, { at });
};
const joinAll = (client: Client, url: string, names: readonly string[], options = profile) => Promise.all(names.map((name) => Actor.join(client, url, name, options)));
const leaveAll = async (actors: readonly Actor[]) => {
  for (const actor of actors) await actor.leave();
};

await run("smoke-politics", async () => {
  const client = new Client(SMOKE_URL);
  const rally = ralliesFor(CYCLE)[0];
  const hall = RALLY_POINTS[rally.site];
  const otherHall = RALLY_POINTS.find((r) => r.id !== hall.id)!;
  const aluta = alutaFor(CYCLE);
  const mondayAt = aluta && aluta.start >= ELECTION_TIMES.formsOpen && aluta.start < ELECTION_TIMES.lateForms && aluta.site === "sub" ? aluta.start + 2 : ELECTION_TIMES.formsOpen + 5;

  // ---- Monday: forms at the SUIEC desk, the sit-out, endorsements.
  let url = await startServer(week + mondayAt);
  for (const name of EVERYONE) await smokeAccount(url, name);
  await clearPolitics(EVERYONE, CYCLE);
  await seedSave(CANDIDATE, { cash: CASH, at: FORM_DESK });
  for (const name of VOTERS) await seedSave(name, { cash: CASH, at: DEBATE_SITE });
  let cand = await Actor.join(client, url, CANDIDATE, profile);
  let voters = await joinAll(client, url, VOTERS);
  let status = await ask(cand, { a: "status" });
  check(status?.ok === true && status.cycle === CYCLE && status.department === DEPARTMENT && status.faculty === faculty.key && status.mine === null, `status is sane on Monday (cycle ${status?.cycle}, ${status?.faculty})`);
  check(status?.voted.length === 0 && status.declared === false && status.results.length === 0, "nothing voted, nothing declared yet");

  let from = cand.mark;
  status = await ask(cand, formPayload(head.id, { nick: 0, slogan: 0, color: 0 }));
  check(cand.said(/write at least one test first/, from) !== undefined && status?.mine === null && cand.me.cash === CASH, "a student with no test written is screened out of SUG President");
  from = voters[0].mark;
  await ask(voters[0], formPayload(POST_ID, { nick: 1, slogan: 1, color: 1 }));
  check(voters[0].said(/forms are at the SUIEC desk/, from) !== undefined && voters[0].me.cash === CASH, "a form away from the desk is refused");
  const fee = formFee(post, LEVEL);
  from = cand.mark;
  status = await ask(cand, formPayload(POST_ID, { nick: 2, slogan: 3, color: 1 }));
  await sleep(300);
  check(status?.mine?.race === race && cand.me.cash === CASH - fee && cand.said(/SUIEC cleared you for Dept\. Gen\. Sec\./, from) !== undefined, `picked the ${post.title} form for ₦${fee} (cash ${cand.me.cash})`);
  check(voters[0].said(/has picked the Dept\. Gen\. Sec\. form/) !== undefined, "the campus hears about the new aspirant");
  from = cand.mark;
  status = await ask(cand, formPayload("dept-president", { nick: 0, slogan: 0, color: 0 }));
  await sleep(300);
  check(cand.said(/One form per student/, from) !== undefined && cand.me.cash === CASH - fee && status?.mine?.race === race, "a second form in the same week is refused and not charged");
  const mine = status?.mine?.id ?? "";

  if (aluta && mondayAt === aluta.start + 2) {
    status = await ask(cand, { a: "status" });
    const fun0 = cand.me.fun;
    from = cand.mark;
    check(status?.gatherings.some((g) => g.id === "aluta") === true, `the ${aluta.title.toLowerCase()} shows as a gathering`);
    status = await ask(cand, { a: "join", g: "aluta" });
    await sleep(300);
    check(cand.said(/Aluta continua/, from) !== undefined && cand.me.fun >= Math.min(100, fun0 + aluta.fun - 1) && status?.marks.includes("aluta") === true, `joined it at the SUB (fun ${fun0} to ${cand.me.fun})`);
    from = cand.mark;
    await ask(cand, { a: "join", g: "aluta" });
    check(cand.said(/already counted here/, from) !== undefined, "joining twice is refused");
    from = voters[0].mark;
    await ask(voters[0], { a: "join", g: "aluta" });
    check(voters[0].said(/Go there to join/, from) !== undefined, "joining from far away is refused");
  } else note("no Monday sit-out at the SUB this week, gathering checks skipped");

  for (const voter of voters) {
    from = voter.mark;
    status = await ask(voter, { a: "endorse", post: POST_ID, c: mine });
    check(voter.said(/You endorsed/, from) !== undefined && status?.endorsed === `${race}#${mine}`, `${voter.username} endorsed the candidate`);
  }
  from = voters[0].mark;
  await ask(voters[0], { a: "endorse", post: POST_ID, c: "n0" });
  check(voters[0].said(/endorsed someone this week already/, from) !== undefined, "one endorsement per student");
  from = cand.mark;
  status = await ask(cand, { a: "endorse", post: POST_ID, c: mine });
  check(cand.said(/cannot endorse yourself/, from) !== undefined && status?.endorsements[`${race}#${mine}`] === VOTERS.length, `self-endorsement refused, ${VOTERS.length} endorsements counted`);
  from = cand.mark;
  await ask(cand, { a: "vote", post: head.id, c: "n0" });
  check(cand.said(/Polls open on Friday/, from) !== undefined, "voting before Friday is refused");
  await leaveAll([cand, ...voters]);
  await stopServer();

  // ---- Tuesday: campaign at a hall while the rally is on.
  await place([CANDIDATE, VOTERS[0]], hall);
  url = await startServer(week + rally.start + 2);
  cand = await Actor.join(client, url, CANDIDATE, profile);
  voters = await joinAll(client, url, VOTERS.slice(0, 1));
  from = voters[0].mark;
  await ask(voters[0], { a: "campaign", site: hall.id });
  check(voters[0].said(/You are not contesting this week/, from) !== undefined, "campaigning without a form is refused");
  from = cand.mark;
  await ask(cand, { a: "campaign", site: otherHall.id });
  check(cand.said(/Walk up to a hall front/, from) !== undefined, "campaigning for a hall you are not at is refused");
  const cashT = cand.me.cash;
  const energyT = cand.me.energy;
  from = cand.mark;
  status = await ask(cand, { a: "campaign", site: hall.id });
  check(cand.said(/You are speaking at/, from) !== undefined && (status?.mine?.speakingMs ?? 0) > 0 && cand.me.cash === cashT, `speech started at ${hall.name}, nothing charged yet`);
  from = cand.mark;
  await ask(cand, { a: "campaign", site: hall.id });
  check(cand.said(/still speaking/, from) !== undefined, "a second speech on top is refused");
  const first = campaignGain("dept", 0, true, 0);
  check(await cand.waitNotice(new RegExp(`You campaigned at ${hall.name}\\. \\+${first} support, the rally crowd doubled it`), CAMPAIGN.speechMs + 4000, from), `the stop lands with +${first} support at a rally`);
  from = cand.mark;
  await ask(cand, { a: "campaign", site: hall.id });
  check(cand.said(/Catch your breath first/, from) !== undefined, "the cooldown holds between stops");
  check(cand.me.cash === cashT - CAMPAIGN.cost && cand.me.energy <= energyT - CAMPAIGN.energy + 1, `logistics ₦${CAMPAIGN.cost} charged once (cash ${cand.me.cash}, energy ${energyT} to ${cand.me.energy})`);
  await sleep(CAMPAIGN.cooldownMs);
  from = cand.mark;
  await ask(cand, { a: "campaign", site: hall.id });
  const off = { x: hall.x + POLITICS_REACH * 1.6, y: hall.y };
  const walkedOff = (await cand.walkTo(off)) || (await cand.walkTo({ x: hall.x - POLITICS_REACH * 1.6, y: hall.y })) || (await cand.walkTo({ x: hall.x, y: hall.y + POLITICS_REACH * 1.6 }));
  const lost = await cand.waitNotice(/You walked off before you finished/, CAMPAIGN.speechMs + 4000, from);
  if (walkedOff) check(lost && cand.me.cash === cashT - CAMPAIGN.cost, "walking off mid-speech earns nothing and costs nothing");
  else note("could not walk clear of the hall front, the walk-off check was skipped");
  await cand.walkTo(hall);
  await sleep(CAMPAIGN.cooldownMs);
  const second = campaignGain("dept", first, true, 1);
  from = cand.mark;
  await ask(cand, { a: "campaign", site: hall.id });
  check(await cand.waitNotice(new RegExp(`\\+${second} support.*fading`), CAMPAIGN.speechMs + 4000, from), `a second stop the same day fades to +${second}`);
  const poster = CAMPAIGN_MATERIALS[0];
  await sleep(600);
  const cashM = cand.me.cash;
  check(cashM === cashT - CAMPAIGN.cost * 2, `two finished stops cost ₦${CAMPAIGN.cost * 2} in all (cash ${cashM})`);
  from = cand.mark;
  status = await ask(cand, { a: "material", item: poster.id });
  await sleep(300);
  check(cand.me.cash === cashM - poster.price && status?.mine?.materials.includes(poster.id) === true, `${poster.name} bought for ₦${poster.price}`);
  from = cand.mark;
  status = await ask(cand, { a: "material", item: poster.id });
  await sleep(300);
  check(cand.said(/already has that/, from) !== undefined && cand.me.cash === cashM - poster.price, "the same material twice is refused and not charged");
  check(status?.mine?.support[hall.id] === first + second && status.mine.effort === effortOf("dept", { [hall.id]: first + second }, [poster.id], false), `status: support ${status?.mine?.support[hall.id]}, effort ${status?.mine?.effort}`);
  await leaveAll([cand, ...voters]);
  await stopServer();

  // ---- Thursday night: Press Night and Debate.
  await place(EVERYONE, DEBATE_SITE);
  url = await startServer(week + ELECTION_TIMES.debateStart + 2);
  cand = await Actor.join(client, url, CANDIDATE, profile);
  voters = await joinAll(client, url, VOTERS);
  for (const voter of voters) {
    from = voter.mark;
    const fun0 = voter.me.fun;
    status = await ask(voter, { a: "attend" });
    await sleep(200);
    check(voter.said(/informed voter now/, from) !== undefined && status?.marks.includes("debate") === true && voter.me.fun >= Math.min(100, fun0 + DEBATE_FUN - 1), `${voter.username} watched the debate`);
  }
  from = voters[0].mark;
  await ask(voters[0], { a: "attend" });
  check(voters[0].said(/already counted in the crowd/, from) !== undefined, "attending twice is refused");
  from = voters[0].mark;
  await ask(voters[0], { a: "speak" });
  check(voters[0].said(/You are not contesting/, from) !== undefined, "only candidates face the press");
  from = cand.mark;
  status = await ask(cand, { a: "speak" });
  check(cand.said(/You faced the press/, from) !== undefined && status?.mine?.spoke === true, "the candidate faced the press");
  from = cand.mark;
  status = await ask(cand, { a: "speak" });
  check(cand.said(/faced the press already/, from) !== undefined, "and cannot do it twice");
  const effort = effortOf("dept", { [hall.id]: first + second }, [poster.id], true);
  check(status?.mine?.effort === effort, `effort after the debate is ${effort}`);
  await leaveAll([cand, ...voters]);
  await stopServer();

  // ---- Friday morning: voting.
  await place([CANDIDATE], pollUnit(SUB_UNIT));
  await place(VOTERS, deptUnit);
  url = await startServer(week + ELECTION_TIMES.pollsOpen + 2);
  cand = await Actor.join(client, url, CANDIDATE, profile);
  voters = await joinAll(client, url, VOTERS);
  const headBallot = ballotFor(CYCLE, head, SUG_SCOPE, []).filter((c) => !c.disqualified);
  from = cand.mark;
  status = await ask(cand, { a: "vote", post: head.id, c: headBallot[0].id });
  check(cand.said(/Vote cast for SUG President/, from) !== undefined && status?.voted.includes(raceKey(head, SUG_SCOPE)) === true, "voted for SUG President at the SUB unit");
  from = cand.mark;
  status = await ask(cand, { a: "vote", post: head.id, c: headBallot[1]?.id ?? headBallot[0].id });
  check(cand.said(/voted for this post already/, from) !== undefined && status?.voted.length === 1, "a second vote for the same post is refused");
  from = cand.mark;
  status = await ask(cand, { a: "vote", post: POST_ID, c: mine });
  check(cand.said(new RegExp(`Vote for ${post.title.replace(/\./g, "\\.")} at the ${deptUnit.name} polling unit`), from) !== undefined && status?.voted.length === 1, `a departmental vote at the wrong unit is refused: "${cand.notices(from)[0] ?? ""}"`);
  from = voters[0].mark;
  await ask(voters[0], { a: "vote", post: POST_ID, c: "nobody" });
  check(voters[0].said(/not on the ballot/, from) !== undefined, "a made-up candidate is refused");
  for (const voter of voters) {
    from = voter.mark;
    status = await ask(voter, { a: "vote", post: POST_ID, c: mine });
    check(voter.said(/Vote cast for Dept\. Gen\. Sec\..*counts extra/, from) !== undefined && status?.voted.includes(race) === true, `${voter.username} voted at the ${deptUnit.name} unit, as an informed voter`);
  }
  from = voters[0].mark;
  await ask(voters[0], { a: "vote", post: POST_ID, c: "n0" });
  check(voters[0].said(/voted for this post already/, from) !== undefined, "the second departmental vote is refused");

  await voters[0].leave();
  await sleep(SAVE_SETTLE_MS);
  const switched = await Actor.join(client, url, VOTERS[0], { ...profile, department: OTHER_DEPARTMENT });
  status = await ask(switched, { a: "status" });
  check(status?.department === DEPARTMENT && status.faculty === faculty.key, `rejoining as a ${OTHER_DEPARTMENT} student keeps this week's ballot in ${status?.department}`);
  from = switched.mark;
  status = await ask(switched, { a: "vote", post: POST_ID, c: "n0" });
  check(switched.said(/voted for this post already/, from) !== undefined && status?.voted.length === 1, "and cannot vote again for the same post");
  from = switched.mark;
  status = await ask(switched, { a: "vote", post: "dept-president", c: "n0" });
  const votedRaces = status?.voted ?? [];
  check(votedRaces.every((r) => !r.endsWith(`@${OTHER_DEPARTMENT}`)) && votedRaces.every((r) => r.endsWith(`@${DEPARTMENT}`)), `no vote lands in the ${OTHER_DEPARTMENT} races (voted: ${votedRaces.join(", ")})`);
  await leaveAll([cand, switched, ...voters.slice(1)]);
  await stopServer();

  // ---- Friday evening: results at 18:00, declaration at 18:24.
  url = await startServer(week + ELECTION_TIMES.results - 3);
  cand = await Actor.join(client, url, CANDIDATE, profile);
  voters = await joinAll(client, url, VOTERS.slice(1, 2));
  from = cand.mark;
  await ask(cand, { a: "vote", post: "sug-vp", c: "n0" });
  check(cand.said(/Polls open on Friday from 8 am to 4 pm/, from) !== undefined, "voting after the polls close is refused");
  from = cand.mark;
  await ask(cand, { a: "celebrate" });
  check(cand.said(/SUIEC has not declared yet/, from) !== undefined, "no celebrating before the declaration");
  await until(() => cand.clock >= week + ELECTION_TIMES.results + 3, gameMinutesToMs(8));
  status = await ask(cand, { a: "status" });
  check(status?.declared === false && status.returns.length === 2 && status.results.length === 0, `counting at 18:03: returns for ${status?.returns.map((r) => r.race).join(" and ")}, nothing declared`);
  check(await cand.waitNotice(/SUIEC declares .* the new SUG President with [\d,]+ votes/, gameMinutesToMs(ELECTION_TIMES.declaration - ELECTION_TIMES.results + 4)), `declaration broadcast: "${cand.said(/SUIEC declares/) ?? ""}"`);
  await sleep(1500);
  status = await ask(cand, { a: "status" });
  const result = status?.results.find((r) => r.race === race);
  const row = result?.rows.find((r) => r.id === mine);
  const npcs = npcCandidates(CYCLE, post, DEPARTMENT).filter((c) => !c.disqualified);
  const expected = entryScore(post, { id: mine, name: "", npc: false, base: effort, endorsements: VOTERS.length, votes: VOTERS.length, informed: VOTERS.length });
  const shouldWin = npcs.every((c) => c.base < expected);
  check(status?.declared === true && status.results.length === 15 && status.results.every((r) => r.rows.length > 0 && r.winner !== null), `declared: ${status?.results.length} races, each with a winner`);
  check(row?.total === expected && row.real === VOTERS.length, `my tally is ${row?.total} (expected ${expected}) from ${row?.real} real votes; rivals ${npcs.map((c) => c.base).join(", ")}`);
  check(status?.outcome === (shouldWin ? "won" : "lost") && (result?.winner === mine) === shouldWin, `outcome is "${status?.outcome}"`);
  check(cand.said(shouldWin ? /You won! You are the new Dept\. Gen\. Sec\./ : /You lost the Dept\. Gen\. Sec\. race/) !== undefined, "the candidate is told the result");
  if (shouldWin) {
    const fun0 = cand.me.fun;
    from = cand.mark;
    await ask(cand, { a: "celebrate" });
    await sleep(300);
    check(voters[0].said(/is celebrating the Dept\. Gen\. Sec\. win/, 0) !== undefined && cand.me.fun >= Math.min(100, fun0 + CELEBRATE.fun - 1), "the winner celebrates and the campus hears it");
    from = cand.mark;
    await ask(cand, { a: "celebrate" });
    check(cand.said(/celebrated already/, from) !== undefined, "only once");
  }
  const fridayCash = cand.me.cash;
  await leaveAll([cand, ...voters]);
  await stopServer();

  // ---- Saturday 10:01: sworn in, stipend once, office power once.
  if (shouldWin) {
    url = await startServer(week + ELECTION_TIMES.swearingIn + 1);
    cand = await Actor.join(client, url, CANDIDATE, profile);
    voters = await joinAll(client, url, VOTERS.slice(1, 2));
    check(await cand.waitNotice(/You have been sworn in as Dept\. Gen\. Sec\.|stipend of ₦[\d,]+ was waiting/, 45_000), `sworn in: "${cand.said(/stipend/) ?? ""}"`);
    await sleep(500);
    check(cand.me.cash === fridayCash + post.stipend && cand.me.office === officeIndex(post), `stipend ₦${post.stipend} landed (cash ${fridayCash} to ${cand.me.cash}) and the office badge is synced (${cand.me.office})`);
    status = await ask(cand, { a: "status" });
    check(status?.office?.race === race && status.office.powerUsed === false && status.holders.some((h) => h.race === race && h.mine), "status shows the office and the holder");
    from = voters[0].mark;
    await ask(voters[0], { a: "power" });
    check(voters[0].said(/You hold no office this week/, from) !== undefined, "a student without an office has no power");
    from = voters[0].mark;
    status = await ask(cand, { a: "power" });
    check(status?.office?.powerUsed === true && (await voters[0].waitNotice(/shared past questions with the class/, 3000, from)), "the office power fires and the campus hears it");
    from = cand.mark;
    await ask(cand, { a: "power" });
    check(cand.said(/used your office power this week/, from) !== undefined, "the power works once a week");
    await cand.leave();
    await sleep(SAVE_SETTLE_MS);
    cand = await Actor.join(client, url, CANDIDATE, profile);
    await sleep(4000);
    check(cand.me.cash === fridayCash + post.stipend && cand.me.office === officeIndex(post), "rejoining does not pay the stipend again, and the badge is back");
    await leaveAll([cand, ...voters]);
    await stopServer();
  } else note("the candidate lost this week, so the office checks did not run");

  // ---- Congress: stand on a side when the Speaker calls the vote.
  const sitting = congressesFor(CYCLE)[0];
  const aye = congressStand("aye");
  const nay = congressStand("nay");
  await patchSave(VOTERS[1], { at: nay });
  await patchSave(VOTERS[2], { at: nay });
  url = await startServer(voteOpensAt(sitting) - 2);
  voters = await joinAll(client, url, VOTERS.slice(1));
  const [walker, stayer] = voters;
  check(await walker.waitNotice(/The Speaker has put the question/, gameMinutesToMs(5)), "the Speaker puts the question");
  check((await walker.waitNotice(/standing with the Nays/, 5000)) && (await stayer.waitNotice(/standing with the Nays/, 5000)), "both students are counted with the Nays");
  from = walker.mark;
  check(await walker.walkTo(aye), "one walks across the aisle");
  check(await walker.waitNotice(/standing with the Ayes/, 5000, from), "and is now counted with the Ayes");
  const expectedHouse = congressResult(sitting, { aye: 1, nay: 1 });
  const line = resultLine(sitting, expectedHouse);
  check(await stayer.waitNotice(/Congress on .*: Aye \d+, Nay \d+\./, gameMinutesToMs(settlesAt(sitting) - stayer.clock + 4)), `the house is counted: "${stayer.said(/Congress on/) ?? ""}"`);
  check(stayer.said(/Congress on/) === line, `the count is the seeded house plus one student each side (${expectedHouse.aye} to ${expectedHouse.nay})`);
  await sleep(1500);
  const world = parseUnionWorld(stayer.last(ServerMsg.Union));
  check(world?.states.some((s) => s.id === congressStateId(sitting) && s.kind === expectedHouse.outcome) === true, `the campus state "${expectedHouse.outcome}" reaches clients`);
  await leaveAll(voters);
});
