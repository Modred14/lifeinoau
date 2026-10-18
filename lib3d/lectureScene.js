// lib3d/lectureScene.js
// The lecture-theatre brawl and what follows, in one 3D scene. Browser only.
//   fight    a real-time brawl run by lib/fightSim.js (the scene only draws it). Auto-plays the player's side; press / hold to take over.
//   dsa      the QRS van screeches in, officers jump out, run you down, CARRY you to the van, put you inside and drive off
//   floor0   the van rolls through the gate of Floor O and you are walked in
//   escape   you won and ran before the van arrived
//   lost     you lost the fight
// Every cutscene is a pure function of its clock t, so it can be paused, skipped or jumped to any moment (see seek()).
import * as THREE from "three";
import { createStage } from "./stage.js";
import { makeFigure, pose, CHANNELS } from "./toonFigure.js";
import { createAvatar } from "./avatar/loadAvatar.js";
import { createNpc, npcSpec, lecturerSpec } from "./avatar/npc.js";
import { makeAvatarFigure } from "./avatar/figureRig.js";
import { makeDsaVan, VAN } from "./dsaVan.js";
import { buildWorld, ROAD_Z } from "./lectureWorld.js";
import { createFight, MOVES, STAGGER } from "../lib/fightSim.js";
import { SKIN_TONES, COLORS, cleanLook } from "../lib/look.js";

// ---------- small maths ----------
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const mix = (a, b, u) => a + (b - a) * u;
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const E = { sm: (u) => u * u * (3 - 2 * u), out: (u) => 1 - (1 - u) * (1 - u), in: (u) => u * u, io: (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)) };
const yawTo = (dx, dz) => Math.atan2(-dz, dx); // rotation.y that makes a figure (facing +x) look along (dx, dz)
const mixPose = (p, q, u) => { const o = {}; for (const c of CHANNELS) o[c] = mix(p[c] ?? 0, q[c] ?? 0, u); return o; };
const keyPose = (t, keys) => { if (t <= keys[0][0]) return keys[0][1]; for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) return mixPose(keys[i - 1][1], keys[i][1], E.sm(seg(t, keys[i - 1][0], keys[i][0]))); return keys[keys.length - 1][1]; };
const keyNum = (t, keys) => { if (t <= keys[0][0]) return keys[0][1]; for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) return mix(keys[i - 1][1], keys[i][1], E.sm(seg(t, keys[i - 1][0], keys[i][0]))); return keys[keys.length - 1][1]; };
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

// ---------- poses ----------
const GUARD = pose({ hipsY: -0.05, lean: 0.12, twist: 0.18, headX: 0.08, aRs: 0.95, aRe: 1.5, aLs: 0.75, aLe: 1.75, lRh: 0.3, lRk: 0.35, lLh: -0.2, lLk: 0.1 });
const LGUARD = pose({ hipsY: -0.03, lean: 0.08, twist: 0.1, headX: 0.05, aRs: 0.7, aRe: 1.2, aLs: 0.5, aLe: 1.3, lRh: 0.2, lRk: 0.2, lLh: -0.15, lLk: 0.1 });
const P = (b, o) => ({ ...b, ...o });
const MOVE_ANIM = {
  punch: { pose: [[0, GUARD], [0.05, P(GUARD, { aRs: 0.35, aRe: 2.2, twist: -0.35, lean: 0, aLs: 1, aLe: 1.6 })], [0.12, P(GUARD, { aRs: 1.55, aRe: 0.05, twist: 0.55, lean: 0.28, aLs: 0.6, aLe: 2, lRh: 0.55, lRk: 0.5, lLh: -0.35, hipsY: -0.1 })], [0.2, P(GUARD, { aRs: 1.55, aRe: 0.05, twist: 0.55, lean: 0.28, aLs: 0.6, aLe: 2, lRh: 0.55, lRk: 0.5, lLh: -0.35, hipsY: -0.1 })], [0.38, GUARD]], dx: [[0, 0], [0.12, 0.3], [0.2, 0.3], [0.38, 0]] },
  kick: { pose: [[0, GUARD], [0.12, P(GUARD, { lRh: 1, lRk: 1.7, lean: -0.1, aRs: 0.5, aRe: 1, aLs: 0.6, aLe: 1, lLh: -0.05, hipsY: -0.03 })], [0.22, P(GUARD, { lRh: 1.5, lRk: 0.05, lean: -0.38, aRs: 0.4, aRe: 0.6, aLs: 0.8, aLe: 0.4, aLa: 0.4, aRa: 0.4, lLh: -0.05, hipsY: -0.02, twist: 0.1 })], [0.34, P(GUARD, { lRh: 1.5, lRk: 0.05, lean: -0.38, aRs: 0.4, aRe: 0.6, aLs: 0.8, aLe: 0.4, aLa: 0.4, aRa: 0.4, lLh: -0.05, hipsY: -0.02, twist: 0.1 })], [0.62, GUARD]], dx: [[0, 0], [0.22, 0.25], [0.34, 0.25], [0.62, 0]] },
  swing: { pose: [[0, LGUARD], [0.42, P(LGUARD, { aRs: 2.9, aRe: 0.5, aLs: 0.3, aLe: 0.4, lean: -0.25, headX: -0.1 })], [0.52, P(LGUARD, { aRs: 1, aRe: 0.35, lean: 0.55, headX: 0.3, lRh: 0.5, lRk: 0.5, hipsY: -0.12, twist: 0.5 })], [0.65, P(LGUARD, { aRs: 1, aRe: 0.35, lean: 0.55, headX: 0.3, lRh: 0.5, lRk: 0.5, hipsY: -0.12, twist: 0.5 })], [0.95, LGUARD]], dx: [[0, 0], [0.42, -0.05], [0.52, 0.35], [0.65, 0.35], [0.95, 0]] },
};
const HURT = pose({ hipsY: -0.04, lean: -0.4, headX: -0.45, aRs: 0.1, aRe: 0.3, aLs: 0.15, aLe: 0.3, lRh: 0.2, lRk: 0.2, lLh: -0.25, lLk: 0.2, chest: -0.1 });
const BLOCK = pose({ hipsY: -0.1, lean: 0.12, headX: 0.2, aRs: 1.4, aRe: 2.5, aLs: 1.4, aLe: 2.5, lRh: 0.3, lRk: 0.45, lLh: -0.2, lLk: 0.1 });
const DODGE = pose({ hipsY: -0.1, lean: -0.35, headX: -0.2, aRs: 0.6, aRe: 1.2, aLs: 0.6, aLe: 1.2, lRh: -0.2, lRk: 0.3, lLh: -0.4, lLk: 0.2 });
const LYING = pose({ aRa: 0.7, aLa: 0.7, aRs: 0.1, aLs: -0.1, lRh: 0.1, lLh: -0.15, lRk: 0.15, lLk: 0.1, headX: 0.15 });
const WIN = (time) => pose({ hipsY: Math.abs(Math.sin(time * 6)) * 0.05, lean: -0.05, aRs: 2.9, aRe: 0.2, aLs: 0.3, aLe: 1.7, headX: -0.1, lRh: 0.1, lLh: -0.1 });
const SMUG = (time) => pose({ lean: -0.08, headX: -0.15, aRs: 0.5, aRe: 2.2, aLs: 0.3, aLe: 1.9, hipsY: Math.sin(time * 3) * 0.01 }); // hands on the lapels
const SEATED = pose({ lRh: 1.5, lLh: 1.5, lRk: 1.5, lLk: 1.5, aRs: 0.9, aLs: 0.9, aRe: 0.5, aLe: 0.5, headX: 0.05 });
const HELD = pose({ aRs: -0.35, aLs: -0.35, aRe: 0.15, aLe: 0.15, headX: 0.5, lean: 0.12 }); // walked in with hands behind, head down

