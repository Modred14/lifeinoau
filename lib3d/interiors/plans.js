// lib3d/interiors/plans.js
// Plan generators for the main building families: halls of residence, faculties and teaching buildings, lecture theatres, the ceremonial hall,
// Senate, library and Student Union. Venues (clubs, worship, banks, shops ...) are in plans2.js. Each generator reads the building's own
// options from registry.js (and its name/actions from the place), so no two buildings are copies of each other.
//
// Everything here is a game layout designed from what the place is for. It is not a survey of the real building.

import { Plan, corridorBlock, frame, rng, fillBedroom, fillWc, fillLobby, fillOffice, fillSharedOffice, fillLecture, fillSeminar, fillLab, fillComputerLab, fillWorkshop, fillStudio, fillCommon, fillLanding, fillStudy, fillKitchen, fillStore, fillPorter, fillLaundry, fillConsult, fillWard, fillPharmacy } from "./planKit.js";

const PI = Math.PI;

/** People who just walk about: n wanderers who stay on `floor` and roam the listed rooms. */
export function crowd(p, role, n, pool, floor = 0) { for (let i = 0; i < n; i++) p.npc(role, { floor, mode: "wander", pool, room: pool[i % pool.length] }); }

// ------------------------------------------------------------------------------------------------ rooms that need more than a shared filler

export const fillMoot = () => (F) => { const { W, D } = F;
  F.add("judgebench", W / 2, 0.75, {}); F.add("flag", W / 2 - 2.6, 0.5, { y: 1.8 }); F.add("flag", W / 2 + 2.6, 0.5, { y: 1.8 });
  F.add("table", W / 2 - 1.9, 2.4, { w: 2.2, d: 0.8, color: "#6b4226" }); F.add("table", W / 2 + 1.9, 2.4, { w: 2.2, d: 0.8, color: "#6b4226" });
  F.add("dock", W - 1.4, 2.4, {}); F.add("podium", W / 2, 1.9, {});
  F.add("pew", W / 2 - 2.5, 3.9, { w: 2.6 }); F.add("pew", W / 2 + 2.5, 3.9, { w: 2.6 }); F.add("pew", W / 2 - 2.5, 4.9, { w: 2.6 }); F.add("pew", W / 2 + 2.5, 4.9, { w: 2.6 });
  F.person("lecturer", W / 2, 0.45, { face: "front", mode: "sit" }); F.person("student", W / 2 - 1.9, 3.0, { face: "back", mode: "sit" }); F.person("student", W / 2 + 1.9, 3.0, { face: "back", mode: "sit" }); };
export const fillAnatomy = () => (F) => { const { W, D } = F; for (let c = 0; c < 2; c++) for (let r = 0; r < 2; r++) F.add("dissect", W * (0.28 + c * 0.44), 2.2 + r * 2.4, { turn: PI / 2 });
  F.wall("skeleton", 1.0); F.wall("display", W - 1.2, { w: 1.4 }); F.wall("whiteboard", W / 2, { w: 2.4, label: "Anatomy" }); F.front("sinks", 1.2, { w: 1.4 }); F.person("lecturer", W / 2, 1.3, { face: "front" }); F.person("student", W * 0.28, 3.2, { face: "back" }); };
export const fillSimWard = () => (F) => { const { W, D } = F; F.add("hospitalBed", 1.1, 1.3, {}); F.add("hospitalBed", 3.1, 1.3, {}); F.add("manikin", W - 1.1, 1.3, {}); F.add("examBed", W - 2.6, 1.3, {}); F.add("trolley", W / 2, D - 3.1, {}); F.wall("medcab", W / 2, {}); F.person("lecturer", W / 2, 3.3, { face: "back" }); F.person("student", 2.1, 3.0, { face: "back" }); };
export const fillGeoLab = () => (F) => { const { W, D } = F; F.wall("display", 1.0, { w: 1.4, color: "#8a6a40", n: 1 }); F.wall("display", 2.6, { w: 1.4, color: "#a85a2f", n: 2 }); F.wall("display", W - 1.0, { w: 1.4, color: "#6f8f6a", n: 3 }); F.wall("display", W - 2.6, { w: 1.4, color: "#8f8f9a", n: 4 }); F.add("labbench", W * 0.3, 3.0, { w: 3.0, v: "phys" }); F.add("labbench", W * 0.7, 3.0, { w: 3.0, v: "bio" }); F.person("student", W * 0.3, 3.9, { face: "back" }); F.person("technician", W / 2, 1.6, { face: "front" }); };
export const fillChemPlant = () => (F) => { const { W, D } = F; F.add("tank", 1.5, 1.4, {}); F.add("tank", 3.6, 1.4, { color: "#b8c4d0" }); F.add("tank", W - 1.5, 1.4, {}); F.add("pipes", W / 2, 0.1, { w: W - 1, y: 2.8 }); F.add("testrig", W / 2, 3.4, { w: 3 }); F.add("labbench", W * 0.25, D - 2.6, { w: 3.0, v: "chem" }); F.add("labbench", W * 0.75, D - 2.6, { w: 3.0, v: "chem" }); F.person("technician", W / 2, 5.0, { face: "back" }); };
export const fillStructures = () => (F) => { const { W, D } = F; F.add("testrig", 2.6, 2.2, {}); F.add("testrig", W - 2.6, 2.2, {}); F.add("workbench", W / 2, 3.8, { w: 3.0 }); F.front("cartons", W / 2 - 2.0); F.front("cartons", W / 2 + 2.0); F.front("shelves", 1.2, { w: 1.6 }); F.person("technician", W / 2, 2.6, { face: "back" }); };
export const fillGreenhouse = () => (F) => { const { W, D } = F; for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) F.add("croptray", W * (0.28 + c * 0.44), 1.6 + r * 2.3, { w: Math.min(3.0, W * 0.38), d: 1.0 }); F.front("water", 0.5); F.person("technician", W / 2, D - 2.4, { face: "back" }); };
export const fillYard = () => (F) => { const { W, D } = F; for (let c = 0; c < 2; c++) for (let r = 0; r < 2; r++) F.add("croptray", W * (0.27 + c * 0.46), 1.6 + r * 2.2, { w: Math.min(3.0, W * 0.4), d: 1.0, crop: ["#3f9a55", "#9ab63f", "#d9a441", "#2f7a45"][c + r * 2] }); F.front("tree", 0.8); F.front("tree", W - 0.8); F.person("technician", W / 2, D - 2.2, { face: "back" }); };
export const fillBay = () => (F) => { const { W, D } = F; F.add("tractor", W / 2 - 1.6, 2.4, {}); F.add("workbench", W - 1.8, 1.0, { w: 2.4 }); F.front("shelves", 1.2, { w: 1.6 }); F.front("shelves", W - 1.2, { w: 1.6 }); F.add("cartons", W - 1.0, 3.4, {}); F.person("technician", W - 2.0, 2.6, { face: "back" }); };
export const fillServer = () => (F) => { const { W, D } = F; for (let i = 0; i < Math.max(3, Math.floor((W - 1.4) / 1.0)); i++) F.add("rack", 0.9 + i * 1.0, 0.7, {}); F.add("workbench", W / 2, D - 2.2, { w: 2.4 }); F.person("technician", W / 2, 2.4, { face: "back" }); };
export const fillCounsel = () => (F) => { const { W, D } = F; F.add("officedesk", W / 2, 1.5, {}); F.add("sofa", W - 1.3, 3.0, { w: 1.7, turn: PI, color: "#7a8f9a" }); F.add("loungeTable", W - 1.3, 1.9, {}); F.wall("bookshelf", 0.8, { w: 1.1 }); F.person("staff", W / 2, 0.8, { face: "front", mode: "sit" }); };

