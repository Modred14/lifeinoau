import assert from "node:assert/strict";
import { test } from "node:test";
import { MINUTES_PER_DAY, gameTime } from "../src/clock.ts";
import { PLACES, PX_PER_METER, nearBuilding, onRoad } from "../src/map.ts";
import { isBlocked } from "../src/movement.ts";
import {
  CAMPAIGN,
  DEBATE_SITE,
  FACULTIES,
  FORM_DESK,
  POLL_UNITS,
  RALLY_POINTS,
  SUG_SCOPE,
  UNION_BODY_INFO,
  UNION_POSTS,
  activeRallies,
  alutaFor,
  ballotFor,
  campaignBanners,
  setKnownHolders,
  campaignGain,
  campaignsOpen,
  debateOn,
  effortOf,
  electionCycle,
  electionNews,
  electionPhase,
  facultyOf,
  findPost,
  formFee,
  formsOnSale,
  npcCandidates,
  officeIndex,
  officeTitle,
  parsePoliticsAction,
  parseRace,
  pollsOpen,
  postsOf,
  raceIsUnopposed,
  raceKey,
  ralliesFor,
  resultsOut,
  screenAspirant,
  siteIsClear,
  tallyRace,
  termCycle,
  unitForFaculty,
  type Aspirant,
  type BallotEntry,
} from "../src/politics.ts";

const at = (week: number, weekday: number, hour: number, minute = 0) => gameTime((week * 7 + weekday) * MINUTES_PER_DAY + hour * 60 + minute);
const president = findPost("sug-president")!;
const deptPresident = findPost("dept-president")!;
const clean: Aspirant = { cgpa: 4.1, exams: 3, malpractice: 0, rusticated: false, level: "300L", cash: 50_000 };

test("the phase follows the weekday and the hour", () => {
  assert.equal(electionPhase(at(3, 0, 9)), "forms");
  assert.equal(electionPhase(at(3, 1, 9)), "campaign");
  assert.equal(electionPhase(at(3, 2, 23)), "campaign");
  assert.equal(electionPhase(at(3, 3, 20)), "debate");
  assert.equal(electionPhase(at(3, 4, 7)), "voting");
  assert.equal(electionPhase(at(3, 4, 15, 59)), "voting");
  assert.equal(electionPhase(at(3, 4, 16)), "counting");
  assert.equal(electionPhase(at(3, 4, 18)), "results");
  assert.equal(electionPhase(at(3, 5, 9)), "results");
  assert.equal(electionPhase(at(3, 5, 10)), "handover");
  assert.equal(electionPhase(at(3, 6, 12)), "handover");
});

test("each window opens and closes on time", () => {
  assert.equal(formsOnSale(at(2, 0, 7)), false);
  assert.equal(formsOnSale(at(2, 0, 8)), true);
  assert.equal(formsOnSale(at(2, 1, 11)), true);
  assert.equal(formsOnSale(at(2, 1, 12)), false);
  assert.equal(campaignsOpen(at(2, 1, 6)), true);
  assert.equal(campaignsOpen(at(2, 3, 18)), false);
  assert.equal(debateOn(at(2, 3, 19)), true);
  assert.equal(debateOn(at(2, 3, 22)), false);
  assert.equal(pollsOpen(at(2, 4, 7, 59)), false);
  assert.equal(pollsOpen(at(2, 4, 8)), true);
  assert.equal(pollsOpen(at(2, 4, 16)), false);
  assert.equal(resultsOut(at(2, 4, 17, 59)), false);
  assert.equal(resultsOut(at(2, 4, 18)), true);
  assert.equal(electionCycle(at(2, 6, 23)), 2);
  assert.equal(termCycle(at(2, 5, 9)), 1);
  assert.equal(termCycle(at(2, 5, 10)), 2);
  assert.equal(termCycle(at(3, 2, 10)), 2);
});

test("the post table has the nine union posts and three for each association", () => {
  assert.deepEqual(postsOf("sug").map((p) => p.role), [
    "President", "Vice President", "Secretary General", "Assistant Secretary General", "Public Relations Officer",
    "Director of Socials and Culture", "Director of Sports", "Financial Secretary", "Welfare Officer",
  ]);
  assert.equal(postsOf("faculty").length, 3);
  assert.equal(postsOf("dept").length, 3);
  assert.equal(new Set(UNION_POSTS.map((p) => p.id)).size, UNION_POSTS.length);
  for (const post of UNION_POSTS) {
    assert.ok(post.fee > 0 && post.stipend > 0, post.id);
    assert.equal(officeTitle(officeIndex(post)), post.title);
    assert.ok(!/[–—]/.test(post.title + post.power.label + post.power.notice), post.id);
    assert.deepEqual(parseRace(raceKey(post, "law")), { post, scope: post.body === "sug" ? SUG_SCOPE : "law" });
  }
  assert.equal(officeTitle(0), "");
});

