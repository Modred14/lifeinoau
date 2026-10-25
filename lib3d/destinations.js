// lib3d/destinations.js
// Which destination name tags are shown while someone is out walking or driving. Pure JS (no three.js, no DOM): runs in the browser and in the tests.
//
// A tag follows its building's roof (the map draws it); this decides WHICH tags are drawn on a given frame:
//   - only places near the traveller, with the big landmarks visible from further away than the small buildings, fading out towards the edge of their range;
//   - never more than MAX_TAGS at once, nearest first, and never two on top of each other;
//   - never a tag whose building is hidden behind a taller building (a line of sight from the camera to the tag is checked against the real footprints and their heights);
//   - the place you are going to is always shown;
//   - a tag that has appeared stays at least `hold` ms, and one that has gone does not come straight back, so a tag never flickers as you move.
// The caller supplies the projection to the screen and the line-of-sight test, so none of this needs a screen.

/** How far from the traveller (metres) a tag of each tier (1 = a landmark, 3 = a small building) is shown. */
export const TIER_RANGE = { 1: 340, 2: 200, 3: 115 };
export const MAX_TAGS = 14;
const SHOW_AGAIN_MS = 250;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const overlap = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/**
 * items: [{ id, tier, x, z (metres), pinned? }]. o: { me: {x, z}, now (ms), w, h (screen px), project(item) -> { x, y, on } | null, widthOf(item) -> px, occluded?(item, dist) -> bool, maxTags?, hold? }.
 * state: a Map the caller keeps between calls. Returns a Map of id -> opacity (0..1) for the tags to draw; every other tag is hidden.
 */
export function selectTags(items, o, state) {
  const { me, now, project, widthOf, occluded, maxTags = MAX_TAGS, hold = 320 } = o, rank = [];
  for (const it of items) {
    const d = Math.hypot(it.x - me.x, it.z - me.z), range = it.pinned ? Infinity : TIER_RANGE[it.tier] ?? TIER_RANGE[3]; if (d > range) continue;
    const s = state.get(it.id), sticky = s?.shown ? 30 : 0;                                       // one already on screen is a little easier to keep than a new one is to add
    rank.push({ it, d, key: it.pinned ? -1 : d - sticky + (it.tier - 1) * 25, fade: it.pinned ? 1 : clamp((range - d) / (range * 0.4), 0.4, 1) });
  }
  rank.sort((a, b) => a.key - b.key);
  const want = new Map(), taken = [];
  for (const r of rank) {
    if (!r.it.pinned && want.size >= maxTags) break;
    const p = project(r.it); if (!p || !p.on) continue;
    const wd = widthOf(r.it), box = [p.x - wd / 2, p.y - 22, p.x + wd / 2, p.y + 4];
    if (!r.it.pinned) { if (taken.some((t) => overlap(box, t))) continue; if (occluded?.(r.it, r.d)) continue; }
    taken.push(box); want.set(r.it.id, r.fade);
  }
  const out = new Map();
  for (const [id, op] of want) {
    const s = state.get(id);
    if (!s?.shown) { if (s && now - s.hiddenAt < SHOW_AGAIN_MS) continue; state.set(id, { shown: true, at: now, op }); }
    else s.op = op;
    out.set(id, op);
  }
  for (const [id, s] of state) {
    if (!s.shown || want.has(id)) continue;
    if (now - s.at < hold) out.set(id, s.op ?? 0.6); else state.set(id, { shown: false, hiddenAt: now });   // it stays a moment longer, then goes
  }
  return out;
}

/**
 * Is the straight line from the camera to a tag hidden behind a building? cam and tag are { x, y, z } in metres (y is the height); heights maps a building id to its drawn height
 * in metres; ownBid is the building the tag belongs to (it never hides its own tag). Walks the line in `step`-metre steps over the collision world's footprints.
 */
export function sightBlocked(world, heights, cam, tag, ownBid, step = 3) {
  const dx = tag.x - cam.x, dz = tag.z - cam.z, len = Math.hypot(dx, dz), n = Math.min(90, Math.floor(len / step));
  for (let i = 1; i < n; i++) {
    const t = i / (n || 1), x = cam.x + dx * t, z = cam.z + dz * t, pi = world.inside(x, z); if (pi < 0) continue;
    const tg = world.polys[pi].tag; if (!tg || tg.kind !== "building" || tg.id === ownBid) continue;
    if ((heights.get(tg.id) ?? 0) > cam.y + (tag.y - cam.y) * t) return true;
  }
  return false;
}