const FILL = {
  lecture: (o) => fillLecture(o), lectureB: (o) => fillLecture({ board: "black", ...o }), lectureS: (o) => fillLecture({ small: true, board: "black", teacher: "staff", ...o }),
  seminar: (o) => fillSeminar(o), "lab:chem": (o) => fillLab("chem", o), "lab:bio": (o) => fillLab("bio", o), "lab:phys": (o) => fillLab("phys", o), "lab:pharm": (o) => fillLab("pharm", o), "lab:soil": (o) => fillLab("soil", o), "lab:skel": (o) => fillLab("bio", { skeleton: true, ...o }),
  pc: (o) => fillComputerLab(o), workshop: (o) => fillWorkshop(o), studio: (o) => fillStudio(o), studioM: (o) => fillStudio({ models: true, ...o }), office: (o) => fillOffice(o), shared: (o) => fillSharedOffice(o), landing: (o) => fillLanding(o), study: (o) => fillStudy(o),
  lobby: (o) => fillLobby(o), dispensary: () => fillPharmacy(), consult: (o) => fillConsult(o), simward: () => fillSimWard(), anatomy: () => fillAnatomy(), moot: () => fillMoot(), geolab: () => fillGeoLab(), chemplant: () => fillChemPlant(), structures: () => fillStructures(),
  greenhouse: () => fillGreenhouse(), yard: () => fillYard(), bay: () => fillBay(), server: () => fillServer(), counsel: () => fillCounsel(), store: () => fillStore(), kitchen: () => fillKitchen(), porter: (o) => fillPorter(o), common: (o) => fillCommon(o),
};
const SURF = { lecture: "tile", lectureB: "tile", lectureS: "tile", pc: "carpet", seminar: "carpet", office: "carpet", shared: "carpet", landing: "carpet", study: "carpet", lobby: "marble", studio: "wood", studioM: "wood", workshop: "concrete", bay: "concrete", chemplant: "concrete", structures: "concrete", yard: "grass", greenhouse: "soil", counsel: "carpet", moot: "wood", server: "rubber" };
/** [key, width, name, options] -> a room spec for corridorBlock. */
const R = (a, place) => { const [key, w, name, o = {}] = a; const spec = { w, name, fill: FILL[key]?.({ ...o, hubLabel: o.hubLabel ?? "Faculty office desk", action: 0 }), surface: SURF[key] ?? "tile", wide: key === "lobby" || key.startsWith("lecture") || key === "moot", kind: key === "yard" ? "yard" : "room" };
  if (key === "yard") { spec.surface = "grass"; spec.open = true; } if (key === "lobby") spec.id = "lobby"; if (!FILL[key]) throw new Error("plans: no fill for " + key); return spec; };
export const ROOM = R;

// ------------------------------------------------------------------------------------------------ halls of residence

export function hostel(spec, place) {
  const prem = spec.v === "premium", pg = spec.v === "postgrad", side = spec.side, beds = spec.beds, rw = prem ? 5.4 : pg ? 3.8 : beds >= 3 ? 4.2 : beds === 2 ? 3.8 : 3.6, nD = prem ? 5.8 : 5.0, sD = 6.4, rnd = rng(spec.seed);
  const wallCols = ["#e9e2d0", "#e4e8d8", "#e6dcc8", "#dde6e4"], wall = wallCols[spec.seed % wallCols.length];
  const p = new Plan(spec.id, place.name, { floors: spec.floors, style: { wall, facade: spec.sex === "F" ? "#d9b8b0" : "#c9ad8c", ceil: "#f3f0e8" } });
  const north = (fl) => { const out = [], half = Math.floor(side / 2); for (let i = 0; i < side; i++) { if (i === half && !prem) out.push({ id: `f${fl}wc`, name: `Toilets and bathrooms`, w: 4.4, kind: "wc", wall: "#d8e6ea", fill: fillWc(spec.sex) });
      const b = beds > 2 && i % 3 === 2 ? beds - 1 : beds; out.push({ id: `f${fl}r${i}`, name: `Room ${fl + 1}${String(i + 1).padStart(2, "0")}`, w: rw, surface: "tile", fill: fillBedroom(b, { premium: prem, study: pg }) }); } return out; };
  const nSum = side * rw + (prem ? 0 : 4.4), sFixed = 2.0 + 3.6 + 7.6, flex = Math.max(3.8, nSum - sFixed);
  const lobbyOpts = { sign: prem ? "Concierge" : "Hall reception", notice: "Hall notices", hubLabel: "Hall reception", action: 0, sofas: true, chairs: "#7a4aa0" };
  const g = corridorBlock(p, { x0: 0, z0: 0, floor: 0, key: "g", nD, sD, cw: 2.4, north: north(0), south: [{ stair: true, id: "stair", w: 2.0 }, { id: "porter", name: prem ? "Concierge office" : "Porters' lodge", w: 3.6, fill: fillPorter({ sign: prem ? "Concierge" : "Porters' lodge" }), surface: "wood" }, { id: "lobby", name: "Hall lobby", w: 7.6, fill: fillLobby(lobbyOpts), surface: "marble", wide: true, wall: "#efe9d8" }, { id: "common", name: pg ? "Postgraduate common room" : "Common room", w: flex, fill: fillCommon({ color: spec.sex === "F" ? "#b86f8a" : "#3b6fc4" }), surface: "carpet" }] });
  const lobby = p.byId.get("lobby"); p.enter("lobby", "s", (lobby.x0 + lobby.x1) / 2, 2.2);
  const wc = g.north.map((r) => r.id);
  const pool0 = ["gcorr", "lobby", "common"];
  crowd(p, "student", 4 + side, pool0, 0);
  if (spec.floors > 1) {
    const upperSouth = [{ stair: true, id: "stair", w: 2.0 }, { id: "landing", name: "Landing lounge", w: 3.6, fill: fillLanding(), surface: "carpet" }, { id: "reading", name: pg ? "Postgraduate reading room" : "Reading room", w: 7.6, fill: fillStudy(), surface: "carpet" }, { id: "kitchen", name: "Shared kitchen", w: flex, fill: fillKitchen(), surface: "tile" }];
    corridorBlock(p, { x0: 0, z0: 0, floor: 1, key: "u", nD, sD, cw: 2.4, north: north(1), south: upperSouth });
    crowd(p, "student", 3 + (side >> 1), ["ucorr", "landing", "reading", "kitchen"], 1);
  }
  void wc; void rnd; return p;
}

