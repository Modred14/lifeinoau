// tests/activity-visibility.test.mjs: a building's activities are on screen only once the player is inside it. Pure rules plus source wiring guards.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { showsActivitiesOutside, showsRoomActivities, wantedAct } from "../lib/activityVisibility.js";
import { INTERIOR, OUTDOOR } from "../lib3d/interiors/registry.js";
const rd = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
let n = 0; const t = (name, fn) => { fn(); n++; };

t("no place with an inside lists activities outside", () => {
  for (const id of Object.keys(INTERIOR)) assert.equal(showsActivitiesOutside({ id, kind: "building" }), false, id);
  assert.equal(showsActivitiesOutside({ id: "bld_12", kind: "building" }), false);
});
t("open-air places keep their list (there is no inside to enter)", () => {
  for (const id of Object.keys(OUTDOOR)) assert.equal(showsActivitiesOutside({ id, kind: "" }), true, id);
  assert.equal(showsActivitiesOutside(null), false);
});
t("a room shows activities only while the player is really in it", () => {
  assert.equal(showsRoomActivities({}), true);
  assert.equal(showsRoomActivities({ standby: true }), false); // built ahead while walking up / standing at the door
  assert.equal(showsRoomActivities({ leaving: true }), false);
});
t("an activity asked for by the Guide is still walked to after entering", () => {
  const list = [{ key: "k1", act: "read" }];
  assert.equal(wantedAct(list, "k1"), "read"); assert.equal(wantedAct(list, "read"), "read");
  assert.equal(wantedAct(list, "nope"), null); assert.equal(wantedAct(list, null), null);
});
const inside = rd("components/BuildingInside.js"), page = rd("src/app/map/page.js"), sheet = rd("components/TravelSheet.js"), home = rd("components/HomeWorld.js"), travel = rd("lib3d/travel.js");
t("every room activity surface is gated", () => {
  for (const c of ["ActivityLayer", "BuildingPanel"]) assert.ok(inside.includes(`{inRoom && <${c} `), c);
  assert.ok(inside.includes("{inRoom && isClub(place.id) && <ClubLayer "));
  assert.ok(page.includes("leaving={leaving}"));
});
t("the map card and travel sheet only list activities for open-air places", () => {
  assert.equal(page.match(/<PlaceActivities /g).length, 1);
  assert.ok(/showsActivitiesOutside\(L\) && <PlaceActivities /.test(page));
  assert.ok(/\{openAir && <PlaceActivities /.test(sheet));
});
t("home activities are offered only while inside the house", () => {
  assert.ok(travel.includes("indoors: !!home?.inside"));
  assert.ok(home.includes("{room && !act && indoors && <button"));
  assert.ok(home.includes("(indoors || act) && <HomeActivityPanel"));
});
console.log(`activity-visibility: ${n} checks passed`);
