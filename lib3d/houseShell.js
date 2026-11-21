// lib3d/houseShell.js
// The outside of the player's house, drawn around the very same walls the room already has, so the interior and the exterior are one building:
//  - a foundation (plinth) all round, so no wall hangs above the lawn;
//  - exterior cladding on every wall in the home's own colour, with a real doorway where the front door is (the wall has a gap, the door leaf swings in it);
//  - windows on the outside faces, in the same places as the painted ones inside;
//  - upper storeys (houses and the larger flats and halls) and a roof (gable, hip or flat with a parapet) that appear when the camera looks at the house from outside
//    and melt away indoors, so the room can still be seen into;
//  - a porch roof over the front door and balcony rails where the style has them.
// What gets built depends only on the room (its size, plan and `hostel`) through lib/homeStyle.js, so every accommodation type has its own building.
// World coordinates: the room is centred on the origin, x east, z south, y up; the floor's top is y = 0 and the lawn is at GROUND.
import * as THREE from "three";
import { homeStyle, UPPER_H, EAVE, ridgeRise } from "../lib/homeStyle.js";
import { layoutOf } from "../lib/layouts.js";

export const WALL_T = 0.24, DOOR_W = 0.9, DOOR_H = 2.2, HOLE_W = 1.04;
const GROUND_Y = -0.36;

const wallXOf = (side, at, W, D) => ({ N: at - W / 2, S: W / 2 - at, W: D / 2 - at, E: at - D / 2 })[side];

/** Where the front door is: { side, x } in that wall's own frame (x along the wall), plus the door's centre in room coordinates and which way is out. Pure (tests use it). */
export function entranceOf(room) {
  const W = room.w, D = room.d, L = layoutOf(room);
  if (L) { const x = wallXOf("S", L.entry.at ?? L.entry.x + 0.5, W, D); return { side: "S", x, cx: x * -1, cz: D / 2, outX: 0, outZ: 1 }; } // south wall: local x grows to the west
  const x = -(D - 1) / 2; return { side: "W", x, cx: -W / 2, cz: -x, outX: -1, outZ: 0 }; // west wall: local x grows to the north
}

/** Windows of the walls, in each wall's frame: [{ side, x, w, h, y }] (the same ones the room paints inside). */
export function windowsOf(room) {
  const W = room.w, D = room.d, L = layoutOf(room);
  if (L) return L.windows.map((w) => ({ side: w.side, x: wallXOf(w.side, w.at, W, D), w: w.w, h: w.h, y: w.y ?? 0.95 }));
  return [
    { side: "N", x: W * 0.2, w: 1.3, h: 1.25, y: 0.95 }, { side: "N", x: -W * 0.36, w: 1.3, h: 1.25, y: 0.95 },
    { side: "W", x: D * 0.18, w: 1.1, h: 1.1, y: 1.0 },
    { side: "E", x: -D * 0.1, w: 1.3, h: 1.25, y: 0.95 }, { side: "E", x: -D * 0.35, w: 1.3, h: 1.25, y: 0.95 },
    { side: "S", x: -W * 0.15, w: 1.5, h: 1.2, y: 0.95 }, { side: "S", x: -W * 0.36, w: 1.3, h: 1.2, y: 0.95 },
  ];
}

/**
 * Builds the shell. `wallH` is the ground floor's wall height. Returns { group, update(dt, { mix, near }), dispose, entrance, style } where mix (0..1) is how much of the
 * outside (cladding, windows, upper storey, roof) is shown, and near (0..1) how close the character is to the front door (the leaf opens as it grows).
 */