export function hostelBlock(spec, place) {
  const rnd = rng(spec.seed), side = 3 + (spec.seed % 2), rw = 3.8, p = new Plan(spec.id, place.name, { floors: 2, style: { wall: "#e9e2d0", facade: "#c58b6e" } });
  const north = (fl) => { const o = []; for (let i = 0; i < side; i++) o.push({ id: `f${fl}r${i}`, name: `Room ${fl + 1}${String(i + 1).padStart(2, "0")}`, w: rw, fill: fillBedroom(i % 2 ? 2 : 3) }); o.push({ id: `f${fl}wc`, name: "Shared toilets", w: 3.8, kind: "wc", wall: "#d8e6ea", fill: fillWc(rnd() < 0.5 ? "F" : "M") }); return o; };
  const W = side * rw + 3.8, flex = Math.max(3.8, W - 2.0 - 5.8);
  corridorBlock(p, { x0: 0, z0: 0, floor: 0, key: "g", nD: 5, sD: 6.4, north: north(0), south: [{ stair: true, id: "stair", w: 2.0 }, { id: "lobby", name: "Entrance hall", w: 5.8, fill: fillLobby({ sign: "Block notices", notice: "Block notices", hubLabel: "Notice board", action: 0 }), surface: "marble", wide: true }, { id: "common", name: "Block common room", w: flex, fill: fillCommon(), surface: "carpet" }] });
  const lobby = p.byId.get("lobby"); p.enter("lobby", "s", (lobby.x0 + lobby.x1) / 2, 2.0);
  corridorBlock(p, { x0: 0, z0: 0, floor: 1, key: "u", nD: 5, sD: 6.4, north: north(1), south: [{ stair: true, id: "stair", w: 2.0 }, { id: "landing", name: "Landing", w: 5.8, fill: fillLanding(), surface: "carpet" }, { id: "kitchen", name: "Block kitchen", w: flex, fill: fillKitchen() }] });
  crowd(p, "student", 4, ["gcorr", "lobby", "common"], 0); crowd(p, "student", 3, ["ucorr", "landing", "kitchen"], 1); return p;
}

// ------------------------------------------------------------------------------------------------ faculties and teaching buildings

