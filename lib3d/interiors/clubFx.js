// lib3d/interiors/clubFx.js
// The things you SEE when someone spends money in a nightclub: banknotes that scatter and fall, a bottle carried to the table by a waiter, sparklers, spotlight
// columns, confetti, reserved tables and the club's changing lights. Browser (three.js) only; the scene (scene.js) creates one of these per club interior.
//
// Nothing here decides anything. The server writes a ClubEvent only after a purchase has been paid for (lib/clubService.js), the screen polls those events and
// hands each one to play(); so an effect on screen always means a real, completed purchase. Cheap by design: every particle kind is ONE InstancedMesh with a fixed
// capacity (a 10 million naira spray is about 580 notes, a few hundred triangles each frame), bottles are lathe shapes (no model files), and everything is
// removed on dispose().
import * as THREE from "three";
import { drinkById } from "../../lib/clubs.js";

// ------------------------------------------------------------------------------------------------ bottles
/** Lathe profiles (radius, height) in metres: original shapes, not any maker's artwork. */
const PROFILE = {
  cognac: [[0, 0], [0.075, 0], [0.085, 0.02], [0.085, 0.17], [0.07, 0.215], [0.032, 0.255], [0.03, 0.32], [0, 0.32]],
  squat: [[0, 0], [0.09, 0], [0.095, 0.03], [0.095, 0.13], [0.075, 0.18], [0.03, 0.215], [0.028, 0.27], [0, 0.27]],
  champagne: [[0, 0], [0.047, 0], [0.052, 0.02], [0.052, 0.19], [0.036, 0.265], [0.018, 0.32], [0.019, 0.38], [0, 0.38]],
  ceramic: [[0, 0], [0.07, 0], [0.1, 0.06], [0.105, 0.14], [0.08, 0.21], [0.035, 0.25], [0.03, 0.3], [0, 0.3]],
  decanter: [[0, 0], [0.1, 0], [0.108, 0.03], [0.1, 0.15], [0.06, 0.21], [0.026, 0.245], [0.03, 0.27], [0.046, 0.3], [0.03, 0.33], [0, 0.33]],
};
const BODY_R = { cognac: 0.085, squat: 0.095, champagne: 0.052, ceramic: 0.105, decanter: 0.105 }, LABEL_AT = { cognac: 0.09, squat: 0.07, champagne: 0.1, ceramic: 0.09, decanter: 0.08 };

/** A bottle for `drink` (an entry of DRINKS). Returns { group, topY, dispose }. Every drink has its own shape and colours. */
export function makeBottle(drink) {
  const shape = PROFILE[drink?.shape] ? drink.shape : "cognac", geos = [], mats = [], g = new THREE.Group();
  const own = (o, list) => { list.push(o); return o; };
  const bodyGeo = own(new THREE.LatheGeometry(PROFILE[shape].map(([r, y]) => new THREE.Vector2(r, y)), 18), geos);
  const body = new THREE.Mesh(bodyGeo, own(new THREE.MeshStandardMaterial({ color: drink?.body ?? "#7a3d12", roughness: drink?.metal ? 0.22 : 0.3, metalness: drink?.metal ? 0.95 : 0.15, emissive: drink?.body ?? "#7a3d12", emissiveIntensity: 0.28 }), mats));
  g.add(body);
  const top = PROFILE[shape][PROFILE[shape].length - 2][1];
  const label = new THREE.Mesh(own(new THREE.CylinderGeometry(BODY_R[shape] + 0.003, BODY_R[shape] + 0.003, 0.07, 18, 1, true), geos), own(new THREE.MeshStandardMaterial({ color: drink?.label ?? "#e9d9b0", roughness: 0.6, side: THREE.DoubleSide, emissive: drink?.label ?? "#e9d9b0", emissiveIntensity: 0.18 }), mats));
  label.position.y = LABEL_AT[shape]; g.add(label);
  const cap = new THREE.Mesh(own(new THREE.CylinderGeometry(0.03, 0.034, 0.05, 12), geos), own(new THREE.MeshStandardMaterial({ color: drink?.cap ?? "#c9a227", roughness: 0.25, metalness: 0.9, emissive: drink?.cap ?? "#c9a227", emissiveIntensity: 0.3 }), mats));
  cap.position.y = top + 0.018; g.add(cap);
  return { group: g, topY: top + 0.05, dispose() { geos.forEach((x) => x.dispose()); mats.forEach((x) => x.dispose()); } };
}