export function buildHouseShell(room, wallH) {
  const W = room.w, D = room.d, style = homeStyle(room), ent = entranceOf(room);
  const g = new THREE.Group(), fade = [], mats = [], geos = [];
  const M = (color, o = {}, fades = false) => { const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o }); mats.push(m); if (fades) fade.push(m); return m; };
  const box = (w, h, d) => { const geo = new THREE.BoxGeometry(w, h, d); geos.push(geo); return geo; };
  const mesh = (geo, m, parent, x, y, z, shadow = true) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = shadow; o.receiveShadow = true; parent.add(o); return o; };
  const clad = M(style.wall, { roughness: 0.95 }, true), trim = M(style.trim, { roughness: 0.6 }, true), glass = M("#9ec8dc", { roughness: 0.15, metalness: 0.1, emissive: "#6a95ad", emissiveIntensity: 0.25 }, true),
    roofM = M(style.roofColor, { roughness: 0.7, side: THREE.DoubleSide }, true), plinthM = M(style.plinth, { roughness: 1 }), doorM = M("#6b4428", { roughness: 0.6 }), frameM = M(style.trim, { roughness: 0.6 }),
    rail = M("#2b2f3a", { metalness: 0.4, roughness: 0.5 }, true);
  const OW = W + WALL_T * 2, OD = D + WALL_T * 2; // the outer footprint: the north and south walls run past the corners
  const outer = new THREE.Group(); outer.name = "house-exterior"; g.add(outer); // everything that fades with `mix`

  // ---- foundation: a slab under and just beyond the walls, from the lawn up to the floor ----
  mesh(box(OW + 0.22, -GROUND_Y - 0.01, OD + 0.22), plinthM, g, 0, GROUND_Y + (-GROUND_Y - 0.01) / 2, 0, false);

  // ---- walls' frames (same transforms as buildRoom's), the cladding on their outer faces, and the windows ----
  const FR = { N: [0, -D / 2, 0, OW], S: [0, D / 2, Math.PI, OW], W: [-W / 2, 0, Math.PI / 2, D], E: [W / 2, 0, -Math.PI / 2, D] };
  const frame = {};
  for (const [k, [x, z, rot, len]] of Object.entries(FR)) { const f = new THREE.Group(); f.position.set(x, 0, z); f.rotation.y = rot; outer.add(f); frame[k] = { f, len }; }
  const doorFrame = new THREE.Group(); g.add(doorFrame); // the doorway's frame is part of the wall: always shown
  for (const [k, { f, len }] of Object.entries(frame)) {
    const hole = k === ent.side ? [ent.x - HOLE_W / 2, ent.x + HOLE_W / 2] : null;
    const spans = hole ? [[-len / 2, hole[0]], [hole[1], len / 2]].filter(([a, b]) => b - a > 0.02) : [[-len / 2, len / 2]];
    for (const [a, b] of spans) mesh(box(b - a, wallH, 0.04), clad, f, (a + b) / 2, wallH / 2, -WALL_T - 0.02);
    if (hole) mesh(box(HOLE_W, wallH - DOOR_H - 0.12, 0.04), clad, f, ent.x, DOOR_H + 0.12 + (wallH - DOOR_H - 0.12) / 2, -WALL_T - 0.02);
    mesh(box(len + 0.1, 0.12, 0.08), trim, f, 0, wallH - 0.06, -WALL_T - 0.04, false); // the eaves band along the top of every wall
  }
  for (const w of windowsOf(room)) {
    const f = frame[w.side]?.f; if (!f || (w.side === ent.side && Math.abs(w.x - ent.x) < HOLE_W / 2 + w.w / 2 + 0.1)) continue;
    const z = -WALL_T - 0.05;
    mesh(box(w.w, w.h, 0.03), glass, f, w.x, w.y + w.h / 2, z, false);
    for (const [bw, bh, x, y] of [[w.w + 0.16, 0.08, 0, 0], [w.w + 0.16, 0.08, 0, w.h], [0.08, w.h, -w.w / 2 - 0.04, w.h / 2], [0.08, w.h, w.w / 2 + 0.04, w.h / 2], [0.05, w.h, 0, w.h / 2]]) mesh(box(bw, bh, 0.06), trim, f, w.x + x, w.y + y, z - 0.015, false);
    mesh(box(w.w + 0.3, 0.06, 0.18), trim, f, w.x, w.y - 0.03, z - 0.08, false); // the sill
  }

  // ---- the doorway: frame, the leaf on a hinge, and a step (the wall itself has the gap, see lib3d/room.js) ----
  const wf = frame[ent.side].f.clone(false); wf.position.copy(frame[ent.side].f.position); wf.rotation.copy(frame[ent.side].f.rotation); doorFrame.add(wf);
  for (const [bw, bh, x, y] of [[HOLE_W + 0.12, 0.1, 0, DOOR_H + 0.1], [0.08, DOOR_H + 0.1, -HOLE_W / 2 - 0.02, (DOOR_H + 0.1) / 2], [0.08, DOOR_H + 0.1, HOLE_W / 2 + 0.02, (DOOR_H + 0.1) / 2]]) mesh(box(bw, bh, WALL_T + 0.06), frameM, wf, ent.x + x, y, -WALL_T / 2);
  const hinge = new THREE.Group(); hinge.position.set(ent.x - DOOR_W / 2, 0, -WALL_T / 2); wf.add(hinge);
  mesh(box(DOOR_W, DOOR_H, 0.07), doorM, hinge, DOOR_W / 2, DOOR_H / 2, 0);
  for (const y of [0.55, 1.65]) mesh(box(0.6, 0.7, 0.02), doorM, hinge, DOOR_W / 2, y, -0.045, false);
  mesh(new THREE.SphereGeometry(0.05, 10, 8), M("#e8c46a", { metalness: 0.8, roughness: 0.3 }), hinge, DOOR_W - 0.12, 1.05, -0.07, false);
  mesh(box(HOLE_W + 0.5, 0.1, 0.6), M("#bdb9ab", { roughness: 1 }), wf, ent.x, -0.05, -WALL_T - 0.3, false); // the step

  // ---- upper storeys, roof ----
  const top = wallH + style.storeys * UPPER_H;
  for (let s = 0; s < style.storeys; s++) {
    const y0 = wallH + s * UPPER_H;
    mesh(box(OW + 0.04, UPPER_H, OD + 0.04), clad, outer, 0, y0 + UPPER_H / 2, 0);
    mesh(box(OW + 0.14, 0.1, OD + 0.14), trim, outer, 0, y0 + 0.05, 0, false); // a floor band between storeys
    // windows on the south and north faces (and the west and east of a deep house), a row each
    const faces = [["S", OW, OD / 2], ["N", OW, -OD / 2], ["E", OD, OW / 2], ["W", OD, -OW / 2]];
    for (const [side, len, off] of faces) {
      const n = Math.max(1, Math.floor(len / 3.4)), gap = len / n;
      for (let i = 0; i < n; i++) {
        const c = -len / 2 + gap * (i + 0.5), ww = 1.3, wh = 1.3, y = y0 + 0.8;
        const horiz = side === "S" || side === "N", sgn = side === "S" || side === "E" ? 1 : -1;
        const px = horiz ? c : off, pz = horiz ? off : c;
        const gm = mesh(box(horiz ? ww : 0.04, wh, horiz ? 0.04 : ww), glass, outer, px + (horiz ? 0 : sgn * 0.03), y + wh / 2, pz + (horiz ? sgn * 0.03 : 0), false);
        const bar = (bw, bh, dx, dy) => mesh(box(horiz ? bw : 0.07, bh, horiz ? 0.07 : bw), trim, outer, gm.position.x + (horiz ? dx : sgn * 0.01), gm.position.y + dy, gm.position.z + (horiz ? sgn * 0.01 : dx), false);
        bar(ww + 0.16, 0.08, 0, wh / 2 + 0.04); bar(ww + 0.16, 0.08, 0, -wh / 2 - 0.04); bar(0.08, wh, -ww / 2 - 0.04, 0); bar(0.08, wh, ww / 2 + 0.04, 0); bar(0.05, wh, 0, 0); // an open frame round the glass
        mesh(box(horiz ? ww + 0.4 : 0.2, 0.06, horiz ? 0.2 : ww + 0.4), trim, outer, gm.position.x + (horiz ? 0 : sgn * 0.08), y - 0.03, gm.position.z + (horiz ? sgn * 0.08 : 0), false);
      }
    }
  }
  if (style.balcony && style.storeys >= 1) { // a balcony across the front of the first upper storey
    const by = wallH + 0.02, bw = Math.min(OW - 1.2, 5.5);
    mesh(box(bw, 0.12, 1.1), trim, outer, ent.side === "S" ? ent.cx : 0, by, OD / 2 + 0.5);
    for (let i = 0; i <= 8; i++) mesh(box(0.05, 0.95, 0.05), rail, outer, (ent.side === "S" ? ent.cx : 0) - bw / 2 + 0.1 + (i * (bw - 0.2)) / 8, by + 0.55, OD / 2 + 1.02, false);
    mesh(box(bw, 0.06, 0.06), rail, outer, ent.side === "S" ? ent.cx : 0, by + 1.03, OD / 2 + 1.02, false);
  }
  const rw = OW + EAVE * 2, rd = OD + EAVE * 2, roof = new THREE.Group(); roof.position.y = top; outer.add(roof);
  if (style.roof === "flat") {
    mesh(box(OW + 0.2, 0.3, OD + 0.2), roofM, roof, 0, 0.15, 0);
    for (const [bw, bd, x, z] of [[OW + 0.3, 0.16, 0, OD / 2 + 0.1], [OW + 0.3, 0.16, 0, -OD / 2 - 0.1], [0.16, OD + 0.3, OW / 2 + 0.1, 0], [0.16, OD + 0.3, -OW / 2 - 0.1, 0]]) mesh(box(bw, 0.55, bd), trim, roof, x, 0.28, z);
    mesh(box(1.1, 0.7, 1.1), clad, roof, -OW / 2 + 1.6, 0.65, -OD / 2 + 1.6); // a stair/water-tank housing: flats and halls are not bare slabs
  } else {
    const rise = ridgeRise(Math.min(rw, rd), style.roof);
    if (style.roof === "hip") {
      const geo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1, true); geo.rotateY(Math.PI / 4); geos.push(geo); // a four-sided pyramid whose base is a unit square
      const p = mesh(geo, roofM, roof, 0, rise / 2, 0); p.scale.set(rw, rise, rd);
      mesh(box(rw - 0.05, 0.1, rd - 0.05), trim, roof, 0, 0.05, 0, false); // the fascia
    } else { // gable: the ridge runs along the longer side
      const alongX = rw >= rd, span = alongX ? rd : rw, len = alongX ? rw : rd, sh = new THREE.Shape();
      sh.moveTo(-span / 2, 0); sh.lineTo(span / 2, 0); sh.lineTo(0, rise); sh.closePath();
      const geo = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false }); geo.translate(0, 0, -len / 2); if (alongX) geo.rotateY(Math.PI / 2); geos.push(geo);
      const p = mesh(geo, roofM, roof, 0, 0, 0); p.castShadow = true;
      mesh(box(alongX ? len + 0.1 : 0.16, 0.12, alongX ? 0.16 : len + 0.1), trim, roof, 0, rise, 0, false); // the ridge cap
    }
    mesh(box(rw, 0.1, rd), trim, roof, 0, 0.0, 0, false); // the soffit
  }
  roof.traverse((o) => { o.receiveShadow = false; }); // a roof lit by its own shadow map shows moire stripes, and nothing shades it anyway
  // porch: a small roof over the front door, held by two posts
  if (style.porch) {
    const f = frame[ent.side].f, pw = HOLE_W + 1.3, pd = 1.1, y = DOOR_H + 0.55;
    mesh(box(pw, 0.14, pd), roofM, f, ent.x, y, -WALL_T - pd / 2);
    for (const s of [-1, 1]) mesh(box(0.1, y, 0.1), trim, f, ent.x + s * (pw / 2 - 0.1), y / 2, -WALL_T - pd + 0.12);
  }

  let mixNow = -1, openNow = 0;
  const hingeMax = 1.75;
  function update(dt, { mix = 0, near = 0 } = {}) {
    if (Math.abs(mix - mixNow) > 0.002) {
      mixNow = mix; outer.visible = mix > 0.01;
      const solid = mix > 0.995;
      for (const m of fade) { m.transparent = !solid; m.opacity = solid ? 1 : Math.max(0, mix); m.depthWrite = solid || mix > 0.6; }
    }
    openNow += (near - openNow) * (1 - Math.exp(-dt * 6));
    hinge.rotation.y = hingeMax * Math.min(1, Math.max(0, openNow));
  }
  const dispose = () => { for (const m of mats) m.dispose(); for (const gg of geos) gg.dispose(); };
  return { group: g, update, dispose, entrance: ent, style };
}