const L = (k, w, n, o) => [k, w, n, o];
const DISC = {
  science: { title: "science", n0: [L("lecture", 8.5, "Lecture Room A"), L("lab:chem", 9.5, "Chemistry Teaching Laboratory"), L("lab:bio", 9.5, "Biology Laboratory")], s0: [L("office", 4.4, "Dean's Office", { sign: "Dean" }), L("lobby", 10, "Faculty foyer"), L("lab:phys", 8, "Physics Laboratory")], n1: [L("lecture", 8.5, "Lecture Room B"), L("seminar", 9.5, "Departmental Seminar Room"), L("shared", 9.5, "Staff Offices")], s1: [L("landing", 4.4, "Staff Common Room"), L("office", 4.4, "Head of Department"), L("lab:chem", 8, "Research Laboratory")] },
  engineering: { n0: [L("workshop", 10, "Mechanical Workshop"), L("lab:phys", 9, "Electronics Laboratory"), L("lecture", 8.5, "Lecture Room A")], s0: [L("office", 4.4, "Dean's Office", { sign: "Dean" }), L("lobby", 10, "Faculty foyer"), L("studio", 8, "Engineering Drawing Room")], n1: [L("lecture", 8.5, "Lecture Room C"), L("lecture", 8.5, "Lecture Room D"), L("shared", 9.5, "Staff Offices")], s1: [L("landing", 4.4, "Staff Common Room"), L("office", 4.4, "Head of Department"), L("pc", 8, "Computer-Aided Design Lab")] },
  computing: { n0: [L("pc", 10, "Computer Laboratory 1"), L("pc", 10, "Computer Laboratory 2"), L("lecture", 8.5, "Lecture Room A")], s0: [L("office", 4.4, "Dean's Office", { sign: "Dean" }), L("lobby", 10, "Faculty foyer"), L("server", 6, "Network and Server Room")], n1: [L("pc", 10, "Software Engineering Lab"), L("lab:phys", 9, "Hardware and Robotics Lab"), L("seminar", 8.5, "Project Presentation Room")], s1: [L("landing", 4.4, "Staff Common Room"), L("office", 4.4, "Head of Department"), L("shared", 8, "Staff Offices")] },
  law: { n0: [L("lectureB", 9, "Law Lecture Room 1"), L("moot", 11, "Moot Court"), L("lectureB", 9, "Law Lecture Room 2")], s0: [L("office", 4.4, "Dean's Office", { sign: "Dean" }), L("lobby", 10, "Faculty foyer"), L("study", 8, "Law Library and Legal Research Room")], n1: [L("seminar", 9, "Tutorial Room"), L("lectureB", 9, "Law Lecture Room 3"), L("shared", 10, "Staff Offices")], s1: [L("landing", 4.4, "Staff Common Room"), L("office", 4.4, "Legal Clinic"), L("seminar", 8, "Mediation Room")] },
  arts1: { n0: [L("lectureB", 9, "Lecture Room 1"), L("lectureB", 9, "Lecture Room 2"), L("seminar", 8.5, "Seminar Room")], s0: [L("office", 4.4, "Dean's Office", { sign: "Dean" }), L("lobby", 10, "Faculty foyer"), L("study", 8, "Humanities Reading Room")], n1: [L("pc", 9, "Language Laboratory"), L("lectureB", 9, "Lecture Room 3"), L("shared", 9, "Staff Offices")], s1: [L("landing", 4.4, "Staff Common Room"), L("office", 4.4, "Head of Department"), L("seminar", 8, "Seminar Room 2")] },
  arts2: { n0: [L("seminar", 8.5, "Departmental Seminar Room"), L("seminar", 8.5, "Postgraduate Seminar Room"), L("lectureB", 9, "Lecture Room 4")], s0: [L("office", 4.4, "Department of History", { sign: "History" }), L("lobby", 8, "Block foyer"), L("study", 8, "Archive and Reading Room")], n1: [L("lectureB", 9, "Lecture Room 5"), L("shared", 9, "Staff Offices"), L("seminar", 8.5, "Seminar Room 3")], s1: [L("landing", 4.4, "Staff Common Room"), L("office", 4.4, "Head of Department"), L("office", 4.4, "Departmental Office")] },
  arts3: { n0: [L("lectureB", 10, "Lecture Room 6"), L("lectureB", 10, "Lecture Room 7"), L("lectureB", 8.5, "Lecture Room 8")], s0: [L("lobby", 8, "Block foyer"), L("office", 4.4, "Department of English", { sign: "English" }), L("pc", 8, "Language Laboratory")], n1: [L("seminar", 10, "Literature Seminar Room"), L("shared", 10, "Staff Offices"), L("lectureB", 8.5, "Lecture Room 9")], s1: [L("landing", 4.4, "Staff Common Room"), L("office", 4.4, "Head of Department"), L("study", 8, "Reading Room")] },
  education: { n0: [L("lectureS", 9, "Teaching Practice Classroom"), L("lecture", 9, "Lecture Room A"), L("pc", 9, "Educational Technology Lab")], s0: [L("office", 4.4, "Dean's Office", { sign: "Dean" }), L("lobby", 10, "Faculty foyer"), L("counsel", 8, "Guidance and Counselling Unit")], n1: [L("seminar", 9, "Microteaching Room"), L("lecture", 9, "Lecture Room B"), L("shared", 9, "Staff Offices")], s1: [L("landing", 4.4, "Staff Common Room"), L("office", 4.4, "Head of Department"), L("study", 8, "Education Resource Room")] },
  pharmacy: { n0: [L("lab:pharm", 10, "Pharmaceutics Laboratory"), L("lab:chem", 9.5, "Pharmaceutical Chemistry Lab"), L("lecture", 8.5, "Lecture Room A")], s0: [L("office", 4.4, "Dean's Office", { sign: "Dean" }), L("lobby", 10, "Faculty foyer"), L("dispensary", 8, "Dispensing Practice Room")], n1: [L("lab:bio", 10, "Pharmacognosy Laboratory"), L("lecture", 9, "Lecture Room B"), L("shared", 9, "Staff Offices")], s1: [L("landing", 4.4, "Staff Common Room"), L("office", 4.4, "Head of Department"), L("seminar", 8, "Drug Information Centre")] },
  pharmacy_new: { n0: [L("lab:pharm", 10, "Clinical Pharmacy Laboratory"), L("lecture", 9, "Lecture Room 1"), L("lecture", 9, "Lecture Room 2")], s0: [L("office", 4.4, "Dean's Office", { sign: "Dean" }), L("lobby", 10, "New building foyer"), L("dispensary", 8, "Community Pharmacy Practice")], n1: [L("lab:pharm", 10, "Pharmacology Laboratory"), L("seminar", 9, "Tutorial Room"), L("shared", 9, "Staff Offices")], s1: [L("landing", 4.4, "Staff Common Room"), L("consult", 4.4, "Patient Counselling Room"), L("pc", 8, "Pharmacy Computer Lab")] },
  health: { n0: [L("anatomy", 10, "Anatomy Dissection Laboratory"), L("lecture", 9, "Lecture Room A"), L("simward", 9, "Clinical Skills Simulation Ward")], s0: [L("office", 4.4, "Provost's Office", { sign: "Provost" }), L("lobby", 10, "College foyer"), L("consult", 8, "Patient Examination Room")], n1: [L("lab:bio", 10, "Physiology Laboratory"), L("seminar", 9, "Tutorial Room"), L("shared", 9, "Staff Offices")], s1: [L("landing", 4.4, "Staff Common Room"), L("office", 4.4, "Head of Department"), L("study", 8, "Medical Library")] },
  social: { n0: [L("lecture", 9, "Lecture Room A"), L("lecture", 9, "Lecture Room B"), L("pc", 9, "Data Analysis Lab")], s0: [L("office", 4.4, "Dean's Office", { sign: "Dean" }), L("lobby", 10, "Faculty foyer"), L("seminar", 8, "Seminar Room")], n1: [L("lecture", 9, "Lecture Room C"), L("seminar", 9, "Research Seminar Room"), L("shared", 9, "Research Offices")], s1: [L("landing", 4.4, "Staff Common Room"), L("office", 4.4, "Head of Department"), L("study", 8, "Reading Room")] },
  management: { n0: [L("lecture", 9, "Lecture Room A"), L("seminar", 10, "Case Study Room"), L("pc", 9, "Management Computer Lab")], s0: [L("office", 4.4, "Dean's Office", { sign: "Dean" }), L("lobby", 10, "Faculty foyer"), L("seminar", 8, "MBA Boardroom", { chairs: 10 })], n1: [L("lecture", 9, "Lecture Room B"), L("lecture", 9, "Lecture Room C"), L("shared", 9, "Staff Offices")], s1: [L("landing", 4.4, "Staff Common Room"), L("office", 4.4, "Head of Department"), L("study", 8, "Management Resource Room")] },
  edm: { n0: [L("studioM", 11, "Architecture Design Studio"), L("studio", 10, "Planning Studio"), L("pc", 9, "GIS and Planning Lab")], s0: [L("office", 4.4, "Dean's Office", { sign: "Dean" }), L("lobby", 10, "Faculty foyer"), L("workshop", 8, "Model-making Workshop")], n1: [L("studioM", 11, "Design Studio 2"), L("lecture", 9, "Lecture Room A"), L("shared", 9, "Staff Offices")], s1: [L("landing", 4.4, "Staff Common Room"), L("office", 4.4, "Head of Department"), L("seminar", 8, "Crit and Review Room")] },
  architecture: { n0: [L("studioM", 11, "Design Studio 1"), L("studio", 10, "Design Studio 2")], s0: [L("office", 4.4, "Head of Department", { sign: "HOD" }), L("lobby", 8, "Department foyer"), L("workshop", 8, "Model Workshop")], n1: [L("studioM", 11, "Design Studio 3"), L("seminar", 9, "Crit Room")], s1: [L("landing", 4.4, "Staff Common Room"), L("shared", 8, "Staff Offices")] },
  agric: { n0: [L("lab:soil", 9.5, "Soil Science Laboratory"), L("greenhouse", 9, "Greenhouse"), L("yard", 9, "Demonstration Plots (outdoor)"), L("lecture", 8.5, "Lecture Room A")], s0: [L("office", 4.4, "Dean's Office", { sign: "Dean" }), L("lobby", 10, "Faculty foyer"), L("bay", 9, "Farm Machinery Bay")], n1: [L("lab:bio", 9.5, "Crop Science Laboratory"), L("lab:skel", 9.5, "Animal Science Laboratory"), L("shared", 9, "Staff Offices")], s1: [L("landing", 4.4, "Staff Common Room"), L("office", 4.4, "Head of Department"), L("seminar", 8, "Extension Seminar Room")] },
  geology: { n0: [L("geolab", 9, "Mineralogy and Petrology Lab"), L("lecture", 9, "Lecture Room A"), L("geolab", 9, "Rock Specimen Room")], s0: [L("office", 4.4, "Departmental Office", { sign: "Geology" }), L("lobby", 9, "Department foyer"), L("lab:phys", 8, "Geophysics Laboratory")], n1: [L("seminar", 9, "Seminar Room"), L("shared", 9, "Staff Offices"), L("lecture", 9, "Lecture Room B")], s1: [L("landing", 4.4, "Staff Common Room"), L("office", 4.4, "Head of Department"), L("study", 8, "Geology Reading Room")] },
  civil: { n0: [L("structures", 12, "Structures and Concrete Laboratory"), L("lab:soil", 9.5, "Soil Mechanics Laboratory"), L("lecture", 8.5, "Lecture Room A")], s0: [L("office", 4.4, "Departmental Office", { sign: "Civil Eng." }), L("lobby", 10, "Department foyer"), L("studio", 8, "Drawing Room")], n1: [L("lecture", 8.5, "Lecture Room B"), L("lecture", 8.5, "Lecture Room C"), L("shared", 9, "Staff Offices")], s1: [L("landing", 4.4, "Staff Common Room"), L("office", 4.4, "Head of Department"), L("pc", 8, "Surveying and Computing Lab")] },
  central_lab: { floors: 1, n0: [L("lab:chem", 12, "General Chemistry Laboratory"), L("lab:phys", 10, "Instrumentation Room"), L("lab:bio", 10, "Biological Analysis Laboratory")], s0: [L("office", 4.4, "Technicians' Office", { sign: "Technicians" }), L("lobby", 9, "Laboratory reception"), L("lab:chem", 8, "Sample Preparation Room")] },
  chem_lab: { floors: 1, n0: [L("chemplant", 12, "Pilot Plant Hall"), L("lab:chem", 9.5, "Unit Operations Laboratory"), L("pc", 9, "Process Control Room")], s0: [L("lobby", 8, "Laboratory reception"), L("office", 4.4, "Technologists' Office", { sign: "Technologists" }), L("store", 4.4, "Chemicals Store")] },
};

