// tests/club.test.mjs: the nightclubs. Part 1: the price list and the rules (pure). Part 2: the server (lib/clubService.js) against the in-memory
// fake database with a controlled clock: opening hours, every kind of purchase, the money, gifts, buyouts, VIP, history and privacy.
import assert from "node:assert/strict";
import { makeDb } from "./fakedb.mjs";
import * as C from "../lib/clubs.js";
import { gameMinuteOfDay } from "../lib/campus-clock.js";

let failed = 0;
const chk = (name, cond, detail = "") => { if (cond) console.log("OK   " + name); else { failed++; console.log("FAIL " + name + (detail ? " :: " + detail : "")); } };
const err = async (p) => { try { await p; return null; } catch (e) { return e; } };

// ======================================================================================================= 1. the price list and the rules
const WAT = (h, m = 0, day = 6) => Date.UTC(2026, 9, day, h - 1, m); // a game-clock time (West Africa Time is UTC+1)
chk("game time is West Africa Time (UTC+1)", gameMinuteOfDay(Date.UTC(2026, 9, 6, 19, 0)) === 20 * 60);
chk("the clubs are open at 8 PM, at midnight and at 4:59 AM", [WAT(20), WAT(23, 59), WAT(0, 0, 7), WAT(4, 59, 7)].every((t) => C.isNightTime(t)));
chk("the clubs are shut at 5 AM, at noon and at 7:59 PM", [WAT(5, 0, 7), WAT(12), WAT(19, 59)].every((t) => !C.isNightTime(t)));
const day = C.clubStatus(WAT(12)), night = C.clubStatus(WAT(22));
chk("by day the status is CLOSED and says when it opens", day.label === "CLOSED" && day.note === "Opens at 8 PM" && day.msToChange === 8 * 3_600_000);
chk("by night the status is OPEN and says when it closes", night.label === "OPEN" && night.note === "Open until 5 AM" && night.msToChange === 7 * 3_600_000);
chk("the hours are shown as 8 PM – 5 AM", C.HOURS_LABEL === "8 PM – 5 AM" && /8 PM/.test(C.closedMessage(C.CLUBS.club_0203)));
chk("all three clubs are configured and share the one clock", Object.keys(C.CLUBS).sort().join() === "club_0203,club_divas,club_quantum" && C.CLUB_IDS.every((id) => C.isClub(id)) && !C.isClub("sub"));

