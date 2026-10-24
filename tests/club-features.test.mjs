// tests/club-features.test.mjs: the DJ, the club music and the expensive purchases, checked SEPARATELY in 0203, Royal Divas and Quantum.
//   1. the room: each club is an interior, has its own DJ booth ring and bottle-service ring (reachable floor), and both lead somewhere that works;
//   2. the DJ: each club has its own resident set, a mix that never repeats back to back, smooth transitions, and only licensed audio is ever played;
//   3. the wiring (read from the source, like tests/phone-overlay.test.mjs): the player and the Luxury app are mounted, their stylesheets and icons exist, and every
//      name one file imports from another really exists (a missing export is a build error the browser would only show at run time);
//   4. the money (server, against the in-memory database): every item of the whole luxury catalogue can be bought in every club at its listed price, a poor player is
//      refused and charged nothing, a repeated request charges once, the purchase is stored, and a fresh server process still sees it after re-entry;
//   5. the clock: the club hours and every clock on screen are the same game time, whatever the device's own time zone is.
import fs from "node:fs";
import { makeDb } from "./fakedb.mjs";
import * as C from "../lib/clubs.js";
import * as M from "../lib/clubMusic.js";
import * as K from "../lib/campus-clock.js";
import { classify, buildInterior } from "../lib3d/interiors/index.js";
import { activityHubs } from "../lib3d/interiors/activityHubs.js";
import { resolveHub } from "../lib/hubActions.js";
import { DJ_RING, MENU_RING } from "../lib3d/interiors/plans2.js";

let failed = 0;
const chk = (name, cond, detail = "") => { if (cond) console.log("OK   " + name); else { failed++; console.log("FAIL " + name + (detail ? " :: " + detail : "")); } };
const err = async (p) => { try { await p; return null; } catch (e) { return e; } };
const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
const NAMES = { club_0203: "0203", club_divas: "Royal Divas", club_quantum: "Quantum" };

// ======================================================================================================= 1. the room, club by club
for (const id of C.CLUB_IDS) {
  const place = { id, name: NAMES[id], kind: "club" }, cl = classify(id, "club");
  chk(`${NAMES[id]}: the map id is a club with an interior of its own`, C.isClub(id) && cl.mode === "interior" && cl.spec.t === "club" && !!cl.spec.v);
  const c = buildInterior(place), labels = c?.hubs.map((h) => h.label) ?? [];
  chk(`${NAMES[id]}: it has a DJ booth ring and a bottle-service ring (and still the parties desk)`, labels.includes(DJ_RING) && labels.includes(MENU_RING) && labels.includes("This week's parties"), labels.join(" | "));
  const nv = c?.navPlayer?.[0], walk = (h) => { const [i, j] = nv.cell(h.x, h.z); return !!nv.at(i, j); };
  chk(`${NAMES[id]}: both rings stand on floor a player can walk to`, !!nv && c.hubs.filter((h) => h.label === DJ_RING || h.label === MENU_RING).every(walk));
  chk(`${NAMES[id]}: the DJ ring opens the music screen and the other ring the VIP menu`, resolveHub({ label: DJ_RING }).panel === "dj" && resolveHub({ label: MENU_RING }).panel === "menu" && resolveHub({ label: DJ_RING }).kind === "club");
  const acts = activityHubs(c, cl.spec).hubs.map((h) => h.act);
  chk(`${NAMES[id]}: the dance floor and the bar rings are there too`, acts.includes("dance") && acts.includes("club_drink"), acts.join());
  chk(`${NAMES[id]}: the three club ids agree everywhere (config, music, party venue, activity venue)`, !!M.CLUB_SETS[id] && C.CLUBS[id].venue === NAMES[id] && read("lib/activityService.js").includes(`${id}: "${NAMES[id]}"`) && read("public/data/oau-campus.json").includes(`"id": "${id}"`));
}
chk("each club's own two rings sit apart from each other (no ring hides another)", C.CLUB_IDS.every((id) => { const h = buildInterior({ id, name: id, kind: "club" }).hubs.filter((x) => x.label === DJ_RING || x.label === MENU_RING); return Math.hypot(h[0].x - h[1].x, h[0].z - h[1].z) > 5; }));