export function faculty(spec, place) {
  const D = DISC[spec.d]; if (!D) throw new Error("no faculty design for " + spec.d); const floors = D.floors ?? 2, nD = 7.0, sD = 6.4;
  const palette = { science: ["#e6e1d0", "#d2dccf"], engineering: ["#dfe0e2", "#c4cbd4"], computing: ["#e2e6ee", "#bcc8dc"], law: ["#ece3d0", "#c9b78f"], agric: ["#e4ead6", "#b6c79a"], health: ["#eaf1f2", "#b9d3d6"], pharmacy: ["#e8eee6", "#a9c8a0"] }[spec.d] ?? ["#e8e2d0", "#c9bfa4"];
  const p = new Plan(spec.id, place.name, { floors, style: { wall: palette[0], facade: palette[1], ceil: "#f3f0e8" } });
  const specs = (list) => list.map((a) => R(a, place));
  const g = corridorBlock(p, { x0: 0, z0: 0, floor: 0, key: "g", nD, sD, cw: 2.6, north: specs(D.n0), south: [...(floors > 1 ? [{ stair: true, id: "stair", w: 2.0 }] : []), ...specs(D.s0)] });
  void g; const lobby = p.byId.get("lobby"); p.enter("lobby", "s", (lobby.x0 + lobby.x1) / 2, 2.2);
  const names = (fl) => p.rooms.filter((r) => r.floor === fl && r.kind !== "stair").map((r) => r.id);
  const lectureRooms = p.rooms.filter((r) => r.floor === 0 && /^g[ns]/.test(r.id)).map((r) => r.id);
  crowd(p, "student", 5, ["gcorr", "lobby", ...lectureRooms.slice(0, 2)], 0);
  if (floors > 1) { corridorBlock(p, { x0: 0, z0: 0, floor: 1, key: "u", nD, sD, cw: 2.6, north: specs(D.n1), south: [{ stair: true, id: "stair", w: 2.0 }, ...specs(D.s1)] }); crowd(p, "student", 3, ["ucorr", ...names(1).filter((i) => i.startsWith("un")).slice(0, 2)], 1); crowd(p, "staff", 1, ["ucorr"], 1); }
  return p;
}

// ------------------------------------------------------------------------------------------------ lecture theatres

export function theatre(spec, place) {
  const S = { xl: { W: 36, D: 28 }, m: { W: 21, D: 17 }, s: { W: 14.4, D: 12 } }[spec.size], { W, D } = S, fy = 4.6, aisle = 1.8, p = new Plan(spec.id, place.name, { floors: 1, style: { wall: "#e2dccb", facade: "#c9bfa4", ceil: "#ebe7dc" } });
  const hall = p.room("hall", "Lecture hall", 0, 0, W, D, { kind: "hall", surface: spec.pcs ? "carpet" : "tile", h: spec.size === "xl" ? 7 : 5, wall: "#ddd6c4" });
  const foyer = p.room("foyer", "Foyer", 0, D, W, D + fy, { kind: "lobby", surface: "marble", wall: "#efe9d8" });
  p.room("prep", "Lecturers' prep room", -5.2, 0, 0, 5.2, { surface: "carpet" }); p.door("prep", "hall", { w: 1.2, at: 2.0 });
  const doors = spec.size === "s" ? [W / 2] : [aisle / 2 + 0.1, W / 2, W - aisle / 2 - 0.1]; doors.forEach((x, i) => p.door("hall", "foyer", { at: x, w: i === 1 ? 2.4 : 1.4 }));
  p.enter("foyer", "s", W / 2, 3.0);
  const F = frame(p, hall, "n"), nb = spec.size === "s" ? 2 : spec.size === "m" ? 2 : 3, bw = (W - aisle * (nb + 1)) / nb, top = spec.size === "xl" ? 6.5 : 5.0, rows = Math.max(3, Math.floor((D - top - 1.9) / (spec.pcs ? 1.5 : 0.95)));
  F.wall("whiteboard", W * 0.3, { w: 3.4 }); F.wall("screen", W / 2, { w: Math.min(6, W * 0.3), label: place.name }); F.wall("blackboard", W * 0.72, { w: 3.4 }); F.add("podium", W / 2 - 3, 1.7); F.add("table", W / 2 + 3, 1.7, { w: 1.8, d: 0.8 });
  for (let b = 0; b < nb; b++) { const x = aisle + b * (bw + aisle) + bw / 2;
    if (spec.pcs) for (let r = 0; r < rows; r++) F.add("pcrow", x, top + r * 1.5, { w: bw });
    else F.add("seatblock", x, top + (rows * 0.95) / 2, { w: bw, d: rows * 0.95, rows, color: ["#3b6fc4", "#b8473b", "#2f7a8a"][b % 3] }); }
  F.person("lecturer", W / 2, 1.1, { face: "front" }); for (let k = 0; k < 6; k++) F.person("student", aisle + (k % nb) * (bw + aisle) + 1.0 + (k >> 1) * 1.1, top + (k % 3) * 0.95 - (spec.pcs ? 0.2 : -0.1), { face: "back", mode: "sit" });
  const fr = frame(p, foyer, "n"); fr.add("reception", W * 0.27, 3.3, { w: 2.6, sign: "Information", color: "#2a2f3a", turn: PI * 0 }); fr.wall("notice", W * 0.3, { label: "Timetable" }); fr.wall("notice", W * 0.7, { label: "Notices" }); fr.add("waitchairs", W * 0.74, 3.7, { w: 2.4, turn: PI }); fr.add("water", W - 0.7, 3.4); fr.add("plant", 0.7, 3.5); fr.hub(W * 0.27, 2.4, "Check your timetable", 0);
  crowd(p, "student", 3 + nb * 2, ["foyer", "hall"], 0); return p;
}

export function classrooms(spec, place) {
  const p = new Plan(spec.id, place.name, { floors: 2, style: { wall: "#e6dfcc", facade: "#c9bfa4" } }), A = (l) => l.map((a) => R(a, place));
  corridorBlock(p, { x0: 0, z0: 0, floor: 0, key: "g", nD: 7, sD: 6.4, cw: 2.6, north: A([L("lecture", 9, "Classroom 1"), L("lecture", 9, "Classroom 2"), L("lecture", 9, "Classroom 3")]), south: [{ stair: true, id: "stair", w: 2.0 }, ...A([L("office", 4.4, "Administrator", { sign: "Office" }), L("lobby", 10, "Foyer"), L("seminar", 8, "Seminar room")])] });
  const lobby = p.byId.get("lobby"); p.enter("lobby", "s", (lobby.x0 + lobby.x1) / 2, 2.2);
  corridorBlock(p, { x0: 0, z0: 0, floor: 1, key: "u", nD: 7, sD: 6.4, cw: 2.6, north: A([L("lecture", 9, "Classroom 4"), L("lecture", 9, "Classroom 5"), L("pc", 9, "Teaching lab")]), south: [{ stair: true, id: "stair", w: 2.0 }, ...A([L("landing", 4.4, "Staff common room"), L("shared", 10, "Staff offices"), L("study", 8, "Study room")])] });
  crowd(p, "student", 6, ["gcorr", "lobby"], 0); crowd(p, "student", 3, ["ucorr"], 1); return p;
}

