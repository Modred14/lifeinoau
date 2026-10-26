// tests/trip-controls.test.mjs
// The driving controls, headless: the keyboard (lib3d/tripkeys.js), how a key steers (lib3d/keysteer.js), that a turn really turns the car and the chase camera the right way and
// never winds up (lib3d/tripcam.js + lib3d/carphysics.js), the horn (lib/sfx.js), and the layout rules of the trip screen (components/TripHud.js + components/travel.css).
import assert from "node:assert/strict";
import fs from "node:fs";
import { createKeys, keyId, isActKey } from "../lib3d/tripkeys.js";
import { stepKeySteer, KEY_STEER } from "../lib3d/keysteer.js";
import { angDiff, followYaw } from "../lib3d/tripcam.js";
import { createCar, stepCar, carProfile } from "../lib3d/carphysics.js";
import { SOUNDS, SOUND_NAMES, makeKit } from "../lib/sfx.js";
let n = 0; const ok = (name, cond) => { assert.ok(cond, name); n++; };
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const ev = (code, o = {}) => ({ code, key: o.key ?? "", repeat: false, metaKey: false, ctrlKey: false, altKey: false, target: null, ...o });

// 1. keys are told apart by place on the keyboard, so W A S D work on any layout
ok("W is KeyW on a QWERTY board", keyId(ev("KeyW", { key: "w" })) === "KeyW");
ok("the key in the A place is KeyA on an AZERTY board (it types q)", keyId(ev("KeyA", { key: "q" })) === "KeyA");
ok("caps lock / shift do not change which key it is", keyId(ev("KeyD", { key: "D" })) === "KeyD");
ok("a browser with no code falls back to the letter", keyId({ key: "a" }) === "KeyA" && keyId({ key: "ArrowLeft" }) === "ArrowLeft" && keyId({ key: " " }) === "Space");
{ const k = createKeys();
  k.press(ev("KeyD", { key: "d" })); ok("D is a right turn", k.read().steer === 1 && k.read().right === 1);
  k.press(ev("KeyA", { key: "a" })); ok("A and D together cancel out", k.read().steer === 0);
  k.release(ev("KeyD")); ok("A alone is a left turn", k.read().steer === -1);
  k.clear(); ok("clear lets go of everything", k.held === 0 && k.read().steer === 0);
  ok("an arrow key stops the page scrolling, a letter does not", k.press(ev("ArrowUp")) === true && k.press(ev("KeyW")) === false);
  k.clear(); k.press(ev("KeyD", { metaKey: true, key: "d" })); ok("Cmd+D (bookmark) is not a right turn", k.read().steer === 0);
  k.clear(); k.press(ev("KeyA", { ctrlKey: true, key: "a" })); ok("Ctrl+A (select all) is not a left turn", k.read().steer === 0);
  k.clear(); k.press(ev("KeyA")); k.press(ev("KeyW")); k.release(ev("MetaLeft")); ok("letting go of Cmd drops everything held (a Mac sends no key-up for the others)", k.held === 0);
  k.clear(); k.press(ev("KeyD", { target: { closest: (q) => (/input/.test(q) ? {} : null) } })); ok("typing in a text box never drives the car", k.read().steer === 0);
  k.clear(); k.press(ev("ShiftRight")); ok("either Shift is run", k.read().run === 1);
  ok("E and F are the act keys, on their own and not repeating", isActKey(ev("KeyE")) && isActKey(ev("KeyF")) && !isActKey(ev("KeyE", { repeat: true })) && !isActKey(ev("KeyE", { metaKey: true }))); }

// 2. a key steers like a wheel: gradually, never a jump to full lock
{ ok("a key does not jump to full lock in one frame", stepKeySteer(0, 1, 1 / 60) < 0.06);
  let v = 0; for (let i = 0; i < 60; i++) v = stepKeySteer(v, 1, 1 / 60); ok("held for a second it reaches full lock", v === 1);
  let tap = 0; for (let i = 0; i < 6; i++) tap = stepKeySteer(tap, 1, 1 / 60); ok("a tap of 0.1 s is a small correction (under a third of full lock)", tap > 0.1 && tap < 0.34);
  let r = 1; for (let i = 0; i < 40; i++) r = stepKeySteer(r, 0, 1 / 60); ok("letting go brings it back to straight", r === 0);
  let f = 1; for (let i = 0; i < 20; i++) f = stepKeySteer(f, -1, 1 / 60); ok("pressing the other way swings through the middle and out the other side quickly", f < -0.5);
  const a = (() => { let x = 0; for (let i = 0; i < 30; i++) x = stepKeySteer(x, 1, 1 / 30); return x; })(), b = (() => { let x = 0; for (let i = 0; i < 120; i++) x = stepKeySteer(x, 1, 1 / 120); return x; })();
  ok("the same at 30 and 120 frames a second", Math.abs(a - b) < 0.05);
  ok("a bad time step changes nothing", stepKeySteer(0.4, 1, 0) === 0.4 && stepKeySteer(0.4, 1, -1) === 0.4 && KEY_STEER.fall > KEY_STEER.rise); }

