// lib3d/interiors/plans2.js
// Plan generators for everything that is not a hall of residence, faculty, theatre, Senate, library or Student Union (those are in plans.js):
// the health centre, the three clubs, churches and the mosque, banks, shops and the market, the museum, the staff school, Floor O,
// the squash court, multipurpose halls, administration offices and plain unnamed buildings.
// Every layout is a game design for what the place is for, not a survey of the real building.

import { Plan, corridorBlock, frame, rng, fillWc, fillLobby, fillOffice, fillSharedOffice, fillLecture, fillSeminar, fillComputerLab, fillWorkshop, fillCommon, fillLanding, fillStudy, fillKitchen, fillStore, fillPorter, fillConsult, fillWard, fillPharmacy, fillClinicLab, fillTriage } from "./planKit.js";
import { crowd, ROOM, fillServer, fillCounsel } from "./plans.js";

const PI = Math.PI;

// ------------------------------------------------------------------------------------------------ Health Centre

export function clinic(spec, place) {
  const p = new Plan(spec.id, place.name, { floors: 1, style: { wall: "#eef3f4", facade: "#d7e0e2", ceil: "#f7f9f9" } });
  const records = (F) => { const { W } = F; F.wall("filing", 0.6); F.wall("filing", 1.4); F.wall("filing", W - 0.6); F.add("officedesk", W / 2, 2.6, { color: "#d6d9dc" }); F.person("staff", W / 2, 1.7, { face: "front", mode: "sit" }); };
  corridorBlock(p, { x0: 0, z0: 0, floor: 0, key: "g", nD: 5.4, sD: 6.4, cw: 2.8, north: [
    { id: "consult1", name: "Consulting room 1", w: 4.4, fill: fillConsult({ doctor: "doctor" }) }, { id: "consult2", name: "Consulting room 2", w: 4.4, fill: fillConsult({ doctor: "doctor" }) },
    { id: "lab", name: "Laboratory", w: 4.8, fill: fillClinicLab() }, { id: "dispensary", name: "Pharmacy", w: 5.0, fill: fillPharmacy() }, { id: "ward", name: "Observation ward", w: 8.4, fill: fillWard(4), wall: "#e4eef0" }],
  south: [{ id: "records", name: "Records", w: 3.6, fill: records, surface: "carpet" }, { id: "triage", name: "Triage and treatment room", w: 4.4, fill: fillTriage() }, { id: "lobby", name: "Reception and waiting area", w: 8.4, fill: fillLobby({ sign: "Reception", notice: "Health notices", hubLabel: "Reception", action: 0, staff: "nurse", chairs: "#2f8f8a", sofas: true }), surface: "marble", wide: true },
    { id: "doctors", name: "Doctors' office", w: 4.4, fill: fillOffice({ sign: "Doctors", person: "doctor" }), surface: "carpet" }, { id: "staffroom", name: "Staff room", w: 5.8, fill: fillCommon({ color: "#2f8f8a" }), surface: "carpet" }] });
  const lobby = p.byId.get("lobby"); p.enter("lobby", "s", (lobby.x0 + lobby.x1) / 2, 2.2);
  const fl = frame(p, lobby, "s"); void fl; for (let k = 0; k < 4; k++) p.npc("patient", { room: "lobby", floor: 0, mode: "sit", x: lobby.x0 + 1.6 + k * 1.5, z: lobby.z1 - 0.9 - 0.05, yaw: PI });
  crowd(p, "nurse", 2, ["gcorr", "ward", "triage"], 0); crowd(p, "patient", 2, ["gcorr", "lobby"], 0); return p;
}

// ------------------------------------------------------------------------------------------------ nightlife

/** The labels of the two club rings (lib/hubActions.js maps them to the DJ screen and the club menu). One spelling, used by every club. */
export const DJ_RING = "DJ booth: the music", MENU_RING = "Bottle service: VIP menu";
const clubStyle = (wall, glow) => ({ dark: true, noWindows: true, wall, facade: "#2c3340", ceil: "#0c0a12", glow });

export function club(spec, place) {
  return { quantum, "0203": club0203, divas }[spec.v](spec, place);
}

function quantum(spec, place) {
  const W = 30, p = new Plan(spec.id, place.name, { floors: 1, style: clubStyle("#171526", "#38e8ff") }), g = "#38e8ff";
  const hall = p.room("hall", "Main dance floor", 0, 0, W, 17, { kind: "hall", surface: "dark", h: 6.5, wall: "#171526", ceil: "#0b0912" });
  p.room("wcf", "Ladies' toilets", 0, 17, 11, 22.5, { surface: "tile", wall: "#262338" }); const ves = p.room("lobby", "Entrance and box office", 11, 17, 19, 22.5, { kind: "lobby", surface: "dark", wall: "#1d1a30" }); p.room("wcm", "Gents' toilets", 19, 17, W, 22.5, { surface: "tile", wall: "#262338" });
  p.door("hall", "wcf", { at: 5.5, w: 1.4 }); p.door("hall", "lobby", { at: 15, w: 2.4 }); p.door("hall", "wcm", { at: 24.5, w: 1.4 }); p.enter("lobby", "s", 15, 2.4);
  const F = frame(p, hall, "n");
  F.add("ledwall", W / 2, 0.15, { w: 16, y: 0.8, hh: 4.4, glow: g, label: "QUANTUM" }); F.add("dj", W / 2, 2.2, { w: 3.6, glow: g }); F.add("speaker", 8, 1.2, { glow: g }); F.add("speaker", W - 8, 1.2, { glow: g }); F.add("speaker", 3.5, 4.0, { glow: g }); F.add("speaker", W - 3.5, 4.0, { glow: g });
  F.add("dancefloor", W / 2, 9.6, { w: 14, d: 8, glow: g }); F.add("discoball", W / 2 - 3.5, 9.6, { y: 5.4 }); F.add("discoball", W / 2 + 3.5, 9.6, { y: 5.4 }); for (const [u, v] of [[5, 3], [W - 5, 3], [8, 12], [W - 8, 12]]) F.add("spotlight", u, v, { glow: [g, "#ff4fd8", "#7a5cff", "#38e8ff"][(u + v) % 4 | 0], y: 5.9 });
  const E = frame(p, hall, "e"); E.wall("bar", 8.5, { w: 8, glow: g }); E.person("bartender", 8.5, 1.5, { face: "front" }); E.person("bartender", 10.5, 1.5, { face: "front" }); for (let i = 0; i < 4; i++) E.add("stool", 5.2 + i * 1.3, 2.2, { color: "#2a2f3a" });
  const Wf = frame(p, hall, "w"); [3.2, 6.2, 9.2, 12.2].forEach((u, i) => Wf.wall("booth", u, { color: ["#27408b", "#2d6f9a", "#27408b", "#2d6f9a"][i], glow: g }));
  for (let k = 0; k < 6; k++) F.person("dancer", W / 2 - 4 + (k % 3) * 3.4, 7.2 + (k >> 1) * 2.4, { mode: "dance", face: k % 2 ? "back" : "front" }); F.person("dj", W / 2, 1.5, { face: "front" });
  F.hub(W / 2, 4.3, DJ_RING, 0); F.hub(W - 4.5, 8.5, MENU_RING, 0); // the DJ booth (music) and the bottle-service spot (the VIP menu): same rings in every club, placed to suit this one
  const L = frame(p, ves, "n"); L.add("counter", 6.4, 1.2, { w: 2.2, sign: "Tickets", color: "#262338", top: "#38e8ff" }); L.hub(6.4, 2.4, "This week's parties", 0); L.person("clerk", 6.4, 0.55, { face: "front" }); L.person("bouncer", 1.2, 3.8, { face: "front" }); L.person("bouncer", 2.8, 3.8, { face: "front" });
  fillWc("F")(frame(p, p.byId.get("wcf"), "s"), p.byId.get("wcf"), p); fillWc("M")(frame(p, p.byId.get("wcm"), "s"), p.byId.get("wcm"), p);
  crowd(p, "patron", 5, ["hall", "lobby"], 0); return p;
}

