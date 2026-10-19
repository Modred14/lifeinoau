// lib3d/interiors/index.js
// The one entry point: a place (id, name, kind ...) in, a compiled interior out. No 3D library, so Node can use it too.
import { classify, PLAN_NOTE } from "./registry.js";
import { FAMILIES } from "./plans.js";
import { FAMILIES2 } from "./plans2.js";
import { compile } from "./compile.js";

export { classify, hasInterior, PLAN_NOTE } from "./registry.js";
const ALL = { ...FAMILIES, ...FAMILIES2 };

/** The plan (rooms, doors, items, people) for a place, or null for places that stay outdoors. */
export function buildPlan(place) {
  const c = classify(place.id, place.kind); if (c.mode !== "interior") return null;
  const gen = ALL[c.spec.t]; if (!gen) throw new Error(`No interior family "${c.spec.t}" for ${place.id}`);
  const plan = gen(c.spec, { name: place.name ?? place.id, ...place }); plan.id = place.id; plan.title = place.name ?? plan.title; plan.family = c.spec.t; plan.note = PLAN_NOTE; return plan;
}
/** The plan, compiled into walls, colliders and navigation. Null for outdoor places. */
export function buildInterior(place) { const plan = buildPlan(place); return plan ? compile(plan) : null; }export { isOpenSpace, buildOpenInterior, OPEN_SPACES } from "./openSpaces.js";