// 3. the turn: D turns the car (and its nose) to the right, A to the left, and the chase camera stays behind it
{ const P = carProfile("corolla-2011");
  const drive = (steerOf, secs = 5) => { const c = createCar({ ang: 0 }); let ks = 0; for (let i = 0; i < secs * 60; i++) { ks = stepKeySteer(ks, steerOf(i / 60), 1 / 60); stepCar(c, { gas: c.v < 8 ? 1 : 0.2, steer: ks }, 1 / 60, null, P); } return c; };
  const right = drive((t) => (t > 1 ? 1 : 0)), left = drive((t) => (t > 1 ? -1 : 0));
  // the car faces +z (south) at ang 0; its right hand is west (-x)
  ok("holding D: the nose turns right (heading angle falls) and the car ends up to the right of where it started", right.ang < -0.5 && right.x < -2);
  ok("holding A: the nose turns left (heading angle rises) and the car ends up to the left", left.ang > 0.5 && left.x > 2);
  ok("left and right are mirror images", Math.abs(left.ang + right.ang) < 1e-6 && Math.abs(left.x + right.x) < 1e-6);
  ok("the front wheels show the same turn: wheel angle is positive (left) for A and negative for D", left.steer > 0.05 && right.steer < -0.05);
  ok("the car moves the way its nose points", Math.abs(Math.atan2(left.hx, left.hz) - left.ang) < 1e-9 && Math.abs(Math.atan2(right.hx, right.hz) - right.ang) < 1e-9);
  // the same loops in both directions, many times round: the camera tracks the car every time
  for (const dir of [1, -1]) {
    const c = createCar({ ang: 0 }); let cam = Math.PI, worst = 0, ks = 0; const dt = 1 / 60;
    for (let i = 0; i < 60 * 90; i++) { const t = i * dt; ks = stepKeySteer(ks, t > 2 ? dir : 0, dt); stepCar(c, { gas: c.v < 9 ? 1 : 0.3, steer: ks }, dt, null, P); cam = followYaw(cam, Math.atan2(c.hx, c.hz) + Math.PI, c.v, dt); if (t > 5) worst = Math.max(worst, Math.abs(angDiff(cam, Math.atan2(c.hx, c.hz) + Math.PI))); }
    ok(`${dir > 0 ? "right" : "left"}-hand circles: ${Math.abs(c.ang / (2 * Math.PI)).toFixed(1)} turns, the camera stays within 15 degrees of straight behind the car`, Math.abs(c.ang) > 4 * Math.PI && worst < 0.27);
    ok(`${dir > 0 ? "right" : "left"}-hand circles: the camera angle never winds up beyond half a turn of the car's`, Math.abs(cam - (Math.atan2(c.hx, c.hz) + Math.PI)) <= Math.PI + 1e-9); } }

// 4. the angle maths itself (the old formula went wrong once the camera angle was three half turns or more below the car's)
{ ok("angDiff is the short way round", Math.abs(angDiff(0.1, -0.1) + 0.2) < 1e-9 && Math.abs(angDiff(3.0, -3.0) - (2 * Math.PI - 6)) < 1e-9);
  for (const [a, b] of [[0, 10 * Math.PI + 0.3], [10 * Math.PI, -0.3], [-25, 40], [7, 7], [1e3, -1e3]]) { const d = angDiff(a, b); ok(`angDiff(${a}, ${b}) is within half a turn and lands on b`, Math.abs(d) <= Math.PI + 1e-9 && Math.abs(Math.sin(a + d) - Math.sin(b)) < 1e-6 && Math.abs(Math.cos(a + d) - Math.cos(b)) < 1e-6); }
  ok("followYaw reaches the wanted angle and stays", (() => { let c = 5; for (let i = 0; i < 600; i++) c = followYaw(c, 0.3, 0, 1 / 60); return Math.abs(c - 0.3) < 1e-3; })());
  const same = (fps) => { let c = 0; for (let i = 0; i < fps; i++) c = followYaw(c, 1, 8, 1 / fps); return c; };
  ok("the camera swings in at the same pace at 30 and 144 frames a second", Math.abs(same(30) - same(144)) < 0.01); }

