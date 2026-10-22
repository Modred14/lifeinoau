// tests/playertags.test.mjs
// Name tags for other real players: who may get one (never you, never an NPC), how the server lists players and their positions, how the tag layer
// places / removes tags and reports taps, and how the building's remote avatars come and go. Pure Node (a tiny DOM stand-in is used for the tag layer).
import * as THREE from "three";
import { shapePeople, positionOf, animOf, publicId, POSITION_FRESH_MS } from "../lib/playerPresence.js";
import { isTaggable, createPlayerTags } from "../lib3d/playerTags.js";
import { createRemotePlayers, REMOTE_MAX } from "../lib3d/interiors/remotePlayers.js";
let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };

// ---------------------------------------------------------------- who may carry a tag
const me = { id: "cmeXXXXXXXXXXXXXX1", name: "Ada" };
chk("a real player who is not you may carry a tag", isTaggable({ id: "abcd1234", name: "Tunde" }, { name: "Ada" }));
chk("you never do (by name, any case, with spaces)", !isTaggable({ id: "zz", name: "ada " }, { name: "Ada" }) && !isTaggable({ id: "zz", name: "ADA" }, { name: "ada" }));
chk("you never do (by id)", !isTaggable({ id: "same", name: "Other" }, { id: "same" }));
chk("an NPC never does", !isTaggable({ id: "npc1", name: "Lecturer", npc: true }) && !isTaggable({ id: "npc1", name: "Lecturer", isNpc: true }));
chk("no id or no name: no tag", !isTaggable({ name: "x" }) && !isTaggable({ id: "x" }) && !isTaggable({ id: "x", name: "  " }) && !isTaggable(null));

// ---------------------------------------------------------------- what the server lists
const now = Date.UTC(2026, 9, 18, 12, 0, 0), at = (ms) => new Date(now - ms);
const row = (id, name, o = {}) => ({ id, name, gender: "M", level: 200, look: null, faculty: { name: "Law" }, inPlace: "library", inX: 3, inZ: 4, inFloor: 0, inAt: at(2000), ...o });
const rows = [row("c_1111111111aaaaaaaa", "Tunde"), row("c_2222222222bbbbbbbb", "Bisi", { inAt: at(POSITION_FRESH_MS + 1000) }), row(me.id, "Ada"), row("c_3333333333cccccccc", "Chi"), row("c_4444444444dddddddd", "Dayo", { inPlace: "", inX: null }), row("c_1111111111aaaaaaaa", "Tunde")];
const out = shapePeople({ rows, blocks: [{ blockerId: me.id, blockedId: "c_3333333333cccccccc" }], runs: [], selfId: me.id, placeId: "library", now });
chk("you are never in the list", !out.some((p) => p.name === "Ada"));
chk("someone you blocked (or who blocked you) is not listed", !out.some((p) => p.name === "Chi"));
chk("the same player is listed once", out.filter((p) => p.name === "Tunde").length === 1);
chk("a fresh position comes with x, z and floor", (() => { const t = out.find((p) => p.name === "Tunde"); return t.x === 3 && t.z === 4 && t.floor === 0; })());
chk("a stale position (a player who went quiet) is dropped: listed, not drawn", (() => { const b = out.find((p) => p.name === "Bisi"); return b && b.x === undefined && b.z === undefined; })());
chk("a player who reported from somewhere else has no position here", (() => { const d = out.find((p) => p.name === "Dayo"); return d && d.x === undefined; })());
chk("only the short public id leaves the server", out.every((p) => p.id === publicId(rows.find((r) => r.name === p.name).id) && p.id.length === 8));
const run = { characterId: "c_1111111111aaaaaaaa", activityId: "group_study", status: "RUNNING", endsAt: new Date(now + 30_000) };
chk("a running activity gives the avatar its pose", shapePeople({ rows, runs: [run], selfId: me.id, placeId: "library", now }).find((p) => p.name === "Tunde").anim?.includes("sit"));
chk("a finished or cancelled activity gives none", !animOf({ ...run, endsAt: new Date(now - 1) }, now) && !animOf({ ...run, status: "CANCELLED" }, now) && animOf(null, now) === null);
chk("max is respected", shapePeople({ rows: Array.from({ length: 50 }, (_, i) => row("c_" + String(i).padStart(18, "0"), "P" + i)), selfId: me.id, placeId: "library", now, max: 30 }).length === 30);
chk("positionOf ignores a position in the future by more than clock skew", positionOf(row("x", "X", { inAt: at(-60_000) }), "library", now) === null);

// ---------------------------------------------------------------- the tag layer (with a tiny DOM stand-in)
const events = [];
globalThis.window = { dispatchEvent: (e) => { events.push(e); return true; } };
class El { constructor(tag) { this.tag = tag; this.style = {}; this.children = []; this.dataset = {}; this.l = {}; this.attrs = {}; this.clientWidth = 800; this.clientHeight = 600; }
  appendChild(c) { this.children.push(c); c.parent = this; return c; } remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; }
  addEventListener(n, f) { this.l[n] = f; } setAttribute(k, v) { this.attrs[k] = v; } getBoundingClientRect() { return { left: 100, top: 50, width: 80, height: 24, bottom: 74 }; } }
