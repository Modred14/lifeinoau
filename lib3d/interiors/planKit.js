// lib3d/interiors/planKit.js
// The tools plans are made with: a plan builder (rooms, doors, stairs, items, people), a "frame" that places things in a room relative to its back
// wall, a corridor-block generator, and the room fillers (bedroom, lecture room, lab, office, bathroom ...). Pure data out, no 3D library.
//
// A room frame has u across the back wall (left to right as you face the back wall) and v from the back wall towards the door wall.
// Rooms made by corridorBlock always have their door in the middle of the FRONT wall, so every filler keeps a clear strip there.

import { dimsOf } from "./items.js";

const PI = Math.PI;
export const rng = (seed) => { let a = seed >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

export class Plan {
  constructor(id, title, o = {}) { this.id = id; this.title = title; this.floors = o.floors ?? 1; this.floorH = o.floorH ?? 3.4; this.style = o.style ?? {}; this.rooms = []; this.doors = []; this.items = []; this.stairs = []; this.npcs = []; this.hubs = []; this.entrance = null; this.byId = new Map(); }
  room(id, name, x0, z0, x1, z1, o = {}) { const r = { id, name, floor: 0, kind: "room", surface: "tile", ...o, x0, z0, x1, z1 }; if (this.byId.has(id)) throw new Error("duplicate room " + id); this.rooms.push(r); this.byId.set(id, r); return r; }
  /** A doorway between two rooms that share a wall. `at` is where along the wall (default: the middle of the shared stretch). */
  door(a, b, o = {}) {
    const A = this.byId.get(a), B = this.byId.get(b); if (!A || !B) throw new Error(`door: unknown room ${a} / ${b}`); if (A.floor !== B.floor) throw new Error("door between floors");
    const w = o.w ?? 1.2, t = 0.02; let axis, coord, lo, hi;
    if (Math.abs(A.x1 - B.x0) < t) { axis = "z"; coord = A.x1; lo = Math.max(A.z0, B.z0); hi = Math.min(A.z1, B.z1); }
    else if (Math.abs(A.x0 - B.x1) < t) { axis = "z"; coord = A.x0; lo = Math.max(A.z0, B.z0); hi = Math.min(A.z1, B.z1); }
    else if (Math.abs(A.z1 - B.z0) < t) { axis = "x"; coord = A.z1; lo = Math.max(A.x0, B.x0); hi = Math.min(A.x1, B.x1); }
    else if (Math.abs(A.z0 - B.z1) < t) { axis = "x"; coord = A.z0; lo = Math.max(A.x0, B.x0); hi = Math.min(A.x1, B.x1); }
    else throw new Error(`door: rooms ${a} and ${b} do not share a wall`);
    if (hi - lo < w + 0.2) throw new Error(`door: shared wall of ${a}/${b} is too short (${(hi - lo).toFixed(2)} m) for a ${w} m door`);
    const pos = Math.min(hi - w / 2 - 0.1, Math.max(lo + w / 2 + 0.1, o.at ?? (lo + hi) / 2)); this.doors.push({ a, b, axis, coord, pos, w, floor: A.floor }); return this;
  }
  enter(room, side, pos, w = 2.0) { this.entrance = { room, side, pos, w }; return this; }
  item(type, x, z, ry = 0, o = {}) { dimsOf({ type, ...o }); this.items.push({ type, x, z, ry, ...o }); return this; }
  npc(role, o = {}) { this.npcs.push({ role, mode: "wander", ...o }); return this; }
  hub(x, z, label, action = 0, floor = 0) { this.hubs.push({ x, z, label, action, floor }); return this; }
  frame(room, back = "n") { return frame(this, typeof room === "string" ? this.byId.get(room) : room, back); }
  /** A straight stair in its own narrow room. `low` is the end the ground-floor door is at ("n" or "s"). Returns { ground, upper } room ids. */
  stairwell(id, x, z0, z1, low = "n", o = {}) {
    const g = this.room(id, "Stairs", x, z0, x + 2.0, z1, { kind: "stair", surface: "concrete", floor: 0 }), u = this.room(id + "_up", "Stairs", x, z0, x + 2.0, z1, { kind: "stair", surface: "concrete", floor: 1 });
    this.stairs.push({ id, x0: x, x1: x + 2.0, z0, z1, dir: low === "n" ? "+z" : "-z", low });
    return { ground: g, upper: u, ...o };
  }
}

export function frame(p, room, back = "n") {
  const horiz = back === "n" || back === "s", W = horiz ? room.x1 - room.x0 : room.z1 - room.z0, D = horiz ? room.z1 - room.z0 : room.x1 - room.x0;
  const to = (u, v) => (back === "n" ? [room.x0 + u, room.z0 + v] : back === "s" ? [room.x0 + u, room.z1 - v] : back === "e" ? [room.x1 - v, room.z1 - u] : [room.x0 + v, room.z0 + u]);
  const ry0 = { n: 0, s: PI, e: -PI / 2, w: PI / 2 }[back];
  const F = {
    W, D, room, back, ry0, to,
    add(type, u, v, o = {}) { const [x, z] = to(u, v), { turn = 0, ...rest } = o; p.item(type, x, z, ry0 + turn, { floor: room.floor, ...rest }); return F; },
    /** Against the back wall (its back touches it). */
    wall(type, u, o = {}) { const d = dimsOf({ type, ...o }).d; return F.add(type, u, d / 2 + 0.04, o); },
    /** Against the front wall, facing into the room. */
    front(type, u, o = {}) { const d = dimsOf({ type, ...o }).d; return F.add(type, u, D - d / 2 - 0.04, { turn: PI, ...o }); },
    /** n copies from u0 to u1 (inclusive centres). */
    row(type, u0, u1, v, n, o = {}) { for (let i = 0; i < n; i++) F.add(type, n === 1 ? (u0 + u1) / 2 : u0 + ((u1 - u0) * i) / (n - 1), v, { ...o, n: i }); return F; },
    /** Someone standing (or sitting) at (u, v). `face`: "front" looks at the door wall, "back" at the back wall, or an angle. */
    person(role, u, v, o = {}) { const [x, z] = to(u, v), face = o.face ?? "front", yaw = typeof face === "number" ? face : face === "front" ? ry0 : ry0 + PI; p.npc(role, { room: room.id, floor: room.floor, x, z, yaw, mode: o.mode ?? "stand", ...(o.pool ? { pool: o.pool } : {}) }); return F; },
    hub(u, v, label, action = 0) { const [x, z] = to(u, v); p.hub(x, z, label, action, room.floor); return F; },
  };
  return F;
}

// ------------------------------------------------------------------------------------------------ corridor block

/**
 * A corridor with a row of rooms on each side. specs: { id, name, w, kind, surface, wall, h, fill(F, room), wide, stair, upDoorTo }.
 * North-row rooms have their door on their south wall, south-row rooms on their north wall; both fill with a frame whose back wall is the far wall.
 * Returns { corridor, north: [rooms], south: [rooms], W }.
 */
export function corridorBlock(p, o) {
  const { x0, z0, floor = 0, cw = 2.4, nD = 5, sD = 5, key = "", surface = "tile" } = o, north = o.north ?? [], south = o.south ?? [];
  const sum = (a) => a.reduce((t, s) => t + (s.w ?? 2.0), 0);
  let W = Math.max(sum(north), sum(south)); if (!(W > 0)) throw new Error("empty corridor block");
  const zc = z0 + nD, zs = zc + cw, E = o.extra ?? ((row, gap) => ({ id: `${key}${row}_spare`, name: "Store", w: gap, fill: fillStore }));
  const pad = (row, list) => { const gap = W - sum(list); if (gap > 0.05) { if (gap >= 1.8) list = [...list, E(row, gap)]; else list = list.map((s, i) => (i === list.length - 1 ? { ...s, w: s.w + gap } : s)); } return list; };
  const N = pad("n", north), S = pad("s", south), corridor = p.room(`${key}corr`, o.corridorName ?? "Corridor", x0, zc, x0 + W, zs, { floor, kind: "corridor", surface: o.corridorSurface ?? surface, color: o.corridorColor, wall: o.corridorWall, lights: true });
  const out = { corridor, north: [], south: [], W };
  const lay = (list, row) => { let x = x0; for (const s of list) {
    const isN = row === "n", ra = isN ? [z0, zc] : [zs, zs + sD], id = s.id ?? `${key}${row}${out[isN ? "north" : "south"].length}`, kind = s.stair ? "stair" : (s.kind ?? "room");
    let r;
    if (s.stair) { const sid = s.id ?? "stair"; if (floor === 0) r = p.stairwell(sid, x, ra[0], ra[1], isN ? "s" : "n").ground; else { r = p.byId.get(sid + "_up"); if (!r || Math.abs(r.x0 - x) > 0.01 || Math.abs(r.z0 - ra[0]) > 0.01) throw new Error("stair must sit in the same place on every floor"); } r.name = "Stairs"; }
    else r = p.room(id, s.name ?? "Room", x, ra[0], x + s.w, ra[1], { floor, kind, surface: s.surface ?? surface, wall: s.wall, color: s.color, h: s.h, lights: s.lights, ceil: s.ceil, name2: s.name });
    // the door to the corridor
    if (s.stair) { if (floor === 0) p.door(r.id, corridor.id, { w: 1.4, at: x + 1.0 }); }
    else p.door(r.id, corridor.id, { w: s.wide ? 1.8 : 1.2, at: x + s.w / 2 });
    r.spec = s; out[isN ? "north" : "south"].push(r); x += s.w;
  } };
  lay(N, "n"); lay(S, "s");
  // upper-floor stair arrival: a door from the stairwell's far end into the room beside it
  for (const row of [out.north, out.south]) row.forEach((r, i) => { if (r.kind === "stair" && floor > 0) { const nb = row[i + 1] ?? row[i - 1]; const isN = row === out.north, endZ = isN ? r.z0 + 1.2 : r.z1 - 1.2; p.door(r.id, nb.id, { w: 1.3, at: endZ }); } });
  // fill the rooms (after all walls and doors exist)
  for (const [list, back] of [[out.north, "n"], [out.south, "s"]]) for (const r of list) { if (r.kind === "stair") continue; const fill = r.spec.fill; if (fill) fill(frame(p, r, back), r, p); }
  return out;
}

// ------------------------------------------------------------------------------------------------ fillers (each gets a frame; door = front centre)

const SHEETS = ["#3b6fc4", "#b8473b", "#3f8f55", "#7a4aa0", "#d9a441", "#2f7a8a"];
const keepWide = (F) => F.W > 3.3;

export function fillBedroom(beds = 2, o = {}) {
  return (F, room) => { const { W, D } = F, c = o.sheets ?? SHEETS, k = (room.id.length + (room.x0 | 0)) % c.length, col = (i) => c[(k + i) % c.length];
    if (o.premium) { F.add("bed", 0.6, 1.08, { color: col(0) }); F.wall("wardrobe", W / 2 - 0.5, { color: "#b08a60" }); F.add("desk", W - 0.7, 0.6 + 0.0 + 0.0, { w: 1.1 }); F.add("sofa", W - 1.1, 2.7, { w: 1.7, d: 0.85, turn: -PI / 2, color: "#7a8f9a" }); F.add("tv", W - 0.1, 2.7, { turn: -PI / 2, w: 1.1 });
      F.add("toilet", W - 0.55, D - 0.5, { turn: PI }); F.add("sinks", W - 1.6, D - 0.4, { w: 0.9, turn: PI }); F.add("rug", W / 2, 2.9, { w: 1.8, d: 1.2, color: "#b09a7a" }); return; }
    if (beds === 1) { F.add("bed", 0.6, 1.08, { color: col(0) }); F.wall("wardrobe", W / 2 + 0.2, { color: "#b08a60" }); F.add("desk", W - 0.65, 0.6, { w: 1.1 }); if (o.study) F.add("bookshelf", W - 0.2, 2.6, { w: 1.0, turn: -PI / 2 }); return; }
    if (beds === 2) { F.add("bed", 0.6, 1.08, { color: col(0) }); F.add("bed", W - 0.6, 1.08, { color: col(1) }); F.wall("wardrobe", W / 2, { color: "#b08a60" }); F.add("desk", 0.6, 3.0, { w: 1.1 }); F.add("desk", W - 0.6, 3.0, { w: 1.1, color: "#2f7a8a" }); return; }
    if (beds === 3) { F.add("bunk", 0.6, 1.08, { color: col(0) }); F.add("bed", W - 0.6, 1.08, { color: col(1) }); F.wall("wardrobe", W / 2, { color: "#b08a60" }); F.add("desk", 0.6, 3.0, { w: 1.1 }); F.add("desk", W - 0.6, 3.0, { w: 1.1, color: "#2f7a8a" }); return; }
    F.add("bunk", 0.6, 1.08, { color: col(0) }); F.add("bunk", W - 0.6, 1.08, { color: col(1) }); F.wall("wardrobe", W / 2, { color: "#b08a60" }); F.add("desk", 0.6, 3.0, { w: 1.1 }); F.add("desk", W - 0.6, 3.0, { w: 1.1, color: "#2f7a8a" }); }; }

export function fillWc(sex = "M") {
  return (F, room, p) => { const { W, D } = F, n = Math.max(2, Math.min(4, Math.floor((W - 1.4) / 0.95))); F.add("stalls", W / 2, 0.85, { w: n * 0.95, d: 1.6, n });
    const west = frame(p, room, "w"), east = frame(p, room, "e"); west.wall("sinks", 3.0, { w: 1.8 }); east.wall("showers", D - 3.1, { w: 1.8, n: 2, d: 1.2 });
    F.person("student", W / 2 + 1.0, 2.6, { face: "back" }); }; }

export function fillLobby(o = {}) {
  return (F, room, p) => { const { W, D } = F, rw = Math.max(1.6, Math.min(3.2, W / 2 - 1.3)), cw = Math.max(1.2, Math.min(2.2, W / 2 - 1.3));
    F.add("reception", rw / 2 + 0.2, 1.15, { w: rw, sign: o.sign ?? "Reception", color: o.color, top: o.top }); F.hub(rw / 2 + 0.2, 2.15, o.hubLabel ?? "Ask at the desk", o.action ?? 0);
    F.wall("notice", W - 1.1, { label: o.notice ?? "Notices" }); F.front("waitchairs", cw / 2 + 0.2, { w: cw, color: o.chairs ?? "#3b6fc4" }); if (W > 6) F.front("waitchairs", W - cw / 2 - 0.2, { w: cw, color: o.chairs ?? "#3b6fc4" });
    F.add("plant", W - 0.45, 1.9); if (o.sofas && W > 6) F.add("sofa", W - 1.0, D / 2 + 0.3, { w: 1.6, turn: -PI / 2, color: "#7a8f9a" });
    F.person(o.staff ?? "clerk", rw / 2 + 0.2, 0.55, { face: "front" }); }; }

export function fillOffice(o = {}) {
  return (F, room) => { const { W, D } = F; F.add("officedesk", W / 2, 1.5, { color: o.color }); F.wall("bookshelf", 0.8, { w: 1.1 }); F.wall("filing", W - 0.5); if (W > 4.6) F.wall("bookshelf", W - 1.7, { w: 1.1 }); F.front("plant", 0.45);
    if (o.sign) F.add("sign", W / 2, 0.05, { label: o.sign, y: 2.0, w: 1.4 }); if (o.person !== false) F.person(o.person ?? "staff", W / 2, 0.8, { face: "front", mode: "sit" }); }; }

export function fillSharedOffice(o = {}) {
  return (F, room) => { const { W, D } = F, n = W > 6 ? Math.max(2, Math.floor((W - 2.3) / 1.9) + 1) : 2, a = 0.8, b = W - 1.9; for (let i = 0; i < n; i++) F.add("desk", n === 1 ? a : a + ((b - a) * i) / (n - 1), 0.75, { pc: true, w: 1.2 }); F.wall("filing", W - 0.4); F.front("plant", 0.5); F.front("water", W - 0.5); F.person("staff", W / 2, 2.4, { face: "back", mode: "sit" }); }; }

/** A landing: furniture stays off the walls beside the stairwell so the stair door at the side stays clear. */
export function fillLanding(o = {}) {
  return (F, room) => { const { W, D } = F; F.add("tv", W / 2 + 0.4, 0.05, { w: 1.2 }); F.add("sofa", W / 2 + 0.4, Math.min(3.2, D - 2.7), { w: Math.max(1.4, Math.min(1.9, W - 2.6)), turn: PI, color: o.color ?? "#7a8f9a" }); F.add("loungeTable", W / 2 + 0.4, Math.min(3.2, D - 2.7) - 1.4, {}); F.front("plant", W - 0.5); F.person("student", W / 2 + 0.4, Math.min(3.2, D - 2.7), { face: "back", mode: "sit" }); }; }

/** n rows of student desks facing the board on the back wall. */
export function fillLecture(o = {}) {
  return (F, room) => { const { W, D } = F, kids = !!o.small, dw = kids ? 0.75 : 0.85, top = 2.3, aisle = 1.5, side = Math.max(1, Math.floor((W - aisle - 0.8) / 2 / dw)), rows = Math.max(1, Math.floor((D - 1.9 - top) / 0.95) + 1);
    F.wall(o.board === "black" ? "blackboard" : "whiteboard", W / 2, { w: Math.min(3.6, W - 1.2), label: o.label }); F.add("podium", W / 2 - 1.6, 1.1); F.add("table", W / 2 + 1.4, 1.1, { w: 1.5, d: 0.7 }); if (o.screen !== false) F.wall("screen", W - 1.4, { w: 1.6 });
    const x0 = (W - aisle) / 2 - side * dw, x1 = (W + aisle) / 2;
    for (let r = 0; r < rows; r++) for (let c = 0; c < side; c++) for (const sx of [x0 + dw * (c + 0.5), x1 + dw * (c + 0.5)]) F.add("studentdesk", sx, top + r * 0.95 + 0.4, { w: dw, small: kids, color: kids ? "#d9a441" : o.chairColor ?? "#3b6fc4" });
    F.person(o.teacher ?? "lecturer", W / 2 + 0.2, 0.95, { face: "front" }); for (let k = 0; k < (o.students ?? 3); k++) F.person("student", x0 + dw * (k % side + 0.5), top + (k >> 1) * 0.95 + 0.7, { face: "back", mode: "sit" }); }; }

export function fillSeminar(o = {}) {
  return (F, room) => { const { W, D } = F; F.add("meetingtable", W / 2, D / 2 + 0.2, { w: Math.min(W - 1.4, 4.2), d: 1.5, chairs: o.chairs ?? 8, color: o.color }); F.wall("screen", W / 2, { w: 2.0, label: o.label }); F.wall("whiteboard", 1.2, { w: 1.4 }); F.front("plant", W - 0.5); F.person("lecturer", W / 2 - 1.2, D / 2 + 0.2, { face: "back", mode: "sit" }); F.person("student", W / 2 + 0.6, D / 2 - 0.9 + 0.2 + 0.0, { face: "front", mode: "sit" }); }; }

export function fillLab(kind = "chem", o = {}) {
  return (F, room) => { const { W, D } = F, per = W > 8.5 ? 2 : 1, bw = Math.min(3.2, (W - 2.4 - (per - 1) * 1.4) / per), rows = D > 6.4 ? 2 : 1;
    F.wall("fumehood", 1.0); if (W > 6) F.wall("fumehood", W - 1.0); F.wall("whiteboard", W / 2, { w: 2.2, label: o.label ?? { chem: "Chemistry practical", bio: "Biology practical", phys: "Physics practical", pharm: "Pharmaceutics", soil: "Soil analysis" }[kind] });
    for (let r = 0; r < rows; r++) for (let c = 0; c < per; c++) F.add("labbench", (W / per) * (c + 0.5), 2.5 + r * 2.1, { w: bw, v: kind });
    if (o.skeleton) F.add("skeleton", W - 0.5, D - 1.0); F.front("sinks", 1.2, { w: 1.4 }); F.person("technician", W / 2, 1.2, { face: "front" }); F.person("student", (W / per) * 0.5, 3.1, { face: "back" }); }; }

export function fillComputerLab(o = {}) {
  return (F, room) => { const { W, D } = F, per = W > 7.5 ? 2 : 1, rw = Math.min(3.4, (W - 1.8 - (per - 1) * 1.4) / per), rows = Math.max(1, Math.floor((D - 2.9) / 1.5));
    F.wall("screen", W / 2, { w: 2.6, label: o.label }); F.add("podium", W - 1.0, 1.0);
    for (let r = 0; r < rows; r++) for (let c = 0; c < per; c++) F.add("pcrow", (W / per) * (c + 0.5), 2.4 + r * 1.5, { w: rw });
    F.person("lecturer", W / 2 - 1.2, 1.1, { face: "front" }); F.person("student", (W / per) * 0.5, 2.9, { face: "back", mode: "sit" }); }; }

export function fillWorkshop(o = {}) {
  return (F, room) => { const { W, D } = F; const n = Math.max(2, Math.floor((W - 1.6) / 2.4)); F.row("machine", 1.4, W - 1.4, 0.65 + 0.2, n, { color: o.color }); F.add("workbench", W / 2, D / 2 + 0.3, { w: Math.min(3.6, W - 3) }); F.front("shelves", 1.2, { w: 1.6 }); F.front("shelves", W - 1.2, { w: 1.6 }); F.person("technician", W / 2, D / 2 - 0.5, { face: "front" }); }; }

export function fillStudio(o = {}) {
  return (F, room) => { const { W, D } = F, per = Math.max(2, Math.floor((W - 1.2) / 2.0)), rows = Math.max(1, Math.floor((D - 4.4) / 1.8) + 1); F.wall("notice", W / 2, { w: Math.min(4, W - 2), label: o.label ?? "Pin-up" });
    for (let r = 0; r < rows; r++) F.row("drafting", 1.2, W - 1.2, 2.4 + r * 1.8, per, {}); if (o.models) { F.add("table", 1.6, 0.65, { w: 2.2, d: 0.9 }); F.wall("shelves", W - 1.3, { w: 1.6 }); } F.person("student", W / 2, 3.0, { face: "back" }); F.person("lecturer", 1.8, 1.6, { face: "front" }); }; }

export function fillCommon(o = {}) {
  return (F, room) => { const { W, D } = F, vs = Math.min(3.4, D - 2.7), vt = vs - 1.5; F.add("tv", W / 2, 0.05, { w: 1.4 }); F.add("sofa", W / 2, vs, { w: Math.min(2.0, W - 1.8), turn: PI, color: o.color ?? "#7a8f9a" }); F.add("loungeTable", W / 2, vt, {}); F.add("armchair", 0.7, vt, { turn: PI / 2, color: "#b8473b" }); F.add("armchair", W - 0.7, vt, { turn: -PI / 2, color: "#b8473b" }); F.front("plant", W - 0.5);
    if (W > 7) F.add("table", 1.6, D - 1.2, { w: 1.8, d: 1.8, chairs: 4 }); F.person("student", W / 2 - 0.5, vs, { face: "back", mode: "sit" }); }; }

export function fillStudy(o = {}) {
  return (F, room) => { const { W, D } = F, n = Math.max(1, Math.floor((W - 1.4) / 2.6)); for (let r = 0; r < Math.max(1, Math.floor((D - 3.2) / 2.5) + 0); r++) F.row("table", 1.5, W - 1.5, 1.8 + r * 2.5, n, { w: 2.4, d: 2.0, chairs: 4, color: "#b98a58" }); F.wall("bookshelf", 1.0, { w: 1.4 }); F.wall("bookshelf", W - 1.0, { w: 1.4 }); F.front("plant", W - 0.5); F.person("student", 1.3, 1.7, { face: "front", mode: "sit" }); }; }

export function fillKitchen() {
  return (F) => { const { W } = F; F.wall("kitchenette", W / 2 - 0.4, { w: 2.6 }); F.wall("fridge", W - 0.6); F.add("table", W / 2, 2.8, { w: 2.0, d: 1.6, chairs: 4 }); F.person("student", W / 2, 0.9, { face: "front" }); }; }

export function fillStore() {
  return (F) => { const { W, D } = F; F.wall("shelves", 0.9, { w: 1.4 }); if (W > 3) F.wall("shelves", W - 0.9, { w: 1.4 }); F.add("cartons", W / 2, 1.2, {}); }; }

export function fillPorter(o = {}) {
  return (F) => { const { W } = F; F.add("counter", W / 2, 1.6, { w: Math.min(W - 1.4, 2.4), sign: o.sign ?? "Porter", color: "#6b4226" }); F.wall("filing", 0.5); F.wall("filing", W - 0.5); F.person("guard", W / 2, 0.7, { face: "front", mode: "sit" }); }; }

export function fillLaundry() { return (F) => { const { W } = F; F.wall("locker", W / 2, { w: Math.min(3, W - 1) }); F.add("table", W / 2, 2.6, { w: 2.0, d: 1.0 }); }; }

// ----- clinic rooms
export function fillConsult(o = {}) {
  return (F) => { const { W, D } = F; F.add("officedesk", W / 2 - 0.2, 1.4, { color: "#d6d9dc" }); F.wall("medcab", 0.8); F.add("examBed", W - 1.05, 3.2, { turn: -PI / 2 }); F.add("curtain", W - 1.5, 4.2, { w: 1.6, hh: 2.2, color: "#8fb8c8", turn: 0 }); F.front("sinks", 0.9, { w: 1.0 }); F.person(o.doctor ?? "doctor", W / 2 - 0.2, 0.9, { face: "front", mode: "sit" }); }; }
export function fillWard(n = 4) {
  return (F) => { const { W, D } = F, k = Math.max(2, Math.min(n, Math.floor((W - 0.4) / 1.9))); F.row("hospitalBed", 1.0, W - 1.0, 1.2, k, {}); F.add("trolley", W / 2, D - 2.4, {}); F.person("nurse", W / 2, D - 3.0, { face: "back" }); }; }
export function fillPharmacy() {
  return (F) => { const { W } = F; F.wall("medcab", 1.0); F.wall("medcab", 2.2); if (W > 5) F.wall("medcab", W - 1.0); F.add("counter", W / 2, 2.2, { w: W - 2, sign: "Dispensary", top: "#cfd8dc", color: "#3b6fc4" }); F.person("pharmacist", W / 2, 1.2, { face: "front" }); }; }
export function fillClinicLab() { return (F) => { const { W } = F; F.add("labbench", W / 2, 1.5, { w: Math.min(3, W - 1.2), v: "bio" }); F.wall("fumehood", 1.0); F.wall("medcab", W - 1.0); F.person("technician", W / 2, 2.2, { face: "back" }); }; }
export function fillTriage() { return (F) => { const { W } = F; F.add("officedesk", W / 2 - 0.5, 1.4, { color: "#d6d9dc" }); F.add("examBed", W - 1.05, 3.2, { turn: -PI / 2 }); F.wall("medcab", 0.8); F.person("nurse", W / 2 - 0.5, 0.9, { face: "front", mode: "sit" }); }; }