// 5. the horn: a real recipe, held steady (not a fading blip), two notes a third apart
{ ok("there is a horn sound (before this, the horn button asked for one that did not exist)", SOUND_NAMES.includes("horn") && typeof SOUNDS.horn === "function");
  const made = []; const ctx = { currentTime: 10, sampleRate: 8000, createBuffer: () => ({ getChannelData: () => new Float32Array(8) }),
    createGain: () => { const g = { gain: { calls: [], setValueAtTime(v, t) { this.calls.push(["set", v, t]); }, exponentialRampToValueAtTime(v, t) { this.calls.push(["ramp", v, t]); }, value: 1 }, connect: (x) => x }; made.push(g); return g; },
    createOscillator: () => { const o = { type: "", frequency: { v: 0, setValueAtTime(v) { this.v = v; }, exponentialRampToValueAtTime() {}, value: 0 }, connect: (x) => x, start() {}, stop() {} }; made.push(o); return o; },
    createBiquadFilter: () => ({ type: "", frequency: { value: 0 }, Q: { value: 0 }, connect: (x) => x }) };
  SOUNDS.horn(makeKit(ctx, { connect: (x) => x }));
  const osc = made.filter((m) => m.type), gains = made.filter((m) => m.gain && !m.type && m.gain.calls.length);
  const freqs = osc.filter((o) => ["sawtooth", "square"].includes(o.type) && o.frequency.v > 100).map((o) => o.frequency.v).sort((a, b) => a - b);
  ok("two horns about a major third apart: roughly 420 and 530 Hz", freqs.includes(420) && freqs.includes(528) && 528 / 420 > 1.2 && 528 / 420 < 1.3);
  ok("buzzy waveforms, not a clean beep", osc.some((o) => o.type === "sawtooth"));
  const g0 = gains[0].gain.calls, peak = g0.find((c) => c[0] === "ramp" && c[1] > 0.01), holdAt = g0.find((c) => c[0] === "set" && c[1] === peak[1]), end = g0.at(-1);
  ok("it is switched on almost at once (under 20 ms)", peak[2] - 10 < 0.02);
  ok("it is HELD at that level, not fading from the peak like a beep", !!holdAt && holdAt[2] - peak[2] > 0.25);
  ok("it lasts about four tenths of a second and is cut off short", end[1] < 0.001 && end[2] - 10 > 0.35 && end[2] - 10 < 0.6 && end[2] - holdAt[2] < 0.12); }

// 6. the trip screen's layout: map on the right, the information panel on the left, wheel left and pedals right, nothing in the middle
{ const hud = read("components/TripHud.js"), css = read("components/travel.css");
  ok("the info panel (cancel + where you are going) comes before the map in the markup", hud.indexOf('className="th-info"') > 0 && hud.indexOf('className="th-info"') < hud.indexOf('className="th-side"'));
  ok("the mini map and the speed are in the right-hand column", /className="th-side">[\s\S]*className="th-mini"[\s\S]*className="th-speed"/.test(hud));
  ok("the old centred chip, map and arrow are gone", !/th-chip|th-way/.test(hud + css));
  ok("info panel is anchored left, the map column right, wheel left, pedals right", /\.th-info \{[^}]*left: var\(--th-l\)/.test(css) && /\.th-side \{[^}]*right: var\(--th-r\)/.test(css) && /\.th-wheel \{[^}]*left: var\(--th-l\)/.test(css) && /\.th-pedals \{[^}]*right: var\(--th-r\)/.test(css));
  ok("nothing in the trip block is centred on the screen's vertical middle", !/\.th(-info|-side|-mini|-wheel|-pedals|-card|-speed)\b[^{]*\{[^}]*(top: 50%|bottom: 50%)/.test(css));
  const block = css.slice(css.indexOf("/* ---- the trip:"), css.indexOf(".th-pre-scrim {")).replace(/\/\*[\s\S]*?\*\//g, "");
  { let d = 0, low = 0; for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, "")) { if (ch === "{") d++; else if (ch === "}") { d--; if (d < low) low = d; } } ok("travel.css has balanced braces (a stray one silently drops every rule after it)", d === 0 && low === 0); }
  ok("flat colours only: no gradients in the driving controls", !/gradient/i.test(block + hud));
  for (const q of ["(max-width: 340px)", "(min-width: 600px) and (min-height: 560px)", "(min-width: 1024px) and (min-height: 640px) and (pointer: fine)", "(max-height: 520px) and (orientation: landscape)", "(max-height: 380px) and (orientation: landscape)"]) ok(`there are sizes for ${q}`, css.includes(q));
  ok("the pedals are held buttons that show when they are pressed", /th-pedal th-brake/.test(hud) && /th-pedal th-gas/.test(hud) && /\.th \.th-pedal\[data-down\]/.test(css) && /dataset\.down/.test(hud));
  ok("the wheel shows when a finger is on it", /dataset\.held/.test(read("components/SteeringWheel.js")) && /\.th-wheel\[data-held="1"\]/.test(css));
  ok("touch targets are at least 44 px", /--th-aux: 44px/.test(css) && /--th-pw: 78px/.test(css) && !/--th-aux: (3[0-9]|[12]?[0-9])px/.test(css.replace(/max-height: 380px[\s\S]*?\n\}/, "")));
  ok("the horn honks on press and has no silent click path", /onPointerDown=\{\(\) => playSound\("horn"\)\}/.test(hud) && !/data-sound="horn"/.test(hud));
  const nav = read("lib3d/travel.js"); ok("the engine reads keys by place (tripkeys) and steers them through keysteer", /createKeys/.test(nav) && /stepKeySteer/.test(nav) && !/e\.key\.toLowerCase\(\)/.test(nav.slice(nav.indexOf("controls: keys"), nav.indexOf("controls: keys") + 900))); }

console.log(`trip-controls: ${n} checks passed`);