/** A running or walking step cycle for `dist` metres travelled. */
function gait(dist, run, extra) {
  const stride = run ? 2.3 : 1.5, ph = (dist / stride) * Math.PI * 2, a = run ? 1 : 0.5, s = Math.sin(ph), c = Math.cos(ph);
  return pose({ hipsY: run ? -0.06 + Math.abs(c) * 0.05 : Math.abs(c) * 0.02 - 0.01, lean: run ? 0.22 : 0.04, lRh: s * 0.95 * a, lLh: -s * 0.95 * a, lRk: (run ? 0.35 : 0.1) + Math.max(0, -s) * (run ? 1.5 : 0.6), lLk: (run ? 0.35 : 0.1) + Math.max(0, s) * (run ? 1.5 : 0.6),
    aRs: -s * 0.9 * a + 0.1, aLs: s * 0.9 * a + 0.1, aRe: run ? 1.4 : 0.25, aLe: run ? 1.4 : 0.25, ...extra });
}

// ---------- looks ----------
const hairFor = (h) => ({ afro: "afro", braids: "long", long: "long", locs: "long", ponytail: "long", bun: "bun", gele: "bun" }[h] ?? "short");
const SHIRTS = ["#4a6b8a", "#6b4a2e", "#3d6b55", "#7a5a8a", "#8a7a3c", "#5a6f93"], TIES = ["#8a1f2d", "#14161a", "#1f4d7a", "#b58a1f"];
function lecturerLook(name, difficulty) {
  const h = hash(name), big = difficulty > 1.3, skins = Object.values(SKIN_TONES);
  return { skin: skins[h % skins.length], top: big ? "#7a1f33" : SHIRTS[h % SHIRTS.length], bottom: "#23262d", tie: big ? "#14161a" : TIES[(h >> 3) % TIES.length], hair: "short", hairColor: "#a5a5a5", long: true, glasses: true, belly: big ? 0.9 : 0.5, width: big ? 1.15 : 1.02, scale: big ? 1.0 : 0.97 };
}
const OFFICER = { top: "#1b2a49", bottom: "#1b2a49", vest: true, cap: "#1b2a49", long: true };
const CROWD_SKINS = ["#b98560", "#9c6a45", "#7f5236", "#63402b", "#4a2e20"], CROWD_TOPS = ["#c0312f", "#2f62c4", "#e3b83a", "#2f7a45", "#e58aa8", "#6b3fa0", "#dd6b27"];