test("seeded candidates are stable in a cycle and change between cycles", () => {
  for (const post of UNION_POSTS) {
    const scope = post.body === "dept" ? "computer-science" : "law";
    assert.deepEqual(npcCandidates(7, post, scope), npcCandidates(7, post, scope));
  }
  const names = (cycle: number) => postsOf("sug").flatMap((p) => npcCandidates(cycle, p, SUG_SCOPE).map((c) => `${c.name}|${c.nick}`)).join(",");
  assert.notEqual(names(7), names(8));
  assert.notEqual(npcCandidates(7, deptPresident, "law").map((c) => c.name).join(), npcCandidates(7, deptPresident, "accounting").map((c) => c.name).join());
});

test("every post has at least two cleared candidates unless it is unopposed", () => {
  let unopposed = 0;
  let disqualified = 0;
  for (let cycle = 0; cycle < 40; cycle++) {
    for (const post of UNION_POSTS) {
      for (const scope of post.body === "sug" ? [SUG_SCOPE] : post.body === "faculty" ? FACULTIES.slice(0, 6).map((f) => f.key) : ["law", "computer-science", "accounting"]) {
        const field = npcCandidates(cycle, post, scope);
        const cleared = field.filter((c) => !c.disqualified);
        disqualified += field.length - cleared.length;
        assert.equal(new Set(field.map((c) => c.id)).size, field.length);
        assert.equal(new Set(field.map((c) => c.name)).size, field.length);
        for (const c of field) assert.ok(c.base > 0 && c.nick && c.slogan && !/[–—]/.test(c.slogan + c.nick + c.from), c.name);
        if (raceIsUnopposed(field)) {
          unopposed++;
          assert.notEqual(post.body, "sug");
          assert.equal(field.length, 1);
        } else assert.ok(cleared.length >= 2, `${cycle} ${post.id} ${scope}`);
      }
    }
  }
  assert.ok(unopposed > 0 && disqualified > 0);
});

test("a player joins the ballot next to the seeded candidates", () => {
  const race = raceKey(president, SUG_SCOPE);
  const ballot = ballotFor(4, president, SUG_SCOPE, [{ id: "abc", race, name: "@tola", effort: 90 }, { id: "zzz", race: "other@all", name: "@x", effort: 1 }]);
  assert.equal(ballot.filter((c) => !c.npc).length, 1);
  assert.equal(ballot.at(-1)?.base, 90);
});

test("screening checks tests, CGPA, record and cash", () => {
  assert.deepEqual(screenAspirant(president, clean), { ok: true, fee: formFee(president, "300L") });
  assert.equal(screenAspirant(president, { ...clean, exams: 0, cgpa: 0 }).ok, false);
  const low = screenAspirant(president, { ...clean, cgpa: 2.9 });
  assert.equal(!low.ok && low.reason, "cgpa");
  assert.equal(screenAspirant(deptPresident, { ...clean, cgpa: 2.9 }).ok, true);
  assert.equal(screenAspirant(deptPresident, { ...clean, exams: 0, cgpa: 0 }).ok, true);
  const dirty = screenAspirant(deptPresident, { ...clean, malpractice: 1 });
  assert.equal(!dirty.ok && dirty.reason, "malpractice");
  const out = screenAspirant(deptPresident, { ...clean, rusticated: true });
  assert.equal(!out.ok && out.reason, "rusticated");
  const broke = screenAspirant(president, { ...clean, cash: 10 });
  assert.equal(!broke.ok && broke.reason, "cash");
  assert.ok(UNION_BODY_INFO.sug.minCgpa > UNION_BODY_INFO.faculty.minCgpa && UNION_BODY_INFO.faculty.minCgpa > UNION_BODY_INFO.dept.minCgpa);
});

test("the form fee differs by post and level, and late forms cost more", () => {
  assert.ok(formFee(president, "100L") > formFee(deptPresident, "100L"));
  assert.ok(formFee(president, "400L") > formFee(president, "100L"));
  assert.ok(formFee(president, "ND2") > formFee(president, "ND1"));
  assert.ok(formFee(president, "100L", true) > formFee(president, "100L"));
  assert.equal(formFee(president, ""), president.fee);
  for (const post of UNION_POSTS) assert.ok(Number.isInteger(formFee(post, "500L", true)));
});

