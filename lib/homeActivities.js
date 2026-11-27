// lib/homeActivities.js
// Everything about what a person can DO in their home, as data, with no three.js and no DOM, so the 3D scene, the Home Activity Panel, the server and the tests all read the same table.
//
//   ACTIVITIES   one entry per activity: its category, label, icon, the kind of spot it needs (a bed to lie on, a seat, a place to stand at a cooker / basin / shower, a patch of floor),
//                the animation clip to play (lib3d/avatar/homeClips.js and activityClips.js), how long it lasts, and what it does to the player (`server`).
//   SPOTS        for each piece of furniture that can host something, WHERE the body goes, in the piece's own frame (model units; the piece faces +z): the place to stand while walking up,
//                and the place the body ends up (the seat, the bed, in front of the basin). The model frame is the one lib3d/furnitureModels.js builds.
//   listActivities(), chooseSpot(), hostsOf()   what is available in THIS home now, and the exact spot (in metres on the map) for one activity.
//
// Geometry: an item sits at (x, z) cells with the footprint sizeOf(key, rot); the scene turns its model by -rot quarter-turns about its centre. Positions here are in that model frame
// (1 unit = one cell = CELL_M metres); `env.toWorld(cx, cz)` turns a position in cells into metres on the map and `env.dirOf(dx, dz)` turns a direction. Heights are returned in metres.
import { ITEMS, sizeOf, isOutdoor } from "./furniture.js";
import { isOutside } from "./room.js";
import { SLEEP, BED_KEYS } from "./sleep.js";

export const CELL_M = 0.9;

export const CATEGORIES = [
  { id: "rest", label: "Rest and Sleep", icon: "moon" },
  { id: "kitchen", label: "Kitchen and Food", icon: "kitchen" },
  { id: "bath", label: "Bathroom and Hygiene", icon: "shower" },
  { id: "care", label: "Personal Care", icon: "wash" },
  { id: "relax", label: "Relaxation", icon: "sofa" },
  { id: "other", label: "Other Home Activities", icon: "study" },
];

const SOFAS = ["sofa", "loveseat", "velvet_sofa", "designer_sofa"], CHAIRS = ["office_chair", "plastic_chair"], ARM = ["armchair"], BEDS = [...new Set([...BED_KEYS, "luxury_bed"])];
const SINKS = ["bathroom_vanity", "ensuite", "toilet"];

/**
 * secs: how long the active part lasts. clip: the avatar clip. spot: which kind of spot on the host. needs: what else must be in the home.
 * server: what the server is told when it has finished ({ action } for /api/action, "sleep" for /api/sleep); null = nothing changes but the person's day.
 * private: the camera moves well back and high (a bathroom): nothing intimate is ever framed. meal: "make" puts a cooked meal on the table, "eat" uses one.
 */
