// tests/hub-actions.test.mjs: the yellow rings. Every yellow ring in every real building (the desks, notice boards, stewards' desk, back stairwell...) must lead to
// something that really works (lib/hubActions.js). Before this, using one fell through to the "About this place" card and did nothing.
import fs from "node:fs";
import { LANDMARKS } from "../lib3d/landmarks.js";
import { withExtras } from "../lib3d/mapExtras.js";
import { classify, buildInterior, buildOpenInterior, isOpenSpace } from "../lib3d/interiors/index.js";
import { activityHubs } from "../lib3d/interiors/activityHubs.js";
import { BY_LABEL, BY_TYPE, resolveHub, pickCard } from "../lib/hubActions.js";
import { ACTIVITIES } from "../lib/activities.js";
import { CUSTODY_PLACE } from "../lib/discipline.js";

let bad = 0; const chk = (l, c, more) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l + (!c && more ? "\n     " + more : "")); };

// the phone's apps, read from the source (the same way tests/features.test.mjs finds them)
const phoneSrc = fs.readFileSync(new URL("../components/Phone.js", import.meta.url), "utf8");
const apps = new Set([...phoneSrc.slice(phoneSrc.indexOf("const APPS = {"), phoneSrc.indexOf("export const PHONE_APPS")).matchAll(/^ {2}(\w+): \{ name:/gm)].map((m) => m[1]));
chk(`found the phone's apps (${apps.size})`, apps.size >= 15 && apps.has("courses") && apps.has("housing") && apps.has("parties") && apps.has("sug"));

const d = withExtras(JSON.parse(fs.readFileSync(new URL("../public/data/oau-campus.json", import.meta.url), "utf8")));
const all = new Map(); for (const l of LANDMARKS) all.set(l.id, { id: l.id, name: l.name, kind: l.kind }); for (const p of d.places) all.set(p.id, { id: p.id, name: p.name, kind: p.kind });

let hubsSeen = 0, places = 0; const used = new Set(), problems = [];
for (const p of all.values()) {
  const cl = classify(p.id, p.kind); let c = null, rings = [];
  if (cl.mode === "interior") { c = buildInterior(p); rings = activityHubs(c, cl.spec).hubs; } else if (isOpenSpace(p.id)) c = buildOpenInterior(p);
  if (!c || !c.hubs.length) continue; places++;
  for (const h of c.hubs) {
    hubsSeen++; used.add(h.label); const t = resolveHub(h), tag = `${p.id} "${h.label}"`;
    if (t.kind === "info") { problems.push(`${tag}: leads nowhere (only the About card)`); continue; }
    if (t.kind === "app" && !apps.has(t.app)) problems.push(`${tag}: phone app "${t.app}" does not exist`);
    if (t.kind === "desk" && p.id !== CUSTODY_PLACE) problems.push(`${tag}: the charge desk only exists in ${CUSTODY_PLACE}`);
    if (t.kind === "activity") {
      for (const a of t.acts) if (!ACTIVITIES[a]) problems.push(`${tag}: unknown activity ${a}`);
      if (!t.acts.some((a) => rings.some((r) => r.act === a))) problems.push(`${tag}: none of ${t.acts.join("/")} is offered in this building, so there is no ring to walk to`);
    }
  }
}
chk(`every yellow ring (${hubsSeen} in ${places} buildings) leads to a working activity, app or desk`, problems.length === 0, problems.slice(0, 6).join("\n     "));
chk("no label in the table is dead (each is used by some real ring)", Object.keys(BY_LABEL).every((l) => used.has(l)), Object.keys(BY_LABEL).filter((l) => !used.has(l)).join(", "));
chk("every ring type the plans use has a fallback", ["faculty", "lecture", "test", "exam", "crew", "backstairs"].every((t) => BY_TYPE[t]));
chk("a ring the table does not know is reported as `info` (so the test above catches it)", resolveHub({ label: "Something new" }).kind === "info" && resolveHub(null).kind === "info");
chk("a ring's own label wins over its type", resolveHub({ label: "Examination hall", act: "faculty" }).acts?.[0] === "sit_exam");
chk("the lecture, test and exam desks lead to the three course activities", resolveHub({ label: "x", act: "lecture" }).acts[0] === "attend_class" && resolveHub({ label: "x", act: "test" }).acts[0] === "class_test" && resolveHub({ label: "x", act: "exam" }).acts[0] === "sit_exam");
chk("the stewards' desk is the safe hustle and the back stairwell the risky one", resolveHub({ label: "x", act: "crew" }).acts[0] === "event_gig" && resolveHub({ label: "x", act: "backstairs" }).acts[0] === "back_room_deal" && ACTIVITIES.back_room_deal.risky === true);

// pickCard: prefer a usable activity in the order given, else the first that exists (so the reason can be shown), else nothing
const cards = [{ act: "bank_errand", blocked: null }, { act: "fin_advice", blocked: "Come back tomorrow." }];
chk("pickCard prefers the first usable one", pickCard(cards, ["fin_advice", "bank_errand"]).act === "bank_errand");
chk("pickCard falls back to a blocked one so its reason can be shown", pickCard([{ act: "fin_advice", blocked: "Come back tomorrow." }], ["fin_advice", "bank_errand"]).blocked === "Come back tomorrow.");
chk("pickCard finds nothing when the building has none of them", pickCard(cards, ["sit_exam"]) === null && pickCard(null, ["sit_exam"]) === null);

console.log(bad ? `\n${bad} check(s) failed` : "\nAll yellow rings lead somewhere that works"); process.exit(bad ? 1 : 0);
