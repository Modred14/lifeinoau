// tests/avatar-snapshot.test.mjs: profile pictures drawn from the real 3D character.
// Covers what runs without a browser: the server lookup (lib/avatarService.js), the browser's look directory (lib/avatarDirectory.js: batching,
// refreshing, live updates, failures) and the snapshot cache / framing / fallback (lib/avatarSnapshot.js). The 3D drawing itself needs WebGL and is
// exercised in the browser; here we prove that when it cannot run, the caller is told so cleanly (null) instead of getting an error or a wrong picture.
import assert from "node:assert/strict";
import { makeDb } from "./fakedb.mjs";
import { cleanLook, lookKey, defaultLook } from "../lib/look.js";
import { cleanNames, getAvatarLooks, MAX_NAMES } from "../lib/avatarService.js";
import { createDirectory } from "../lib/avatarDirectory.js";
import { keyOf, peekSnapshot, getSnapshot, framing, SNAP_VERSION } from "../lib/avatarSnapshot.js";
let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };
const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));

// ---- the server lookup ----
const db = makeDb(["character"]), T = db.T();
const ada = cleanLook({ hair: "braids", skin: "mahogany", outfit: "owambe", top: "red", bottom: "black", build: "athletic", height: "tall" }, "F");
T.character.push({ id: "c1", name: "Ada", gender: "F", look: ada }, { id: "c2", name: "Bob", gender: "M", look: null }, { id: "c3", name: "Cy", gender: "M", look: { hair: "nonsense", skin: "x" } });
chk("names are trimmed, de-duplicated (any case) and junk is dropped", JSON.stringify(cleanNames([" Ada ", "ada", "", null, 5, "x".repeat(40), "Bob"])) === JSON.stringify(["Ada", "5", "Bob"]));
chk("a list can never be longer than one screen's worth", cleanNames(Array.from({ length: 500 }, (_, i) => "p" + i)).length === MAX_NAMES);
chk("not a list at all gives nothing", cleanNames("Ada").length === 0 && cleanNames(null).length === 0);
const r = await getAvatarLooks(db, ["ada", "BOB", "Cy", "Nobody"]);
chk("a name is found in any case, an unknown name is simply absent", r.players.ada?.name === "Ada" && r.players.bob && r.players.cy && !r.players.nobody);
chk("the saved gender and look are returned exactly as saved", r.players.ada.gender === "F" && JSON.stringify(r.players.ada.look) === JSON.stringify(ada) && r.players.ada.key === lookKey(ada, "F"));
chk("a player with no saved look gets the default look for their gender", JSON.stringify(r.players.bob.look) === JSON.stringify(cleanLook(null, "M")) && r.players.bob.key === lookKey(defaultLook("M"), "M"));
chk("an invalid stored look is cleaned, never passed on as it is", r.players.cy.look.hair === defaultLook("M").hair && r.players.cy.look.skin === defaultLook("M").skin);
chk("a different look has a different key (so its picture is made again)", lookKey(ada, "F") !== lookKey({ ...ada, hair: "afro" }, "F") && lookKey(ada, "F") !== lookKey(ada, "M"));
chk("no names means no database work and no players", Object.keys((await getAvatarLooks(db, [])).players).length === 0);

// ---- the look directory ----
let calls = [], now = 1_000_000, down = false;
const server = { ada: { name: "Ada", gender: "F", look: ada, key: "k1" }, bob: { name: "Bob", gender: "M", look: defaultLook("M"), key: "k2" } };
const dir = createDirectory({ fetchLooks: async (names) => { calls.push(names); if (down) throw new Error("offline"); return Object.fromEntries(names.filter((n) => server[n]).map((n) => [n, server[n]])); }, now: () => now, ttl: 60_000, missTtl: 10_000, wait: 5 });
const [a1, a2, b1, z1] = await Promise.all([dir.request("Ada"), dir.request("ada"), dir.request("Bob"), dir.request("Zed")]);
chk("ten faces on one screen are ONE request, each name asked once", calls.length === 1 && calls[0].length === 3);
chk("every asker gets the player's look", a1?.key === "k1" && a2?.key === "k1" && b1?.key === "k2" && z1 === null);
chk("what is known can be read at once", dir.peek("ADA")?.gender === "F" && dir.peek("Zed") === null);
await dir.request("Ada"); chk("a fresh entry is not asked again", calls.length === 1);
await dir.request("Zed"); chk("an unknown player is not asked again straight away", calls.length === 1);
now += 70_000; const stale = dir.peek("Ada"); await dir.request("Ada"); chk("an old entry is refreshed, and meanwhile still usable", stale?.key === "k1" && calls.length === 2);
let heard = []; const off = dir.subscribe((k) => heard.push(k));
server.ada = { ...server.ada, key: "k1-new" }; now += 70_000; await dir.request("Ada");
chk("a changed look is announced to the faces showing that player", heard.includes("ada") && dir.peek("Ada").key === "k1-new");
heard = []; dir.seed("Ada", "F", ada, "k1-newer"); chk("a look saved on this device is shown at once, without a request", dir.peek("Ada").key === "k1-newer" && heard.includes("ada") && calls.length === 3);
heard = []; dir.seed("Ada", "F", ada, "k1-newer"); chk("the same look again does not repaint anything", heard.length === 0);
off();
dir.forget("Bob"); chk("a forgotten name is asked for again", dir.peek("Bob") === null && (await dir.request("Bob"))?.key === "k2");
down = true; now += 70_000; const kept = await dir.request("Ada"); chk("when the server cannot be reached the known look is kept", kept?.key === "k1-newer");
const none = await dir.request("Newbie"); chk("an unreachable server is not mistaken for 'no such player'", none === null); down = false;
const before = calls.length; await dir.request("Newbie"); chk("…so the name is tried again on the next ask", calls.length > before);

// ---- snapshot cache, framing, fallback ----
chk("pictures are keyed by what is drawn and by the picture version", keyOf("abc") === `v${SNAP_VERSION}:abc` && keyOf("abc") !== keyOf("abd"));
chk("nothing is in memory before anything is drawn", peekSnapshot("never-drawn") === null);
for (const h of [1.5, 1.76, 1.9]) { const f = framing(h); chk(`framing for ${h} m keeps the head in and the camera sane`, f.mid > h * 0.78 && f.mid < h * 0.9 && f.dist > 0.8 && f.dist < 3); }
const f1 = framing(1.6), f2 = framing(1.9); chk("a taller character is framed higher and from further away, so the same share of them shows", f2.mid > f1.mid && f2.dist > f1.dist);
chk("an absurd height is clamped", framing(0).mid > 0 && framing(50).dist < 4);
const t0 = Date.now(); const s1 = await getSnapshot("nowebgl", ada, "F");
chk("without WebGL the picture is null (the caller shows its fallback), not an exception", s1 === null);
const s2 = await getSnapshot("nowebgl", ada, "F");
chk("a failed picture is not retried on every render", s2 === null && Date.now() - t0 < 5000);
chk("two asks for the same look share one piece of work", getSnapshot("shared", ada, "F") === getSnapshot("shared", ada, "F"));
await tick(50);
console.log(bad ? `\n${bad} check(s) failed` : "\nAll avatar snapshot checks passed"); process.exit(bad ? 1 : 0);