// ======================================================================================================= 2. the DJ, club by club
const seed = 123456;
for (const id of C.CLUB_IDS) {
  const set = M.buildSet(id, seed), club = M.setOf(id);
  chk(`${NAMES[id]}: has its own resident DJ and a full night's set`, !!club.dj && set.length === M.SET_LENGTH && club.dj !== M.setOf(C.CLUB_IDS.find((o) => o !== id)).dj);
  chk(`${NAMES[id]}: the set only plays the club's own genres`, set.every((t) => club.genres[t.genre]), [...new Set(set.map((t) => t.genre))].join());
  chk(`${NAMES[id]}: the same night gives the same set, and no track repeats back to back`, JSON.stringify(set.map((t) => t.id)) === JSON.stringify(M.buildSet(id, seed).map((t) => t.id)) && set.every((t, i) => i === 0 || t.id !== set[i - 1].id));
  let ok = true; const rnd = M.rng(M.hashSeed(id));
  for (let i = 1; i < set.length; i++) { const p = M.planTransition(set[i - 1], set[i], rnd); ok = ok && p.seconds >= 4 && p.seconds <= 40 && (p.type === "beatmatch" || p.type === "fade"); }
  chk(`${NAMES[id]}: every change is a timed blend (4 to 40 seconds), never a hard cut`, ok);
}
chk("a crossfade never dips or jumps in loudness (equal power)", [0, 0.2, 0.5, 0.8, 1].every((k) => { const g = M.crossfadeGains(k); return Math.abs(g.out ** 2 + g.in ** 2 - 1) < 1e-9; }));
chk("only authorised audio is ever played: an entry with no licence note, no artist or a bad src is refused", (() => {
  const r = M.normalizeManifest({ tracks: [{ id: "a", title: "A", artist: "B", src: "/audio/club/a.mp3", license: "Own work, written permission 2026" }, { id: "b", title: "B", artist: "X", src: "/audio/club/b.mp3" }, { id: "c", title: "C", src: "/audio/club/c.mp3", license: "x" }, { id: "d", title: "D", artist: "Y", src: "http://evil/x.mp3", license: "x" }, { id: "e", title: "E", artist: "Y", src: "/../x.mp3", license: "x" }] });
  return r.tracks.length === 1 && r.rejected.length === 4; })());
chk("the in-house tracks are generated by the browser and named as the game's own, never as anybody's song", M.SYNTH_TRACKS.every((t) => t.kind === "synth") && M.describeTrack(M.SYNTH_TRACKS[0], "club_0203").artist === "DJ Harmattan" && M.describeTrack(M.SYNTH_TRACKS[0], "club_divas").artist === "DJ Gold Mara");
chk("no copyrighted audio file is bundled (public/audio/club has none, and the catalogue of hits has no audio of its own)", !fs.existsSync(new URL("../public/audio/club", import.meta.url)) || fs.readdirSync(new URL("../public/audio/club", import.meta.url)).every((f) => f === "manifest.json"));