export const ACTIVITIES = {
  sleep: { cat: "rest", label: "Sleep", doing: "Sleeping", icon: "moon", hosts: BEDS, spot: "lie", clip: "sleepLie", secs: SLEEP.durationMs / 1000, server: "sleep", energyBelow: SLEEP.stopAt - 4, tired: "You are not tired enough to sleep." },
  nap: { cat: "rest", label: "Rest on the sofa", doing: "Resting", icon: "sofa", hosts: [...SOFAS, ...ARM], spot: "seat", clip: "sitRelax", secs: 12, server: { action: "home_rest" }, energyBelow: 85, tired: "You are well rested already." },
  cook: { cat: "kitchen", label: "Cook a meal", doing: "Cooking", icon: "kitchen", hosts: ["gas_cooker", "built_in_oven"], spot: "cook", clip: "cook", secs: 12, server: { action: "home_cook" }, meal: "make", missing: "There is no cooker in this home." },
  eat: { cat: "kitchen", label: "Eat your meal", doing: "Eating", icon: "meal", hosts: ["dining_set"], spot: "dine", clip: "eatSit", secs: 10, server: { action: "home_eat" }, meal: "eat", missing: "There is no dining table in this home." },
  shower: { cat: "bath", label: "Take a shower", doing: "Showering", icon: "shower", hosts: ["ensuite", "shower_enclosure"], spot: "shower", clip: "shower", secs: 10, server: null, private: true, missing: "There is no shower in this home." },
  bathe: { cat: "bath", label: "Take a bath", doing: "Bathing", icon: "bath", hosts: ["bathtub"], spot: "shower", clip: "shower", secs: 12, server: null, private: true, missing: "There is no bathtub in this home." },
  toilet: { cat: "bath", label: "Use the toilet", doing: "In the toilet", icon: "toilet", hosts: ["ensuite", "toilet"], spot: "toilet", clip: "sit", secs: 7, server: null, private: true, missing: "There is no toilet in this home." },
  wash: { cat: "care", label: "Wash your hands", doing: "Washing your hands", icon: "wash", hosts: [...SINKS, "counter", "quartz_counter"], spot: "basin", clip: "washHands", secs: 6, server: null, missing: "There is no basin in this home." },
  brush: { cat: "care", label: "Brush your teeth", doing: "Brushing your teeth", icon: "tooth", hosts: SINKS, spot: "basin", clip: "brushTeeth", secs: 8, server: null, missing: "There is no basin in this home." },
  tv: { cat: "relax", label: "Watch television", doing: "Watching television", icon: "tv", hosts: [...SOFAS, ...ARM], spot: "seat", clip: "watchTV", secs: 15, server: null, needs: ["tv", "smart_tv"], missing: "There is no television in this home.", tapOn: ["tv", "smart_tv", "tv_stand"] },
  phone: { cat: "relax", label: "Use your phone", doing: "On your phone", icon: "phone", hosts: [...SOFAS, ...ARM, ...CHAIRS], spot: "seat", clip: "sitPhone", secs: 10, server: null, missing: "There is nowhere to sit." },
  meditate: { cat: "relax", label: "Meditate", doing: "Meditating", icon: "mind", hosts: ["rug"], spot: "floor", clip: "meditate", secs: 15, server: null, missing: "Meditating needs a rug to sit on." },
  read: { cat: "other", label: "Read or study", doing: "Reading", icon: "study", hosts: CHAIRS, spot: "seat", clip: "read", secs: 12, server: null, missing: "There is no chair to read in.", tapOn: ["desk"] },
};
export const ACTIVITY_IDS = Object.keys(ACTIVITIES);

const SEATW = { sofa: 1.86, loveseat: 1.72, velvet_sofa: 2.42, designer_sofa: 2.55 };
const halfOf = (key) => [ITEMS[key].w / 2, ITEMS[key].d / 2];
const BED_Y = { iron_bunk: 0.45 };