const price = Object.fromEntries(C.DRINKS.map((d) => [d.name, d.priceNaira]));
chk("the seven luxury drinks have exactly the specified prices", C.DRINKS.length === 7 && price["Hennessy"] === 1_000_000 && price["Martell"] === 2_000_000 && price["Don Julio 1942 Tequila"] === 2_000_000 && price["Dom Pérignon Champagne"] === 3_000_000 && price["Clase Azul Tequila"] === 5_000_000 && price["Ace of Spades Champagne"] === 5_000_000 && price["Louis XIII Cognac"] === 10_000_000);
chk("every drink has its own bottle design (shape + colours)", new Set(C.DRINKS.map((d) => [d.shape, d.body, d.label, d.cap].join())).size === 7);
chk("the three packages: ₦3M, ₦5M, ₦10M, each with benefits", C.PACKAGES.map((p) => p.priceNaira).join() === "3000000,5000000,10000000" && C.PACKAGES.every((p) => p.benefits.length >= 3 && p.vipMinutes > 0));
chk("spray options are the ten specified amounts, ₦10,000 to ₦10,000,000", C.SPRAY_AMOUNTS.join() === "10000,25000,50000,100000,250000,500000,1000000,2500000,5000000,10000000" && C.SPRAY_AMOUNTS.every((a) => C.validSpend(a)));
chk("the minimum for any club purchase is ₦10,000 and the maximum ₦10,000,000", C.MIN_SPEND === 10_000 && C.MAX_SPEND === 10_000_000 && !C.validSpend(9_000) && !C.validSpend(10_001_000) && !C.validSpend(15_500) && !C.validSpend(-10_000) && !C.validSpend(NaN) && C.validSpend(37_000));
const everything = [...C.SPRAY_AMOUNTS, ...C.DRINKS.map((d) => d.priceNaira), ...C.PACKAGES.map((p) => p.priceNaira), ...C.EXPERIENCES.map((x) => x.priceNaira), ...Object.values(C.CLUBS).flatMap((c) => Object.values(c.buyout))];
chk(`all ${everything.length} prices on offer sit between ₦10,000 and ₦10,000,000`, everything.every((n) => n >= 10_000 && n <= 10_000_000));
chk("the spending ladder: ₦10k basic, ₦100k premium, ₦1M luxury, ₦5M exclusive", C.tierOf(10_000).id === "basic" && C.tierOf(100_000).id === "premium" && C.tierOf(1_000_000).id === "luxury" && C.tierOf(5_000_000).id === "exclusive" && C.tierOf(10_000_000).id === "exclusive");
chk("the show grows with the money (level 1 at ₦10k up to level 5 at ₦5M+)", C.fxLevel(10_000) === 1 && C.fxLevel(10_000_000) === 5 && C.fxLevel(1_000_000) < C.fxLevel(5_000_000) && C.fxLevel(500_000) <= C.fxLevel(2_500_000));
chk("buyouts last 5 to 10 minutes, are priced per club and reach ₦10M", C.BUYOUT_TIERS.every((t) => t.minutes >= 5 && t.minutes <= 10) && C.buyoutPrice("club_divas", "takeover") === 10_000_000 && C.buyoutPrice("club_0203", "takeover") !== C.buyoutPrice("club_divas", "takeover") && C.BUYOUT_TERMS.some((t) => /doors stay open/i.test(t)));
chk("there is a spending ladder of experiences from ₦10,000 to ₦5,000,000", C.EXPERIENCES[0].priceNaira === 10_000 && Math.max(...C.EXPERIENCES.map((x) => x.priceNaira)) >= 5_000_000 && C.EXPERIENCES.length >= 8);