function club0203(spec, place) {
  const p = new Plan(spec.id, place.name, { floors: 1, style: clubStyle("#2a1c14", "#ffb13d") }), g = "#ffb13d";
  const hall = p.room("hall", "Lounge and live floor", 0, 0, 26, 13, { kind: "hall", surface: "wood", h: 4.6, wall: "#2e1f16", ceil: "#120b07" }), patio = p.room("patio", "Open-air patio", 26, 0, 35, 13, { kind: "yard", surface: "concrete", open: true });
  p.room("cloak", "Cloakroom", 0, 13, 8, 20, { surface: "wood", wall: "#3a281c" }); const ves = p.room("lobby", "Entrance", 8, 13, 18, 20, { kind: "lobby", surface: "wood", wall: "#34231a" }); p.room("wc", "Toilets", 18, 13, 26, 20, { surface: "tile", wall: "#3a281c" });
  p.door("hall", "cloak", { at: 4, w: 1.4 }); p.door("hall", "lobby", { at: 13, w: 2.4 }); p.door("hall", "wc", { at: 22, w: 1.4 }); p.door("hall", "patio", { at: 6.5, w: 2.2 }); p.enter("lobby", "s", 13, 2.2);
  const F = frame(p, hall, "n");
  F.add("stage", 5.0, 2.2, { w: 8, d: 4, h: 0.7 }); F.add("ledwall", 5.0, 0.15, { w: 8, y: 0.9, hh: 3.2, glow: g, label: "0203" }); F.add("speaker", 0.8, 5.4, { glow: g }); F.add("speaker", 9.2, 5.4, { glow: g }); F.add("box", 3.4, 2.0, { w: 1.2, d: 1.2, h: 0.7, color: "#b8473b", lift: 0.7, solid: false }); F.add("box", 6.6, 1.6, { w: 0.5, d: 0.5, h: 1.3, color: "#2a2f3a", lift: 0.7, solid: false });
  F.wall("bar", 19.5, { w: 11, glow: g, top: "#4a2f1e" }); F.person("bartender", 17.0, 1.5, { face: "front" }); F.person("bartender", 21.5, 1.5, { face: "front" }); for (let i = 0; i < 5; i++) F.add("stool", 15.0 + i * 1.5, 2.2, { color: "#b8793f" });
  F.add("dancefloor", 14.0, 8.2, { w: 8, d: 5, glow: g }); F.add("discoball", 14.0, 8.2, { y: 4.0 }); F.add("spotlight", 6, 7, { glow: g, y: 4.3 }); F.add("spotlight", 20, 7, { glow: "#ff6a3d", y: 4.3 });
  F.add("roundtable", 2.4, 8.4, { w: 2.2, chairs: 4, color: "#4a2f1e", chairColor: "#b8793f" }); F.add("roundtable", 2.4, 5.6 + 0.4, { w: 2.2, chairs: 4, color: "#4a2f1e", chairColor: "#b8793f" }); F.add("roundtable", 23.4, 8.0, { w: 2.2, chairs: 4, color: "#4a2f1e", chairColor: "#b8793f" }); F.add("roundtable", 19.6, 6.4, { w: 2.2, chairs: 4, color: "#4a2f1e", chairColor: "#b8793f" });
  for (let k = 0; k < 4; k++) F.person("dancer", 12 + (k % 2) * 3, 7.2 + (k >> 1) * 1.8, { mode: "dance", face: "front" }); F.person("dj", 5.0, 2.4, { face: "front" });
  F.hub(5.0, 5.4, DJ_RING, 0); F.hub(21.5, 10.5, MENU_RING, 0);
  const P = frame(p, patio, "n"); P.add("roundtable", 2.2, 3.0, { w: 2.2, chairs: 4, color: "#6b4226" }); P.add("roundtable", 6.0, 6.4, { w: 2.2, chairs: 4, color: "#6b4226" }); P.add("roundtable", 2.4, 8.8, { w: 2.2, chairs: 4, color: "#6b4226" }); P.add("tree", 7.6, 1.4, {}); P.add("tree", 0.9, 11.4 === 0 ? 0 : 11.6, {}); P.add("spotlight", 4.5, 5, { glow: "#ffd59a", y: 3.2 }); P.person("patron", 2.2, 3.0, { face: "back", mode: "sit" });
  const L = frame(p, ves, "n"); L.add("counter", 2.2, 1.4, { w: 2.2, sign: "Entry", color: "#3a281c", top: g }); L.hub(2.2, 2.4, "This week's parties", 0); L.person("clerk", 2.2, 0.7, { face: "front" }); L.person("bouncer", 7.4, 4.2, { face: "back" });
  frame(p, p.byId.get("cloak"), "s").add("counter", 4.0, 1.6, { w: 3.0, sign: "Cloakroom" }); frame(p, p.byId.get("cloak"), "s").wall("locker", 4.0, { w: 3.2 }); fillWc("M")(frame(p, p.byId.get("wc"), "s"), p.byId.get("wc"), p);
  crowd(p, "patron", 5, ["hall", "patio", "lobby"], 0); return p;
}