test("campaign support is capped per hall and doubles at a rally", () => {
  assert.equal(campaignGain("sug", 0, false), CAMPAIGN.gain);
  assert.equal(campaignGain("sug", 0, true), CAMPAIGN.gain * CAMPAIGN.rallyFactor);
  assert.equal(campaignGain("sug", CAMPAIGN.hallCap, true), 0);
  assert.equal(campaignGain("sug", CAMPAIGN.hallCap - 5, false), 5);
  assert.ok(campaignGain("dept", 0, false) < campaignGain("sug", 0, false));
  assert.equal(effortOf("sug", { awo: 40, moz: 20 }, [], false), 60);
  assert.ok(effortOf("sug", { awo: 40 }, ["posters", "van"], false) > 40);
  assert.ok(effortOf("sug", { awo: 40 }, [], true) > 40);
});

const entry = (id: string, base: number, more: Partial<BallotEntry> = {}): BallotEntry => ({ id, name: id, npc: true, base, endorsements: 0, votes: 0, informed: 0, ...more });

test("results rank by support, real votes weigh heavily and the disqualified do not count", () => {
  const plain = tallyRace(1, "r", president, [entry("a", 300), entry("b", 200), entry("c", 900, { disqualified: true })]);
  assert.equal(plain.winner, "a");
  assert.deepEqual(plain.rows.map((r) => r.id), ["a", "b"]);
  const voted = tallyRace(1, "r", president, [entry("a", 300), entry("b", 200, { npc: false, votes: 5 })]);
  assert.equal(voted.winner, "b");
  assert.equal(voted.rows[0].real, 5);
  const informed = tallyRace(1, "r", president, [entry("a", 100, { votes: 2 }), entry("b", 100, { votes: 2, informed: 2 })]);
  assert.equal(informed.winner, "b");
  const endorsed = tallyRace(1, "r", president, [entry("a", 100), entry("b", 100, { endorsements: 1 })]);
  assert.equal(endorsed.winner, "b");
});

test("ties break the same way every time, first by real votes", () => {
  const tied = [entry("a", 200), entry("b", 200)];
  const first = tallyRace(5, "r", president, tied);
  assert.ok(first.winner);
  assert.deepEqual(tallyRace(5, "r", president, [...tied].reverse()), first);
  const real = tallyRace(5, "r", president, [entry("a", 225), entry("b", 200, { votes: 1 })]);
  assert.equal(real.rows[0].total, real.rows[1].total);
  assert.equal(real.winner, "b");
});

test("unopposed, empty and run-off races are marked", () => {
  assert.deepEqual(tallyRace(1, "r", president, []), { race: "r", rows: [], winner: null, unopposed: false, runoff: false });
  const alone = tallyRace(1, "r", president, [entry("a", 10)]);
  assert.equal(alone.unopposed, true);
  assert.equal(alone.winner, "a");
  const close = tallyRace(1, "r", president, [entry("a", 301), entry("b", 300), entry("c", 150)]);
  assert.equal(close.runoff, true);
  assert.ok(close.winner === "a" || close.winner === "b");
  assert.equal(close.rows.reduce((s, r) => s + r.total, 0) - 150, 751);
  assert.equal(close.rows[0].id, close.winner);
  assert.deepEqual(tallyRace(1, "r", president, [entry("c", 150), entry("b", 300), entry("a", 301)]), close);
  assert.equal(tallyRace(1, "r", president, [entry("a", 400), entry("b", 300), entry("c", 150)]).runoff, false);
});

test("polling units, rally points and the SUIEC desk stand on open ground", () => {
  const sites = [FORM_DESK, ...POLL_UNITS, ...RALLY_POINTS, DEBATE_SITE];
  assert.equal(POLL_UNITS.length, 10);
  assert.equal(RALLY_POINTS.length, 9);
  assert.equal(new Set(sites.map((s) => s.id)).size, sites.length);
  for (const s of sites) {
    assert.ok(PLACES[s.place], s.id);
    assert.equal(onRoad(s.x, s.y), false, `${s.id} on a road`);
    assert.equal(nearBuilding(s.x, s.y), false, `${s.id} in a building`);
    assert.equal(isBlocked(s.x, s.y), false, `${s.id} blocked`);
    assert.ok(siteIsClear(s.x, s.y), s.id);
    const door = PLACES[s.place].door;
    assert.ok(Math.hypot(door.x - s.x, door.y - s.y) < 60 * PX_PER_METER, `${s.id} far from its place`);
  }
  for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) assert.ok(Math.hypot(sites[i].x - sites[j].x, sites[i].y - sites[j].y) > 8 * PX_PER_METER);
  assert.match(PLACES[POLL_UNITS[0].place].name, /Student Union/);
  assert.match(PLACES[DEBATE_SITE.place].name, /Amphi/);
  const angola = RALLY_POINTS.find((r) => r.id === "angola")!;
  const moz = RALLY_POINTS.find((r) => r.id === "moz")!;
  const car = RALLY_POINTS.find((r) => r.id === "anglomoz")!;
  assert.ok(car.x > Math.min(angola.x, moz.x) && car.x < Math.max(angola.x, moz.x));
});