// ======================================================================================================= 2. the server
const S = await import("../lib/clubService.js");
const H = 3_600_000, MIN = 60_000, N = (n) => BigInt(n) * 100n, START = Date.UTC(2026, 9, 1, 15, 30);
const realNow = Date.now; let clock = WAT(22, 0, 6); Date.now = () => clock; // 10 PM game time
const models = ["character", "account", "actionLog", "ledgerEntry", "floorZero", "gameClock", "notification", "achievement", "examResult", "achievementAward", "business", "holding", "partyTicket", "bond", "activityRun", "courseProgress", "clubVip", "clubBuyout", "clubEvent", "clubTransaction", "block"];
const FACULTY = { name: "Science", difficulty: 1.1 };
const base = (id, name, over = {}) => ({ id, userId: "u_" + id, name, hostel: "Awo", expelled: false, suspendedUntilWeek: 0, jailedUntil: null, strikes: 0, energy: 100, health: 80, happiness: 60, academics: 40, popularity: 10, suspicion: 0, luck: 50, personalities: [], lastTickWeek: 9999, joinedWeek: 1, sessionStartWeek: 1, level: 100, class: "LAPO", placeId: "club_quantum", energyRefilledAt: new Date(clock), inPlace: "club_quantum", inX: 2, inZ: 3, inFloor: 0, inAt: new Date(clock), ...over });
function world(cash = 50_000_000, over = {}) {
  const db = makeDb(models, { unique: { actionLog: ["characterId", "requestId"], ledgerEntry: ["idempotencyKey"], activityRun: ["characterId", "requestId"], examResult: ["characterId", "gameWeek"], clubTransaction: ["characterId", "requestId"] }, join: { character: (r, T) => r && ({ ...r, account: T.account.find((a) => a.characterId === r.id), faculty: FACULTY }) } });
  // The fake database has no row locks and no column defaults. Postgres gives the real code both: loadLocked() and the ledger take FOR UPDATE locks, so one
  // player's transactions run one at a time, and createdAt defaults to now(). The test world does the same, so the checks below test the SERVICE, not the fake.
  for (const m of ["clubTransaction", "clubEvent", "clubBuyout", "clubVip", "notification"]) { const create = db[m].create; db[m].create = (a) => create({ data: { createdAt: new Date(Date.now()), ...a.data } }); }
  const tr = db.$transaction; let queue = Promise.resolve(); db.$transaction = (fn) => { const next = queue.then(() => tr(fn), () => tr(fn)); queue = next.catch(() => {}); return next; };
  const T = db.T();
  T.account.push({ id: "a1", kind: "PLAYER", systemName: null, characterId: "c1", balance: N(cash) }, { id: "a2", kind: "PLAYER", systemName: null, characterId: "c2", balance: N(1_000_000) }, { id: "a3", kind: "PLAYER", systemName: null, characterId: "c3", balance: N(90_000_000) },
    { id: "w", kind: "SYSTEM", systemName: "WORLD", balance: 0n }, { id: "v", kind: "SYSTEM", systemName: "VENUES", balance: 0n }, { id: "d", kind: "SYSTEM", systemName: "DSA", balance: 0n });
  T.gameClock.push({ id: 1, startedAt: new Date(START) });
  T.character.push(base("c1", "Ada", over), base("c2", "Tunde"), base("c3", "Chika", { placeId: "club_divas", inPlace: "club_divas" }));
  const bal = (id) => T.account.find((a) => a.id === id).balance;
  return { db, T, bal: () => bal("a1"), tunde: () => bal("a2"), venues: () => bal("v") };
}
const rid = (() => { let n = 0; return () => `club-${String(++n).padStart(6, "0")}-abcdef`; })();
const buy = (w, body, user = "u_c1") => S.purchase(w.db, user, { requestId: rid(), ...body });
const fresh = (w) => { for (const c of w.T.character) c.inAt = new Date(clock); }; // everyone has just reported where they stand

// ---- opening hours, enforced by the server
{ const w = world(); clock = WAT(12, 0, 6); fresh(w);
  const e = await err(buy(w, { kind: "SPRAY", amount: 10_000 }));
  chk("by day the server refuses a purchase and explains why", e?.status === 403 && /closed/i.test(e.message) && /8 PM/.test(e.message), e?.message);
  chk("a refused purchase takes no money and writes nothing", w.bal() === N(50_000_000) && w.T.clubTransaction.length === 0 && w.T.ledgerEntry.length === 0 && w.T.clubEvent.length === 0);
  const st = await S.clubState(w.db, "u_c1", { at: "club_quantum" }); chk("the state says CLOSED and that someone already inside may stay", st.status.label === "CLOSED" && st.canEnter === true);
  w.c = w.T.character[0]; w.c.inPlace = ""; w.c.inAt = null; chk("someone NOT already inside is told they cannot enter a closed club", (await S.clubState(w.db, "u_c1", { at: "club_quantum" })).canEnter === false);
  clock = WAT(22, 0, 6); }

