// tests/avatar-snapshot.test.mjs: profile pictures drawn from the real 3D character.
// Covers what runs without a browser: the server lookup (lib/avatarService.js), the browser's look directory (lib/avatarDirectory.js: batching,
// refreshing, live updates, failures) and the snapshot cache / framing / fallback (lib/avatarSnapshot.js). The 3D drawing itself needs WebGL and is
// exercised in the browser; here we prove that when it cannot run, the caller is told so cleanly (null) instead of getting an error or a wrong picture.
import assert from "node:assert/strict";
import { makeDb } from "./fakedb.mjs";
import { cleanLook, lookKey, defaultLook } from "../lib/look.js";
import { cleanNames, getAvatarLooks, MAX_NAMES } from "../lib/avatarService.js";
import { createDirectory } from "../lib/avatarDirectory.js";
import { keyOf, peekSnapshot, getSnapshot, framing, SNAP_VERSION, SNAP_PX, HEAD_TOP, HAIR_TOP, CHIN_AT } from "../lib/avatarSnapshot.js";
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
// a head as measured from the real model: [top of hair, top of skull, chin] in metres
const HEADS = { man: { top: 1.78, skullTop: 1.767, chin: 1.555 }, afro: { top: 1.957, skullTop: 1.873, chin: 1.66 }, gele: { top: 1.788, skullTop: 1.673, chin: 1.47 }, short: { top: 1.65, skullTop: 1.589, chin: 1.39 } };
const place = (m, f, y) => 0.5 - (y - f.cy) / f.size; // where a height lands in the square picture, 0 = top edge, 1 = bottom edge
for (const [n, m] of Object.entries(HEADS)) {
  const f = framing({ ...m, cx: 0, cz: 0.06, hairW: 0.3 });
  chk(`${n}: the hair is inside the picture, clear of the top edge`, place(m, f, m.top) >= HAIR_TOP - 1e-9 && place(m, f, m.top) < 0.2);
  chk(`${n}: the chin sits at its place in the circle and the face fills at least 40% of the picture`, Math.abs(place(m, f, m.chin) - CHIN_AT) < 1e-9 && place(m, f, m.chin) - place(m, f, m.skullTop) >= 0.4);
  chk(`${n}: the camera is the same kind of distance for everyone (head and shoulders, not a speck)`, f.dist > 0.4 && f.dist < 2 && f.size < 0.9);
}
chk("a wide hairstyle zooms out instead of being cut at the sides", framing({ ...HEADS.man, hairW: 0.6 }).size > framing({ ...HEADS.man, hairW: 0.2 }).size);
chk("an absurd measurement still gives a usable camera", Number.isFinite(framing({ top: 1, chin: 1 }).dist) && framing({ top: 1, chin: 1 }).dist > 0);
chk("the picture is square and the circle crop shows all of it", SNAP_PX > 0 && SNAP_PX % 2 === 0 && SNAP_VERSION >= 2);
const t0 = Date.now(); const s1 = await getSnapshot("nowebgl", ada, "F");
chk("without WebGL the picture is null (the caller shows its fallback), not an exception", s1 === null);
const s2 = await getSnapshot("nowebgl", ada, "F");
chk("a failed picture is not retried on every render", s2 === null && Date.now() - t0 < 5000);
chk("two asks for the same look share one piece of work", getSnapshot("shared", ada, "F") === getSnapshot("shared", ada, "F"));
await tick(50);
console.log(bad ? `\n${bad} check(s) failed` : "\nAll avatar snapshot checks passed"); process.exit(bad ? 1 : 0);