function divas(spec, place) {
  const p = new Plan(spec.id, place.name, { floors: 1, style: clubStyle("#2a1423", "#ffd24a") }), g = "#ffd24a", pk = "#ff4f87";
  const hall = p.room("hall", "Lounge and runway", 0, 0, 28, 14, { kind: "hall", surface: "marble", h: 5.0, wall: "#2b1527", ceil: "#14080f" });
  p.room("vip1", "VIP room 1", 0, 14, 9, 22, { surface: "carpet", wall: "#3a1a33" }); const ves = p.room("lobby", "Entrance and guest list", 9, 14, 19, 22, { kind: "lobby", surface: "marble", wall: "#34172e" }); p.room("vip2", "VIP room 2", 19, 14, 28, 22, { surface: "carpet", wall: "#3a1a33" });
  p.door("hall", "vip1", { at: 4.5, w: 1.4 }); p.door("hall", "lobby", { at: 14, w: 2.4 }); p.door("hall", "vip2", { at: 23.5, w: 1.4 }); p.enter("lobby", "s", 14, 2.4);
  const F = frame(p, hall, "n");
  F.add("mirrorwall", 14, 0.06, { w: 16 }); F.add("runway", 14, 5.0, { w: 12, d: 1.6, h: 0.7, glow: g }); F.add("spotlight", 8.5, 5, { glow: pk, y: 4.6 }); F.add("spotlight", 19.5, 5, { glow: g, y: 4.6 }); F.add("discoball", 14, 8.6, { y: 4.3 });
  F.wall("bar", 4.6, { w: 6, glow: pk, top: "#3a1a33" }); F.person("bartender", 4.6, 1.5, { face: "front" }); for (let i = 0; i < 3; i++) F.add("stool", 2.4 + i * 1.5, 2.2, { color: pk }); F.add("dj", 24.0, 1.4, { w: 3.0, glow: pk }); F.add("speaker", 20.8, 1.2, { glow: pk }); F.add("speaker", 27.2, 1.2, { glow: pk }); F.person("dj", 24.0, 0.9, { face: "front" });
  const Wf = frame(p, hall, "w"), Ef = frame(p, hall, "e"); [4.0, 7.0, 10.0].forEach((u, i) => { Wf.wall("booth", u, { color: "#8a1f6e", glow: g }); Ef.wall("booth", u, { color: "#8a1f6e", glow: g }); });
  F.add("dancefloor", 14, 10.2, { w: 8, d: 3, glow: pk }); for (let k = 0; k < 4; k++) F.person("dancer", 11 + k * 2, 9.8, { mode: "dance", face: k % 2 ? "front" : "back" }); F.person("patron", 14, 5.0, { face: "front", mode: "stand" });
  F.hub(24.0, 3.6, DJ_RING, 0); F.hub(4.5, 7.8, MENU_RING, 0);
  const L = frame(p, ves, "n"); L.add("counter", 2.4, 1.4, { w: 2.4, sign: "Guest list", color: "#34172e", top: g }); L.hub(2.4, 2.4, "This week's parties", 0); L.person("clerk", 2.4, 0.7, { face: "front" }); L.add("photobooth", 8.2, 1.0, { glow: pk }); L.add("counter", 7.6, 5.8 + 0.2, { w: 2.0, sign: "Coats", color: "#34172e" }); L.person("bouncer", 5.0, 5.2, { face: "back" });
  for (const id of ["vip1", "vip2"]) { const F2 = frame(p, p.byId.get(id), "s"); F2.add("sofa", F2.W / 2, 1.0 + 0.4, { w: 2.6, color: "#8a1f6e" }); F2.add("loungeTable", F2.W / 2, 2.9, { glow: g }); F2.add("armchair", 1.3, 3.2, { turn: PI / 2, color: pk }); F2.add("armchair", F2.W - 1.3, 3.2, { turn: -PI / 2, color: pk }); F2.add("speaker", F2.W - 0.6, 0.6, { glow: pk }); F2.person("patron", F2.W / 2, 1.4, { face: "front", mode: "sit" }); }
  crowd(p, "patron", 5, ["hall", "lobby"], 0); return p;
}

// ------------------------------------------------------------------------------------------------ worship

export function church(spec, place) {
  const v = spec.v, W = 14, N = 5, D = 19, p = new Plan(spec.id, place.name, { floors: 1, style: { wall: "#f1ece0", facade: "#e8e1cd", ceil: "#efe8d8" } });
  const nart = p.room("narthex", "Entrance porch", 0, 0, W, N, { kind: "lobby", surface: "marble", h: 4.4 }), nave = p.room("nave", { catholic: "Nave and sanctuary", anglican: "Nave and chancel", pentecostal: "Worship hall", baptist: "Sanctuary" }[v], 0, N, W, N + D, { kind: "hall", surface: "wood", h: 8.2, wall: v === "pentecostal" ? "#e6e8ee" : "#f1ece0" });
  p.room("vestry", { catholic: "Sacristy", anglican: "Vestry", pentecostal: "Prayer and counselling room", baptist: "Pastor's study" }[v], W, N + 10, W + 6, N + D, { surface: "carpet" }); p.door("narthex", "nave", { at: W / 2, w: 2.4 }); p.door("nave", "vestry", { at: N + D - 1.6, w: 1.3 }); p.enter("narthex", "n", W / 2, 2.4);
  const Nf = frame(p, nart, "n"); Nf.wall("notice", 2.2, { label: "Announcements" }); Nf.wall("notice", W - 2.2, { label: "Services" }); Nf.add("plant", 0.7, 3.0); Nf.add("plant", W - 0.7, 3.0); Nf.add("table", 2.4, 3.3, { w: 1.8, d: 1.2 }); Nf.hub(W - 2.5, 2.6, "Join the fellowship", 0); Nf.person("staff", W - 2.5, 3.4, { face: "front" });
  const F = frame(p, nave, "s"), aisle = 2.0, pad = v === "catholic" ? 1.2 : 0, sw = (W - aisle - 0.8 - 2 * pad) / 2, rows = 10; // back wall = the altar end
  const stageH = 0.5;
  F.add("stage", W / 2, v === "pentecostal" ? 2.0 : 1.8, { w: v === "pentecostal" ? 11 : 8, d: v === "pentecostal" ? 4 : 3.2, h: stageH });
  if (v === "pentecostal") { F.add("ledwall", W / 2, 0.15, { w: 10, y: 1.2, hh: 3.4, glow: "#4aa8ff", label: "WELCOME" }); F.add("speaker", 1.5, 2.2, { glow: "#4aa8ff", lift: stageH, solid: false }); F.add("speaker", W - 1.5, 2.2, { glow: "#4aa8ff", lift: stageH, solid: false }); F.add("box", W / 2 + 3, 2.4, { w: 1.4, d: 0.6, h: 0.9, color: "#2a2f3a", lift: stageH, solid: false }); F.add("podium", W / 2 - 3, 2.6, { lift: stageH, solid: false }); F.person("pastor", W / 2, 2.0, { face: "front" }); }
  else { F.add("cross", W / 2, 0.2, { y: 3.4, s: 1.3 }); F.add("altar", W / 2, 1.6, { w: 2.4, lift: stageH, solid: false }); F.add("pulpit", 1.9, 2.4, { lift: stageH, solid: false }); F.add("curtain", W / 2, 0.2, { w: 9, hh: 6.5, color: v === "baptist" ? "#2f4a7a" : "#7a1f2b" }); F.person("pastor", 1.9, 2.4, { face: "front" }); }
  if (v === "anglican") { F.add("pew", 1.2, 4.4, { w: 2.6, turn: PI / 2 }); }
  if (v === "baptist") F.add("box", W / 2, 0.8, { w: 3.0, d: 1.2, h: 0.4, color: "#4aa8d9", lift: stageH, solid: false });
  if (v === "catholic") { F.add("display", 0.8, 6.0, { w: 1.2, color: "#d9a441", turn: PI / 2 }); F.add("display", W - 0.8, 6.0, { w: 1.2, color: "#d9a441", turn: -PI / 2 }); F.add("box", W - 0.9, 9.5, { w: 1.1, d: 1.1, h: 2.4, color: "#4a2f1e", turn: 0 }); F.add("box", 0.9, 9.5, { w: 1.1, d: 1.1, h: 2.4, color: "#4a2f1e", turn: 0 }); }
  const first = v === "pentecostal" ? 6.2 : 6.6;
  for (let r = 0; r < rows; r++) for (const sx of [0.4 + pad + sw / 2, W - 0.4 - pad - sw / 2]) { if (v === "pentecostal") { if (r === 0) F.add("seatblock", sx, first + ((rows - 1) * 1.0) / 2, { w: sw, d: (rows - 1) * 1.0, rows: rows - 1, color: "#2f62c4" }); } else F.add("pew", sx, first + r * 1.15, { w: sw }); }
  for (let k = 0; k < 6; k++) F.person("worshipper", 1.4 + (k % 2) * (W - 2.8) - (k % 2 ? 0 : -0.0), first + 0.2 + (k >> 1) * 2.3 * 1.15, { face: "back", mode: "sit" });
  const V = frame(p, p.byId.get("vestry"), "s"); V.add("officedesk", 2.4, 1.8, {}); V.wall("wardrobe", 0.7, { color: "#6b4226" }); V.wall("bookshelf", 4.7, { w: 1.1 }); V.person("staff", 2.4, 0.9, { face: "front", mode: "sit" });
  crowd(p, "worshipper", 3, ["nave", "narthex"], 0); return p;
}

