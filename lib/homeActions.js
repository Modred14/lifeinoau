// lib/homeActions.js
// What the three things you do at home that change the player (cooking, eating the meal, resting on the sofa) do to them. Pure (no database): the server runs it (lib/gameService.js actionInTx) and
// the tests run it. The numbers are NOT new: cooking and resting are the catalogue's own "Cook a meal" (hostel_cook) and "Rest on the sofa" (nap_common) in lib/activities.js, so a balance change there
// moves them too; the meal you cooked is eaten for half of what a bought meal gives (it was paid for when it was cooked). Sleep is not here (lib/sleepService.js).
import { ACTIVITIES, effectsOf, unmet, apply } from "./activities.js";
import { isJailed } from "./discipline.js";

const half = (d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Math.round(v / 2)]));
/** name -> the catalogue entry it follows, and how it is adjusted. */
export const HOME_ACTIONS = {
  home_cook: { from: "hostel_cook", memo: "Groceries" },
  home_rest: { from: "nap_common" },
  home_eat: { from: "eat_meal", free: true, memo: "Meal" },
};
export const isHomeAction = (name) => Object.prototype.hasOwnProperty.call(HOME_ACTIONS, name);

/** { error } or { stats, spend (kobo, only when something is paid), memo } for a player who is not asleep or in custody. Never mutates `c`. */
export function resolveHomeAction(c, name, now = Date.now()) {
  const h = HOME_ACTIONS[name]; if (!h) return null;
  if (isJailed(c, now)) return { error: "You are in custody. You cannot do that." };
  if (c.sleepingSince) return { error: "You are asleep." };
  const base = ACTIVITIES[h.from], def = h.free ? { ...base, cost: 0, d: half(base.d) } : base;
  const why = unmet(c, def, { now, runs: [], day: 0, week: 0 }); if (why) return { error: why };
  const { d, cost } = effectsOf(c, def), { stats } = apply(c, d);
  return { stats, spend: cost > 0 ? BigInt(cost) * 100n : undefined, memo: h.memo ?? base.memo };
}