/** The spots of every kind a piece offers, in its own frame: [{ at: [x, z], face: [dx, dz], y, from: [[x, z] ...] }]. `from` = where to stand while walking up (best first). Pure. */
export function spotsOf(key) {
  const [hw, hd] = ITEMS[key] ? halfOf(key) : [0.5, 0.5], front = hd + 0.5, side = hw + 0.5;
  if (BEDS.includes(key)) { // a bed is walked up to from either side (several places along it: a wardrobe or a nightstand may stand beside one end) or from its foot
    const wide = ITEMS[key].w > 1, y = BED_Y[key] ?? 0.6, zs = [0.1, 0.55, -0.35, 0.95].filter((z) => z > -hd + 0.2 && z < hd + 0.2), at = (x) => ({ at: [x, 0], face: [0, 1], y });
    if (!wide) return { lie: [{ ...at(0), from: [...zs.map((z) => [-side, z]), ...zs.map((z) => [side, z]), [0, front]] }] };
    // a double bed: you lie down on the side you walked up to (never across the mattress), or on the side nearer the foot-end approach
    return { lie: [{ ...at(-0.45), from: [...zs.map((z) => [-side, z]), [-0.45, front]] }, { ...at(0.45), from: [...zs.map((z) => [side, z]), [0.45, front]] }] };
  }
  if (SEATW[key]) { const w = SEATW[key]; return { seat: [-0.24, 0.24].map((k) => ({ at: [k * w, 0.08], face: [0, 1], y: 0.54, from: [[k * w, front]] })) }; }
  if (key === "armchair") return { seat: [{ at: [0, 0.08], face: [0, 1], y: 0.54, from: [[0, front]] }] };
  if (key === "plastic_chair") return { seat: [{ at: [0, 0.02], face: [0, 1], y: 0.5, from: [[0, front]] }] };
  if (key === "office_chair") return { seat: [{ at: [0, 0.02], face: [0, 1], y: 0.52, from: [[0, front]] }] };
  if (key === "dining_set") return { dine: [[-0.35, 0.68, -1], [0.35, 0.68, -1], [-0.35, -0.68, 1], [0.35, -0.68, 1]].map(([x, z, f]) => ({ at: [x, z], face: [0, f], y: 0.49, from: [[x, f < 0 ? 1.5 : -1.5]] })) };
  if (key === "gas_cooker" || key === "built_in_oven") return { cook: [{ at: [-0.04, 0.88], face: [0, -1], y: 0, from: [[-0.04, 0.88], [-side, 0.2], [side, 0.2]] }] };
  if (key === "ensuite") return { toilet: [{ at: [-0.55, 0.04], face: [0, 1], y: 0.31, from: [[-0.55, front]] }], basin: [{ at: [0.1, 0.42], face: [0, -1], y: 0, from: [[0.1, front]] }], shower: [{ at: [0.62, 0.12], face: [0, -1], y: 0, from: [[0.62, front]] }] };
  if (key === "toilet") return { toilet: [{ at: [-0.4, 0.04], face: [0, 1], y: 0.31, from: [[-0.4, front]] }], basin: [{ at: [0.4, 0.42], face: [0, -1], y: 0, from: [[0.4, front]] }] };
  if (key === "bathroom_vanity") return { basin: [{ at: [0, 0.88], face: [0, -1], y: 0, from: [[0, 0.88]] }] };
  if (key === "counter" || key === "quartz_counter") return { basin: [{ at: [-0.5, 0.88], face: [0, -1], y: 0, from: [[-0.5, 0.88]] }] };
  if (key === "shower_enclosure" || key === "bathtub") return { shower: [{ at: [0, 0.1], face: [0, -1], y: 0, from: [[0, front]] }] };
  if (key === "rug") return { floor: [{ at: [0, 0], face: [0, 1], y: 0.03, from: [] }] };
  return {};
}

/** The item's centre in cells, and how to turn a position / direction of its own frame into the room's (cells). */
export function frameOf(it) {
  const [w, d] = sizeOf(it.key, it.rot ?? 0), th = (-(it.rot ?? 0) * Math.PI) / 2, c = Math.cos(th), s = Math.sin(th), cx = it.x + w / 2, cz = it.z + d / 2;
  return { cx, cz, pos: (lx, lz) => [cx + lx * c + lz * s, cz - lx * s + lz * c], dir: (dx, dz) => [dx * c + dz * s, -dx * s + dz * c] };
}

const indoor = (room, it) => it && it.placed !== false && it.x != null && ITEMS[it.key] && !isOutdoor(it.key) && !isOutside(room, it);
const hostsOf = (def, items, room) => items.filter((it) => indoor(room, it) && def.hosts.includes(it.key));
const has = (items, room, keys) => items.some((it) => indoor(room, it) && keys.includes(it.key));

/**
 * What the panel offers: every activity, with whether the home has what it needs (`present`: absent ones are hidden by the panel) and whether it can be done now and, when not, why in one plain sentence.
 * ctx: { energy, sleeping, busy (an activity is running), jailed, meals (cooked meals ready to eat) }. Returns [{ id, ...def, available, why, hosts: [item] }].
 */
export function listActivities({ items = [], room, ctx = {} }) {
  return ACTIVITY_IDS.map((id) => {
    const def = ACTIVITIES[id], hosts = hostsOf(def, items, room);
    let why = null;
    if (ctx.jailed) why = "You are in custody.";
    else if (ctx.sleeping) why = "You are asleep.";
    else if (ctx.busy) why = "You are busy.";
    else if (!hosts.length) why = def.missing ?? "Not available here.";
    else if (def.needs && !has(items, room, def.needs)) why = def.missing;
    else if (def.energyBelow != null && (ctx.energy ?? 0) >= def.energyBelow) why = def.tired;
    else if (def.meal === "eat" && !(ctx.meals > 0)) why = "Cook a meal first.";
    // `present`: the fixture or furniture the activity needs is in the home. The panel only SHOWS present activities (an absent one is not offered at all, e.g. no shower in a hostel);
    // a present one that cannot be done right now (tired, busy, asleep) stays listed with its reason.
    const present = hosts.length > 0 && (!def.needs || has(items, room, def.needs));
    return { id, ...def, available: !why, why, hosts, present };
  });
}