// ------------------------------------------------------------------------------------------------ particles
const NOTE_COLORS = { low: ["#5fb36a", "#3f8f55", "#8ccf7a"], mid: ["#6a8fe8", "#5fb36a", "#c7e07a"], high: ["#ffd24a", "#f2b632", "#5fb36a"] };
const CONFETTI = ["#ff4f87", "#ffd24a", "#38e8ff", "#7cf29a", "#b48cff", "#ffffff"], GOLD = ["#ffd24a", "#f2b632", "#fff2b0", "#c9a227"];
/** Notes per second and how many a spray may spawn at most, by show level 1..5. */
const NOTE_RATE = { 1: 8, 2: 14, 3: 24, 4: 40, 5: 64 }, BURST = { 1: 50, 2: 90, 3: 150, 4: 240, 5: 380 };

/** One InstancedMesh of small flat pieces with gravity, drag, spin and a lifetime. spawn() is a no-op when full (a busy night cannot slow the frame down). */
function createParticles(scene, geo, mat, cap) {
  const mesh = new THREE.InstancedMesh(geo, mat, cap); mesh.frustumCulled = false; mesh.count = 0; scene.add(mesh);
  const live = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  return {
    mesh, get count() { return live.length; },
    spawn(p) { if (live.length >= cap) return false; live.push({ vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, sx: 0, sy: 0, sz: 0, g: 3, drag: 0.4, age: 0, life: 3, size: 1, floorY: 0, rest: 0, flutter: 0, ph: Math.random() * 6.28, ...p, c: new THREE.Color(p.color ?? "#ffffff") }); return true; },
    update(dt) {
      for (let i = live.length - 1; i >= 0; i--) {
        const p = live[i]; p.age += dt;
        if (p.rest > 0) { p.rest -= dt; if (p.rest <= 0) { live[i] = live[live.length - 1]; live.pop(); continue; } } // lying on the floor, then gone
        else {
          p.vy -= p.g * dt; const k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vz *= k; if (p.vy < -1.4 && p.g < 6) p.vy = -1.4; // paper and confetti never fall fast
          p.x += (p.vx + Math.sin(p.age * 5 + p.ph) * p.flutter) * dt; p.z += (p.vz + Math.cos(p.age * 4 + p.ph) * p.flutter) * dt; p.y += p.vy * dt; p.rx += p.sx * dt; p.ry += p.sy * dt; p.rz += p.sz * dt;
          if (p.y <= p.floorY + 0.02 && p.vy < 0 && p.life > 0.6) { p.y = p.floorY + 0.025; p.vx = p.vy = p.vz = 0; p.sx = p.sz = 0; p.rx = -Math.PI / 2; p.rest = 1.6 + Math.random(); }
          else if (p.age >= p.life) { live[i] = live[live.length - 1]; live.pop(); continue; }
        }
      }
      let n = 0;
      for (const p of live) {
        const fade = p.rest > 0 ? Math.min(1, p.rest / 0.8) : Math.min(1, (p.life - p.age) / 0.4, p.age / 0.05 + 0.2); // thin out at the end of life, shrink away on the floor
        pos.set(p.x, p.y, p.z); e.set(p.rx, p.ry, p.rz); q.setFromEuler(e); sc.setScalar(Math.max(0.001, p.size * Math.max(0, fade))); m.compose(pos, q, sc); mesh.setMatrixAt(n, m); mesh.setColorAt(n, p.c); n++;
      }
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    clear() { live.length = 0; mesh.count = 0; },
    dispose() { scene.remove(mesh); mesh.dispose(); },
  };
}

// ------------------------------------------------------------------------------------------------ the module
const rnd = (a, b) => a + Math.random() * (b - a), pick = (l) => l[(Math.random() * l.length) | 0], easeOut = (t) => 1 - (1 - t) ** 3;
const labelTexture = (text, fg, bg) => {
  if (typeof document === "undefined") return null; const c = document.createElement("canvas"); c.width = 512; c.height = 112; const g = c.getContext("2d"); if (!g) return null;
  g.fillStyle = bg; g.fillRect(0, 0, 512, 112); g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle"; let size = 52; g.font = `700 ${size}px system-ui, sans-serif`; const w = g.measureText(text).width; if (w > 480) { size *= 480 / w; g.font = `700 ${size}px system-ui, sans-serif`; }
  g.fillText(text, 256, 58); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
};
const TABLES = { vip: { cloth: "#5b2d8a", trim: "#d9d4e8", glow: "#b48cff" }, royal: { cloth: "#c9a227", trim: "#fff2b0", glow: "#ffd24a" }, billionaire: { cloth: "#15151a", trim: "#ffd24a", glow: "#ffd24a" } };
const MOODS = {
  lounge: { tint: "#ff7ac8", mix: 0.5, beams: 0, pulse: 0.3, amp: 0.08 },
  shutdown: { tint: "#7a5cff", mix: 0.5, beams: 4, hue: 0.25, confetti: 9, amp: 0.1 },
  takeover: { tint: "#ffcf4a", mix: 0.6, beams: 6, hue: 0.08, confetti: 7, sweep: true, amp: 0.12 },
  djset: { tint: "#38e8ff", mix: 0.6, beams: 4, hue: 0.6, strobe: 2, amp: 0.45 },
  party: { tint: "#ff4f87", mix: 0.5, beams: 2, hue: 0.4, confetti: 10, amp: 0.1 },
};

/**
 * scene, floorY(f), bounds {x0,x1,z0,z1} of the club,
 * lights { hemi, ambient? } (modulated by the mood and put back), walkable(x, z, floor) -> bool, pathFn(x0, z0, x1, z1, floor) -> [[x,z],...] | null,
 * posOf(name) -> { x, z, floor } | null (a player in this room), barSpot { x, z } where the waiter starts, makeWaiter() -> Promise<avatar> | null, reduced: fewer particles.
 */
export function createClubFx({ scene, floorY = () => 0, bounds, lights = {}, walkable = () => true, pathFn = () => null, posOf = () => null, barSpot = null, makeWaiter = null, reduced = false }) {
  const k = reduced ? 0.5 : 1, toDispose = [], own = (o) => { toDispose.push(o); return o; }, root = new THREE.Group(); scene.add(root);
  const noteGeo = own(new THREE.PlaneGeometry(0.17, 0.08)), noteMat = own(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }));
  const confGeo = own(new THREE.PlaneGeometry(0.07, 0.11)), confMat = own(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }));
  const sparkGeo = own(new THREE.BoxGeometry(0.025, 0.025, 0.025)), sparkMat = own(new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const notes = createParticles(root, noteGeo, noteMat, 720), confetti = createParticles(root, confGeo, confMat, 640), sparks = createParticles(root, sparkGeo, sparkMat, 500);
  const emitters = [], spots = [], shows = [], tables = new Map(), centre = bounds ? { x: (bounds.x0 + bounds.x1) / 2, z: (bounds.z0 + bounds.z1) / 2 } : { x: 0, z: 0 };
  const base = { hemi: lights.hemi ? { c: lights.hemi.color.clone(), i: lights.hemi.intensity } : null, amb: lights.ambient ? { c: lights.ambient.color.clone(), i: lights.ambient.intensity } : null };
  let mood = null, beams = [], moodT = 0, nextConf = 0, waiter = null, waiterBusy = false, waiterTried = false, dead = false;
  const tmpC = new THREE.Color(), posFor = (name, show) => { const p = name ? posOf(name) : null; return p ?? { x: show.x ?? centre.x, z: show.z ?? centre.z, floor: show.data?.floor ?? 0 }; };

  // a free spot beside someone (always the same spot for the same place, so the table and the bottle agree)
  function spotFor(x, z, floor) { for (const [dx, dz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2], [0.85, 0.85], [-0.85, 0.85], [0.85, -0.85], [-0.85, -0.85]]) if (walkable(x + dx, z + dz, floor)) return { x: x + dx, z: z + dz }; return { x: x + 0.9, z: z }; }

  // ---- spray ----
  function spray(show) {
    const level = show.level, sec = show.data?.sec ?? 4, tone = (show.data?.amount ?? 0) >= 1_000_000 ? "high" : (show.data?.amount ?? 0) >= 100_000 ? "mid" : "low";
    emitters.push({ name: show.actor, show, left: sec, rate: NOTE_RATE[level] * k, acc: 0, tone, floor: show.data?.floor ?? 0 });
  }
  function emitNotes(e, dt) {
    const p = posFor(e.name, e.show); e.acc += e.rate * dt; const y0 = floorY(p.floor ?? e.floor);
    while (e.acc >= 1) { e.acc -= 1; const a = Math.random() * 6.28, v = rnd(0.7, 2.7);
      notes.spawn({ x: p.x + Math.cos(a) * 0.25, y: y0 + rnd(1.2, 1.7), z: p.z + Math.sin(a) * 0.25, vx: Math.cos(a) * v, vz: Math.sin(a) * v, vy: rnd(1.4, 3.4), g: 3.4, drag: 0.9, rx: rnd(0, 6), ry: rnd(0, 6), rz: rnd(0, 6), sx: rnd(-6, 6), sy: rnd(-5, 5), sz: rnd(-6, 6), flutter: 0.45, floorY: y0, life: rnd(2.6, 4.2), color: pick(NOTE_COLORS[e.tone]) }); }
  }

  // ---- confetti, sparkle ----
  function confettiBurst(x, z, floor, level, gold) {
    const n = Math.round(BURST[level] * k), y0 = floorY(floor), cols = gold ? GOLD : CONFETTI;
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * 3.2; confetti.spawn({ x: x + Math.cos(a) * r, y: y0 + rnd(3.0, 3.6), z: z + Math.sin(a) * r, vx: rnd(-0.5, 0.5), vz: rnd(-0.5, 0.5), vy: rnd(-0.2, 1.1), g: 1.6, drag: 0.8, rx: rnd(0, 6), ry: rnd(0, 6), rz: rnd(0, 6), sx: rnd(-7, 7), sy: rnd(-7, 7), sz: rnd(-7, 7), flutter: 0.6, floorY: y0, life: rnd(3.5, 6), color: pick(cols) }); }
  }
  const sparkle = (e) => { e.acc += 55 * k * e.dt; while (e.acc >= 1) { e.acc -= 1; sparks.spawn({ x: e.x + rnd(-0.03, 0.03), y: e.y, z: e.z + rnd(-0.03, 0.03), vx: rnd(-0.9, 0.9), vz: rnd(-0.9, 0.9), vy: rnd(0.8, 2.1), g: 5, drag: 0.5, floorY: -9, life: rnd(0.4, 0.9), color: pick(["#fff2b0", "#ffd24a", "#ffffff", "#ffb13d"]), size: rnd(0.7, 1.4) }); } };
  const sparkJobs = []; // fountains of sparks that stay put (a sparkler on a bottle)

  // ---- spotlight columns ----
  function spotlight(name, show, sec, color = "#fff2b0", follow = true) {
    const p = posFor(name, show), y0 = floorY(p.floor ?? 0), h = 3.4, g = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.0, h, 20, 1, true).translate(0, -h / 2, 0), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    const pool = new THREE.Mesh(new THREE.CircleGeometry(1.0, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    cone.position.y = h; pool.position.y = 0.04; g.add(cone, pool); g.position.set(p.x, y0, p.z); root.add(g);
    spots.push({ g, cone, pool, name: follow ? name : null, fixed: { x: p.x, z: p.z }, age: 0, life: sec, base: { x: p.x, z: p.z, f: p.floor ?? 0 } });
  }

  // ---- tables ----
  function buildTable(t) {
    const spec = TABLES[t.data?.table] ?? TABLES.vip, p = { x: t.x ?? centre.x, z: t.z ?? centre.z }, f = t.data?.floor ?? 0, at = spotFor(p.x, p.z, f), g = new THREE.Group(), geos = [], mats = [];
    const mk = (geo, color, o = {}) => { geos.push(geo); const m = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1, emissive: o.glow ? color : "#000000", emissiveIntensity: o.glow ? 0.6 : 0, ...o.mat }); mats.push(m); return new THREE.Mesh(geo, m); };
    const top = mk(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 24), spec.cloth); top.position.y = 0.78; const rim = mk(new THREE.TorusGeometry(0.55, 0.02, 6, 28).rotateX(Math.PI / 2), spec.trim, { glow: true }); rim.position.y = 0.805;
    const leg = mk(new THREE.CylinderGeometry(0.07, 0.07, 0.76, 10), "#2a2a33"), foot = mk(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 18), "#2a2a33"); leg.position.y = 0.38; foot.position.y = 0.015;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: spec.glow, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); ring.position.y = 0.03; geos.push(ring.geometry); mats.push(ring.material);
    g.add(top, rim, leg, foot, ring);
    const tex = labelTexture(`${t.actor}'s table`, "#ffffff", "rgba(13,19,33,0.85)"); let sprite = null;
    if (tex) { sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false })); sprite.scale.set(1.5, 0.33, 1); sprite.position.y = 1.35; g.add(sprite); }
    g.position.set(at.x, floorY(f), at.z); root.add(g);
    return { g, at, y: floorY(f) + 0.805, ring, until: t.until, dispose() { root.remove(g); geos.forEach((x) => x.dispose()); mats.forEach((x) => x.dispose()); tex?.dispose(); sprite?.material.dispose(); } };
  }
  /** The reserved tables in the club right now (from the server): new ones appear, ended ones are removed. Safe to call on every poll. */
  function setTables(list) {
    const want = new Map((list ?? []).map((t) => [t.id, t]));
    for (const [id, t] of tables) if (!want.has(id)) { t.dispose(); tables.delete(id); }
    for (const [id, t] of want) if (!tables.has(id)) tables.set(id, buildTable(t));
  }

  // ---- the bottle, brought out ----
  const HOLD = { tray: 25, sparkler: 25, royal: 40, crown: 60 };
  async function ensureWaiter() { if (waiter || waiterTried || !makeWaiter) return; waiterTried = true; try { const av = await makeWaiter(); if (dead) { av?.dispose?.(); return; } waiter = av; if (av?.root) { av.root.visible = false; root.add(av.root); } } catch { waiter = null; } }
  function bottleShow(show) {
    const d = show.data ?? {}, drink = drinkById(d.drink); if (!drink) return;
    const who = show.to ?? show.actor, p = posFor(who, show), f = p.floor ?? d.floor ?? 0, here = d.table ? spotFor(show.x ?? p.x, show.z ?? p.z, f) : spotFor(p.x, p.z, f), // a reserved table stands where it was bought, so the bottle and the table agree
       style = d.style ?? "tray", level = show.level;
    const bottle = makeBottle(drink), tbl = [...tables.values()].find((t) => t.owner === show.actor);
    let tmpTable = null; if (!d.table && !tbl) { tmpTable = buildTable({ id: "tmp", actor: who, x: p.x, z: p.z, data: { table: level >= 5 ? "royal" : "vip", floor: f }, until: 0 }); }
    const dest = tbl ?? tmpTable, top = (dest?.y ?? floorY(f) + 0.8) + 0.03;
    const s = { bottle, dest, tmpTable, at: dest?.at ?? here, f, top, style, level, who, show, age: 0, phase: "start", path: null, pi: 0, hold: (HOLD[style] ?? 25) * 1, sparkAcc: 0, spotDone: false, confDone: false, walked: false, gold: level >= 5 };
    root.add(bottle.group); bottle.group.visible = false; shows.push(s);
    ensureWaiter().then(() => { if (!s.dead) startWalk(s); });
    s.fallback = setTimeout(() => { if (s.phase === "start") startDrop(s); }, 1800); // no waiter (or no path) within a moment: the bottle is brought in another way, so the purchase is never invisible
  }
  function startWalk(s) {
    if (s.phase !== "start") return;
    if (!waiter || waiterBusy || !barSpot) return startDrop(s);
    const path = pathFn(barSpot.x, barSpot.z, s.at.x, s.at.z, s.f); if (!path || path.length < 2) return startDrop(s);
    waiterBusy = true; s.waiter = true; s.path = path; s.pi = 1; s.wx = path[0][0]; s.wz = path[0][1]; s.wyaw = 0; s.phase = "walk"; waiter.root.visible = true; waiter.play?.("walk", { fade: 0.2 }); s.bottle.group.visible = true; clearTimeout(s.fallback);
  }
  function startDrop(s) { if (s.phase !== "start") return; clearTimeout(s.fallback); s.phase = "drop"; s.age = 0; s.bottle.group.visible = true; s.bottle.group.position.set(s.at.x, s.top + 3, s.at.z); }
  function beginShow(s) {
    s.phase = "show"; s.age = 0; s.bottle.group.position.set(s.at.x, s.top, s.at.z); s.bottle.group.rotation.set(0, 0, 0);
    const parts = s.show.data?.parts ?? [];
    if (parts.includes("sparkle")) sparkJobs.push({ x: s.at.x, y: s.top + s.bottle.topY, z: s.at.z, left: 9, acc: 0, dt: 0 });
    if (parts.includes("spotlight")) spotlight(null, { x: s.at.x, z: s.at.z, data: { floor: s.f } }, 14 + s.level * 3, s.gold ? "#ffd24a" : s.style === "crown" ? "#ffd24a" : "#9fd4ff", false);
    if (parts.includes("confetti")) confettiBurst(s.at.x, s.at.z, s.f, Math.min(5, s.level), s.gold);
    if (parts.includes("sweep")) for (let i = 0; i < 3; i++) beams.push(makeBeam(s.at.x, s.at.z, s.f, "#ffd24a", 14, i));
  }
  function endShow(s) { clearTimeout(s.fallback); s.dead = true; scene.remove(s.bottle.group); root.remove(s.bottle.group); s.bottle.dispose(); s.tmpTable?.dispose(); }

  // ---- beams (the sweeping lights of a mood or of the billionaire package) ----
  function makeBeam(x, z, floor, color, sec, i) {
    const h = 3.3, cone = new THREE.Mesh(new THREE.ConeGeometry(0.55, h, 14, 1, true).translate(0, -h / 2, 0), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    cone.position.set(x, floorY(floor) + h, z); root.add(cone); return { cone, ph: i * 1.7, left: sec, speed: 0.7 + i * 0.15 };
  }
  function setMood(m) {
    const key = m?.data?.mood ?? m?.mood ?? null; if ((mood?.key ?? null) === key) return; clearMood();
    if (!key || !MOODS[key]) return; mood = { key, spec: MOODS[key], host: m?.data?.host ?? m?.actor ?? "" }; moodT = 0; nextConf = 1.5;
    const n = mood.spec.beams ?? 0, b = bounds ?? { x0: -6, x1: 6, z0: -6, z1: 6 };
    for (let i = 0; i < n; i++) beams.push({ ...makeBeam(b.x0 + ((i + 0.5) / n) * (b.x1 - b.x0), centre.z + (i % 2 ? -2 : 2), 0, "#ffffff", Infinity, i), mood: true });
  }
  function clearMood() {
    mood = null; for (const b of beams) if (b.mood) { root.remove(b.cone); b.cone.geometry.dispose(); b.cone.material.dispose(); } beams = beams.filter((b) => !b.mood);
    if (lights.hemi && base.hemi) { lights.hemi.color.copy(base.hemi.c); lights.hemi.intensity = base.hemi.i; } if (lights.ambient && base.amb) { lights.ambient.color.copy(base.amb.c); lights.ambient.intensity = base.amb.i; } // the club goes back to normal
  }

  // ---- play one server event ----
  function play(show) {
    if (dead || !show) return; const parts = show.data?.parts ?? [], level = Math.max(1, Math.min(5, show.level | 0 || 1)), p = posFor(show.actor, show);
    if (parts.includes("spray")) spray({ ...show, level });
    if (parts.includes("bottle")) bottleShow({ ...show, level });
    else if (parts.includes("sparkle")) sparkJobs.push({ x: p.x, y: floorY(p.floor ?? 0) + 0.1, z: p.z, left: 6, acc: 0, dt: 0 });
    if (parts.includes("spotlight") && !parts.includes("bottle")) spotlight(show.actor, show, show.data?.exp === "spotlight" ? 30 : 8 + level * 2, parts.includes("gold") ? "#ffd24a" : "#fff2b0");
    if (parts.includes("confetti") && !parts.includes("bottle")) confettiBurst(p.x, p.z, p.floor ?? 0, level, parts.includes("gold"));
    if (parts.includes("gold")) confettiBurst(p.x, p.z, p.floor ?? 0, Math.min(5, level), true);
  }

  // ---- every frame ----
  function update(t, dt) {
    if (dead) return; dt = Math.min(dt, 0.05);
    for (let i = emitters.length - 1; i >= 0; i--) { const e = emitters[i]; e.left -= dt; emitNotes(e, dt); if (e.left <= 0) emitters.splice(i, 1); }
    for (let i = sparkJobs.length - 1; i >= 0; i--) { const j = sparkJobs[i]; j.left -= dt; j.dt = dt; sparkle(j); if (j.left <= 0) sparkJobs.splice(i, 1); }
    for (let i = spots.length - 1; i >= 0; i--) { const s = spots[i]; s.age += dt; if (s.name) { const p = posOf(s.name); if (p) s.g.position.set(p.x, floorY(p.floor ?? 0), p.z); } const a = Math.min(1, s.age / 0.6, (s.life - s.age) / 0.8), o = Math.max(0, a);
      s.cone.material.opacity = 0.2 * o; s.pool.material.opacity = 0.4 * o; s.cone.scale.setScalar(1 + Math.sin(t * 3) * 0.03);
      if (s.age >= s.life) { root.remove(s.g); s.cone.geometry.dispose(); s.cone.material.dispose(); s.pool.geometry.dispose(); s.pool.material.dispose(); spots.splice(i, 1); } }
    for (const tb of tables.values()) tb.ring.material.opacity = 0.5 + Math.sin(t * 2.2) * 0.2;
    for (let i = shows.length - 1; i >= 0; i--) {
      const s = shows[i]; if (s.dead) { shows.splice(i, 1); continue; } s.age += dt;
      if (s.phase === "walk" && waiter) {
        const [tx, tz] = s.path[s.pi], dx = tx - s.wx, dz = tz - s.wz, d = Math.hypot(dx, dz), step = 2.3 * dt;
        if (d <= step) { s.wx = tx; s.wz = tz; s.pi++; if (s.pi >= s.path.length) { s.phase = "serve"; s.age = 0; waiter.play?.(waiter.has?.("interact") ? "interact" : "greet", { fade: 0.2 }) || waiter.play?.("idle"); } } else { s.wx += (dx / d) * step; s.wz += (dz / d) * step; let dh = Math.atan2(dx, dz) - s.wyaw; dh = ((dh + Math.PI * 3) % (Math.PI * 2)) - Math.PI; s.wyaw += dh * Math.min(1, dt * 9); }
        waiter.root.position.set(s.wx, floorY(s.f) + 0.02, s.wz); waiter.root.rotation.y = s.wyaw; s.bottle.group.position.set(s.wx + Math.sin(s.wyaw) * 0.35, floorY(s.f) + 1.15, s.wz + Math.cos(s.wyaw) * 0.35);
      } else if (s.phase === "serve") { // the bottle is set down on the table
        const u = easeOut(Math.min(1, s.age / 0.6)); const b = s.bottle.group; b.position.set(s.wx + (s.at.x - s.wx) * u + Math.sin(s.wyaw) * 0.35 * (1 - u), floorY(s.f) + 1.15 + (s.top - floorY(s.f) - 1.15) * u, s.wz + (s.at.z - s.wz) * u + Math.cos(s.wyaw) * 0.35 * (1 - u));
        if (s.age >= 1.3) { beginShow(s); if (waiter) { waiter.play?.("walk", { fade: 0.2 }); s.leaving = { x: s.wx, z: s.wz }; waiterBusy = false; s.leaveT = 0; } }
      } else if (s.phase === "drop") { const u = easeOut(Math.min(1, s.age / 0.9)); s.bottle.group.position.set(s.at.x, s.top + 3 * (1 - u), s.at.z); s.bottle.group.rotation.y = (1 - u) * 6; if (s.age >= 0.9) beginShow(s); }
      else if (s.phase === "show") { s.bottle.group.rotation.y += dt * 0.4; if (s.age >= s.hold) { const u = (s.age - s.hold) / 0.8; s.bottle.group.scale.setScalar(Math.max(0.001, 1 - u)); if (u >= 1) endShow(s); } }
      if (s.leaving && waiter) { s.leaveT += dt; const u = Math.min(1, s.leaveT / 2.5), bx = barSpot?.x ?? s.leaving.x, bz = barSpot?.z ?? s.leaving.z; waiter.root.position.set(s.leaving.x + (bx - s.leaving.x) * u, floorY(s.f) + 0.02, s.leaving.z + (bz - s.leaving.z) * u); if (u >= 1) { waiter.root.visible = false; waiter.play?.("idle"); s.leaving = null; } }
    }
    if (waiter?.root?.visible) { if (waiter.tick) waiter.tick(t, dt, 6, { shadowAt: 0, halfAt: 8, hideAt: 60 }); else waiter.update?.(t, dt); }
    // the lights
    if (mood) {
      moodT += dt; const sp = mood.spec, h = lights.hemi, a = lights.ambient;
      let pulse = 1 + (sp.pulse ? Math.sin(moodT * sp.pulse * 6.28) * sp.amp : 0); if (sp.strobe) pulse = 1 + (Math.sin(moodT * sp.strobe * 6.28) > 0 ? sp.amp : -sp.amp * 0.4);
      tmpC.set(sp.tint); if (sp.hue) tmpC.offsetHSL((moodT * sp.hue) % 1, 0, 0);
      if (h && base.hemi) { h.color.copy(base.hemi.c).lerp(tmpC, sp.mix); h.intensity = base.hemi.i * pulse; } if (a && base.amb) { a.color.copy(base.amb.c).lerp(tmpC, sp.mix); a.intensity = base.amb.i * pulse; }
      if (sp.confetti && moodT >= nextConf) { nextConf = moodT + sp.confetti; confettiBurst(centre.x + rnd(-4, 4), centre.z + rnd(-3, 3), 0, 2, !!sp.sweep); }
    }
    for (let i = beams.length - 1; i >= 0; i--) { const b = beams[i]; if (!b.mood) { b.left -= dt; if (b.left <= 0) { root.remove(b.cone); b.cone.geometry.dispose(); b.cone.material.dispose(); beams.splice(i, 1); continue; } }
      b.cone.rotation.z = Math.sin(t * b.speed + b.ph) * 0.7; b.cone.rotation.x = Math.cos(t * b.speed * 0.8 + b.ph) * 0.7;
      if (b.mood) { tmpC.set(mood?.spec.tint ?? "#ffffff").offsetHSL(((t * (mood?.spec.hue ?? 0.2)) + b.ph * 0.15) % 1, 0, 0); b.cone.material.color.copy(tmpC); } }
    notes.update(dt); confetti.update(dt); sparks.update(dt);
  }

  function dispose() {
    dead = true; clearMood(); for (const s of shows) endShow(s); shows.length = 0; for (const t of tables.values()) t.dispose(); tables.clear();
    for (const s of spots) { root.remove(s.g); s.cone.geometry.dispose(); s.cone.material.dispose(); s.pool.geometry.dispose(); s.pool.material.dispose(); } spots.length = 0;
    for (const b of beams) { root.remove(b.cone); b.cone.geometry.dispose(); b.cone.material.dispose(); } beams.length = 0;
    notes.dispose(); confetti.dispose(); sparks.dispose(); if (waiter) { root.remove(waiter.root); waiter.dispose?.(); waiter = null; } toDispose.forEach((o) => o.dispose()); scene.remove(root);
  }
  /** The tables are matched to their owner by name, for the bottle that goes to a reserved table. */
  const setTablesOwned = (list) => { setTables(list); for (const [id, t] of tables) { const src = (list ?? []).find((x) => x.id === id); if (src) t.owner = src.actor; } };
  return { play, setTables: setTablesOwned, setMood, update, dispose, stats: () => ({ notes: notes.count, confetti: confetti.count, sparks: sparks.count, shows: shows.length, spots: spots.length, tables: tables.size, beams: beams.length }) };
}