// ------------------------------------------------------------------------------------------------ the ceremonial hall

export function ceremonial(spec, place) {
  const W = 34, D = 26, fy = 6.5, p = new Plan(spec.id, place.name, { floors: 1, style: { wall: "#ece4cf", facade: "#d9cfae", ceil: "#f1ece0" } });
  const hall = p.room("hall", "Main hall", 0, 0, W, D, { kind: "hall", surface: "wood", h: 10.5, wall: "#e9e0c8" });
  p.room("foyer", "Entrance foyer", 0, D, W, D + fy, { kind: "lobby", surface: "marble", h: 5, wall: "#efe7d2" });
  p.room("green", "Green room", -7, 0, 0, 8, { surface: "carpet" }); p.room("control", "Control and press room", W, 0, W + 7, 8, { surface: "carpet" }); p.room("vip", "VIP lounge", -7, D - 8, 0, D, { surface: "carpet" });
  p.door("green", "hall", { at: 3.2, w: 1.5 }); p.door("control", "hall", { at: 3.2, w: 1.5 }); p.door("vip", "hall", { at: D - 4, w: 1.5 });
  [4.6, W / 2, W - 4.6].forEach((x, i) => p.door("hall", "foyer", { at: x, w: i === 1 ? 3.0 : 2.2 })); p.enter("foyer", "s", W / 2, 3.4);
  const F = frame(p, hall, "n"), aisle = 2.0, nb = 3, bw = (W - aisle * 4) / nb, top = 10.2, rows = Math.floor((D - top - 1.8) / 0.95);
  F.add("stage", W / 2, 3.4, { w: 26, d: 6.4, h: 1.1 }); F.add("steps", 2.1, 7.2, { w: 2.0, d: 1.4, h: 1.1 }); F.add("steps", W - 2.1, 7.2, { w: 2.0, d: 1.4, h: 1.1 });
  F.add("curtain", W / 2, 0.35, { w: 26, hh: 8, color: "#1d5f4a" }); F.add("banner", W / 2, 0.55, { w: 12, y: 5.6, hh: 1.5, label: "OBAFEMI AWOLOWO UNIVERSITY", color: "#1d3b2f" });
  F.add("meetingtable", W / 2, 3.0, { w: 12, d: 1.6, chairs: 9, lift: 1.1, solid: false, chairColor: "#7a1f2b", color: "#6b4226" }); F.add("podium", W / 2 + 7.2, 4.6, { lift: 1.1, solid: false }); F.add("flag", 4.5, 0.7, { y: 3.4 }); F.add("flag", W - 4.5, 0.7, { y: 3.4 });
  for (let b = 0; b < nb; b++) F.add("seatblock", aisle + b * (bw + aisle) + bw / 2, top + (rows * 0.95) / 2, { w: bw, d: rows * 0.95, rows, color: b === 1 ? "#1d5f4a" : "#174a3a" });
  F.person("staff", W / 2 - 1.2, 3.0, { face: "front", mode: "stand", }); for (let k = 0; k < 8; k++) F.person(k % 3 ? "celebrant" : "student", aisle + (k % nb) * (bw + aisle) + 1.0 + (k >> 1), top + (k % 4) * 0.95 + 0.1, { face: "back", mode: "sit" });
  const fr = frame(p, p.byId.get("foyer"), "n"); fr.add("reception", W * 0.28, 4.2, { w: 3.2, sign: "Events desk", color: "#1d3b2f" }); fr.hub(W * 0.28, 3.2, "Events and tickets", 0); fr.wall("notice", W * 0.3, { label: "Convocation" }); fr.wall("notice", W * 0.7, { label: "Events" }); fr.add("plant", 1.0, 4.4); fr.add("plant", W - 1.0, 4.4);
  fr.add("display", 14.5, 4.4, { w: 1.4, color: "#d9a441" }); fr.add("display", 20, 4.4, { w: 1.4, color: "#d9a441" }); fr.add("waitchairs", W * 0.74, 4.8, { w: 2.4, turn: PI }); fr.add("waitchairs", W * 0.12, 4.8, { w: 2.4, turn: PI });
  crowd(p, "celebrant", 4, ["foyer", "hall"], 0); crowd(p, "student", 3, ["foyer"], 0); return p;
}

// ------------------------------------------------------------------------------------------------ Senate

export function senate(spec, place) {
  const p = new Plan(spec.id, place.name, { floors: 2, style: { wall: "#ebe6d6", facade: "#d8d4c6", ceil: "#f4f1e8" } });
  corridorBlock(p, { x0: 0, z0: 0, floor: 0, key: "g", nD: 6.4, sD: 6.4, cw: 2.8, north: [{ id: "registry", name: "Registry", w: 9, fill: fillSharedOffice(), surface: "carpet" }, { id: "affairs", name: "Academic Affairs Office", w: 9, fill: fillSharedOffice(), surface: "carpet" }, { id: "admissions", name: "Admissions Office", w: 8, fill: fillSharedOffice(), surface: "carpet" }],
    south: [{ stair: true, id: "stair", w: 2.0 }, { id: "security", name: "Security desk", w: 4.4, fill: fillPorter({ sign: "Security" }), surface: "wood" }, { id: "lobby", name: "Senate Building foyer", w: 12, fill: fillLobby({ sign: "Academic Affairs", notice: "Senate notices", hubLabel: "Academic affairs desk", action: 0, sofas: true, chairs: "#1d5f4a", color: "#1d3b2f" }), surface: "marble", wide: true }, { id: "records", name: "Records room", w: 5, fill: (F) => { F.wall("filing", 0.6); F.wall("filing", 1.4); F.wall("filing", F.W - 0.6); F.add("table", F.W / 2, 2.4, { w: 2.0, d: 0.9, chairs: 2 }); F.person("staff", F.W / 2, 3.6, { face: "back" }); }, surface: "carpet" }] });
  const lobby = p.byId.get("lobby"); p.enter("lobby", "s", (lobby.x0 + lobby.x1) / 2, 2.4);
  const board = (F) => { const { W, D } = F; F.add("meetingtable", W / 2, D / 2 + 0.2, { w: 8.4, d: 2.4, chairs: 16, color: "#4a2f1e", chairColor: "#1d5f4a" }); F.add("flag", 1.3, 0.5, { y: 1.9 }); F.add("flag", W - 1.3, 0.5, { y: 1.9 }); F.wall("banner", W / 2, { w: 4, y: 2.4, hh: 0.8, label: "UNIVERSITY SENATE", color: "#1d3b2f" }); F.person("staff", W / 2, D / 2 - 1.5, { face: "front", mode: "sit" }); F.person("staff", W / 2 - 1.5, D / 2 + 1.9, { face: "back", mode: "sit" }); };
  const vc = (F) => { const { W } = F; F.add("officedesk", W / 2, 1.6, { color: "#4a2f1e", w: 1.8 }); F.add("sofa", W - 1.6, 3.6, { w: 1.9, turn: PI, color: "#5f3b2a" }); F.add("loungeTable", W - 1.6, 2.6, {}); F.wall("bookshelf", 1.0, { w: 1.4 }); F.wall("bookshelf", W - 1.0, { w: 1.4 }); F.add("flag", W / 2 - 1.4, 0.5, { y: 1.9 }); F.person("staff", W / 2, 0.9, { face: "front", mode: "sit" }); };
  corridorBlock(p, { x0: 0, z0: 0, floor: 1, key: "u", nD: 6.4, sD: 6.4, cw: 2.8, north: [{ id: "chamber", name: "Council Chamber", w: 13, fill: board, surface: "wood", wide: true, wall: "#e2d9c4" }, { id: "vc", name: "Vice-Chancellor's Suite", w: 9, fill: vc, surface: "carpet", wall: "#e6dcc8" }, { id: "registrar", name: "Registrar's Office", w: 7, fill: vc, surface: "carpet" }],
    south: [{ stair: true, id: "stair", w: 2.0 }, { id: "waiting", name: "Waiting area", w: 3.6, fill: fillLanding(), surface: "carpet" }, { id: "bullpen", name: "Secretaries' office", w: 5.4, fill: fillSharedOffice(), surface: "carpet" }, { id: "meet1", name: "Meeting Room 1", w: 8, fill: fillSeminar(), surface: "carpet" }, { id: "meet2", name: "Meeting Room 2", w: 8, fill: fillSeminar({ chairs: 6 }), surface: "carpet" }] });
  crowd(p, "staff", 3, ["gcorr", "lobby"], 0); crowd(p, "student", 3, ["lobby", "gcorr"], 0); crowd(p, "staff", 3, ["ucorr", "bullpen", "waiting"], 1); return p;
}