// ---- money spraying
{ const w = world(); fresh(w);
  const r = await buy(w, { kind: "SPRAY", amount: 10_000 });
  chk("spraying ₦10,000 charges exactly ₦10,000 and pays the venue", r.ok && w.bal() === N(50_000_000 - 10_000) && w.T.ledgerEntry.some((l) => l.creditAccountId === "v" && l.amount === N(10_000) && /Money Spraying/.test(l.memo)));
  const r2 = await buy(w, { kind: "SPRAY", amount: 10_000_000 });
  chk("spraying ₦10,000,000 works with enough cash and is a level-5 show", r2.ok && r2.level === 5 && w.bal() === N(50_000_000 - 10_010_000));
  const ev = w.T.clubEvent.filter((e) => e.kind === "SHOW"); const big = ev[1];
  chk("each spray wrote one show for the floor, only after the money moved", ev.length === 2 && big.data.parts.includes("spray") && big.data.parts.includes("confetti") && big.actorName === "Ada" && big.title.includes("₦10,000,000") && !ev[0].data.parts.includes("confetti"));
  const poor = world(5_000); fresh(poor); const e = await err(buy(poor, { kind: "SPRAY", amount: 10_000 }));
  chk("not enough money: refused, nothing charged, nothing recorded, no show", e?.status === 402 && poor.bal() === N(5_000) && poor.T.clubTransaction.length === 0 && poor.T.clubEvent.length === 0, e?.message);
  for (const bad of [9_999, 10_000_001, -50_000, 12_345, "lots", null]) { const x = await err(buy(w, { kind: "SPRAY", amount: bad })); chk(`an amount of ${bad} is refused`, x?.status === 400); }
  chk("those refusals changed nothing", w.bal() === N(50_000_000 - 10_010_000)); }

// ---- duplicate requests and races
{ const w = world(); fresh(w); const id = rid();
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => S.purchase(w.db, "u_c1", { requestId: id, kind: "SPRAY", amount: 500_000 })));
  chk("the same request three times (a double tap, a retry) charges ONCE", w.bal() === N(50_000_000 - 500_000) && w.T.clubTransaction.length === 1 && w.T.clubEvent.filter((e) => e.kind === "SHOW").length === 1, `${w.T.clubTransaction.length} rows`);
  chk("the repeats are answered as already done, not as errors", [a, b, c].filter((x) => x.duplicate).length >= 1);
  const e = await err(S.purchase(w.db, "u_c1", { kind: "SPRAY", amount: 10_000 })); chk("a purchase with no requestId is refused", e?.status === 400); }

// ---- never negative: a pile of purchases at once
{ const w = world(12_000_000); fresh(w);
  const res = await Promise.allSettled(Array.from({ length: 5 }, () => buy(w, { kind: "DRINK", itemId: "louis_xiii" })));
  const ok = res.filter((x) => x.status === "fulfilled").length;
  chk("₦12M cannot pay for five ₦10M bottles: one succeeds, the balance never goes negative", ok === 1 && w.bal() === N(2_000_000) && w.T.clubTransaction.length === 1, `ok=${ok} bal=${w.bal()}`); }

// ---- the seven drinks
{ const w = world(100_000_000); fresh(w);
  for (const d of C.DRINKS) { const before = w.bal(); const r = await buy(w, { kind: "DRINK", itemId: d.id }); chk(`${d.name}: charged ${d.priceNaira.toLocaleString()} and presented (${d.style})`, r.ok && before - w.bal() === N(d.priceNaira) && w.T.clubEvent.at(-1).data.drink === d.id); }
  const shows = w.T.clubEvent.filter((e) => e.kind === "SHOW"), hen = shows[0], lou = shows[6];
  chk("Louis XIII is a bigger show than Hennessy (more layers, higher level, crown style)", lou.level > hen.level && lou.data.parts.length > hen.data.parts.length && lou.data.style === "crown" && hen.data.style === "tray" && lou.data.parts.includes("confetti") && !hen.data.parts.includes("confetti"));
  const e = await err(buy(w, { kind: "DRINK", itemId: "free_beer" })); chk("a drink that is not on the menu is refused", e?.status === 404);
  const e2 = await err(buy(w, { kind: "DRINK", itemId: "hennessy", price: 1, amount: 1 })); chk("a price sent by the browser changes nothing: the drink still costs ₦1,000,000", !e2 && w.T.clubTransaction.at(-1).amount === N(1_000_000)); }