// ---------- effects ----------
function textSprite(text, { color = "#fff", stroke = "#1b1b1b", size = 96, w = 384, h = 160 } = {}) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
  g.font = `900 ${size}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.lineJoin = "round"; g.lineWidth = size * 0.16; g.strokeStyle = stroke; g.strokeText(text, w / 2, h / 2); g.fillStyle = color; g.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false })); s.renderOrder = 10; s.scale.set(w / h * 0.7, 0.7, 1); return s;
}

export async function createLectureScene(container, opts = {}) {
  const { look: lookIn, gender = "M", lecturer = { name: "The lecturer", difficulty: 1 }, health = 80, sound = () => {}, caption = () => {}, onFight = () => {}, onFightEnd = () => {} } = opts;
  const stage = createStage(container, { fov: 38, far: 500, maxDpr: 1.6, controls: { enabled: false } });
  stage.setManual(true);
  const { scene, camera, renderer } = stage;
  const world = buildWorld(scene), toDispose = [];

  // ---------- people ----------
  const look = cleanLook(lookIn, gender);
  // Everyone is a real rigged character built by the same pipeline as the player (avatar/loadAvatar.js, avatar/npc.js) and posed by makeAvatarFigure from the joint-angle poses below.
  // The little box figure of toonFigure.js stands in until a character has loaded (and for good if its models cannot be loaded), so the scene always works.
  const people = []; let gone = false;
  const person = (o, build) => {
    const toon = makeFigure(o), holder = new THREE.Group(); holder.add(toon.root); scene.add(holder);
    const f = { root: holder, impl: toon, get head() { return f.impl.head; }, apply: (p, k) => f.impl.apply(p, k), expr: (n) => f.impl.expr(n), dispose() { f.impl.dispose(); },
      async upgrade() { try { const av = await build?.(); if (!av) return; if (gone || av.kind !== "glb") { av.dispose(); return; }
          const fig = makeAvatarFigure(av); fig.root.traverse((m) => { if (m.isMesh) m.castShadow = true; }); fig.apply({}, 1);
          holder.remove(toon.root); toon.dispose(); holder.add(fig.root); f.impl = fig; } catch (e) { console.warn("lecture scene: using the simple figure:", e); } } };
    toDispose.push(f); people.push(f); return f;
  };
  const lecSpec = lecturerSpec(lecturer.name, lecturer.difficulty); // the same person the lecture room shows
  const player = person({ skin: SKIN_TONES[look.skin], top: COLORS[look.top], bottom: COLORS[look.bottom], hair: hairFor(look.hair), width: gender === "F" ? 0.93 : 1, scale: look.height === "tall" ? 1 : look.height === "short" ? 0.9 : 0.95, long: false },
    () => createAvatar(look, gender)); // the player's own character, exactly as they made it
  const lec = person(lecturerLook(lecturer.name, lecturer.difficulty), () => createNpc(lecSpec));
  const officer = (seed, g) => npcSpec("dsa:" + seed, { gender: g, role: "officer" });
  const offA = person({ ...OFFICER, skin: "#6b4430" }, () => createNpc(officer("a", "M"))), offB = person({ ...OFFICER, skin: "#9c6a45", scale: 1 }, () => createNpc(officer("b", "F"))), driver = person({ ...OFFICER, skin: "#4a2e20" }, () => createNpc(officer("c", "M")));
  const van = makeDsaVan(); scene.add(van.root); toDispose.push(van);
  van.driverSlot.add(driver.root); driver.root.rotation.y = Math.PI; scene.remove(driver.root); van.driverSlot.add(driver.root);
  const crowd = [[-4.6, 0.6], [-3.4, -1.3], [-5.8, -1.0], [3.9, -1.2], [5.1, 0.7], [-0.2, -1.8], [6.4, -0.6]].map(([x, z], i) => {
    const f = person({ skin: CROWD_SKINS[i % 5], top: CROWD_TOPS[(i * 3) % 7], bottom: i % 2 ? "#2b3140" : "#a8946a", hair: i % 3 === 0 ? "long" : i % 3 === 1 ? "afro" : "short", scale: 0.9 + (i % 3) * 0.04 },
      () => createNpc(npcSpec("campus-crowd:" + i, { gender: i % 2 ? "F" : "M", role: "student" })));
    return { f, x, z, phase: i * 1.3, run: 6 + i * 0.5, side: x < 0 ? -1 : 1 };
  });
  const place = (f, x, z, yaw = 0, y = 0, rz = 0) => { f.root.position.set(x, y, z); f.root.rotation.set(0, yaw, rz); };
  let applyK = 0.35; // how fast poses ease (1 = snap)
  const setPose = (f, ch) => f.apply(ch, applyK);
  const PX = -0.95, LX = 0.95;
  const stars = new THREE.Group(); scene.add(stars);
  const starGeo = new THREE.OctahedronGeometry(0.06), starMat = new THREE.MeshBasicMaterial({ color: "#ffd84a" }); toDispose.push({ dispose: () => starGeo.dispose() });
  for (let i = 0; i < 4; i++) stars.add(new THREE.Mesh(starGeo, starMat));
  stars.visible = false;
  const tele = textSprite("!", { color: "#ff4d4d", size: 120, w: 160, h: 160 }); tele.scale.set(0.5, 0.5, 1); tele.visible = false; scene.add(tele);

  // ---------- effects ----------
  const pops = [], sparks = [];
  const sparkGeo = new THREE.SphereGeometry(0.035, 6, 5), sparkMat = new THREE.MeshBasicMaterial({ color: "#ffe27a" });
  for (let i = 0; i < 24; i++) { const m = new THREE.Mesh(sparkGeo, sparkMat); m.visible = false; scene.add(m); sparks.push({ m, v: new THREE.Vector3(), life: 0 }); }
  function pop(text, at, o = {}) { const s = textSprite(text, o); s.position.copy(at); scene.add(s); pops.push({ s, life: 0, max: o.max ?? 0.8, rise: o.rise ?? 0.8, base: s.scale.clone() }); }
  function burst(at, n = 8) { let k = 0; for (const p of sparks) if (p.life <= 0 && k < n) { k++; p.m.position.copy(at); p.v.set((Math.random() - 0.5) * 3, Math.random() * 2.5 + 0.5, (Math.random() - 0.5) * 3); p.life = 0.45; p.m.visible = true; } }
  let shake = 0, slow = 0;

  // ---------- state ----------
  let mode = "intro", time = 0, paused = false, sim = null, koAt = { p: -1, l: -1 }, endAt = 0, lastHp = "", sirenAt = 0, camT = 0;
  const lastWorldFlash = { v: 0 };
  let cut = null; // { name, t, resolve }
  const wp = (x, y, z) => new THREE.Vector3(x, y, z);
  const headPos = (f, dy = 0) => f.head.getWorldPosition(new THREE.Vector3()).add(wp(0, dy, 0));

  // ---------- fight drawing ----------
  const base = (role) => (role === "p" ? PX : LX), dirOpp = (role) => (role === "p" ? 1 : -1);
  const figOf = (role) => (role === "p" ? player : lec);
  function fighterVisual(role, f) {
    const g = role === "p" ? GUARD : LGUARD, k = f.t;
    let ch = g, dx = 0, face = role === "p" ? "normal" : "angry", lie = 0;
    const bob = Math.sin(time * 7 + (role === "p" ? 0 : 1.6)) * 0.015;
    if (f.act === "move") { const a = MOVE_ANIM[f.move]; ch = keyPose(k, a.pose); dx = keyNum(k, a.dx); if (f.move === "swing") face = "angry"; }
    else if (f.act === "hit") { ch = HURT; dx = -0.3 * Math.sin(Math.PI * clamp01(k / STAGGER)); face = "shock"; }
    else if (f.act === "block") ch = BLOCK;
    else if (f.act === "dodge") { ch = DODGE; dx = -0.6 * Math.sin(Math.PI * clamp01(k / 0.4)); }
    else if (f.act === "ko") { const u = seg(time - koAt[role], 0, 0.75); lie = u; ch = u < 0.5 ? mixPose(HURT, LYING, u * 2) : LYING; dx = -0.7 * E.out(u); face = "ko"; }
    else ch = { ...g, hipsY: g.hipsY + bob };
    return { ch, dx, face, lie };
  }
  function drawFighter(role, f) {
    const fig = figOf(role), v = fighterVisual(role, f);
    const x = base(role) + dirOpp(role) * v.dx, yaw = role === "p" ? 0 : Math.PI;
    place(fig, x, 0, yaw, 0.12 * E.in(v.lie), (Math.PI / 2) * E.in(v.lie));
    setPose(fig, v.ch); fig.expr(v.face);
  }
  function crowdUpdate(t, scatterAt = null) {
    crowd.forEach((c, i) => {
      const f = c.f;
      if (scatterAt == null || t < scatterAt + i * 0.14) {
        const jump = Math.abs(Math.sin(t * 7 + c.phase)) * 0.1 * (mode === "fight" || mode === "intro" ? 1 : 0.5), up = Math.sin(t * 9 + c.phase) > 0;
        place(f, c.x, c.z, yawTo(-c.x * 0.5, -c.z - 0.2 + 0.0));
        setPose(f, pose({ hipsY: jump - 0.02, aRs: 2.6 + (up ? 0.3 : 0), aRe: 0.4, aLs: i % 2 ? 2.4 : 1.9, aLe: i % 2 ? 0.5 : 1.0, headX: -0.15 }));
        f.expr(scatterAt != null && t > scatterAt - 1 ? "shock" : "grin");
      } else {
        const u = (t - scatterAt - i * 0.14), spd = c.run * 0.55, dist = u * spd, dir = c.side;
        place(f, c.x + dir * dist, c.z + Math.sin(i * 2) * dist * 0.1 + 0.0, yawTo(dir, Math.sin(i * 2) * 0.1)); setPose(f, gait(dist, true)); f.expr("shock");
      }
    });
  }

  function startFight({ auto = true } = {}) {
    sim = createFight({ difficulty: lecturer.difficulty, health, auto });
    mode = "fight"; koAt = { p: -1, l: -1 }; lastHp = ""; caption("FIGHT!", 900); stage.root?.focus?.();
  }
  const latch = { punch: false, kick: false, dodge: false, block: false };
  function handle(ev) {
    if (ev.type === "start") { sound(ev.move === "kick" ? "whoosh" : ev.by === "l" ? "whoosh" : "whoosh"); return; }
    if (ev.type === "strike") {
      const def = ev.by === "p" ? lec : player, at = headPos(def, -0.35).add(wp(0, 0, 0.1));
      if (ev.result === "dodge") { pop("MISS", headPos(def, 0.25), { color: "#9fd4f5", size: 70, w: 300 }); sound("whoosh"); return; }
      if (ev.result === "block") { burst(at, 4); pop("BLOCK", headPos(def, 0.25), { color: "#9fd4f5", size: 70, w: 320 }); sound("block"); shake = Math.max(shake, 0.04); return; }
      burst(at, ev.crit ? 14 : 8); sound(ev.move === "kick" ? "kick" : "punch"); shake = Math.max(shake, ev.crit ? 0.25 : 0.12);
      pop(ev.crit ? ["SMACK!", "WHACK!", "BAM!"][Math.floor(Math.random() * 3)] : ev.move === "kick" ? "THUD" : ["POW", "BAP", "WHAP"][Math.floor(Math.random() * 3)], headPos(def, 0.45), { color: ev.crit ? "#ffb03a" : "#fff", size: ev.crit ? 110 : 88, w: 420 });
      pop(`-${ev.dmg}`, headPos(def, 0.1).add(wp(ev.by === "p" ? 0.3 : -0.3, 0, 0.15)), { color: ev.by === "p" ? "#7dffa8" : "#ff7a7a", size: 70, w: 240, max: 0.9, rise: 1.1 });
    } else if (ev.type === "ko") { koAt[ev.who] = time; slow = 0.9; shake = 0.35; sound("ko"); }
    else if (ev.type === "end") { endAt = time; mode = "ended"; onFightEnd(sim.report()); }
  }
  function fightStep(dt) {
    const inp = { punch: latch.punch, kick: latch.kick, dodge: latch.dodge, block: latch.block };
    latch.punch = latch.kick = latch.dodge = false;
    let left = dt; // never let a long frame skip a whole exchange
    while (left > 0 && mode === "fight") { const h = Math.min(left, 1 / 60); left -= h; for (const ev of sim.update(h, inp)) handle(ev); }
    const snap = `${sim.p.hp}|${sim.l.hp}|${sim.auto}`;
    if (snap !== lastHp) { lastHp = snap; onFight({ p: { hp: sim.p.hp, maxHp: sim.p.maxHp }, l: { hp: sim.l.hp, maxHp: sim.l.maxHp }, auto: sim.auto, over: sim.over }); }
  }
  function drawFightScene() {
    if (!sim) { // before the bell: both stand ready
      const ready = (role) => { const f = { act: "idle", t: 0 }; drawFighter(role, f); };
      ready("p"); ready("l"); return;
    }
    drawFighter("p", sim.p); drawFighter("l", sim.l);
    tele.visible = sim.l.act === "move" && sim.l.t < MOVES.swing.wind && !sim.over;
    if (tele.visible) tele.position.copy(headPos(lec, 0.5));
    if (mode === "ended") { // the winner celebrates, the loser sees stars
      const winner = sim.winner, wf = figOf(winner), lf = figOf(winner === "p" ? "l" : "p");
      if (time - endAt > 0.9) { setPose(wf, winner === "p" ? WIN(time) : SMUG(time)); wf.expr("grin"); wf.root.position.x = base(winner); }
      showStars(lf, time - endAt > 0.8);
    } else stars.visible = false;
  }
  function showStars(fig, on) {
    stars.visible = on; if (!on) return;
    const h = headPos(fig, 0.3); stars.position.copy(h); stars.children.forEach((s, i) => { const a = time * 3 + (i * Math.PI) / 2; s.position.set(Math.cos(a) * 0.28, 0, Math.sin(a) * 0.28); s.rotation.y = a; });
  }

  // ---------- cameras ----------
  const fit = () => Math.max(1, 0.85 / camera.aspect); // a narrow (phone) screen needs the camera further back
  const look3 = new THREE.Vector3(), pos3 = new THREE.Vector3();
  function setCam(px, py, pz, lx, ly, lz) {
    look3.set(lx, ly, lz); pos3.set(px, py, pz).sub(look3).multiplyScalar(fit()).add(look3);
    if (shake > 0.001) pos3.add(wp((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
    camera.position.copy(pos3); camera.lookAt(look3);
  }
  function track(keys) {
    const pp = new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(...k[1])), false, "centripetal"), ll = new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(...k[2])), false, "centripetal");
    return (t) => {
      let i = 0; while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
      const u = clamp01((i + clamp01((t - keys[i][0]) / (keys[i + 1][0] - keys[i][0]))) / (keys.length - 1)), a = pp.getPoint(u), b = ll.getPoint(u);
      setCam(a.x, a.y, a.z, b.x, b.y, b.z);
    };
  }
  function fightCam(dt) {
    const push = mode === "ended" ? E.sm(seg(time - endAt, 0, 1.4)) : 0, sway = Math.sin(time * 0.35) * 0.8;
    const wx = mode === "ended" && sim ? base(sim.winner) : 0;
    setCam(mix(sway, wx * 0.8 + 0.3, push), 2.0 - push * 0.3, mix(8.0, 5.2, push), mix(0, wx * 0.5, push), 1.15, 0);
  }

  // ---------- the cutscenes ----------
  const VX = -1.8, VZ = -4.1, XR = VX + VAN.rearX; // where the van stops, and its rear plane
  const CATCH = { x: 3.1, z: 1.35 };
  const vanTo = (x, z = VZ, pitch = 0) => { van.root.position.set(x, 0, z); van.root.rotation.set(0, 0, 0); van.pitch(pitch); van.rollTo(32 - x); };
  const inVan = (f, lx, lz, y = 0.63, crouch = true, yaw = 0) => { place(f, van.root.position.x + lx, VZ + lz, yaw, y); setPose(f, crouch ? pose({ hipsY: -0.22, lean: 0.1, lRh: 0.4, lRk: 0.9, lLh: 0.4, lLk: 0.9, aRs: 0.4, aLs: 0.4, aRe: 0.4, aLe: 0.4 }) : pose()); };
  const polyPos = (pts, u) => { const lens = []; let tot = 0; for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); lens.push(l); tot += l; } let d = clamp01(u) * tot; for (let i = 0; i < lens.length; i++) { if (d <= lens[i] || i === lens.length - 1) { const f = lens[i] ? clamp01(d / lens[i]) : 0; return { x: mix(pts[i][0], pts[i + 1][0], f), z: mix(pts[i][1], pts[i + 1][1], f), dx: pts[i + 1][0] - pts[i][0], dz: pts[i + 1][1] - pts[i][1], dist: u * tot, tot }; } d -= lens[i]; } };
  const sirenTick = (t, on) => { world.siren(on ? van.lights(true, t) : (van.lights(false, t), 0)); if (on && time > sirenAt) { sirenAt = time + 0.55; sound("siren"); } };
  const fallen = () => { place(lec, LX + 0.7 * 1, 0, Math.PI, 0.12, Math.PI / 2); setPose(lec, LYING); lec.expr("ko"); };
  const victor = (t) => { setPose(player, WIN(t)); player.expr(t > 2.4 ? "shock" : "grin"); };

  const camDsa = track([[0, [0, 1.55, 6.6], [0, 1.1, 0]], [2.6, [-0.5, 1.6, 7.2], [-0.6, 1.2, -1]], [4.2, [0.2, 1.7, 7.6], [0.5, 1.2, -1]], [6, [1.8, 1.6, 6.4], [3, 1, 1.3]], [7.8, [5.8, 1.7, 4.5], [3.1, 1, 0]], [9.6, [7.8, 1.6, -0.5], [2.8, 1.1, -3.2]], [11, [6.2, 1.3, -2.6], [0.6, 1.1, -4.1]], [12.4, [5.5, 1.6, -0.5], [0.5, 1.2, -4]], [14, [2.5, 1.7, 3.8], [-1.8, 1.3, -3.2]], [16, [-2, 1.7, 5], [-6, 1.4, -4]], [18, [-6, 1.8, 4.5], [-20, 1.5, -4.2]]]);
  const DSA_PATH_B = [[2.0, VZ], [1.8, -3.0], [VX + 0.4, -2.95]];

  function dsa(t) {
    world.setMode("campus");
    // --- the van: in from the right with sirens, brakes, doors, then away to the left ---
    const arrive = E.out(seg(t, 0.2, 3.2)), leave = E.in(seg(t, 14.8, 18)), x = t < 14.8 ? mix(32, VX, arrive) : mix(VX, -48, leave);
    vanTo(x, VZ, 0.05 * Math.sin(Math.PI * seg(t, 2.3, 3.5)));
    van.slideDoor(seg(t, 3.2, 3.8) - seg(t, 4.7, 5.1) + seg(t, 13.1, 13.6) - seg(t, 14.4, 14.8));
    van.rearDoors(seg(t, 9.2, 9.9) - seg(t, 11.6, 12.2));
    sirenTick(t, t < 17);
    setPose(driver, SEATED); driver.expr("angry");
    // --- the lecturer stays where he fell; the crowd cheers and then runs from the sirens ---
    fallen(); stars.visible = false; crowdUpdate(t, 2.6);
    // --- officers: out of the sliding door, run the player down ---
    const exitA = seg(t, 3.7, 4.2), exitB = seg(t, 3.85, 4.35), runA = seg(t, 4.2, 5.9), runB = seg(t, 4.35, 6.4);
    // --- the player: celebrates, sees the van, flees to the right ---
    const flee = seg(t, 3.5, 5.9), fx = mix(PX, CATCH.x, flee), fz = mix(0, CATCH.z, flee) + 0.7 * Math.sin(Math.PI * flee);
    const frameU = { carry: seg(t, 7.5, 9.6), turn: seg(t, 9.6, 10.2), load: E.io(seg(t, 10.2, 11.4)), lift: E.io(seg(t, 6.8, 7.5)) };
    // the carrying frame: a point P with a heading; the player lies along it, head first, A at the head end and B at the feet
    let Px = CATCH.x, Pz = CATCH.z, phi = Math.PI / 2;
    if (t >= 7.5) { Pz = mix(CATCH.z, VZ, E.sm(frameU.carry)); }
    if (t >= 9.6) { Px = mix(CATCH.x, 2.35, E.io(frameU.turn)); phi = mix(Math.PI / 2, Math.PI, E.io(frameU.turn)); }
    if (t >= 10.2) Px = mix(2.35, -0.6, frameU.load);
    const dX = { x: Math.cos(phi), z: -Math.sin(phi) }, carried = t >= 6.8;
    if (t < 6.8) {
      if (t < 3.5) { place(player, PX, 0, 0); victor(t); }
      else {
        const dist = flee * Math.hypot(CATCH.x - PX, CATCH.z) * 1.05;
        if (flee < 1) { place(player, fx, fz, yawTo(CATCH.x - PX, CATCH.z + 0.3 * Math.cos(Math.PI * flee) * Math.PI), 0); setPose(player, gait(dist, true, { headY: 0.0 })); player.expr("shock"); }
        else { // caught: thrashing
          const w = Math.sin(t * 22);
          place(player, CATCH.x, CATCH.z, yawTo(1, 0.0) + w * 0.12, 0); setPose(player, pose({ lean: -0.15 + w * 0.05, aRs: 1.6 + w * 0.6, aLs: 1.6 - w * 0.6, aRe: 0.5, aLe: 0.5, lRh: w * 0.4, lLh: -w * 0.4, lRk: 0.3, lLk: 0.3, headY: w * 0.4 })); player.expr("shock");
        }
      }
    } else {
      const lieYaw = phi + Math.PI, standYaw = yawTo(1, 0), u = frameU.lift;
      const yawEnd = lieYaw - 2 * Math.PI * Math.round((lieYaw - standYaw) / (2 * Math.PI));
      const lyX = Px - 0.9 * dX.x, lyZ = Pz - 0.9 * dX.z, onVan = t >= 10.2 ? seg(t, 10.8, 11.4) : 0;
      const lyY = mix(1.05, VAN_FLOOR + 0.12, onVan);
      place(player, mix(CATCH.x, lyX, u), mix(CATCH.z, lyZ, u), mix(standYaw, yawEnd, u), mix(0, lyY, u), (Math.PI / 2) * u);
      setPose(player, pose({ aRs: 0.15 + Math.sin(t * 14) * 0.35 * (1 - onVan), aLs: 0.15 - Math.sin(t * 14) * 0.35 * (1 - onVan), aRe: 0.3, aLe: 0.3, lRh: Math.sin(t * 12) * 0.25 * (1 - onVan), lLh: -Math.sin(t * 12) * 0.25 * (1 - onVan), headX: 0.2, headY: Math.sin(t * 9) * 0.3 })); player.expr("shock");
    }
    // officer A: sprints, grabs, lifts, walks backwards with the head end, climbs into the van with the player
    {
      const startA = [VX - 0.1, VZ + 0.55];
      if (t < 3.7) inVan(offA, -0.1, 0.55);
      else if (t < 4.2) { const k = exitA, z = mix(startA[1], -2.95, k); place(offA, VX - 0.1, z, 0, 0.63 * (1 - E.sm(seg(k, 0.4, 1)))); setPose(offA, gait(k * 0.5, true)); }
      else if (t < 5.9) { const p = polyPos([[VX - 0.1, -2.95], [CATCH.x, CATCH.z - 1.25]], runA); place(offA, p.x, p.z, yawTo(p.dx, p.dz), 0); setPose(offA, gait(p.dist, true)); }
      else {
        const ax = Px + 1.25 * dX.x, az = Pz + 1.25 * dX.z;
        const aStep = t >= 10.2 ? E.sm(seg(ax, 0.9, 0.3)) : 0;
        place(offA, ax, az, phi + Math.PI, 0.63 * (t >= 10.2 ? aStep : 0));
        const walking = (t >= 7.5 && t < 10.2) || (t >= 10.2 && t < 11.4);
        const dist = (t >= 7.5 ? (Math.hypot(Px - CATCH.x, Pz - CATCH.z) + (t >= 10.2 ? 3 - Px : 0)) : 0) * 1.0;
        const hold = pose({ aRs: 0.95, aLs: 0.95, aRe: 0.35, aLe: 0.35, lean: 0.05, hipsY: t >= 10.2 ? -0.2 : -0.02, headX: 0.1 });
        setPose(offA, walking ? { ...gait(dist, false), aRs: hold.aRs, aLs: hold.aLs, aRe: hold.aRe, aLe: hold.aLe, lean: 0.05, hipsY: hold.hipsY } : hold);
        if (t >= 11.4) { place(offA, ax, az, phi + Math.PI, 0.63); setPose(offA, pose({ hipsY: -0.25, lRh: 0.5, lRk: 0.9, lLh: 0.5, lLk: 0.9, aRs: 0.3, aLs: 0.3 })); }
      }
    }
    // officer B: runs round the player, takes the feet, pushes him in, shuts the doors and goes back to the side door
    {
      if (t < 3.85) inVan(offB, 0.45, 0.55);
      else if (t < 4.35) { const k = exitB, z = mix(VZ + 0.55, -2.95, k); place(offB, VX + 0.45, z, 0, 0.63 * (1 - E.sm(seg(k, 0.4, 1)))); setPose(offB, gait(k * 0.5, true)); }
      else if (t < 6.4) { const p = polyPos([[VX + 0.45, -2.95], [-0.2, 2.2], [CATCH.x, CATCH.z + 1.25]], runB); place(offB, p.x, p.z, yawTo(p.dx, p.dz), 0); setPose(offB, gait(p.dist, true)); }
      else if (t < 6.8) { place(offB, CATCH.x, CATCH.z + 1.25, Math.PI / 2, 0); setPose(offB, pose({ hipsY: -0.3, lean: 0.5, aRs: 1.3, aLs: 1.3, aRe: 0.2, aLe: 0.2, lRh: 0.9, lRk: 1, lLh: -0.1, lLk: 0.9 })); }
      else if (t < 11.8) {
        const bx = Math.max(Px - 1.25 * dX.x, 1.5), bz = Pz - 1.25 * dX.z, bxF = t >= 10.2 ? Math.max(Px + 1.25, 1.5) : bx;
        const px = t >= 10.2 ? bxF : bx, pz = t >= 10.2 ? VZ : bz;
        place(offB, px, pz, t >= 10.2 ? Math.PI : phi, 0);
        const dist = Math.hypot(Px - CATCH.x, Pz - CATCH.z) * 1.0 + (t >= 10.2 ? 3 - Px : 0);
        const walking = (t >= 7.5 && t < 11.0);
        const hold = pose({ aRs: 0.9, aLs: 0.9, aRe: 0.4, aLe: 0.4, lean: 0.12, hipsY: -0.06, headX: 0.1 });
        setPose(offB, t < 7.5 ? pose({ hipsY: -0.3 + 0.3 * E.sm(seg(t, 6.8, 7.5)), lean: 0.4 * (1 - seg(t, 6.8, 7.5)), aRs: 1.3, aLs: 1.3, aRe: 0.2, aLe: 0.2, lRh: 0.9 * (1 - seg(t, 6.8, 7.5)), lRk: 1 * (1 - seg(t, 6.8, 7.5)), lLh: 0, lLk: 0.9 * (1 - seg(t, 6.8, 7.5)) }) : walking ? { ...gait(dist, false), aRs: 0.9, aLs: 0.9, aRe: 0.4, aLe: 0.4, hipsY: -0.06, lean: 0.12 } : hold);
      }
      else if (t < 12.2) { place(offB, 2.0, VZ, Math.PI, 0); setPose(offB, pose({ aRs: 1.3, aLs: 1.3, aRe: 0.2, aLe: 0.2, lean: 0.2 })); }
      else if (t < 14.0) { const p = polyPos(DSA_PATH_B.map((q) => [q[0], q[1]]), E.sm(seg(t, 12.2, 14.0))); place(offB, p.x, p.z, yawTo(p.dx, p.dz), 0); setPose(offB, gait(p.dist, true)); }
      else if (t < 14.4) { const k = seg(t, 14.0, 14.4); place(offB, VX + 0.45, mix(-2.95, VZ + 0.55, k), yawTo(0, -1), 0.63 * E.sm(k)); setPose(offB, gait(k * 0.5, false)); }
      else { inVan(offB, 0.45, 0.55, 0.63, true, 0); }
    }
    // inside the van the player is hidden by the walls; once the doors shut A is in there too
    if (t >= 12.2) { /* A and the player stay where loading left them (inside) */ }
    camDsa(t);
  }
  const VAN_FLOOR = VAN.floorY;

  // ----- Floor O: the van rolls in through the gate, the doors open and you are walked inside -----
  const camF0 = track([[0, [5.5, 1.6, 17], [0, 2.5, -8]], [3, [4, 1.5, 12], [0, 1.6, -4]], [5, [1.4, 1.6, 4], [0, 1.5, -8]], [6.6, [1, 1.7, -5.8], [0, 1.3, -10.5]], [8.6, [4, 1.7, -6.2], [0.8, 1.2, -11]], [11.5, [3.2, 1.8, -8.5], [0.4, 1.8, -14.5]]]);
  const F0_PATH = [[0, -8.2], [1.9, -8.6], [1.9, -13.4], [0.2, -14.6]];
  function floor0(t) {
    world.setMode("floor0");
    const z = mix(48, -10.8, E.io(seg(t, 0.2, 6.3)) * 0.7 + seg(t, 0.2, 6.3) * 0.3);
    van.root.position.set(0, 0, z); van.root.rotation.set(0, -Math.PI / 2, 0); van.pitch(0.04 * Math.sin(Math.PI * seg(t, 5.2, 6.4))); van.rollTo(48 - z);
    van.rearDoors(seg(t, 6.6, 7.4)); van.slideDoor(0);
    van.lights(t < 6.4, t); world.siren(0);
    world.gate(E.sm(seg(t, 2.8, 4.0)) - E.sm(seg(t, 6.0, 7.0)));
    world.door(E.sm(seg(t, 8.6, 9.4)));
    if (t < 6.4 && time > sirenAt) { sirenAt = time + 0.55; sound("siren"); }
    setPose(driver, SEATED); driver.expr("normal");
    // inside the cargo (van-local x runs back towards +z world): A, the player, B; then out of the rear and along the side to the door
    const toWorld = (lx, lz) => [van.root.position.x - lz, van.root.position.z + lx]; // van heading -z
    const out = [seg(t, 7.0, 7.8), seg(t, 7.4, 8.2), seg(t, 7.7, 8.5)];
    const lat = [0.62, 0, -0.62];
    [offA, player, offB].forEach((f, i) => {
      const u = out[i];
      if (u <= 0) { const [wx, wz] = toWorld(1.2 + (i === 1 ? 0.3 : 0), lat[i] * 0.7); place(f, wx, wz, Math.PI / 2, 0.63); setPose(f, i === 1 ? P(HELD, { hipsY: -0.2 }) : pose({ hipsY: -0.2, aRs: 0.4, aLs: 0.4 })); f.expr(i === 1 ? "shock" : "normal"); f.root.visible = true; return; }
      const path = [[z * 0 + 0 + lat[i] * -0.7 * 0, z + 2.7 + 0.1]]; void path;
      const p0 = toWorld(1.4, lat[i] * 0.7), pEnd = polyPos(F0_PATH, clamp01((t - 8.3 - i * 0.12) / 3.1)), walk = clamp01((t - 8.3 - i * 0.12) / 3.1);
      let x, zz, yaw, y = 0, dist = 0;
      if (walk <= 0) { const k = u, rx = z + 2.9; x = mix(p0[0], lat[i] * -0.9 + 0.0, 0) + 0; zz = mix(p0[1], rx + 0.6, E.sm(k)); x = mix(p0[0], p0[0] + lat[i] * -0.0, k); y = 0.63 * (1 - E.sm(seg(k, 0.4, 0.9))); yaw = Math.PI / 2; dist = k * 1.6; }
      else { x = pEnd.x - lat[i] * 0.0 + (i === 0 ? -0.7 : i === 2 ? 0.7 : 0) * (1 - walk * 0.0); zz = pEnd.z; yaw = yawTo(pEnd.dx, pEnd.dz); dist = 1.6 + pEnd.dist; }
      place(f, x, zz, yaw, y);
      setPose(f, i === 1 ? { ...gait(dist, false), ...pick(HELD, ["aRs", "aLs", "aRe", "aLe", "headX"]) } : gait(dist, false));
      f.expr(i === 1 ? "shock" : "normal");
      f.root.visible = !(zz < -14.7);
    });
    crowd.forEach((c) => (c.f.root.visible = false)); lec.root.visible = false; stars.visible = false;
    camF0(t);
  }
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

  // ----- you won and ran: the QRS arrive to an empty street -----
  const camEsc = track([[0, [0, 1.55, 6.4], [0, 1.1, 0]], [2.2, [-2.5, 1.6, 6.8], [-4, 1.1, 0.3]], [4.2, [0.5, 1.7, 7.5], [0, 1.2, -1]], [7.5, [0.8, 1.6, 6.3], [0.5, 1.1, 0]]]);
  function escape(t) {
    world.setMode("campus");
    fallen(); crowdUpdate(t, 3.6);
    const run = seg(t, 1.3, 3.6);
    if (t < 1.3) { place(player, PX, 0, 0); setPose(player, WIN(t)); player.expr(t > 0.7 ? "shock" : "grin"); }
    else { const d = run * 13.5, x = PX - d, zz = 0.2 + run * 1.2; place(player, x, zz, yawTo(-1, 0.1), 0); setPose(player, gait(d, true)); player.expr("grin"); player.root.visible = run < 1; }
    const arrive = E.out(seg(t, 3.0, 5.2)); vanTo(t < 3.0 ? 32 : mix(32, VX, arrive), VZ, 0.05 * Math.sin(Math.PI * seg(t, 4.3, 5.4)));
    van.slideDoor(seg(t, 5.3, 5.8)); van.rearDoors(0); sirenTick(t, t < 6.8);
    setPose(driver, SEATED); driver.expr("normal");
    const ex = (f, i, tx, tz) => { const k = seg(t, 5.6 + i * 0.15, 6.2 + i * 0.15), zStart = VZ + 0.55, zz = mix(zStart, -2.95, k < 0.5 ? E.sm(k * 2) : 1), p = seg(t, 6.0 + i * 0.15, 7.2 + i * 0.15);
      if (t < 5.6 + i * 0.15) inVan(f, i * 0.55 - 0.1, 0.55); else if (p <= 0) { place(f, VX + i * 0.55 - 0.1, zz, 0, 0.63 * (1 - E.sm(seg(k, 0.4, 1)))); setPose(f, gait(k * 0.5, false)); } else { const q = polyPos([[VX + i * 0.55 - 0.1, -2.95], [tx, tz]], p); place(f, q.x, q.z, p < 1 ? yawTo(q.dx, q.dz) : yawTo(LX + 0.7 - tx, -tz), 0); setPose(f, p < 1 ? gait(q.dist, false) : pose({ aRa: 0.5, aLa: 0.5, aRe: 1.2, aLe: 1.2, headX: 0.2 })); } };
    ex(offA, 0, 0.5, 0.9); ex(offB, 1, 2.3, 1.1);
    stars.visible = false; camEsc(t);
  }

  // ----- you lost: the lecturer carries on with the class -----
  function lost(t) {
    world.setMode("campus"); van.root.position.set(60, 0, VZ); [offA, offB, driver].forEach((f) => (f.root.visible = false));
    crowdUpdate(t); place(player, PX - 0.7, 0, 0, 0.12, Math.PI / 2); setPose(player, LYING); player.expr("ko"); showStars(player, true);
    place(lec, LX - 0.3, 0, Math.PI, 0); const k = seg(t, 0.4, 1.4); setPose(lec, mixPose(LGUARD, t > 2.4 ? pose({ aRs: 1.9, aRe: 0.3, aLs: 0.4, aLe: 1.6, lean: 0.1, headX: 0.1 }) : SMUG(t), E.sm(k))); lec.expr("grin");
    const p = E.sm(seg(t, 0, 4.4)); setCam(mix(0.2, -0.4, p), 1.5, mix(6.2, 4.4, p), -0.2, 1.0, 0);
  }

  const SCENES = {
    dsa: { dur: 18, fn: dsa, cues: [[0.2, () => caption("Sirens... someone called N-QRS.", 2400)], [3.2, () => { caption("N-QRS! Nobody move!", 1800); sound("door"); }], [4.5, () => caption("Run! Run!", 1500)], [6.0, () => caption("Got you!", 1500)], [7.6, () => caption("You are coming with us.", 2000)], [9.3, () => sound("door")], [11, () => caption("In you go.", 1500)], [12.2, () => sound("slam")], [12.5, () => caption("Next stop: Floor O.", 2400)], [14.8, () => sound("engine")]] },
    floor0: { dur: 11.8, fn: floor0, cues: [[0.3, () => caption("The N-QRS van rolls up to Floor O (N-QRS Custody).", 2600)], [3, () => sound("door")], [6.6, () => sound("door")], [9.2, () => caption("Welcome to Floor O.", 2600)], [10.2, () => sound("slam")]] },
    escape: { dur: 7.8, fn: escape, cues: [[0.5, () => caption("You hear sirens...", 1600)], [1.4, () => caption("Run!", 1200)], [5.8, () => caption("N-QRS got there too late.", 2400)]] },
    lost: { dur: 4.6, fn: lost, cues: [[0.5, () => caption(`${lecturer.name} wins. Sit down.`, 2800)]] },
  };
  const everyone = [player, lec, offA, offB, driver, ...crowd.map((c) => c.f)];

  function play(name) {
    const s = SCENES[name]; if (!s) return Promise.resolve();
    everyone.forEach((f) => (f.root.visible = true)); tele.visible = false; stars.visible = false; sirenAt = 0;
    return new Promise((resolve) => { cut = { name, t: 0, last: -1, resolve }; mode = "cut"; });
  }
  function cutStep(dt) {
    const s = SCENES[cut.name]; cut.t = Math.min(s.dur, cut.t + dt);
    for (const [at, fn] of s.cues) if (cut.last < at && cut.t >= at) fn();
    cut.last = cut.t; s.fn(cut.t);
    if (cut.t >= s.dur) { const r = cut.resolve; cut.done = true; mode = "held"; r(); }
  }

  // ---------- the loop ----------
  function frame(dt) {
    if (slow > 0) { slow -= dt; dt *= 0.35; }
    time += dt; shake *= Math.pow(0.02, dt);
    if (mode === "fight") fightStep(dt);
    if (mode === "intro" || mode === "fight" || mode === "ended") { [offA, offB, driver].forEach((f) => (f.root.visible = false)); world.setMode("campus"); drawFightScene(); crowdUpdate(time); fightCam(dt); van.root.position.x = 60; world.siren(0); }
    else if (mode === "cut") cutStep(dt);
    else if (mode === "held") { const s = SCENES[cut.name]; s.fn(s.dur); }
    for (let i = pops.length - 1; i >= 0; i--) { const p = pops[i]; p.life += dt; const u = p.life / p.max; p.s.position.y += dt * p.rise; p.s.material.opacity = 1 - E.in(u); const sc = u < 0.15 ? mix(0.4, 1.15, u / 0.15) : 1; p.s.scale.set(p.base.x * sc, p.base.y * sc, 1); if (u >= 1) { scene.remove(p.s); p.s.material.map.dispose(); p.s.material.dispose(); pops.splice(i, 1); } }
    for (const p of sparks) if (p.life > 0) { p.life -= dt; p.v.y -= 9 * dt; p.m.position.addScaledVector(p.v, dt); if (p.life <= 0) p.m.visible = false; }
    world.update(time);
  }
  // wait (a few seconds at most) for the characters, so the scene opens with people in it; any that are slower swap in when they arrive
  await Promise.race([Promise.all(people.map((f) => f.upgrade())), new Promise((r) => setTimeout(r, 4500))]);
  stage.onFrame((t, dt) => { if (!paused) frame(dt); });
  applyK = 0.35;

  return {
    stage, startFight, play,
    get mode() { return mode; },
    get auto() { return sim ? sim.auto : true; },
    setAuto(v) { if (sim) { sim.auto = !!v; lastHp = ""; } },
    press(move) { if (move in latch) latch[move] = true; },
    setBlock(v) { latch.block = !!v; },
    /** Jump to the end of the running cutscene. */
    skip() { if (cut && mode === "cut") { cut.t = SCENES[cut.name].dur; for (const [at, fn] of SCENES[cut.name].cues) if (cut.last < at && at < SCENES[cut.name].dur - 0.01 && SCENES[cut.name].dur > at + 2) { /* skipped cues stay silent */ } cutStep(0); } },
    // ---- for tests and screenshots: freeze the clock and draw an exact moment ----
    pause(v = true) { paused = v; },
    seek(name, t) { paused = true; applyK = 1; everyone.forEach((f) => (f.root.visible = true)); cut = { name, t, last: 1e9, resolve() {} }; mode = "held"; SCENES[name].fn(t); renderer.render(scene, camera); applyK = 0.35; },
    step(dt, n = 1) { paused = true; applyK = 1; for (let i = 0; i < n; i++) frame(dt); renderer.render(scene, camera); applyK = 0.35; },
    sim: () => sim,
    dispose() { gone = true; stage.dispose(); world.dispose(); toDispose.forEach((d) => d.dispose?.()); sparkGeo.dispose(); pops.forEach((p) => { p.s.material.map.dispose(); p.s.material.dispose(); }); },
  };
}