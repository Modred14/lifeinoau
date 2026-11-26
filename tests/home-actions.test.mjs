// tests/home-actions.test.mjs
// What cooking, eating the cooked meal and resting on the sofa do to the player (lib/homeActions.js), against the catalogue they follow (lib/activities.js).
import { register } from "node:module";
register(new URL("./fixtures/room-loader.mjs", import.meta.url));
const { resolveHomeAction, isHomeAction, HOME_ACTIONS } = await import("../lib/homeActions.js");
const { ACTIVITIES } = await import("../lib/activities.js");
let bad = 0; const chk = (label, ok, extra = "") => { if (!ok) bad++; console.log(`${ok ? "OK  " : "FAIL"} ${label}${!ok && extra ? `: ${extra}` : ""}`); };
const c = (o = {}) => ({ health: 50, energy: 40, happiness: 50, academics: 50, popularity: 50, personalities: [], jailedUntil: null, sleepingSince: null, ...o });

chk("only the three home names are home actions", isHomeAction("home_cook") && isHomeAction("home_eat") && isHomeAction("home_rest") && !isHomeAction("rest") && !isHomeAction("hustle") && !isHomeAction("toString"));
chk("every home action follows an entry of the catalogue", Object.values(HOME_ACTIONS).every((h) => ACTIVITIES[h.from]));
chk("anything else is left to the plain actions (null)", resolveHomeAction(c(), "rest") === null && resolveHomeAction(c(), "hustle") === null);

const cook = resolveHomeAction(c(), "home_cook"), d = ACTIVITIES.hostel_cook;
chk("cooking costs what the catalogue's Cook a meal costs, in kobo", cook.spend === BigInt(d.cost) * 100n && cook.memo === "Groceries", String(cook.spend));
chk("cooking gives its energy, health and happiness", cook.stats.energy === 40 + d.d.energy && cook.stats.health === 50 + d.d.health && cook.stats.happiness === 50 + d.d.happiness);
const eat = resolveHomeAction(c(), "home_eat"), e = ACTIVITIES.eat_meal.d;
chk("eating the cooked meal is free (it was paid for when it was cooked)", eat.spend === undefined);
chk("eating gives half of a bought meal", eat.stats.energy === 40 + Math.round(e.energy / 2) && eat.stats.health === 50 + Math.round(e.health / 2));
const rest = resolveHomeAction(c(), "home_rest");
chk("resting on the sofa is free and gives energy", rest.spend === undefined && rest.stats.energy === 40 + ACTIVITIES.nap_common.d.energy);
chk("a rested player is refused a rest on the sofa, with a reason", /not tired/i.test(resolveHomeAction(c({ energy: 95 }), "home_rest").error ?? ""));
chk("stats never pass 100", resolveHomeAction(c({ energy: 98, health: 99, happiness: 100 }), "home_eat").stats.energy <= 100 && resolveHomeAction(c({ energy: 84, health: 99, happiness: 100 }), "home_cook").stats.health === 100);
chk("a player in custody cannot do any of them", ["home_cook", "home_eat", "home_rest"].every((n) => /custody/i.test(resolveHomeAction(c({ jailedUntil: new Date(Date.now() + 600000) }), n).error ?? "")));
chk("a sleeping player cannot do any of them", ["home_cook", "home_eat", "home_rest"].every((n) => /asleep/i.test(resolveHomeAction(c({ sleepingSince: new Date() }), n).error ?? "")));
chk("the input is never changed", (() => { const p = c(); const before = JSON.stringify(p); resolveHomeAction(p, "home_cook"); return JSON.stringify(p) === before; })());
console.log(bad ? `\n${bad} check(s) failed` : "\nAll checks passed"); process.exit(bad ? 1 : 0);