// ---- gifts
{ const w = world(); fresh(w); const t0 = w.tunde();
  const r = await buy(w, { kind: "GIFT_DRINK", itemId: "clase_azul", to: "tunde" });
  chk("a ₦5,000,000 Clase Azul for a friend: the purchaser pays the full price", r.ok && w.bal() === N(50_000_000 - 5_000_000) && r.recipient === "Tunde");
  chk("the recipient pays NOTHING (not charged, not credited)", w.tunde() === t0);
  const row = w.T.clubTransaction[0]; chk("it is recorded against the purchaser with the recipient named", row.characterId === "c1" && row.kind === "GIFT_DRINK" && row.recipientName === "Tunde" && row.recipientId === "c2");
  chk("the recipient is notified and the show names both people", w.T.notification.some((n) => n.characterId === "c2" && /Ada/.test(n.body) && /Clase Azul/.test(n.body)) && w.T.clubEvent.at(-1).targetName === "Tunde" && w.T.clubEvent.at(-1).actorName === "Ada");
  const before = w.bal();
  for (const [to, why] of [["Ada", "yourself"], ["Nobody", "does not exist"], ["Chika", "in another club"], ["", "no one picked"]]) { const e = await err(buy(w, { kind: "GIFT_DRINK", itemId: "hennessy", to })); chk(`a gift to a bad recipient is refused (${why})`, e && e.status >= 400); }
  w.T.character[1].inAt = new Date(clock - 5 * MIN); const e = await err(buy(w, { kind: "GIFT_DRINK", itemId: "hennessy", to: "Tunde" })); chk("a recipient who has gone quiet (left) is refused", e?.status === 409);
  w.T.character[1].inAt = new Date(clock); w.T.block.push({ blockerId: "c2", blockedId: "c1" }); const e2 = await err(buy(w, { kind: "GIFT_DRINK", itemId: "hennessy", to: "Tunde" })); chk("a blocked player cannot be sent a drink", e2?.status === 409);
  chk("no refused gift charged anything", w.bal() === before); }

// ---- where you stand
{ const w = world(); fresh(w); w.T.character[0].inAt = new Date(clock - 3 * MIN); const e = await err(buy(w, { kind: "SPRAY", amount: 10_000 })); chk("not reporting a position (not really inside) is refused", e?.status === 409);
  const w2 = world(); fresh(w2); w2.T.character[0].placeId = "sub"; w2.T.character[0].inPlace = "sub"; const e2 = await err(buy(w2, { kind: "SPRAY", amount: 10_000 })); chk("outside any club is refused", e2?.status === 409); }

// ---- packages, experiences and VIP
{ const w = world(100_000_000); fresh(w);
  const r = await buy(w, { kind: "PACKAGE", itemId: "billionaire_package" });
  chk("the Billionaire package costs ₦10M and delivers each advertised benefit", r.ok && w.bal() === N(90_000_000) && w.T.clubVip.length === 1 && w.T.clubEvent.some((e) => e.kind === "TABLE" && e.data.table === "billionaire") && w.T.clubEvent.at(-1).data.parts.includes("spotlight") && w.T.clubEvent.at(-1).data.parts.includes("confetti") && w.T.clubEvent.at(-1).data.parts.includes("sweep") && w.T.clubEvent.at(-1).data.drink === "louis_xiii");
  const vip = w.T.clubVip[0]; chk("VIP lasts the package's 60 minutes", Math.abs(+vip.until - (clock + 60 * MIN)) < 2000);
  const st = await S.clubState(w.db, "u_c1", { at: "club_quantum" }); chk("the state tells the player they are VIP, waives the ticket and the bar, and lists them for everyone", st.vip && st.perks.ticketWaived && st.perks.freeDrink && st.vips.some((v) => v.name === "Ada"));
  const other = await S.clubState(w.db, "u_c2", { at: "club_quantum" }); chk("another player sees the VIP badge and the table but is not VIP themselves", !other.vip && other.vips.length === 1 && other.tables.length === 1);
  const p = await S.perksAt(w.db, "c1", "club_quantum", clock); const q = await S.perksAt(w.db, "c1", "club_0203", clock); chk("VIP is for THAT club only", p.ticketWaived && !q.ticketWaived);
  for (const x of C.EXPERIENCES) { const before = w.bal(); const rr = await buy(w, { kind: "EXPERIENCE", itemId: x.id }).catch((e) => e); chk(`experience "${x.name}" (₦${x.priceNaira.toLocaleString()}) ${rr.ok ? "is charged and has its effect" : "refused: " + rr.message}`, rr.ok ? before - w.bal() === N(x.priceNaira) && w.T.clubEvent.some((e) => e.kind === "SHOW" && e.data.exp === x.id) : /special set/.test(rr.message)); w.T.clubEvent.forEach((e) => { if (e.kind === "MOOD") e.expiresAt = new Date(clock - 1); }); }
  const w2 = world(); fresh(w2); await buy(w2, { kind: "EXPERIENCE", itemId: "vip_table" }); chk("a VIP table reservation makes a table AND VIP", w2.T.clubEvent.some((e) => e.kind === "TABLE") && w2.T.clubVip.length === 1); }