// ======================================================================================================= 3. the wiring
const layer = read("components/ClubLayer.js"), player = read("components/ClubMusicPlayer.js"), phone = read("components/Phone.js"), dj = read("lib/clubDj.js"), snd = read("lib/sound.js"), icons = read("components/Icon.js"), inside = read("components/BuildingInside.js");
chk("the club screen mounts the DJ player for every club, live only while the club is open", /<ClubMusicPlayer club=\{club\} live=\{isOpen\} \/>/.test(layer) && /isClub\(place\.id\) && <ClubLayer/.test(inside));
chk("the DJ ring and the bottle-service ring reach the screens (BuildingInside -> oau:club-ui -> player / menu)", /t\.kind === "club"/.test(inside) && /"oau:club-ui"/.test(layer) && /"oau:club-ui"/.test(player) && /panel === "dj"/.test(player) && /panel === "menu"/.test(layer));
chk("the Luxury app is registered in the phone and shown on the home screen", /^ {2}luxury: \{ name: "Luxury"[^\n]*C: LuxuryApp/m.test(phone) && /const GRID = \[[^\]]*"luxury"/.test(phone) && /import LuxuryApp from/.test(phone));
chk("the club menu leads to the Luxury app", /app: "luxury"/.test(read("components/ClubPanel.js")));
const sheets = ["components/ClubLayer.js", "components/ClubPanel.js", "components/ClubMusicPlayer.js", "components/apps/LuxuryApp.js", "components/apps/SpendingApp.js"].flatMap((f) => [...read(f).matchAll(/import "\.\/([\w-]+\.css)"/g)].map((m) => f.replace(/[^/]+$/, "") + m[1]));
chk(`every stylesheet those screens import exists (${sheets.length})`, sheets.every((s) => fs.existsSync(new URL("../" + s, import.meta.url))), sheets.filter((s) => !fs.existsSync(new URL("../" + s, import.meta.url))).join());
const missing = []; // a named import that the other file does not export
for (const f of ["lib/clubDj.js", "components/ClubMusicPlayer.js", "components/ClubLayer.js", "components/apps/LuxuryApp.js", "components/ClubPanel.js"]) for (const m of read(f).matchAll(/import \{([^}]+)\} from "(?:@\/lib\/|\.\/)(sound|clubDj|clubMusic|clubs|campus-clock|wardrobe|gameStore|confirm|client)(?:\.js)?"/g)) {
  const target = read(`lib/${m[2]}.js`); for (const n of m[1].split(",").map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean)) if (!new RegExp(`export (?:async )?(?:function|class) ${n}\\b|export (?:const|let) [^;\\n]*\\b${n}\\s*=|export \\{[^}]*\\b${n}\\b`).test(target)) missing.push(`${f}: ${n} from ${m[2]}`);
}
chk("every name the DJ, the club screens and the Luxury app import exists in the file it comes from", missing.length === 0, missing.join("; "));
chk("the DJ can fade the lobby song (duckMusic exists and is used)", /export function duckMusic/.test(snd) && /duckMusic\(true\)/.test(dj) && /duckMusic\(false\)/.test(dj));
chk("the player's pause and play buttons have icons", /pause: Pause/.test(icons) && /play: Play/.test(icons));
chk("the DJ controls exist: play, pause, next, mute and a volume slider", ["pauseClubMusic", "resumeClubMusic", "skipClubTrack", "setClubMuted", "setClubVolume"].every((n) => player.includes(n)) && /type="range"/.test(player));
chk("on a phone the DJ button shrinks and stays clear of the stick, the Run button and the drawer", /@media \(max-width: 640px\)[^}]*\.th \.cm/.test(read("components/club-music.css")) && /bottom: calc\(var\(--safe-b\) \+ 13\d+px\)/.test(read("components/club-music.css")));