test("faculties map to a real polling unit, with the SUB as fallback", () => {
  assert.equal(facultyOf("law")?.label, "Law");
  assert.equal(facultyOf(""), undefined);
  assert.equal(facultyOf("other"), undefined);
  assert.equal(unitForFaculty("law").id, "law");
  assert.equal(unitForFaculty("social-sciences").id, "socsci");
  assert.equal(unitForFaculty("engineering-and-technology").id, "tech");
  assert.equal(unitForFaculty("education").id, "edu");
  assert.equal(unitForFaculty("pharmacy").id, "pharm");
  assert.equal(unitForFaculty("administration-and-management").id, "admin");
  assert.equal(unitForFaculty("arts-and-humanities").id, "arts");
  assert.equal(unitForFaculty("agriculture").id, "sub");
  for (const f of FACULTIES) assert.ok(POLL_UNITS.includes(unitForFaculty(f.key)), f.key);
});

test("rallies run on campaign days at real rally points", () => {
  const rallies = ralliesFor(9);
  assert.deepEqual(rallies, ralliesFor(9));
  assert.equal(rallies.length, 10);
  for (const r of rallies) {
    assert.ok(RALLY_POINTS[r.site]);
    assert.ok(campaignsOpen(gameTime(9 * 7 * MINUTES_PER_DAY + r.start)));
  }
  assert.equal(new Set(rallies.map((r) => r.site)).size, RALLY_POINTS.length);
  assert.equal(activeRallies(at(9, 1, 10, 30)).length, 1);
  assert.equal(activeRallies(at(9, 4, 10, 30)).length, 0);
});

test("campaign banners come back in every phase", () => {
  const phases: [number, number, RegExp][] = [[0, 10, /NOMINATION/], [1, 10, /PRESS NIGHT/], [3, 20, /PRESS NIGHT/], [4, 9, /ELECTION DAY/], [4, 17, /ELECTION DAY/], [5, 12, /CONGRATULATIONS/], [6, 12, /CONGRATULATIONS/]];
  for (const [weekday, hour, head] of phases) {
    const art = campaignBanners(at(6, weekday, hour));
    assert.ok(art.length >= 3, `${weekday}`);
    assert.match(art[0].title, head);
    assert.equal(new Set(art.map((a) => a.id)).size, art.length);
    for (const a of art) {
      assert.ok(a.title && a.lines.length > 0 && a.weight > 0);
      assert.ok(!/[–—]/.test([a.title, ...a.lines, a.footer ?? ""].join(" ")));
    }
  }
  assert.deepEqual(campaignBanners(at(6, 2, 9)), campaignBanners(at(6, 2, 15)));
  assert.notDeepEqual(campaignBanners(at(6, 2, 9)).map((a) => a.id), campaignBanners(at(7, 2, 9)).map((a) => a.id));
  assert.ok(campaignBanners(at(6, 5, 12)).every((a) => !/"/.test(a.lines.join(" "))));
  setKnownHolders(6, [{ post: "sug-president", name: "@tola" }]);
  assert.ok(campaignBanners(at(6, 5, 12)).some((a) => a.lines[0] === "@tola"));
  setKnownHolders(-1, []);
});

test("news and aluta are seeded per cycle", () => {
  assert.deepEqual(electionNews(4), electionNews(4));
  const lines = electionNews(4);
  assert.ok(lines.length > 15);
  for (const l of lines) assert.ok(!/[–—]/.test(l.text) && l.at >= 0 && l.at < 7 * MINUTES_PER_DAY);
  const weeks = Array.from({ length: 30 }, (_v, c) => alutaFor(c));
  assert.ok(weeks.some((a) => a) && weeks.some((a) => !a));
  for (const a of weeks) if (a) assert.ok(a.end > a.start && a.fun > 0);
});

test("only well formed politics actions parse", () => {
  assert.deepEqual(parsePoliticsAction({ a: "vote", post: "sug-president", c: "n0", extra: 1 }), { a: "vote", post: "sug-president", c: "n0" });
  assert.deepEqual(parsePoliticsAction({ a: "status" }), { a: "status" });
  for (const bad of [null, 4, "vote", {}, { a: "vote" }, { a: "vote", post: 3, c: "n0" }, { a: "form", post: "" }, { a: "form", post: "x".repeat(200) }, { a: "nuke" }]) assert.equal(parsePoliticsAction(bad), null);
});