// ---- buyouts
{ const w = world(100_000_000); fresh(w);
  const e0 = await err(buy(w, { kind: "BUYOUT", itemId: "nonsense" })); chk("an unknown buyout level is refused", e0?.status === 404);
  const r = await buy(w, { kind: "BUYOUT", itemId: "takeover" });
  chk("a Billionaire Takeover charges this club's price and lasts 10 minutes", r.ok && w.bal() === N(100_000_000 - 9_000_000) && Math.abs(r.buyoutEndsAt - (clock + 10 * MIN)) < 1000);
  chk("it creates the buyout, the club lights, the host's VIP and a show", w.T.clubBuyout.length === 1 && w.T.clubEvent.some((e) => e.kind === "MOOD" && e.data.mood === "takeover") && w.T.clubVip.length === 1 && w.T.clubEvent.some((e) => e.kind === "SHOW" && e.data.kind === "BUYOUT"));
  const st = await S.clubState(w.db, "u_c2", { at: "club_quantum" }); chk("everyone else sees the buyout, the host and the lights", st.buyout?.host === "Ada" && st.mood?.data.mood === "takeover" && st.perks.freeDrink && st.perks.ticketWaived);
  const dup = world(100_000_000); fresh(dup);
  const e = await err(buy(w, { kind: "BUYOUT", itemId: "section" }, "u_c1")); chk("a second buyout at the same club while one runs is refused, with the time left", e?.status === 409 && /Ada has Quantum/.test(e.message) && /min left/.test(e.message), e?.message);
  const before = w.T.account.find((a) => a.id === "a3").balance; w.T.character[2].placeId = "club_quantum"; w.T.character[2].inPlace = "club_quantum"; fresh(w);
  const e2 = await err(buy(w, { kind: "BUYOUT", itemId: "section" }, "u_c3")); chk("another rich player cannot take it over either, and is not charged", e2?.status === 409 && w.T.account.find((a) => a.id === "a3").balance === before);
  const e3 = await err(buy(w, { kind: "EXPERIENCE", itemId: "dj_set" }, "u_c3")); chk("a special DJ set cannot override a buyout's lights", e3?.status === 409);
  chk("a different club is unaffected by this club's buyout", (await S.clubState(w.db, "u_c3", { at: "club_divas" })).buyout === null);
  clock += 10 * MIN + 1000; fresh(w); const after = await S.clubState(w.db, "u_c2", { at: "club_quantum" });
  chk("when it ends the club goes back to normal (no buyout, lights, free bar or VIP)", after.buyout === null && after.mood === null && !after.perks.freeDrink && after.vips.length === 0 && !after.vip);
  const again = await buy(w, { kind: "BUYOUT", itemId: "section" }, "u_c3"); chk("and the club can be bought out again", again.ok);
  clock = WAT(22, 0, 6); fresh(w); }
{ const w = world(100_000_000); clock = WAT(4, 56, 7); fresh(w); const e = await err(buy(w, { kind: "BUYOUT", itemId: "takeover" })); chk("a 10-minute buyout 4 minutes before closing is refused (it must not outlast the night)", e?.status === 409 && /closes in/.test(e.message), e?.message); clock = WAT(22, 0, 6); }