export function mosque(spec, place) {
  const p = new Plan(spec.id, place.name, { floors: 1, style: { wall: "#eef1ea", facade: "#e3e6d8", ceil: "#f3f4ec" } });
  const hall = p.room("hall", "Prayer hall", 0, 0, 16, 13, { kind: "hall", surface: "carpet", h: 6.6, color: "#2f6f5a", wall: "#eef1ea" }), ves = p.room("lobby", "Entrance and shoe area", 0, 13, 16, 18, { kind: "lobby", surface: "tile" }); p.room("wudu", "Ablution (wudu) area", 16, 13, 22, 18, { surface: "tile", wall: "#d8e6ea" }); p.room("library", "Quran library and imam's office", 16, 0, 22, 13, { surface: "carpet" });
  p.door("hall", "lobby", { at: 8, w: 2.4 }); p.door("lobby", "wudu", { at: 15.5, w: 1.3 }); p.door("library", "hall", { at: 2.6, w: 1.3 }); p.enter("lobby", "s", 8, 2.2);
  const E = frame(p, hall, "e"); E.wall("mihrab", 6.5, { w: 2.6 }); E.wall("minbar", 3.4, {});
  for (let r = 0; r < 7; r++) for (let c = 0; c < 8; c++) E.add("prayermat", 1.0 + c * 1.5, 2.2 + r * 1.4, { turn: PI, n: r + c });
  const F = frame(p, hall, "n"); F.add("clock", 6, 0.05, {}); F.wall("bookshelf", 2.0, { w: 1.4 }); F.person("worshipper", 5, 5.2, { face: 1.5708 }); F.person("worshipper", 9, 8.8, { face: 1.5708 }); F.person("staff", 12.2, 3.6, { face: -1.5708 });
  const L = frame(p, ves, "n"); L.add("shoerack", 2.4, 0.4 + 0.1, { w: 2.0 }); L.add("shoerack", 13.4, 0.5, { w: 2.0 }); L.wall("notice", 8, { label: "Prayer times" }); L.add("plant", 0.7, 3.4); L.hub(8, 2.6, "Join the community", 0);
  const Wd = frame(p, p.byId.get("wudu"), "n"); Wd.wall("sinks", 2.4, { w: 2.0 }); Wd.wall("sinks", 4.0, { w: 1.2 }); Wd.add("bench", 3.0, 3.6, { w: 2.0, turn: PI });
  const Lb = frame(p, p.byId.get("library"), "s"); Lb.add("officedesk", 3.0, 1.8, {}); Lb.wall("bookshelf", 0.8, { w: 1.2 }); Lb.wall("bookshelf", 5.2, { w: 1.2 }); Lb.add("table", 3.0, 6.6, { w: 3.0, d: 2.2, chairs: 4 }); Lb.person("staff", 3.0, 0.9, { face: "front", mode: "sit" });
  crowd(p, "worshipper", 4, ["hall", "lobby"], 0); return p;
}

// ------------------------------------------------------------------------------------------------ banks

export function bank(spec, place) {
  const acc = { green: "#2f8f55", purple: "#7a3fa0", navy: "#1f3b6f", red: "#b83a3a", orange: "#e0802f" }[spec.v], flip = spec.seed % 2, W = 18, D = 11;
  const p = new Plan(spec.id, place.name, { floors: 1, style: { wall: "#eceae2", facade: "#d6d2c4", ceil: "#f4f3ee" } });
  const hall = p.room("hall", "Banking hall", 0, 0, W, D, { kind: "lobby", surface: "marble", h: 4.2 }), atm = p.room("atm", "ATM lobby", W, 5, W + 6, D, { surface: "tile", wall: "#e8ecee" });
  p.room("manager", "Manager's office", 0, -4.8, 6, 0, { surface: "carpet" }); p.room("accounts", "Accounts office", 6, -4.8, 12, 0, { surface: "carpet" }); p.room("vault", "Strong room", 12, -4.8, W, 0, { surface: "concrete", wall: "#c8ced4" });
  p.door("manager", "hall", { at: 3, w: 1.2 }); p.door("accounts", "hall", { at: 9, w: 1.2 }); p.door("vault", "hall", { at: 15, w: 1.3 }); p.door("atm", "hall", { at: 8, w: 1.4 }); p.enter("hall", "s", flip ? 12 : 6, 2.4);
  const F = frame(p, hall, "n"); const tellerU = flip ? [6.0, 12.0] : [6.0, 12.0];
  for (const u of tellerU) { F.add("teller", u, 1.6, { w: 2.2, color: acc }); F.person("teller", u, 0.6, { face: "front" }); } F.hub(9, 4.0, "Banking enquiries", 0);
  F.add("stanchions", 6, 4.0, { w: 2.4 }); F.add("stanchions", 12, 4.0, { w: 2.4 }); F.add("banner", 9, 0.2, { w: 5, y: 3.0, hh: 0.9, label: place.name.toUpperCase(), color: acc, fg: "#ffffff" });
  const Wf = frame(p, hall, "w"); Wf.add("officedesk", 5.0, 1.6, { turn: 0, color: "#4a3a2a" }); Wf.add("officedesk", 8.6, 1.6, { turn: 0, color: "#4a3a2a" }); Wf.person("staff", 5.0, 0.8, { face: "front", mode: "sit" });
  F.front("waitchairs", flip ? 3.0 : 15.0, { w: 2.4, color: acc }); F.front("waitchairs", flip ? 6.0 : 15.0 + 0.0 === 15 ? 3.0 : 3.0, { w: 2.4, color: acc }); F.add("plant", W - 0.6, 3.6); F.add("water", 0.6, 4.0);
  const A = frame(p, atm, "e"); A.wall("atm", 1.6, { color: acc }); A.wall("atm", 3.8, { color: acc }); A.add("plant", 5.2, 4.8, {});
  const M = frame(p, p.byId.get("manager"), "n"); M.add("officedesk", 3.0, 1.6, { color: "#4a2f1e" }); M.wall("bookshelf", 0.8, { w: 1.1 }); M.person("staff", 3.0, 0.9, { face: "front", mode: "sit" });
  const Ac = frame(p, p.byId.get("accounts"), "n"); Ac.add("desk", 1.5, 1.0, { pc: true }); Ac.add("desk", 4.5, 1.0, { pc: true }); Ac.wall("filing", 5.5); Ac.person("staff", 3.0, 2.6, { face: "back" });
  const V = frame(p, p.byId.get("vault"), "n"); V.wall("vault", 3.0, { w: 2.4 }); V.add("cartons", 1.2, 2.2, {}); V.add("cartons", 4.8, 2.2, {});
  crowd(p, "customer", 4, ["hall", "atm"], 0); return p;
}

