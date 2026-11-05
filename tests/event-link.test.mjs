// tests/event-link.test.mjs: shareable event links (/home?event=<slug>). Pure Node: the link helpers, a simulated browser for the
// logged-out flow (link -> landing -> log in -> game -> phone on Parties, once), and checks that the screens are wired to them.
import assert from "node:assert/strict";
import fs from "node:fs";
import { slugify, cleanSlug, eventUrl, homeUrl, landingUrl, slugFromSearch, rememberEvent, pendingEvent, takeEvent, forgetEvent, requestFocus, takeFocus } from "../lib/eventLink.js";
const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");

// ---- names and links
assert.equal(slugify("Welcome Back Party"), "welcome-back-party");
assert.equal(slugify("  Fête & Fire!!  "), "fete-fire");
assert.equal(slugify("!!!"), "event", "a name with no letters still gets a usable link name");
assert.ok(slugify("x".repeat(300)).length <= 60);
assert.equal(eventUrl("welcome-back-party", "https://lifeinoau.com"), "https://lifeinoau.com/home?event=welcome-back-party");
assert.equal(eventUrl("a-b", "https://lifeinoau.com/"), "https://lifeinoau.com/home?event=a-b", "no double slash");
assert.equal(homeUrl("welcome-back-party"), "/home?event=welcome-back-party");
assert.equal(homeUrl(null), "/home");
assert.equal(landingUrl("welcome-back-party"), "/?event=welcome-back-party");
assert.equal(landingUrl(undefined), "/");

// ---- junk in the address bar is never trusted
for (const bad of ["", " ", "-a", "a-", "a--b", "A B", "a/b", "../x", "<script>", "a".repeat(81), null, undefined]) assert.equal(cleanSlug(bad), null, JSON.stringify(bad));
assert.equal(cleanSlug("  Welcome-Back-Party "), "welcome-back-party");
assert.equal(slugFromSearch("?event=%3Cscript%3E"), null);
assert.equal(slugFromSearch("?app=parties&event=night-2"), "night-2");
assert.equal(homeUrl("<script>"), "/home", "an unsafe name never reaches a redirect");

// ---- a simulated tab: sessionStorage plus an address bar
const tab = (search = "") => { const m = new Map(); return { search, s: { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) } }; };
let now = 1_000_000;

// 1. a logged-out visitor opens the shared link: the game page remembers it, gets a 401 and sends them to the landing page WITH the event
let t = tab("?event=welcome-back-party");
assert.equal(pendingEvent(now, t.search, t.s), "welcome-back-party");
assert.equal(landingUrl(pendingEvent(now, t.search, t.s)), "/?event=welcome-back-party");
// 2. the landing page opens with the event in its address; it is still remembered, and survives a refresh of the landing page
t = { ...tab("?event=welcome-back-party"), s: t.s };
assert.equal(pendingEvent(now += 5000, t.search, t.s), "welcome-back-party");
// ... even if the address bar was cleaned or lost (a refresh that dropped the query), the remembered event is still there
assert.equal(pendingEvent(now += 5000, "", t.s), "welcome-back-party", "kept through a refresh");
// 3. after a successful log in the player is sent to the event
assert.equal(homeUrl(pendingEvent(now += 20_000, "", t.s)), "/home?event=welcome-back-party");
// 4. the game is ready: the event is taken exactly once (so the phone opens once), and nothing is left behind
assert.equal(takeEvent(now += 1000, "?event=welcome-back-party", t.s), "welcome-back-party");
assert.equal(takeEvent(now += 10, "", t.s), null, "a second take finds nothing: the phone cannot open twice");
assert.equal(pendingEvent(now, "", t.s), null);
// 5. the Parties app is told once; reopening the app later does not repeat it
requestFocus("welcome-back-party", now);
assert.equal(takeFocus(now + 500), "welcome-back-party");
assert.equal(takeFocus(now + 600), null);
requestFocus("welcome-back-party", now);
assert.equal(takeFocus(now + 3 * 60_000), null, "a request nobody picked up expires");

// ---- a normal visit changes nothing
t = tab("");
assert.equal(pendingEvent(now, "", t.s), null);
assert.equal(takeEvent(now, "", t.s), null);
assert.equal(homeUrl(pendingEvent(now, "", t.s)), "/home");
assert.equal(landingUrl(pendingEvent(now, "", t.s)), "/");