/** The activities a tapped piece of furniture can start (ids), best first. Pure. */
export function activitiesFor(key) {
  return ACTIVITY_IDS.filter((id) => ACTIVITIES[id].hosts.includes(key) || ACTIVITIES[id].tapOn?.includes(key));
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
/**
 * The exact spot for an activity, in metres on the map, or null (with why). `from` is where the person stands now (the nearest free spot wins); `item` forces the host (the one that was tapped);
 * `free(x, z)` says whether a person fits at a point (the collision world), so a spot with something in the way is skipped. env: { toWorld, dirOf }.
 * Returns { id, item, kind, stand: { x, z } (where the walk ends), at: { x, z }, yaw, face: { hx, hz }, y (metres: the surface the body rests on), look: { x, z } (what the body looks at), secs, def }.
 */
export function chooseSpot(id, { items = [], room, from, env, item = null, free = () => true, taken = [] }) {
  const def = ACTIVITIES[id]; if (!def) return { why: "That is not something you can do." };
  let hosts = item && !def.hosts.includes(item.key) ? [] : item ? [item] : hostsOf(def, items, room);
  if (item && !hosts.length) { // a tapped television or desk: the seats that belong to it
    hosts = hostsOf(def, items, room);
    if (id === "tv") { const fr = frameOf(item), t = env.toWorld(fr.cx, fr.cz); hosts = hosts.filter((h) => { const f = frameOf(h), p = env.toWorld(f.cx, f.cz), [fx, fz] = env.dirOf(...f.dir(0, 1)), dx = t[0] - p[0], dz = t[1] - p[1], l = Math.hypot(dx, dz) || 1; return (fx * dx + fz * dz) / l > 0.35; }); }
    else if (id === "read") { const fr = frameOf(item), t = env.toWorld(fr.cx, fr.cz); hosts = hosts.filter((h) => { const f = frameOf(h), p = env.toWorld(f.cx, f.cz); return Math.hypot(p[0] - t[0], p[1] - t[1]) < 3.2; }); }
  }
  if (!hosts.length) return { why: def.missing ?? "Nothing here can be used for that." };
  const at = from ?? { x: 0, z: 0 }; let best = null;
  for (const host of hosts) {
    const fr = frameOf(host), list = spotsOf(host.key)[def.spot] ?? [];
    list.forEach((sp, i) => {
      const key = host.id + ":" + def.spot + ":" + i; if (taken.includes(key)) return;
      const [ax, az] = fr.pos(...sp.at), A = env.toWorld(ax, az), [dx, dz] = env.dirOf(...fr.dir(...sp.face)), yaw = Math.atan2(dx, dz);
      const walk = sp.from.length ? sp.from : [sp.at];
      for (const w of walk) {
        const [wx, wz] = fr.pos(...w), W = env.toWorld(wx, wz), stand = { x: W[0], z: W[1] };
        if (!free(stand.x, stand.z)) continue;
        const score = dist(at, stand) + (sp.from.length && w !== walk[0] ? 0.6 : 0); // the first way up is preferred a little
        if (!best || score < best.score) best = { score, key, id, item: host, kind: def.spot, stand, at: { x: A[0], z: A[1] }, yaw, face: { hx: dx / (Math.hypot(dx, dz) || 1), hz: dz / (Math.hypot(dx, dz) || 1) }, y: sp.y * CELL_M, secs: def.secs, def };
        break; // a spot's own best way up is used; only the nearest spot of the piece competes
      }
    });
  }
  if (!best) return { why: "There is no way to reach it: something is in the way." };
  delete best.score; return best;
}

/** What each tap on a piece should do: the single activity to start, or the list to choose from. Pure. */
export function tapChoices(key, items, room, ctx) {
  const all = listActivities({ items, room, ctx }), ids = activitiesFor(key);
  return all.filter((a) => ids.includes(a.id));
}
