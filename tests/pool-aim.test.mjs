// tests/pool-aim.test.mjs: the cue interaction's maths (components/games/poolAim.js) and that what the player aims, pulls and spins is what the server's physics (lib/games/pool.js) plays.
import assert from "node:assert/strict";
import * as A from "../components/games/poolAim.js";
import { simulate, TABLE } from "../lib/games/pool.js";
let n = 0; const ok = (m) => console.log("OK  ", ++n, m), near = (a, b, e, m) => assert.ok(Math.abs(a - b) <= e, `${m}: ${a} vs ${b}`);
const R = TABLE.r;

// ---- pull <-> power
near(A.pullToPower(0), 0, 1e-9, "no pull"); near(A.pullToPower(A.MAX_PULL), 1, 1e-9, "full pull"); near(A.pullToPower(A.MAX_PULL / 2), 0.5, 1e-9, "half pull"); near(A.pullToPower(A.MAX_PULL * 3), 1, 1e-9, "over-pull clamps"); near(A.pullToPower(-20), 0, 1e-9, "pushing forward is no power");
for (const p of [0, 0.17, 0.5, 0.99, 1]) near(A.pullToPower(A.powerToPull(p)), p, 1e-9, "round trip");
ok("pull distance maps linearly onto power 0..1 and clamps at both ends");

// ---- aim angle: straight to the pointer, in table space (angle 0 = +x, growing towards +y)
const cue = { x: 250, y: 250 };
near(A.aimAngle(cue, [350, 250], 9), 0, 1e-9, "+x"); near(A.aimAngle(cue, [250, 350], 9), Math.PI / 2, 1e-9, "+y"); near(A.aimAngle(cue, [150, 250], 9), Math.PI, 1e-9, "-x"); near(A.aimAngle(cue, [250, 150], 9), -Math.PI / 2, 1e-9, "-y");
assert.equal(A.aimAngle(cue, [255, 252], 1.25), 1.25); ok("the aim angle points from the cue ball at the pointer; a pointer on the ball keeps the old angle");

// ---- the stick sits behind the ball, opposite the aim, and its distance behind the ball grows with the pull
for (const aim of [0, 1, -2, 3]) {
  const [tip, butt] = A.cueSegment(cue, aim, R, 0);
  near(Math.hypot(tip[0] - cue.x, tip[1] - cue.y), R + A.TIP_GAP, 1e-9, "tip rests just off the ball");
  near(Math.atan2(cue.y - tip[1], cue.x - tip[0]) - aim, 0, 1e-9, "stick lies opposite the aim");
  near(Math.hypot(butt[0] - tip[0], butt[1] - tip[1]), A.CUE_LEN, 1e-9, "stick length");
  const [tip2] = A.cueSegment(cue, aim, R, 50); near(Math.hypot(tip2[0] - cue.x, tip2[1] - cue.y), R + A.TIP_GAP + 50, 1e-9, "pull slides the stick straight back");
}
ok("the drawn stick is opposite the aim at any angle and slides back by exactly the pull");

// ---- grabbing the stick, and dragging it back
const aim = 0, tol = 40;
assert.ok(A.onCue(cue, aim, R, 0, [cue.x - 100, cue.y + 10], tol)); assert.ok(!A.onCue(cue, aim, R, 0, [cue.x + 100, cue.y], tol)); assert.ok(!A.onCue(cue, aim, R, 0, [cue.x - 100, cue.y + 200], tol));
ok("a touch near the stick grabs it; in front of the ball or far to the side does not");
const grab = A.backDistance(cue, aim, [cue.x - 100, cue.y]); near(grab, 100, 1e-9, "100 behind");
near(A.pullFor(cue, aim, [cue.x - 100, cue.y], grab, 0), 0, 1e-9, "no movement, no pull");
near(A.pullFor(cue, aim, [cue.x - 140, cue.y], grab, 0), 40, 1e-9, "40 further back is a 40 pull");
near(A.pullFor(cue, aim, [cue.x - 140, cue.y + 60], grab, 0), 40, 1e-9, "sideways wobble of the finger does not change the pull");
near(A.pullFor(cue, aim, [cue.x - 400, cue.y], grab, 0), A.MAX_PULL, 1e-9, "a long drag is full power, not more");
near(A.pullFor(cue, aim, [cue.x - 60, cue.y], grab, 0), 0, 1e-9, "dragging forward of the grab point never goes below zero");
near(A.pullFor(cue, aim, [cue.x - 120, cue.y], grab, 30), 50, 1e-9, "a pull continues from where the stick already was");
const aim2 = Math.PI / 3, back = (d) => [cue.x - Math.cos(aim2) * d, cue.y - Math.sin(aim2) * d];
near(A.pullFor(cue, aim2, back(160), A.backDistance(cue, aim2, back(100)), 0), 60, 1e-9, "pulling works along any aim direction, not just along x"); ok("dragging the stick back maps to pull along the stick's own axis, clamped to 0..max");

// ---- end to end against the real physics
const balls = Array.from({ length: 16 }, () => ({ x: -1, y: -1, in: true })); balls[0] = { x: 100, y: 250, in: false }; balls[1] = { x: 220, y: 250, in: false }; // short runs: nothing reaches a cushion, so distances compare cleanly
const run = (angle, power, spin = 0, b = balls) => simulate(b, angle, power, spin);
let last = null;
for (const p of [0.1, 0.13, 0.16, 0.2, 0.23]) { const r = run(0, p), c = r.balls[0]; assert.ok(r.events.first === 1, "hit the ball"); if (last) assert.ok(r.balls[1].x > last, "harder is further"); last = r.balls[1].x; assert.ok(Math.abs(r.balls[1].y - 250) < 1, "straight shot stays straight"); }
ok("a shot goes exactly where it was aimed and the object ball travels further the more power it was given");
const slow = run(0, 0.05), fast = run(0, 1); assert.ok(slow.frames.length < fast.frames.length); assert.ok(slow.balls[1].x < 300 && slow.balls[1].x > 220); ok("a tiny pull is a soft shot (the ball barely moves on), a full pull a hard one (a much longer run)");
for (const ang of [0.3, -0.4, 2.5, -2.8]) { const b2 = balls.map((b) => ({ ...b })); b2[0] = { x: 500, y: 250, in: false }; b2[1] = { x: 500 + Math.cos(ang) * 150, y: 250 + Math.sin(ang) * 150, in: false }; const r = run(ang, 0.5, 0, b2); assert.equal(r.events.first, 1, "aimed at the ball: hits it, angle " + ang); }
ok("the angle the player sends is the direction the cue ball travels, in every direction");
// spin: follow carries the cue ball on past the contact point, draw pulls it back, none stops it dead-ish
const stop = run(0, 0.15, 0).balls[0].x, follow = run(0, 0.15, 1).balls[0].x, draw = run(0, 0.15, -1).balls[0].x;
assert.ok(follow > stop + 20, `follow rolls on (${follow} vs ${stop})`); assert.ok(draw < stop - 20, `draw comes back (${draw} vs ${stop})`); ok(`spin: follow ends ${Math.round(follow - stop)} units past a stop shot, draw ${Math.round(stop - draw)} units behind it`);
const half = run(0, 0.15, 0.5).balls[0].x; assert.ok(half > stop && half < follow); ok("spin is graded: half follow lies between none and full");
console.log("\nAll pool aiming checks passed");