// ---- an old, unused link is forgotten so it never opens the phone by surprise much later
t = tab("");
rememberEvent("old-party", now, t.s);
assert.equal(pendingEvent(now + 29 * 60_000, "", t.s), "old-party");
assert.equal(pendingEvent(now + 31 * 60_000, "", t.s), null);
// storage that is blocked or full never throws; the address bar still carries the event
const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); }, removeItem() { throw new Error("blocked"); } };
assert.doesNotThrow(() => rememberEvent("x-y", now, broken));
assert.equal(pendingEvent(now, "?event=x-y", broken), "x-y");
assert.equal(takeEvent(now, "?event=x-y", broken), "x-y");
assert.doesNotThrow(() => forgetEvent(broken));
// a corrupt stored value is treated as nothing
t = tab(""); t.s.setItem("oau.event", "{not json"); assert.equal(pendingEvent(now, "", t.s), null);
t.s.setItem("oau.event", JSON.stringify({ slug: "<b>", at: now })); assert.equal(pendingEvent(now, "", t.s), null);

// ---- the screens are wired to all of this
const shell = read("components/Shell.js"), app = read("components/apps/PartiesApp.js"), landing = read("src/app/page.js"), auth = read("components/AuthModal.js"), client = read("lib/client.js"), css = read("components/apps/parties-app.css");
const events = read("lib/partyEvents.js"), admin = read("lib/adminEvents.js"), schema = read("prisma/schema.prisma");
assert.match(shell, /takeEvent\(\)/); assert.match(shell, /requestFocus\(slug\)/); assert.match(shell, /setPhoneApp\("parties"\)/);
assert.match(shell, /const gameReady = path === "\/home" && !!st/, "the phone opens only once the game is ready (after login, or after the character is made)");
assert.match(shell, /if \(path === "\/home"\) pendingEvent\(\)/, "the event is remembered before the address bar is tidied");
assert.match(client, /router\.push\(landingUrl\(pendingEvent\(\)\)\)/, "a 401 keeps the event");
assert.match(landing, /router\.replace\(homeUrl\(ev\)\)/, "a signed-in visitor on the landing page goes straight to the event");
assert.match(landing, /setMode\(\(m\) => m \?\? "login"\)/, "a logged-out visitor with an event gets the log in form");
assert.match(auth, /router\.push\(homeUrl\(pendingEvent\(\)\)\)/, "log in and sign up both land on the event");
assert.match(app, /className="pty-copy"/); assert.match(app, /navigator\.clipboard\?\.writeText/); assert.match(app, /execCommand\("copy"\)/, "copy works without the clipboard API too");
assert.match(app, /toast\.success\("Event link copied"/); assert.match(app, /no longer listed/, "a deleted or ended event is handled politely");
assert.match(app, /scrollIntoView/); assert.match(app, /prefers-reduced-motion/); assert.match(app, /handled\.current/, "the request is used once");
assert.match(css, /\.pty-copy/); assert.match(css, /\.pty-card-spot/); assert.match(css, /prefers-reduced-motion: reduce/);
// the share link is built from the event's own slug, never its numeric id or its (changeable) name
assert.match(app, /eventUrl\(slug, base\)/);
// every event has its own permanent slug: unique in the database, made once on create, never touched by an update
assert.match(schema, /slug\s+String\s+@unique/); assert.match(events, /slug: e\.slug/); assert.match(admin, /slug: await uniqueSlug\(tx, f\.name\)/);
assert.ok(!/slug/.test(admin.slice(admin.indexOf("export async function updateEvent"), admin.indexOf("export async function deleteEvent"))), "updating an event never changes its slug");
// the old ?app=parties links still work (the existing effect is untouched)
assert.match(shell, /params\.get\("app"\)/);

console.log("event links: all checks passed");

// ---- unique, stable slugs (no database needed: a tiny fake)
{
  const { uniqueSlug } = await import("../lib/partyEvents.js");
  const taken = new Set();
  const db = { partyEvent: { findUnique: async ({ where }) => (taken.has(where.slug) ? { id: 1 } : null) } };
  const a = await uniqueSlug(db, "Welcome Back Party"); taken.add(a);
  const b = await uniqueSlug(db, "Welcome Back Party!"); taken.add(b);
  const c = await uniqueSlug(db, "welcome back party"); taken.add(c);
  assert.deepEqual([a, b, c], ["welcome-back-party", "welcome-back-party-2", "welcome-back-party-3"]);
  assert.ok([a, b, c].every((x) => cleanSlug(x) === x), "every made slug is a valid link name");
  const long = await uniqueSlug({ partyEvent: { findUnique: async ({ where }) => (where.slug.length < 60 ? { id: 1 } : null) } }, "x".repeat(200));
  assert.ok(cleanSlug(long), "even a very long name gives a usable slug");
  console.log("event slugs: unique and valid");
}