// ------------------------------------------------------------------------------------------------ shops and the market

export function shop(spec, place) {
  const v = spec.v, big = v === "canteen" || v === "books" || v === "store", W = v === "kiosk" ? 6.4 : big ? 11 : 9, D = v === "kiosk" ? 5.4 : 7.6;
  const p = new Plan(spec.id, place.name, { floors: 1, style: { wall: { books: "#efe6d2", hotspot: "#e8d9c4", phones: "#e4ecf2", canteen: "#f1e4c8", kiosk: "#efe3c8", store: "#ebebe0" }[v], facade: "#d9c9a4" } });
  const main = p.room("lobby", { books: "Bookshop", hotspot: "Hangout spot", phones: "Phone shop", canteen: "Eatery", kiosk: "Kiosk", store: "Provisions store" }[v], 0, 0, W, D, { kind: "lobby", surface: v === "canteen" ? "tile" : "wood", h: 3.6 });
  p.enter("lobby", "s", v === "canteen" ? 7.0 : W / 2, 2.2); const F = frame(p, main, "n"), hubTxt = "Browse and chat";
  if (v === "books") { for (let c = 0; c < 3; c++) F.add("shelves", 2.0 + c * 3.1, 2.2, { w: 2.4, n: c }); F.wall("shelves", 1.6, { w: 2.4 }); F.wall("shelves", W - 1.6, { w: 2.4, n: 2 }); F.add("counter", 2.2, D - 1.2, { w: 2.4, sign: "Pay here", turn: PI }); F.add("table", W - 2.4, D - 2.0, { w: 2.6, d: 2.0, chairs: 4 }); F.hub(2.2, D - 2.6, "School bookshop", 0); F.person("clerk", 2.2, D - 0.55, { face: "back" }); F.person("student", 4.8, 3.6, { face: "back" }); }
  else if (v === "hotspot") { F.wall("freezer", 1.6, { w: 1.5 }); F.wall("freezer", 3.4, { w: 1.5 }); F.add("counter", W - 2.4, 2.0, { w: 3.0, sign: "Orders", color: "#b8473b" }); for (let i = 0; i < 3; i++) F.add("stool", W - 3.4 + i * 1.0, 3.1, { color: "#b8473b" }); F.add("roundtable", 2.0, 4.6, { w: 2.0, chairs: 4 }); F.add("roundtable", 5.6, 4.6, { w: 2.0, chairs: 4, chairColor: "#d9a441" }); F.add("tv", W / 2, 0.05, { w: 1.6 }); F.hub(W - 2.4, 3.4, "Hang out", 0); F.person("clerk", W - 2.4, 1.2, { face: "front" }); F.person("student", 2.0, 4.6, { face: "back", mode: "sit" }); }
  else if (v === "phones") { for (let i = 0; i < 3; i++) F.add("display", 1.6 + i * 2.2, 2.6, { w: 1.6, color: ["#2a2f3a", "#4aa8ff", "#c0c4cc"][i], n: i }); F.wall("shelves", W - 1.4, { w: 1.6 }); F.wall("shelves", 1.4, { w: 1.6, n: 3 }); F.add("counter", W - 2.4, 3.6, { w: 3.0, sign: "Repairs and sales", color: "#2a3f5f" }); F.add("workbench", W - 2.0, 5.6, { w: 2.4 }); F.hub(W - 2.4, 4.7, "Phone shop", 0); F.person("clerk", W - 2.4, 2.9, { face: "back" }); F.person("student", 3.0, 3.8, { face: "back" }); }
  else if (v === "canteen") { F.add("counter", 6.8, 1.8, { w: 5.2, sign: "Serving counter", color: "#b8793f" }); F.add("potstack", 6.8, 0.65, { w: 3.2 }); F.add("fridge", 10.1, 0.8, {}); for (let c = 0; c < 2; c++) for (let r = 0; r < 2; r++) F.add("roundtable", 2.0 + c * 3.0, 3.4 + r * 2.2, { w: 2.0, chairs: 4, chairColor: "#d9a441" }); F.add("table", 9.4, 4.4, { w: 2.6, d: 2.4, chairs: 6 }); F.hub(6.8, 3.0, "Eat something", 0); F.person("clerk", 5.4, 1.1, { face: "front" }); F.person("clerk", 8.2, 1.1, { face: "front" }); F.person("student", 2.0, 3.4, { face: "back", mode: "sit" }); }
  else if (v === "kiosk") { F.add("counter", W / 2, 1.2, { w: 3.4, sign: "Kiosk", color: "#6b4226" }); F.wall("shelves", 0.9, { w: 1.4 }); F.wall("shelves", W - 0.9, { w: 1.4, n: 1 }); F.add("freezer", 1.6, 2.6, { w: 1.4, turn: PI / 2 }); F.hub(W / 2, 2.2, "Buy snacks", 0); F.person("clerk", W / 2, 0.55, { face: "front" }); }
  else { for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) F.add("shelves", 2.4 + c * 4.4, 2.2 + r * 1.9, { w: 3.0, n: c + r }); F.wall("freezer", W - 1.4, { w: 1.5 }); F.wall("freezer", W - 3.1, { w: 1.5 }); F.add("counter", W - 2.2, D - 1.3, { w: 2.6, sign: "Pay here", color: "#2f5f3b", turn: PI }); F.hub(W - 2.2, D - 2.7, "Provisions", 0); F.person("clerk", W - 2.2, D - 0.55, { face: "back" }); F.person("student", 3.0, 4.6, { face: "back" }); }
  void hubTxt; crowd(p, "shopper", v === "kiosk" ? 1 : 2, ["lobby"], 0); return p;
}