globalThis.document = { createElement: (t) => new El(t) };
const box = new El("div"), cam = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 100); cam.position.set(0, 1.5, 0); cam.lookAt(0, 1.5, -10); cam.updateMatrixWorld();
const picks = []; const tags = createPlayerTags({ container: box, camera: cam, selfName: "Ada", onPick: (p) => picks.push(p), maxDist: 28 });
const head = (x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); o.updateMatrixWorld(); return o; };
const tagEls = () => tags.layer.children;
chk("a real player in front of the camera gets one tag", tags.set("p1", { name: "Tunde", anchor: head(0, 2, -8) }) && tags.ids().join() === "p1");
chk("your own name is refused, even with a different id", tags.set("me", { name: "Ada", anchor: head(1, 2, -5) }) === false && !tags.has("me"));
chk("an entry flagged as an NPC is refused", tags.set("n1", { name: "Dr Lecturer", anchor: head(1, 2, -5), npc: true }) === false && !tags.has("n1"));
tags.update();
const el1 = tagEls()[0];
chk("the tag shows the player's name", el1.textContent === "Tunde" && el1.title === "Tunde");
chk("the tag is visible and centred over the head", el1.style.visibility === "visible" && /translate3d\(4\d\d\.\dpx,/.test(el1.style.transform));
chk("it is a real button for taps and screen readers", el1.type === "button" && el1.attrs["aria-label"]?.includes("Tunde"));
tags.set("p2", { name: "Bisi", anchor: head(0, 2, 8) }); tags.update();
chk("a player behind the camera is hidden", tagEls()[1].style.visibility === "hidden");
tags.set("p3", { name: "Chi", anchor: head(0, 2, -60) }); tags.update();
chk("a player far beyond the range is hidden", tagEls()[2].style.visibility === "hidden");
const wall = createPlayerTags({ container: new El("div"), camera: cam, visible: () => false }); wall.set("w", { name: "Behind a wall", anchor: head(0, 2, -5) }); wall.update();
chk("a tag can be hidden by the room (nobody named through a wall)", wall.layer.children[0].style.visibility === "hidden"); wall.dispose();
const hide = head(0, 2, -8); const grp = new THREE.Group(); grp.add(hide); grp.updateMatrixWorld(true); tags.set("p4", { name: "OnOtherFloor", anchor: hide }); grp.visible = false; tags.update();
chk("a player on another floor (hidden avatar) loses the tag with it", tagEls()[3].style.visibility === "hidden");
const click = el1.l.click; click({ stopPropagation() {} });
chk("tapping a tag reports exactly that player (id, name, where the tag is)", picks.length === 1 && picks[0].id === "p1" && picks[0].name === "Tunde" && picks[0].x === 140 && picks[0].y === 50);
let stopped = false; el1.l.pointerdown({ stopPropagation() { stopped = true; } });
chk("pressing a tag never starts a camera drag", stopped);
events.length = 0; tags.remove("p1");
chk("removing a player removes the tag at once and tells the menu", !tags.has("p1") && !tagEls().includes(el1) && events.some((e) => e.type === "oau:player-gone" && e.detail.ids.includes("p1")));
tags.set("p1", { name: "Tunde", anchor: head(0, 2, -8) }); tags.set("p1", { name: "Tunde", anchor: head(0, 2, -8) });
chk("setting the same player twice never makes a second tag", tags.ids().filter((x) => x === "p1").length === 1 && tagEls().filter((e) => e.dataset.playerId === "p1").length === 1);
tags.dispose(); chk("dispose removes every tag and the layer", tags.ids().length === 0 && box.children.length === 0);

// ---------------------------------------------------------------- the building's remote avatars
const calls = []; const fakeTags = { set: (id, o) => { calls.push(["set", id, o.name]); return true; }, remove: (id) => calls.push(["remove", id]) };
const scene = new THREE.Scene(); let made = 0;
const played = []; const makeAvatar = async () => { made++; const root = new THREE.Group(); return { root, height: 1.7, has: (n) => ["idle", "walk", "run", "sit"].includes(n), play: (n) => { played.push(n); return true; }, setSpeed() {}, update() {}, dispose() { this.gone = true; } }; };
const rp = createRemotePlayers({ scene, makeAvatar, tags: fakeTags, floorY: (f) => f * 4, self: { name: "Ada" } });
const P = (id, name, x, z, o = {}) => ({ id, name, gender: "M", x, z, floor: 0, level: 100, faculty: "Law", ...o });
rp.sync([P("a1", "Tunde", 2, 2), P("me", "Ada", 1, 1), P("n1", "Dr NPC", 3, 3, { npc: true }), { id: "a2", name: "NoSpot" }, P("a3", "tunde", 4, 4)], { x: 0, z: 0 });
await new Promise((r) => setTimeout(r, 5));
chk("a listed player with a position gets an avatar and a tag", rp.ids().join() === "a1" && calls.some((c) => c[0] === "set" && c[2] === "Tunde"));
chk("you, an NPC, a player with no position and a same-name duplicate get nothing", made === 1 && !rp.ids().includes("me") && !rp.ids().includes("n1") && !rp.ids().includes("a2") && !rp.ids().includes("a3"));
rp.update(1, 0.016, { x: 0, z: 0, fl: 0 });
const holder = scene.children[0];
chk("the avatar is drawn at the reported spot only while you are on its floor", holder.visible === true && Math.abs(holder.position.x - 0.0) < 3);
rp.update(1, 0.016, { x: 0, z: 0, fl: 1 }); chk("on another floor it is hidden", holder.visible === false);
rp.sync([P("a1", "Tunde", 8, 2)], { x: 0, z: 0 }); for (let i = 0; i < 200; i++) rp.update(1 + i * 0.05, 0.05, { x: 0, z: 0, fl: 0 });
chk("it glides to a new spot as the player walks", Math.abs(holder.position.x - 8) < 0.05);
rp.sync([P("a1", "Tunde", 8, 2, { anim: ["sit"] })], { x: 0, z: 0 }); rp.update(20, 0.05, { x: 0, z: 0, fl: 0 });
chk("they walk while moving and take the activity pose (sit) when they stand still", played.includes("walk") && played.at(-1) === "sit");
calls.length = 0; rp.sync([], { x: 0, z: 0 });
chk("a player who is no longer listed disappears at once, with the tag", rp.count() === 0 && scene.children.length === 0 && calls.some((c) => c[0] === "remove" && c[1] === "a1"));
rp.sync(Array.from({ length: 40 }, (_, i) => P("m" + i, "M" + i, i, 0)), { x: 0, z: 0 }); await new Promise((r) => setTimeout(r, 5));
chk("only the nearest few are built", rp.count() === REMOTE_MAX);
rp.sync([P("m1", "M1", 1, 0)], { x: 0, z: 0 }); rp.sync([P("m1", "M1", 1, 0)], { x: 0, z: 0 }); await new Promise((r) => setTimeout(r, 5));
chk("a player who reconnects appears once, never twice", rp.ids().join() === "m1" && scene.children.length === 1);
// the name rides the real head bone: sitting lowers the head, the name follows it exactly, and it stays upright above it
{
  const sc = new THREE.Scene(), headBone = new THREE.Bone(); headBone.position.y = 1.55;
  const mk = async () => { const root = new THREE.Group(); root.add(headBone); return { root, height: 1.75, bone: (n) => (n === "Head" ? headBone : null), has: () => true, play: () => true, setSpeed() {}, update() {}, dispose() {} }; };
  const r2 = createRemotePlayers({ scene: sc, makeAvatar: mk, tags: { set() { return true; }, remove() {} }, self: { name: "Ada" } });
  r2.sync([P("h1", "Head", 5, 6)], { x: 5, z: 6 }); await new Promise((r) => setTimeout(r, 5)); r2.update(1, 0.016, { x: 5, z: 6, fl: 0 });
  const holder2 = sc.children[0], anchor2 = holder2.children[0], wpos = new THREE.Vector3();
  anchor2.getWorldPosition(wpos); const stand = wpos.y;
  chk("standing: the name is just over the crown (not 0.3 m of empty air)", Math.abs(stand - (1.55 + 1.75 * 0.11 + 0.07 + 0.02)) < 0.02);
  headBone.position.y = 0.9; r2.update(1.1, 0.016, { x: 5, z: 6, fl: 0 }); anchor2.getWorldPosition(wpos);
  chk("sitting: the head drops and the name drops with it", Math.abs(wpos.y - (0.9 + 1.75 * 0.11 + 0.07 + 0.02)) < 0.02 && wpos.y < stand - 0.5);
  chk("it stays over the character, not beside it", Math.abs(wpos.x - 5) < 1e-6 && Math.abs(wpos.z - 6) < 1e-6);
  r2.dispose();
}
// a resized layer re-maps the tag: the same head lands at the same fraction of the new size
{
  const b2 = new El("div"), t2 = createPlayerTags({ container: b2, camera: cam, maxDist: 28 }); t2.set("r", { name: "Resize", anchor: head(0, 2, -8) }); t2.update();
  const x1 = parseFloat(/translate3d\(([\d.]+)px/.exec(t2.layer.children[0].style.transform)[1]);
  b2.children[0].clientWidth = 400; b2.children[0].clientHeight = 300; for (let i = 0; i < 9; i++) t2.update();
  const x2 = parseFloat(/translate3d\(([\d.]+)px/.exec(t2.layer.children[0].style.transform)[1]);
  chk("after the layer shrinks to half, the tag is at half the x (same spot on the head)", Math.abs(x2 * 2 - x1) < 1); t2.dispose();
}
rp.dispose(); chk("dispose frees everything", rp.count() === 0 && scene.children.length === 0);
process.exit(bad ? 1 : 0);