// ------------------------------------------------------------------------------------------------ Hezekiah Oluwasanmi Library

export function library(spec, place) {
  const W = 38, D = 26, p = new Plan(spec.id, place.name, { floors: 2, style: { wall: "#ebe4d2", facade: "#d6c9a6", ceil: "#f3efe4" } });
  const lobby = p.room("lobby", "Entrance and circulation hall", 0, 18, 35.4, D, { kind: "lobby", surface: "marble", wall: "#efe7d4" });
  const stacks = p.room("stacks", "General collection (open stacks)", 0, 0, 23, 18, { kind: "stacks", surface: "carpet", h: 3.4 });
  const ref = p.room("ref", "Reference and reading room", 23, 0, 35.4, 18, { kind: "room", surface: "carpet" });
  p.stairwell("stair", 35.4, 18, D, "n"); // low end at the north: the ground-floor door is from the lobby
  p.door("stair", "lobby", { w: 1.4, at: 19.0 });
  [6, 15].forEach((x) => p.door("stacks", "lobby", { at: x, w: 2.0 })); p.door("ref", "lobby", { at: 29, w: 2.0 }); p.door("stacks", "ref", { at: 9, w: 1.6 });
  p.enter("lobby", "s", 17.5, 2.6);
  // upper floor
  const qs = p.room("quiet", "Quiet study hall", 0, 0, 23, 18, { floor: 1, kind: "room", surface: "carpet" }), er = p.room("eres", "Electronic resources and computer lab", 23, 0, 35.4, 18, { floor: 1, kind: "room", surface: "carpet" });
  p.room("rare", "Research and special collections", 0, 18, 14, D, { floor: 1, surface: "wood" }); p.room("staff", "Library staff offices", 14, 18, 24, D, { floor: 1, surface: "carpet" }); p.room("group", "Group study and discussion", 24, 18, 35.4, D, { floor: 1, surface: "carpet" });
  p.door("rare", "quiet", { at: 6, w: 1.6 }); p.door("staff", "quiet", { at: 18, w: 1.6 }); p.door("group", "eres", { at: 29, w: 1.6 }); p.door("quiet", "eres", { at: 9, w: 1.6 }); p.door("stair_up", "group", { w: 1.3, at: D - 1.2 });
  // lobby: circulation desk, catalogue terminals, bag lockers, newspapers
  const f2 = frame(p, lobby, "n"); f2.wall("notice", 2.4, { label: "Library hours" }); f2.wall("notice", 32.4, { label: "New arrivals" }); f2.wall("locker", 23, { w: 2.8 });
  f2.add("reception", 17.5, 4.3, { w: 5.0, sign: "Circulation Desk", color: "#3b2a1d" }); f2.hub(17.5, 5.5, "Library services and courses", 0);
  for (let i = 0; i < 3; i++) { f2.front("pcdesk", 3.0 + i * 2.0, { w: 1.6 }); f2.front("pcdesk", 25.0 + i * 2.0, { w: 1.6 }); }
  f2.add("table", 8.5, 3.0, { w: 3.0, d: 2.2, chairs: 4 }); f2.add("table", 28.0, 3.0, { w: 3.0, d: 2.2, chairs: 4 }); f2.add("plant", 1.0, 5.4); f2.add("plant", 34.2, 5.4);
  f2.person("staff", 17.5, 3.5, { face: "front" }); f2.person("student", 8.5, 3.0, { face: "back", mode: "sit" });
  // open stacks: rows of shelving with aisles and a cross-aisle, tables under the windows
  const fs = frame(p, stacks, "n"); for (let r = 0; r < 5; r++) { const z = 2.0 + r * 2.5; for (const x of [4.3, 7.4, 14.6, 17.7]) fs.add("stack", x, z, { w: 2.8 }); }
  fs.add("table", 20.2, 14.4, { w: 2.6, d: 1.5, chairs: 4 }); fs.add("table", 2.6, 15.6, { w: 2.4, d: 1.4, chairs: 4 }); fs.person("student", 11, 1.3, { face: "front", mode: "stand" }); fs.person("student", 11, 12.8, { face: "back" });
  // reference and reading room
  const fr = frame(p, ref, "n"); for (let i = 0; i < 3; i++) fr.add("bookshelf", 1.2 + i * 1.5, 0.3, { w: 1.4 }); fr.add("table", 4.0, 6.6, { w: 3.0, d: 2.2, chairs: 6 }); fr.add("table", 9.0, 6.6, { w: 3.0, d: 2.2, chairs: 6 }); fr.add("table", 4.0, 11.0, { w: 3.0, d: 2.2, chairs: 6 }); fr.add("table", 9.0, 11.0, { w: 3.0, d: 2.2, chairs: 6 });
  fr.add("counter", 10.6, 1.3, { w: 2.0, sign: "Reference desk" }); fr.person("staff", 10.6, 0.6, { face: "front" }); fr.person("student", 4.0, 6.6, { face: "front", mode: "sit" }); fr.add("plant", 12, 16.8, {});
  // upper floor
  const fq = frame(p, qs, "n"); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) fq.add("desk", 2.0 + c * 3.3, 2.2 + r * 3.4, { w: 1.1, color: "#6b4226", turn: PI * 0 }); fq.add("table", 17.5, 14.4, { w: 4.6, d: 1.6, chairs: 8 }); fq.wall("bookshelf", 21.0, { w: 1.4 }); fq.wall("bookshelf", 19.4, { w: 1.4 }); fq.person("student", 3.7, 2.9, { face: "back", mode: "sit" }); fq.person("student", 6.9, 9.6, { face: "back", mode: "sit" });
  const fe = frame(p, er, "n"); for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) fe.add("pcrow", 3.2 + c * 6.0, 2.2 + r * 3.4, { w: 4.0 }); fe.add("counter", 6.2, 16.0, { w: 2.0, sign: "e-Resources help" }); fe.person("staff", 6.2, 15.3, { face: "back" }); fe.person("student", 3.2, 2.9, { face: "back", mode: "sit" });
  const fa = frame(p, p.byId.get("rare"), "s"); fa.add("display", 2.0, 1.2, { w: 1.5 }); fa.add("display", 4.2, 1.2, { w: 1.5, color: "#8f3b3b" }); fa.add("display", 6.4, 1.2, { w: 1.5 }); fa.add("table", 7.0, 4.6, { w: 3.0, d: 1.5, chairs: 4, color: "#4a2f1e" }); fa.wall("bookshelf", 11, { w: 1.6 }); fa.person("staff", 6.0, 4.6, { face: "back", mode: "sit" });
  frame(p, p.byId.get("staff"), "s").add("officedesk", 3.0, 1.8, {}); frame(p, p.byId.get("staff"), "s").add("officedesk", 7.0, 1.8, {}); frame(p, p.byId.get("staff"), "s").wall("filing", 9.4); frame(p, p.byId.get("staff"), "s").person("staff", 3.0, 0.9, { face: "front", mode: "sit" });
  const fg = frame(p, p.byId.get("group"), "s"); fg.add("table", 3.0, 2.6, { w: 3.0, d: 1.6, chairs: 6 }); fg.add("table", 8.2, 2.6, { w: 3.0, d: 1.6, chairs: 6 }); fg.add("whiteboard", 5.7, 0.05, { w: 2.2 }); fg.person("student", 3.0, 2.6, { face: "back", mode: "sit" });
  crowd(p, "student", 6, ["lobby", "stacks", "ref"], 0); crowd(p, "student", 4, ["quiet", "eres", "group"], 1); return p;
}