// ---- mood and popularity are capped
{ const w = world(1_000_000_000); fresh(w); const h0 = w.T.character[0].happiness, p0 = w.T.character[0].popularity;
  for (let i = 0; i < 12; i++) await buy(w, { kind: "SPRAY", amount: 5_000_000 });
  chk("spending cannot farm mood or popularity beyond the daily/weekly caps", w.T.character[0].happiness - h0 <= C.CLUB_BUDGET.happiness.gain && w.T.character[0].popularity - p0 <= C.CLUB_BUDGET.popularity.gain && w.T.character[0].happiness > h0, `+${w.T.character[0].happiness - h0} happy, +${w.T.character[0].popularity - p0} pop`); }

// ---- the show feed: nearby players, reconnects, clean-up
{ const w = world(); fresh(w); await buy(w, { kind: "SPRAY", amount: 100_000 }); const eid = w.T.clubEvent.at(-1).id;
  const a = await S.clubState(w.db, "u_c2", { at: "club_quantum", since: 0 }); chk("another player in the club receives the show", a.shows.length === 1 && a.shows[0].actor === "Ada" && a.shows[0].data.parts.includes("spray"));
  const b = await S.clubState(w.db, "u_c2", { at: "club_quantum", since: Number(eid) }); chk("it is not sent again once seen", b.shows.length === 0);
  const far = await S.clubState(w.db, "u_c3", { at: "club_divas" }); chk("a player in a DIFFERENT club never receives it", far.shows.length === 0);
  clock += 40_000; fresh(w); const late = await S.clubState(w.db, "u_c2", { at: "club_quantum", since: 0 }); chk("an old show is not replayed to someone arriving much later", late.shows.length === 0); }