export function market(spec, place) {
  const W = 28, D = 19, p = new Plan(spec.id, place.name, { floors: 1, style: { wall: "#e6dcc6", facade: "#cdb98d", ceil: "#d9cfba" } });
  const hall = p.room("lobby", "Market hall", 0, 0, W, D, { kind: "hall", surface: "concrete", h: 5.4 }); p.enter("lobby", "s", W / 2, 3.0);
  const F = frame(p, hall, "n"), cols = [3.2, 8.4, 19.6, 24.8], rows = [3.4, 7.2, 11.0], colors = ["#b83a3a", "#e0802f", "#2f8f55", "#3b6fc4", "#d9a441", "#7a4aa0"];
  rows.forEach((v, r) => cols.forEach((u, c) => { F.add("stall", u, v, { w: 2.6, color: colors[(r * 4 + c) % colors.length], n: r + c }); F.person("trader", u, v - 0.2, { face: "front" }); }));
  for (let i = 0; i < 4; i++) F.wall("freezer", 3 + i * 1.8, { w: 1.5 }); F.wall("croptray", 20.5, { w: 3.0 }); F.wall("croptray", 24.0, { w: 3.0, crop: "#d9a441" }); F.add("tree", W / 2, 8.0, { }); F.hub(W / 2, 14.4, "Market life", 0); F.front("cartons", 2.0); F.front("cartons", W - 2.0);
  crowd(p, "shopper", 8, ["lobby"], 0); return p;
}

// ------------------------------------------------------------------------------------------------ museum, school, custody, squash

export function museum(spec, place) {
  const p = new Plan(spec.id, place.name, { floors: 1, style: { wall: "#ece6d6", facade: "#d3c7a8", ceil: "#f3efe3" } });
  const gal = (kind) => (F) => { const { W, D } = F;
    if (kind === "fossil") { F.add("fossil", W / 2, 3.0, {}); F.wall("display", 1.4, { w: 1.4 }); F.wall("display", W - 1.4, { w: 1.4, color: "#8f3b3b", n: 1 }); F.add("display", 2.2, 5.6, { w: 1.4, n: 2 }); F.add("display", W - 2.2, 5.6, { w: 1.4, n: 3 }); }
    else if (kind === "bio") { for (let i = 0; i < 4; i++) F.wall("display", 1.4 + i * 2.5, { w: 1.6, color: ["#3f9a55", "#d9a441", "#4aa8d9", "#b8473b"][i], n: i }); F.add("croptray", 3.0, 4.6, { w: 2.6, d: 1.0 }); F.add("croptray", W - 3.0, 4.6, { w: 2.6, d: 1.0, crop: "#d9a441" }); F.add("tree", W / 2, 3.4, {}); }
    else { F.add("skeleton", 2.0, 2.0, {}); F.add("skeleton", 4.0, 2.0, {}); F.add("skeleton", W - 2.0, 2.0, {}); for (let i = 0; i < 3; i++) F.add("display", 2.0 + i * 2.6, 4.6, { w: 1.6, n: i + 3 }); }
    F.person("visitor", W / 2 - 1.8, D - 3.0, { face: "back" }); };
  corridorBlock(p, { x0: 0, z0: 0, floor: 0, key: "g", nD: 8, sD: 6.4, cw: 2.8, north: [{ id: "fossils", name: "Palaeontology gallery", w: 12, fill: gal("fossil"), surface: "wood", wide: true }, { id: "bio", name: "Biodiversity gallery", w: 10, fill: gal("bio"), surface: "wood", wide: true }, { id: "zoo", name: "Zoology and skeletons", w: 10, fill: gal("zoo"), surface: "wood", wide: true }],
    south: [{ id: "curator", name: "Curator's office", w: 4.4, fill: fillOffice({ sign: "Curator" }), surface: "carpet" }, { id: "lobby", name: "Entrance hall", w: 10, fill: fillLobby({ sign: "Tickets", notice: "Exhibitions", hubLabel: "Museum information", action: 0, staff: "clerk" }), surface: "marble", wide: true }, { id: "edu", name: "Education room", w: 8, fill: fillSeminar({ label: "School visits" }), surface: "carpet" }] });
  const lobby = p.byId.get("lobby"); p.enter("lobby", "s", (lobby.x0 + lobby.x1) / 2, 2.2); crowd(p, "visitor", 5, ["gcorr", "fossils", "bio", "zoo", "lobby"], 0); return p;
}

export function school(spec, place) {
  const p = new Plan(spec.id, place.name, { floors: 1, style: { wall: "#f1e7cb", facade: "#e0c98f", ceil: "#f6f1e2" } });
  const cls = (n) => ({ id: `class${n}`, name: `Classroom ${n}`, w: 8.2, fill: fillLecture({ small: true, board: "black", teacher: "staff", students: 5, chairColor: "#d9a441" }), surface: "tile", wide: true });
  corridorBlock(p, { x0: 0, z0: 0, floor: 0, key: "g", nD: 7, sD: 6.4, cw: 2.6, north: [cls(1), cls(2), cls(3)], south: [{ id: "head", name: "Head teacher's office", w: 4.4, fill: fillOffice({ sign: "Head teacher" }), surface: "carpet" }, { id: "lobby", name: "Reception", w: 8.2, fill: fillLobby({ sign: "School office", notice: "School notices", hubLabel: "School office", action: 0, staff: "clerk", chairs: "#d9a441" }), surface: "marble", wide: true }, { id: "staffroom", name: "Staff room", w: 5.6, fill: fillCommon({ color: "#2f8f8a" }), surface: "carpet" }, { id: "libnook", name: "Reading corner", w: 6.4, fill: fillStudy(), surface: "carpet" }] });
  const lobby = p.byId.get("lobby"); p.enter("lobby", "s", (lobby.x0 + lobby.x1) / 2, 2.2); crowd(p, "pupil", 6, ["gcorr", "lobby"], 0); return p;
}

export function custody(spec, place) {
  const cell = (n) => ({ id: `cell${n}`, name: `Cell ${n}`, w: 3.6, kind: "cell", surface: "concrete", wall: "#aeb6c0", fill: (F) => { const { W } = F; F.add("bunk", 0.6, 1.08, { color: "#6b7a8a" }); F.add("toilet", W - 0.5, 0.6, {}); F.front("bars", W / 2, { w: W - 0.06, solid: false }); } }); // the bars across the cell door are drawn but not solid in the shared plan: the cell is kept shut by lib/custodyCells.js (server) and the scene (client), and real prisoners fill the cells
  const p = new Plan(spec.id, place.name, { floors: 1, style: { wall: "#b7bec7", facade: "#8d99a8", ceil: "#d4d9de" } });
  corridorBlock(p, { x0: 0, z0: 0, floor: 0, key: "g", nD: 5.0, sD: 6.4, cw: 2.4, north: [cell(1), cell(2), cell(3), cell(4)], south: [{ id: "interview", name: "Interview room", w: 4.6, surface: "concrete", fill: (F) => { const { W } = F; F.add("table", W / 2, 2.4, { w: 2.0, d: 2.4, chairs: 2, color: "#8d99a8" }); F.person("officer", W / 2, 2.0, { face: "back", mode: "sit" }); } }, { id: "lobby", name: "Charge desk", w: 9, fill: fillLobby({ sign: "Charge desk", notice: "Custody rules", hubLabel: "Settle your bill", action: 0, staff: "officer", chairs: "#6b7a8a" }), surface: "concrete", wide: true }, { id: "officers", name: "QRS officers' room", w: 5.6, fill: fillSharedOffice(), surface: "concrete" }, { id: "evidence", name: "Evidence store", w: 4.4, fill: fillStore(), surface: "concrete" }] });
  const lobby = p.byId.get("lobby"); p.enter("lobby", "s", (lobby.x0 + lobby.x1) / 2, 2.2); crowd(p, "officer", 2, ["gcorr", "lobby"], 0); return p;
}