// ------------------------------------------------------------------------------------------------ Student Union Building

export function sub(spec, place) {
  const W = 36, p = new Plan(spec.id, place.name, { floors: 1, style: { wall: "#f0e6cf", facade: "#cdb98d", ceil: "#f4efe2" } });
  const lounge = p.room("lounge", "Student lounge and games area", 0, 0, 21, 14, { kind: "hall", surface: "tile", h: 4.2, wall: "#f2e8d0" }), assembly = p.room("assembly", "Union assembly hall", 21, 0, W, 14, { kind: "hall", surface: "wood", h: 4.2 });
  p.room("secretariat", "Union secretariat", 0, 14, 10, 21, { surface: "carpet" }); const lobby = p.room("lobby", "Entrance and services hall", 10, 14, 26, 21, { kind: "lobby", surface: "marble", h: 3.6 }); p.room("meet1", "Meeting room 1", 26, 14, 31, 21, { surface: "carpet" }); p.room("meet2", "Meeting room 2", 31, 14, W, 21, { surface: "carpet" });
  p.door("lounge", "lobby", { at: 15, w: 2.4 }); p.door("assembly", "lobby", { at: 23, w: 2.0 }); p.door("secretariat", "lounge", { at: 5, w: 1.4 }); p.door("meet1", "assembly", { at: 28.5, w: 1.2 }); p.door("meet2", "assembly", { at: 33.5, w: 1.2 }); p.door("secretariat", "lobby", { at: 17.5, w: 1.2 });
  p.enter("lobby", "s", 18, 2.6);
  const fl = frame(p, lounge, "n"); fl.add("tv", 10.5, 0.05, { w: 2.2 }); fl.add("sofa", 8.0, 3.2, { w: 2.0, turn: PI, color: "#3b6fc4" }); fl.add("sofa", 13.0, 3.2, { w: 2.0, turn: PI, color: "#b8473b" }); fl.add("loungeTable", 10.5, 2.0, {});
  fl.add("pingpong", 3.2, 8.4, { turn: PI / 2 }); fl.add("foosball", 6.9, 9.2, {}); fl.add("roundtable", 12.0, 8.8, { w: 2.0, chairs: 4 }); fl.add("roundtable", 17.0, 8.8, { w: 2.0, chairs: 4, chairColor: "#d9a441" }); fl.wall("notice", 19.0, { label: "Union notices" }); fl.add("plant", 20.0, 2.5); fl.add("plant", 0.6, 12.8);
  fl.person("student", 10.5, 3.2, { face: "back", mode: "sit" }); fl.person("student", 3.2, 6.9, { face: "back" }); fl.person("student", 3.2, 10.0, { face: "front" });
  const fa = frame(p, assembly, "n"); fa.add("stage", 7.5, 1.8, { w: 9, d: 3.4, h: 0.8 }); fa.add("banner", 7.5, 0.4, { w: 8, y: 2.6, hh: 1.2, label: "STUDENTS' UNION", color: "#1d5f4a" }); fa.add("podium", 7.5, 2.0, { lift: 0.8, solid: false });
  for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) fa.add("waitchairs", 4.0 + c * 6.0, 5.4 + r * 1.2, { w: 4.4, turn: 0 }); fa.person("student", 7.5, 2.4, { face: "front", mode: "stand" }); fa.person("student", 4.0, 5.6, { face: "back", mode: "sit" });
  const lb = frame(p, lobby, "n"); lb.add("reception", 8.0, 3.2, { w: 3.0, sign: "Union Information", color: "#1d5f4a" }); lb.hub(8.0, 2.2, "Meet people and join clubs", 0); lb.add("counter", 1.2, 0.9, { w: 2.0, sign: "Printing" }); lb.add("copier", 2.9, 0.7); lb.front("counter", 12.4, { w: 2.0, sign: "Snacks", color: "#b8473b" }); lb.front("freezer", 14.7, { w: 1.5 });
  lb.wall("notice", 15.2, { label: "Clubs" }); lb.add("plant", 0.7, 5.0); lb.person("clerk", 1.2, 0.5, { face: "front" }); lb.person("clerk", 12.4, 6.4, { face: "back" });
  const fs = frame(p, p.byId.get("secretariat"), "s"); fs.add("officedesk", 5.0, 1.8, { sign: "President" }); fs.wall("filing", 0.5); fs.wall("bookshelf", 9.0, { w: 1.1 }); fs.person("staff", 5.0, 0.9, { face: "front", mode: "sit" });
  for (const id of ["meet1", "meet2"]) fillSeminar({ chairs: 6, label: "Union meeting" })(frame(p, p.byId.get(id), "s"), p.byId.get(id), p);
  crowd(p, "student", 6, ["lounge", "lobby", "assembly"], 0); return p;
}

export const FAMILIES = { hostel, block: hostelBlock, faculty, theatre, classrooms, ceremonial, senate, library, sub };