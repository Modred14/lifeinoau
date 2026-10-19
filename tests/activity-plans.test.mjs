// tests/activity-plans.test.mjs
// Every activity has an acting plan, and the plans use only clips that exist; the activity clips are distinct by name.
import assert from "node:assert/strict";
import { ACTIVITIES } from "../lib/activities.js";
import { planFor, clipAt, PLAN_IDS, CYCLE_S } from "../lib3d/avatar/activityPlans.js";
import { ANIMATIONS } from "../lib3d/avatar/manifest.js";

const KNOWN = new Set([...Object.keys(ANIMATIONS), "listen", "write", "type", "read", "eatSit", "eat", "drink", "greet", "shop", "work", "pray", "present", "play", "interact", "sleepLie", "sit", "talk", "phone", "cheer", "gesture", "lookAround", "idleEmote"]);
for (const id of Object.keys(ACTIVITIES)) assert.ok(PLAN_IDS.includes(id), id + " has no plan");
for (const id of PLAN_IDS) { assert.ok(ACTIVITIES[id], id + " is not an activity"); const p = planFor(id); for (const n of [p.clip, ...(p.cycle ?? [])]) assert.ok(KNOWN.has(n), id + " uses unknown clip " + n); }
assert.equal(planFor("attend_class").clip, "listen"); assert.equal(planFor("sit_exam").clip, "write"); assert.equal(planFor("ict_lab").clip, "type"); assert.equal(planFor("study_course").seat, "chair");
assert.equal(planFor("sleep_bed").seat, "lie"); assert.equal(planFor("nope").clip, "interact");
const clips = new Set(PLAN_IDS.map((i) => planFor(i).clip)); assert.ok(clips.size >= 12, "too few distinct clips: " + clips.size);
const has = (n) => n !== "gesture"; const pl = planFor("haggle");
assert.equal(clipAt(pl, 0, has), "talk"); assert.equal(clipAt(pl, CYCLE_S + 1, has), "talk"); assert.equal(clipAt(planFor("join_club"), CYCLE_S + 1, has), "talk");
assert.equal(clipAt(planFor("buy_data"), 3, () => false), "idle");
console.log("OK  activity plans: " + PLAN_IDS.length + " activities, " + clips.size + " distinct main clips");