export function squash(spec, place) {
  const p = new Plan(spec.id, place.name, { floors: 1, style: { wall: "#eceae2", facade: "#c9bfa4" } });
  for (const [i, x0] of [[1, 0], [2, 7.2]]) { const r = p.room(`court${i}`, `Squash court ${i}`, x0, 0, x0 + 7, 10, { kind: "hall", surface: "wood", h: 5.6, wall: "#f4f2ea" }); const F = frame(p, r, "n"); F.add("squashlines", 3.5, 5.0, { w: 6.4, d: 9.75 }); if (i === 1) { F.person("student", 2.4, 3.4, { face: "front", mode: "stand" }); } else F.person("student", 4.6, 6.6, { face: "back" }); }
  p.room("lobby", "Reception and pro shop", 0, 10, 14.2, 17, { kind: "lobby", surface: "wood", h: 3.6 }); p.room("gallery", "Spectators' gallery", 14.2, 0, 22, 10, { surface: "carpet" }); p.room("changing", "Changing rooms", 14.2, 10, 22, 17, { surface: "tile", wall: "#dde6e8" });
  p.door("court1", "lobby", { at: 3.5, w: 1.4 }); p.door("court2", "lobby", { at: 10.7, w: 1.4 }); p.door("court2", "gallery", { at: 5, w: 1.2 }); p.door("lobby", "changing", { at: 13.5, w: 1.3 }); p.door("gallery", "changing", { at: 18, w: 1.2 }); p.enter("lobby", "s", 7, 2.2);
  const L = frame(p, p.byId.get("lobby"), "n"); L.add("counter", 7.1, 2.8, { w: 3.0, sign: "Court bookings" }); L.hub(7.1, 4.0, "Book a court", 0); L.wall("shelves", 12.6, { w: 1.6 }); L.wall("notice", 7.0, { label: "Court rota" }); L.add("bench", 2.2, 3.6, { w: 2.0 }); L.person("clerk", 7.1, 2.1, { face: "front" });
  const G = frame(p, p.byId.get("gallery"), "e"); G.add("bench", 3.0, 1.4, { w: 2.6 }); G.add("bench", 6.0, 1.4, { w: 2.6 }); G.person("student", 4.0, 1.4, { face: "back", mode: "sit" });
  const C = frame(p, p.byId.get("changing"), "n"); C.wall("locker", 3.0, { w: 2.4 }); C.wall("locker", 6.0, { w: 2.0 }); C.add("bench", 3.9, 2.4, { w: 2.4, turn: PI }); crowd(p, "student", 3, ["lobby", "gallery", "changing"], 0); return p;
}

// ------------------------------------------------------------------------------------------------ multipurpose halls

export function multihall(spec, place) {
  if (spec.v === "spider") return spider(spec, place);
  const coop = spec.v === "cooperative", W = coop ? 22 : 26, D = coop ? 15 : 17, p = new Plan(spec.id, place.name, { floors: 1, style: { wall: coop ? "#e9e3d3" : "#eadfd3", facade: "#d6c9a8" } });
  const hall = p.room("hall", coop ? "Meeting hall" : "Event hall", 0, 0, W, D, { kind: "hall", surface: "wood", h: 6 }), foyer = p.room("lobby", "Foyer", 0, D, W, D + 5.4, { kind: "lobby", surface: "marble", h: 4 });
  p.room("side1", coop ? "Cooperative society office" : "Catering kitchen", -6.5, 4, 0, 11.5, { surface: coop ? "carpet" : "tile" }); p.room("side2", coop ? "Treasurer's office" : "Green room", W, 4, W + 6.5, 11.5, { surface: "carpet" });
  p.door("hall", "lobby", { at: W / 2, w: 2.8 }); p.door("hall", "lobby", { at: 3.4, w: 1.4 }); p.door("hall", "lobby", { at: W - 3.4, w: 1.4 }); p.door("side1", "hall", { at: 7.8, w: 1.3 }); p.door("side2", "hall", { at: 7.8, w: 1.3 }); p.enter("lobby", "s", W / 2, 3.0);
  const F = frame(p, hall, "n"); F.add("stage", W / 2, 2.0, { w: 12, d: 3.6, h: 0.9 }); F.add("banner", W / 2, 0.2, { w: 8, y: 3.4, hh: 1.2, label: coop ? "COOPERATIVE SOCIETY" : "AWOVARSITY EVENTS", color: "#1d3b2f" }); F.add("podium", W / 2 + 3, 2.4, { lift: 0.9, solid: false }); F.add("curtain", W / 2, 0.2, { w: 12, hh: 4.5, color: "#6b1f2b" });
  if (coop) for (let r = 0; r < 5; r++) for (const sx of [5.6, W - 5.6]) F.add("waitchairs", sx, 6.0 + r * 1.2, { w: 6.0, turn: 0 }); else { [[4, 7.2], [9, 7.2], [W - 9, 7.2], [W - 4, 7.2], [4, 11.2], [9, 11.2], [W - 9, 11.2], [W - 4, 11.2]].forEach(([u, v], i) => F.add("roundtable", u, v, { w: 2.6, chairs: 6, color: "#f4efe0", chairColor: ["#7a1f2b", "#1d5f4a"][i % 2] })); F.wall("bar", 4, { w: 4 }); }
  F.person("staff", W / 2, 2.4, { face: "front", mode: "stand" }); for (let k = 0; k < 4; k++) F.person("celebrant", 4 + (k % 2) * (W - 8), 7.0 + (k >> 1) * 4, { face: "back", mode: coop ? "sit" : "stand" });
  const L = frame(p, foyer, "n"); L.add("reception", W * 0.28, 3.2, { w: 3.0, sign: "Information", color: "#1d3b2f" }); L.hub(W * 0.28, 2.2, coop ? "Cooperative services" : "Events and parties", 0); L.wall("notice", W * 0.3, { label: "Notices" }); L.wall("notice", W * 0.7, { label: "Events" }); L.add("plant", 0.8, 3.8); L.add("plant", W - 0.8, 3.8); L.add("waitchairs", W * 0.74, 3.8, { w: 2.4, turn: PI });
  const s1 = frame(p, p.byId.get("side1"), "w"), s2 = frame(p, p.byId.get("side2"), "e");
  if (coop) { frame(p, p.byId.get("side1"), "n").add("counter", 3.2, 2.4, { w: 3.4, sign: "Savings and loans", color: "#2f5f3b" }); frame(p, p.byId.get("side1"), "n").person("clerk", 3.2, 1.6, { face: "front" }); } else { s1.wall("kitchenette", 2.6, { w: 2.6 }); s1.add("table", 3.0, 3.6, { w: 2.4, d: 1.6 }); s1.person("clerk", 2.6, 1.3, { face: "front" }); }
  s2.add("sofa", 2.4, 1.4, { w: 2.2 }); s2.add("officedesk", 3.8, 4.4, {}); void s1;
  crowd(p, "celebrant", 3, ["lobby", "hall"], 0); return p;
}

