// lib3d/interiors/remotePlayers.js
// The other real players standing in the building you are in: their avatars (the same character pipeline as your own), moving to the spot each one last
// reported, doing the activity they are doing, and carrying a name tag (lib3d/playerTags.js). Nothing here makes an NPC: a person is drawn only if the
// server listed them as a player, and a player who is no longer listed (left, disconnected, went quiet) is removed on the very next update.
import * as THREE from "three";
import { isTaggable } from "../playerTags.js";
import { cellAt } from "../../lib/custodyCells.js";

export const REMOTE_MAX = 12;   // avatars are heavy, so only the nearest few are built
export const REMOTE_RANGE = 22; // metres: farther away they are hidden (and so is their tag)
const RUN_AT = 2.6, SPEED_CAP = 4.4, SNAP = 14;

/**
 * scene: where avatars go. makeAvatar(look, gender) -> Promise<avatar> (createAvatar). tags: a playerTags layer. floorY(f): height of floor f.
 * self: { id, name } (never drawn). Returns { sync(list, from), update(t, dt, P), dispose(), count(), ids() }.
 */
export function createRemotePlayers({ scene, makeAvatar, tags, floorY = () => 0, self = {}, cells = [] }) {
  const entries = new Map(); let dead = false;

  function drop(id) {
    const e = entries.get(id); if (!e) return; entries.delete(id); e.dead = true;
    tags.remove(id); scene.remove(e.holder);
    if (e.av) { e.holder.remove(e.av.root); e.av.dispose?.(); }
    if (e.fallback) { e.fallback.geometry.dispose(); e.fallback.material.dispose(); }
  }

  function add(p) {
    const holder = new THREE.Group(), anchor = new THREE.Object3D(); anchor.position.y = 2.05; holder.add(anchor); holder.visible = false; scene.add(holder);
    const e = { id: p.id, name: p.name, holder, anchor, av: null, fallback: null, x: p.x, z: p.z, tx: p.x, tz: p.z, floor: p.floor ?? 0, yaw: 0, cur: null, anim: null, meta: {}, dead: false, height: 1.75, v: 0 };
    entries.set(p.id, e);
    const ready = (h) => { if (e.dead || dead) return false; e.height = h; anchor.position.y = h + 0.3; tags.set(e.id, { name: e.name, anchor, meta: e.meta }); return true; };
    makeAvatar(p.look ?? null, p.gender === "F" ? "F" : "M").then((av) => { if (!ready(av.height ?? 1.75)) { av.dispose?.(); return; } e.av = av; holder.add(av.root); })
      .catch(() => { // the model would not load: a plain figure stands in, so the name never floats over nothing
        const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.1, 4, 8).translate(0, 0.8, 0), new THREE.MeshStandardMaterial({ color: "#2f62c4" }));
        if (!ready(1.75)) { m.geometry.dispose(); m.material.dispose(); return; } e.fallback = m; holder.add(m); });
    return e;
  }

  /** The latest list of players in this building (from /api/travel?at=). `from` is where you stand, to keep the nearest few. */
  function sync(list, from = { x: 0, z: 0 }) {
    if (dead) return;
    const seenName = new Set(), want = [];
    for (const p of list ?? []) {
      if (!isTaggable(p, self) || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue; // not a player we may name, or no position to draw them at
      const k = p.name.trim().toLowerCase(); if (seenName.has(k)) continue; seenName.add(k); // one avatar per player, whatever the list holds
      want.push(p);
    }
    want.sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z));
    const keep = new Map(want.slice(0, REMOTE_MAX).map((p) => [p.id, p]));
    for (const id of [...entries.keys()]) if (!keep.has(id)) drop(id); // left, went quiet or disconnected: gone now
    for (const [id, p] of keep) {
      const e = entries.get(id) ?? add(p);
      e.tx = p.x; e.tz = p.z; e.floor = p.floor ?? 0; e.anim = p.anim ?? null; e.detained = p.detained === true; e.name = p.name; e.meta = { level: p.level, faculty: p.faculty };
      if (e.av || e.fallback) tags.set(id, { name: p.name, anchor: e.anchor, meta: e.meta });
    }
  }

  /** Every frame: glide each avatar to its latest spot, pick walk / run / idle / the activity pose, and hide the ones on another floor or far away. */
  function update(t, dt, P) {
    if (dead) return;
    for (const e of entries.values()) {
      const dx = e.tx - e.x, dz = e.tz - e.z, d = Math.hypot(dx, dz);
      if (d > SNAP) { e.x = e.tx; e.z = e.tz; e.v = 0; }
      else if (d > 0.02) { const sp = Math.min(SPEED_CAP, d * 1.6), s = Math.min(d, sp * dt); e.x += (dx / d) * s; e.z += (dz / d) * s; e.v = s / Math.max(dt, 1e-3); let dh = Math.atan2(dx, dz) - e.yaw; dh = ((dh + Math.PI * 3) % (Math.PI * 2)) - Math.PI; e.yaw += dh * Math.min(1, dt * 9); }
      else e.v = 0;
      e.holder.position.set(e.x, floorY(e.floor) + 0.02, e.z); e.holder.rotation.y = e.yaw;
      const show = e.floor === P.fl && Math.hypot(e.x - P.x, e.z - P.z) < REMOTE_RANGE && !!(e.av || e.fallback);
      e.holder.visible = show; if (!show || !e.av) continue;
      const av = e.av, moving = e.v > 0.35, clips = e.cue && performance.now() < e.cue.until ? e.cue.clips : e.anim, pose = !moving && clips ? clips.find((n) => av.has?.(n)) : null;
      // A prisoner (only ever flagged by the server) moves and rests like one: pacing, hands on the bars when beside them, a slow look round otherwise.
      let want = moving ? (e.v > RUN_AT ? "run" : "walk") : pose ?? "idle";
      if (e.detained && !pose) { const cell = cellAt(cells, e.x, e.z, -0.4); want = moving ? "detainedPace" : cell && cell.z1 - e.z < 1.1 ? "detainedHold" : "lookAround"; if (!av.has?.(want)) want = moving ? "walk" : "idle"; }
      if (want !== e.cur && av.has?.(want) && av.play(want, { fade: 0.25 })) e.cur = want;
      if (moving) av.setSpeed?.(Math.max(0.6, Math.min(1.6, e.v / 2.2))); else av.setSpeed?.(1);
      // the name stays just above the head, lower when they sit and lower still when they lie down
      const k = /sleep|lie|lay/.test(e.cur ?? "") ? 0.42 : /sit/.test(e.cur ?? "") ? 0.74 : 1; e.anchor.position.y = e.height * k + 0.3;
      av.update(t, dt);
    }
  }

  const byName = (name) => { const k = String(name ?? "").trim().toLowerCase(); for (const e of entries.values()) if (e.name?.trim().toLowerCase() === k) return e; return null; };
  /** Where a player in this room stands: { x, z, floor } or null. (The club effects aim at people with it.) */
  const positionOf = (name) => { const e = byName(name); return e ? { x: e.x, z: e.z, floor: e.floor } : null; };
  /** Make a player play a gesture for `ms` (a club show: spraying money, receiving a bottle). Their real activity pose comes back after. */
  const cue = (name, clips, ms) => { const e = byName(name); if (e) e.cue = { clips, until: performance.now() + ms }; };
  const dispose = () => { dead = true; for (const id of [...entries.keys()]) drop(id); };
  return { sync, update, dispose, positionOf, cue, count: () => entries.size, ids: () => [...entries.keys()] };
}