// ---- history: persisted, categorised, private
{ const w = world(200_000_000); fresh(w);
  const empty = await S.history(w.db, "u_c1"); chk("a player who never spent sees zeros and an empty list", empty.summary.totalKobo === "0" && empty.items.length === 0 && empty.summary.count === 0 && empty.summary.biggest === null);
  await buy(w, { kind: "DRINK", itemId: "hennessy" }); await buy(w, { kind: "SPRAY", amount: 500_000 }); await buy(w, { kind: "BUYOUT", itemId: "shutdown" }); clock += 11 * MIN; fresh(w);
  w.T.character[0].placeId = "club_divas"; w.T.character[0].inPlace = "club_divas"; await buy(w, { kind: "GIFT_DRINK", itemId: "martell", to: "Chika" }); await buy(w, { kind: "PACKAGE", itemId: "vip_package" });
  const h = await S.history(w.db, "u_c1"), sum = h.summary, K = (x) => BigInt(x);
  const rows = w.T.clubTransaction.filter((r) => r.status === "COMPLETED"), total = rows.reduce((s, r) => s + r.amount, 0n);
  chk("the total equals the sum of the stored transactions", K(sum.totalKobo) === total && sum.count === rows.length && rows.length === 5, `${sum.totalKobo} vs ${total}`);
  chk("the total equals the money that actually left the wallet (ledger)", total === w.T.ledgerEntry.filter((l) => /^club:/.test(l.idempotencyKey)).reduce((s, l) => s + BigInt(l.amount), 0n));
  chk("totals per club add up", K(sum.perClub.club_quantum) + K(sum.perClub.club_divas) + K(sum.perClub.club_0203) === total && K(sum.perClub.club_divas) === N(2_000_000 + 3_000_000) && K(sum.perClub.club_0203) === 0n);
  chk("totals per category: drinks (incl. the gift), spraying, buyouts, VIP", K(sum.perGroup.drinks) === N(1_000_000 + 2_000_000) && K(sum.perGroup.spray) === N(500_000) && K(sum.perGroup.buyout) === N(2_500_000) && K(sum.perGroup.vip) === N(3_000_000));
  chk("the most expensive purchase is reported", sum.biggest.amountKobo === N(3_000_000).toString() && /VIP PACKAGE/.test(sum.biggest.itemName));
  chk("the list is newest first with club, type, name, amount, time, status", h.items[0].name === "VIP PACKAGE" && h.items.at(-1).name === "Hennessy" && h.items.every((i) => i.club && i.type && i.name && i.amountKobo && i.at && i.status === "COMPLETED") && h.items.every((x, i, a) => !i || a[i - 1].at >= x.at));
  chk("a gift shows who it was for", h.items.find((i) => i.kind === "GIFT_DRINK").recipient === "Chika");
  const f1 = await S.history(w.db, "u_c1", { club: "club_divas" }), f2 = await S.history(w.db, "u_c1", { type: "drinks" }), f3 = await S.history(w.db, "u_c1", { type: "buyout", club: "club_quantum" });
  chk("filters by club and by type work", f1.items.length === 2 && f2.items.length === 2 && f3.items.length === 1 && f3.items[0].name.includes("Shut Down"));
  const day = new Date(clock).toISOString().slice(0, 10), yday = new Date(clock - 2 * 86_400_000).toISOString().slice(0, 10);
  chk("the date range filter works", (await S.history(w.db, "u_c1", { from: day, to: day })).items.length === 5 && (await S.history(w.db, "u_c1", { to: yday })).items.length === 0);
  const p1 = await S.history(w.db, "u_c1", { limit: 2 }), p2 = await S.history(w.db, "u_c1", { limit: 2, cursor: p1.next }), p3 = await S.history(w.db, "u_c1", { limit: 2, cursor: p2.next });
  chk("pagination walks every transaction once, newest to oldest", p1.items.length === 2 && p2.items.length === 2 && p3.items.length === 1 && p3.next === null && new Set([...p1.items, ...p2.items, ...p3.items].map((i) => i.id)).size === 5);
  const e1 = await err(S.history(w.db, "u_c1", { club: "sub" })), e2 = await err(S.history(w.db, "u_c1", { type: "x" })), e3 = await err(S.history(w.db, "u_c1", { cursor: "1; drop" }));
  chk("bad filters are refused", e1?.status === 400 && e2?.status === 400 && e3?.status === 400);
  const mine = await S.history(w.db, "u_c2"); chk("another player's history is empty: you can only ever read your own (the id comes from the session)", mine.summary.count === 0 && mine.items.length === 0 && !JSON.stringify(mine).includes("Hennessy"));
  w.T.clubTransaction.push({ id: 999n, characterId: "c1", clubId: "club_quantum", kind: "SPRAY", itemId: "spray", itemName: "Money Spraying", amount: N(7_000_000), status: "FAILED", requestId: "x", gameWeek: 1, createdAt: new Date(clock) });
  const again = await S.history(w.db, "u_c1"); chk("a FAILED or cancelled row is never counted as spending", again.summary.totalKobo === sum.totalKobo && !again.items.some((i) => i.id === "999")); }

// ---- the data survives (it is rows, not screen state)
{ const w = world(); fresh(w); await buy(w, { kind: "SPRAY", amount: 250_000 }); const rows = structuredClone(w.T.clubTransaction.map((r) => ({ ...r })));
  const db2 = makeDb(models, { unique: { clubTransaction: ["characterId", "requestId"] } }); db2.T().character.push(base("c1", "Ada")); db2.T().clubTransaction.push(...rows);
  const h = await S.history(db2, "u_c1"); chk("a fresh server process reading the same rows reports the same spending", h.summary.totalKobo === N(250_000).toString() && h.items.length === 1); }

Date.now = realNow;
console.log(failed ? `\n${failed} club check(s) failed` : "\nAll club checks passed");
process.exit(failed ? 1 : 0);