function spider(spec, place) {
  const p = new Plan(spec.id, place.name, { floors: 2, style: { wall: "#ece6d6", facade: "#d3c7a8" } });
  corridorBlock(p, { x0: 0, z0: 0, floor: 0, key: "g", nD: 7, sD: 6.4, cw: 2.6, north: [ROOM(["lecture", 9, "Assembly room"], place), ROOM(["seminar", 9, "Conference room"], place), ROOM(["shared", 8, "Offices"], place)], south: [{ stair: true, id: "stair", w: 2.0 }, ROOM(["office", 4.4, "Manager's office", { sign: "Manager" }], place), ROOM(["lobby", 10, "Foyer"], place), ROOM(["store", 5, "Store"], place)] });
  const lobby = p.byId.get("lobby"); p.enter("lobby", "s", (lobby.x0 + lobby.x1) / 2, 2.2);
  corridorBlock(p, { x0: 0, z0: 0, floor: 1, key: "u", nD: 7, sD: 6.4, cw: 2.6, north: [ROOM(["seminar", 9, "Meeting room"], place), ROOM(["pc", 9, "Training room"], place), ROOM(["shared", 8, "Offices"], place)], south: [{ stair: true, id: "stair", w: 2.0 }, ROOM(["landing", 4.4, "Waiting area"], place), ROOM(["office", 4.4, "Director's office", { sign: "Director" }], place), ROOM(["study", 8, "Resource room"], place)] });
  crowd(p, "staff", 3, ["gcorr", "lobby"], 0); crowd(p, "student", 3, ["gcorr", "lobby"], 0); crowd(p, "staff", 3, ["ucorr"], 1); return p;
}

// ------------------------------------------------------------------------------------------------ administration offices and plain buildings

export function admin(spec, place) {
  const v = spec.v, A = (l) => l.map((a) => ROOM(a, place)), p = new Plan(spec.id, place.name, { floors: v === "offices" || v === "pg" ? 2 : 1, style: { wall: "#ebe6d6", facade: "#d6cfb8" } });
  const L = (k, w, n, o) => [k, w, n, o];
  const D = { executive: { n0: [L("office", 8, "Executive office", { sign: "Executive" }), L("seminar", 10, "Conference room", { chairs: 12 }), L("office", 8, "Secretary's suite")], s0: [L("shared", 6, "Staff office"), L("lobby", 10, "Reception"), L("store", 5, "Records")] },
    offices: { n0: [L("shared", 9, "Registry"), L("shared", 9, "Accounts office"), L("seminar", 9, "Committee room")], s0: [{ stair: true }, L("office", 4.4, "Director's office", { sign: "Director" }), L("lobby", 10, "Reception"), L("store", 5, "Records")], n1: [L("shared", 9, "Staff offices"), L("shared", 9, "Staff offices 2"), L("seminar", 9, "Meeting room")], s1: [{ stair: true }, L("landing", 4.4, "Waiting area"), L("office", 4.4, "Head of unit"), L("store", 8, "Archive")] },
    pg: { n0: [L("shared", 9, "Admissions office"), L("seminar", 9, "Postgraduate seminar room"), L("lecture", 9, "Lecture room")], s0: [{ stair: true }, L("office", 4.4, "Dean's office", { sign: "Dean PG" }), L("lobby", 10, "Postgraduate reception"), L("store", 5, "Records")], n1: [L("seminar", 9, "Thesis defence room"), L("pc", 9, "Research computing room"), L("shared", 9, "Staff offices")], s1: [{ stair: true }, L("landing", 4.4, "Waiting area"), L("office", 4.4, "Sub-dean's office"), L("study", 8, "Postgraduate reading room")] },
    ict: { n0: [L("server", 9, "Server room"), L("pc", 10, "Cyber and training lab"), L("workshop", 9, "Hardware repair workshop")], s0: [L("office", 4.4, "ICT director", { sign: "ICT Director" }), L("lobby", 10, "Help desk", { sign: "ICT Help desk" }), L("shared", 7, "Network operations")] } }[v];
  const sp = (l) => l.map((a) => (Array.isArray(a) ? ROOM(a, place) : { stair: true, id: "stair", w: 2.0 }));
  corridorBlock(p, { x0: 0, z0: 0, floor: 0, key: "g", nD: 7, sD: 6.4, cw: 2.6, north: A(D.n0), south: sp(D.s0) });
  const lobby = p.byId.get("lobby"); p.enter("lobby", "s", (lobby.x0 + lobby.x1) / 2, 2.2);
  if (D.n1) { corridorBlock(p, { x0: 0, z0: 0, floor: 1, key: "u", nD: 7, sD: 6.4, cw: 2.6, north: A(D.n1), south: sp(D.s1) }); crowd(p, "staff", 3, ["ucorr"], 1); }
  crowd(p, "staff", 3, ["gcorr", "lobby"], 0); crowd(p, "student", 3, ["gcorr", "lobby"], 0); return p;
}

export function generic(spec, place) {
  const r = rng(spec.seed), p = new Plan(spec.id, place.name, { floors: 1, style: { wall: ["#e9e2d0", "#e4e8d8", "#e6dcc8"][spec.seed % 3], facade: "#cdbf9a" } }), kinds = [["office", 4.4, "Office"], ["lecture", 8, "Classroom"], ["store", 4.4, "Store"], ["seminar", 8, "Meeting room"], ["shared", 7, "Staff room"]];
  const pick = () => kinds[Math.floor(r() * kinds.length)], a = pick(), b = pick(), c = pick(); const n = [a, b, c].map((k, i) => ROOM([k[0], k[1], k[2] + (i ? ` ${i + 1}` : "")], place));
  corridorBlock(p, { x0: 0, z0: 0, floor: 0, key: "g", nD: 7, sD: 6.4, cw: 2.4, north: n, south: [ROOM(["lobby", 8, "Entrance hall"], place)] });
  const lobby = p.byId.get("lobby"); p.enter("lobby", "s", (lobby.x0 + lobby.x1) / 2, 2.2); crowd(p, "student", 2, ["gcorr", "lobby"], 0); return p;
}

export const FAMILIES2 = { clinic, club, church, mosque, bank, shop, market, museum, school, custody, squash, multihall, admin, generic };
void fillSeminar; void fillComputerLab; void fillWorkshop; void fillLanding; void fillKitchen; void fillPorter; void fillConsult; void fillWard; void fillPharmacy; void fillClinicLab; void fillTriage; void fillServer; void fillCounsel; void fillLecture; void fillStore; void fillStudy;