// ======================================================================================================= 4. the money, club by club
const WAT = (h, m = 0, day = 6) => Date.UTC(2026, 9, day, h - 1, m);
const S = await import("../lib/clubService.js");
const N = (n) => BigInt(n) * 100n, START = Date.UTC(2026, 9, 1, 15, 30);
const realNow = Date.now; let clock = WAT(22, 0, 6); Date.now = () => clock;
const models = ["character", "account", "actionLog", "ledgerEntry", "floorZero", "gameClock", "notification", "achievement", "examResult", "achievementAward", "business", "holding", "partyTicket", "bond", "activityRun", "courseProgress", "clubVip", "clubBuyout", "clubEvent", "clubTransaction", "block"];
const FACULTY = { name: "Science", difficulty: 1.1 };
const base = (id, name, over = {}) => ({ id, userId: "u_" + id, name, hostel: "Awo", expelled: false, suspendedUntilWeek: 0, jailedUntil: null, strikes: 0, energy: 100, health: 80, happiness: 60, academics: 40, popularity: 10, suspicion: 0, luck: 50, personalities: [], lastTickWeek: 9999, joinedWeek: 1, sessionStartWeek: 1, level: 100, class: "LAPO", placeId: "club_quantum", energyRefilledAt: new Date(clock), inPlace: "club_quantum", inX: 2, inZ: 3, inFloor: 0, inAt: new Date(clock), ...over });
function world(club, cash) {
  const db = makeDb(models, { unique: { actionLog: ["characterId", "requestId"], ledgerEntry: ["idempotencyKey"], activityRun: ["characterId", "requestId"], examResult: ["characterId", "gameWeek"], clubTransaction: ["characterId", "requestId"] }, join: { character: (r, T) => r && ({ ...r, account: T.account.find((a) => a.characterId === r.id), faculty: FACULTY }) } });
  for (const m of ["clubTransaction", "clubEvent", "clubBuyout", "clubVip", "notification"]) { const create = db[m].create; db[m].create = (a) => create({ data: { createdAt: new Date(Date.now()), ...a.data } }); }
  const tr = db.$transaction; let queue = Promise.resolve(); db.$transaction = (fn) => { const next = queue.then(() => tr(fn), () => tr(fn)); queue = next.catch(() => {}); return next; };
  const T = db.T();
  T.account.push({ id: "a1", kind: "PLAYER", systemName: null, characterId: "c1", balance: N(cash) }, { id: "w", kind: "SYSTEM", systemName: "WORLD", balance: 0n }, { id: "v", kind: "SYSTEM", systemName: "VENUES", balance: 0n }, { id: "d", kind: "SYSTEM", systemName: "DSA", balance: 0n });
  T.gameClock.push({ id: 1, startedAt: new Date(START) });
  T.character.push(base("c1", "Ada", { placeId: club, inPlace: club }));
  return { db, T, bal: () => T.account.find((a) => a.id === "a1").balance, venues: () => T.account.find((a) => a.id === "v").balance };
}
let n = 0; const rid = () => `feat-${String(++n).padStart(6, "0")}-abcdef`;
const catalogue = (club) => [
  ...C.DRINKS.map((d) => ({ kind: "DRINK", itemId: d.id, naira: d.priceNaira, label: d.name })),
  ...C.PACKAGES.map((p) => ({ kind: "PACKAGE", itemId: p.id, naira: p.priceNaira, label: p.name })),
  ...C.EXPERIENCES.map((x) => ({ kind: "EXPERIENCE", itemId: x.id, naira: x.priceNaira, label: x.name })),
  ...C.BUYOUT_TIERS.map((t) => ({ kind: "BUYOUT", itemId: t.id, naira: C.buyoutPrice(club, t.id), label: t.name })),
  ...[10_000, 1_000_000, 10_000_000].map((a) => ({ kind: "SPRAY", itemId: "spray", amount: a, naira: a, label: `Spray ${a}` })),
];
chk("the catalogue is the whole luxury list: 7 bottles up to ₦10M, 3 packages, 9 experiences, 3 buyouts per club and spraying", catalogue("club_0203").length === 7 + 3 + 9 + 3 + 3 && Math.max(...catalogue("club_0203").map((i) => i.naira)) === 10_000_000);
for (const club of C.CLUB_IDS) {
  const name = NAMES[club], items = catalogue(club);
  { // every item, bought one after the other in this club (the clock moves on past each buyout so the next one is free to start)
    const w = world(club, 400_000_000); let allOk = true, showsOk = true, bad = ""; const total = items.reduce((a, i) => a + i.naira, 0);
    for (const it of items) {
      const before = w.bal(); let r = null, e = null; try { r = await S.purchase(w.db, "u_c1", { requestId: rid(), kind: it.kind, itemId: it.itemId, amount: it.amount }); } catch (x) { e = x; }
      const ok = !e && r?.ok && before - w.bal() === N(it.naira); if (!ok) { allOk = false; bad ||= `${it.label}: ${e?.message ?? "wrong amount"}`; }
      if (!w.T.clubEvent.some((x) => x.kind === "SHOW" && String(x.id) === r?.eventId && x.clubId === club)) showsOk = false; // this purchase's own show is on the floor
      w.T.character[0].inAt = new Date(clock); clock += 11 * 60_000; w.T.character[0].inAt = new Date(clock); // a buyout runs at most 10 minutes
    }
    chk(`${name}: all ${items.length} items can be bought, each charging exactly its listed ₦ price`, allOk, bad);
    chk(`${name}: the venue was paid everything, the player lost exactly that, and each purchase is stored`, w.T.ledgerEntry.filter((l) => l.creditAccountId === "v").reduce((a, l) => a + l.amount, 0n) === N(total) && w.bal() === N(400_000_000 - total) && w.T.clubTransaction.length === items.length && w.T.clubTransaction.every((t) => t.clubId === club && t.status === "COMPLETED") && w.T.ledgerEntry.length === items.length);
    chk(`${name}: every purchase wrote a show for the others in the club (only after the money moved)`, showsOk);
    const h = await S.history(world(club, 1).db, "u_c1"); chk(`${name}: the history of a player who bought nothing is empty`, h.items.length === 0 && h.summary.totalKobo === "0");
    const again = await S.history(w.db, "u_c1", { club, limit: 50 }); chk(`${name}: the Spending History lists them, in ₦, newest first`, again.items.length === items.length && again.summary.perClub[club] === N(total).toString() && Number(again.items[0].id) > Number(again.items[1].id) && again.items.every((i) => i.club === name));
    const other = C.CLUB_IDS.find((o) => o !== club); chk(`${name}: nothing was recorded against the other clubs`, (await S.history(w.db, "u_c1", { club: other })).items.length === 0);
    // leaving and coming back (a new server process reading the same rows): the ownership is still there
    clock = WAT(22, 0, 6); const rows = w.T; const db2 = makeDb(models, { unique: {}, join: { character: (r, T) => r && ({ ...r, account: T.account.find((a) => a.characterId === r.id), faculty: FACULTY }) } }); for (const k of Object.keys(rows)) db2.T()[k]?.push(...rows[k]);
    const hh = await S.history(db2, "u_c1", { limit: 50 }); chk(`${name}: after leaving and coming back, the purchases and the total are all still there`, hh.items.length === items.length && hh.summary.totalKobo === N(total).toString());
  }
  clock = WAT(22, 0, 6);
  { const w = world(club, 900_000); const e = await err(S.purchase(w.db, "u_c1", { requestId: rid(), kind: "DRINK", itemId: "hennessy" }));
    chk(`${name}: a player with ₦900,000 cannot buy the ₦1,000,000 Hennessy: refused (402), nothing charged, nothing stored, no show`, e?.status === 402 && w.bal() === N(900_000) && w.T.clubTransaction.length === 0 && w.T.ledgerEntry.length === 0 && w.T.clubEvent.length === 0, e?.message);
    const e2 = await err(S.purchase(w.db, "u_c1", { requestId: rid(), kind: "BUYOUT", itemId: "takeover" })); chk(`${name}: nor the ₦${(C.buyoutPrice(club, "takeover") / 1e6)}M takeover`, e2?.status === 402 && w.bal() === N(900_000) && w.T.clubBuyout.length === 0); }
  { const w = world(club, 20_000_000), id = rid(); const rs = await Promise.all([1, 2, 3, 4].map(() => S.purchase(w.db, "u_c1", { requestId: id, kind: "DRINK", itemId: "louis_xiii" })));
    chk(`${name}: the same request four times at once (double tap, retry) charges ONCE`, w.bal() === N(10_000_000) && w.T.clubTransaction.length === 1 && rs.filter((r) => !r.duplicate).length === 1); }
  { const w = world(club, 50_000_000), other = C.CLUB_IDS.find((o) => o !== club); w.T.character[0].placeId = other; const e = await err(S.purchase(w.db, "u_c1", { requestId: rid(), kind: "DRINK", itemId: "hennessy" }));
    chk(`${name}: standing in a different club is refused (the position is the server's, not the browser's)`, e?.status === 409 && w.bal() === N(50_000_000)); }
  { clock = WAT(12, 0, 6); const w = world(club, 50_000_000); const e = await err(S.purchase(w.db, "u_c1", { requestId: rid(), kind: "DRINK", itemId: "hennessy" })); clock = WAT(22, 0, 6);
    chk(`${name}: by day the club is closed: refused, charged nothing`, e?.status === 403 && w.bal() === N(50_000_000)); }
  { const w = world(club, 50_000_000); const e = await err(S.purchase(w.db, "u_c1", { requestId: rid(), kind: "DRINK", itemId: "hennessy", price: 1, amount: 1, priceNaira: 1 }));
    chk(`${name}: a price sent by the browser is ignored: Hennessy still costs ₦1,000,000`, e === null && w.bal() === N(49_000_000)); }
  { const w = world(club, 50_000_000); const s = await S.clubState(w.db, "u_c1", { at: club }); chk(`${name}: the club state is open at night, names the club and is ready for the screen to poll`, s.status.open && s.club.id === club && s.club.name === name && s.canEnter && Array.isArray(s.shows)); }
}

// ======================================================================================================= 5. one clock
{ const real = K.GAME_TIME_ZONE;
  chk("the game's time zone is one setting, West Africa Time by default, with a short label", real === "Africa/Lagos" && K.gameZoneLabel() === "WAT" && K.zoneOffsetMin(Date.UTC(2026, 9, 24, 12)) === 60);
  const t = Date.UTC(2026, 9, 24, 21, 43); // 22:43 in Ile-Ife, 17:43 in New York
  chk("the club hours, the clock text and the night flag all read the same game time", K.gameMinuteOfDay(t) === 22 * 60 + 43 && K.gameClockText(t) === "10:43 PM" && K.gameClockWithZone(t) === "10:43 PM WAT" && K.isGameNight(t) && C.isNightTime(t) && C.clubStatus(t).open);
  const noon = Date.UTC(2026, 9, 24, 11, 0); chk("at 12:00 game time the clubs are shut and say when they open", !C.clubStatus(noon).open && C.clubStatus(noon).note === "Opens at 8 PM" && !K.isGameNight(noon) && K.gameClockText(noon) === "12:00 PM");
  const midnightNY = Date.UTC(2026, 9, 24, 4, 0); chk("midnight in New York (05:00 game time) is closing time, not a night out: the same everywhere", K.gameMinuteOfDay(midnightNY) === 5 * 60 && !C.isNightTime(midnightNY));
  chk("the server and the browser read time the same way: no clock on screen uses the device's own zone", ["components/Phone.js", "components/Shell.js"].every((f) => !/\.getHours\(\)|\.getDate\(\)/.test(read(f))) && /timeZone: GAME_TIME_ZONE/.test(read("components/apps/MessagesApp.js")) && /GAME_TIME_ZONE/.test(read("lib/clubService.js")) && !/"Africa\/Lagos"/.test(read("lib/clubService.js")));
  chk("the clock runs 1:1 with real time (one game minute is one real minute)", K.GAME_MINUTE_MS === 60_000 && K.GAME_DAY_MS === 86_400_000);
  const dst = Date.UTC(2026, 6, 1, 12); chk("a zone with daylight saving is handled exactly (New York is UTC-4 in summer, UTC-5 in winter)", K.zoneOffsetMin(dst, "America/New_York") === -240 && K.zoneOffsetMin(Date.UTC(2026, 0, 15, 12), "America/New_York") === -300); }

Date.now = realNow;
console.log(failed ? `\n${failed} check(s) failed` : "\nAll club feature checks passed"); process.exit(failed ? 1 : 0);
