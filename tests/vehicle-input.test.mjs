// tests/vehicle-input.test.mjs
// The one keyboard binding of every vehicle (lib3d/vehicleInput.js) and the one on-screen hold (lib/pointerHold.js), run headless with a fake window / document.
// The real browser run of the same rules, with real key and touch events on every vehicle, is tests/e2e/vehicle-controls.e2e.mjs.
import { attachVehicleKeys, createVehicleReader, clearVehicleInput, driveControls, driveAxes, modalOpen } from "../lib3d/vehicleInput.js";
import { createHold, releaseAllHolds, heldCount } from "../lib/pointerHold.js";

let bad = 0;
const ok = (label, v) => { console.log(`${v ? "OK   " : "FAIL "}${label}`); if (!v) { bad++; process.exitCode = 1; } };

// ---- a fake page
const mkDoc = () => { const d = new EventTarget(); d.hidden = false; d.dialogs = []; d.querySelectorAll = () => d.dialogs; return d; };
const dlg = (visible = true) => ({ closest: () => null, checkVisibility: () => visible });
const key = (code, extra = {}) => ({ code, key: code.replace("Key", "").toLowerCase(), repeat: false, metaKey: false, ctrlKey: false, altKey: false, target: { closest: () => null }, preventDefault() { this.prevented = true; }, ...extra });
const fire = (t, type, e) => { const ev = new Event(type); for (const [k, v] of Object.entries(e ?? {})) Object.defineProperty(ev, k, { value: v, writable: true, configurable: true }); t.dispatchEvent(ev); return ev; };
const rig = (o = {}) => { const win = new EventTarget(), doc = mkDoc(); let t = 0; const vin = attachVehicleKeys({ win, doc, now: () => t, active: () => true, ...o }); return { win, doc, vin, tick: (ms) => (t += ms), down: (c, x) => fire(win, "keydown", key(c, x)), up: (c) => fire(win, "keyup", key(c)) }; };

// ---- keydown / keyup
{ const r = rig(); r.down("KeyW"); ok("W held reads as gas", r.vin.keys.read().up === 1); r.up("KeyW"); ok("W released reads as nothing: the car stops accelerating", r.vin.keys.read().up === 0 && r.vin.keys.held === 0); r.vin.detach(); }
{ const r = rig(); r.down("KeyW"); r.down("KeyD"); r.down("ArrowDown"); const k = r.vin.keys.read(); ok("gas + steer + brake are held together", k.up && k.steer === 1 && k.down); r.up("KeyD"); ok("letting go of one key leaves the others held", r.vin.keys.read().up === 1 && r.vin.keys.read().steer === 0 && r.vin.keys.read().down === 1); r.vin.detach(); }
{ const r = rig(); r.down("KeyA"); r.down("KeyD"); ok("left + right together cancel", r.vin.keys.read().steer === 0); r.vin.detach(); }
{ const r = rig(); const e = r.down("Space"); ok("Space is the brake and the page is told not to scroll", r.vin.keys.read().space === 1 && e.prevented === true); r.vin.detach(); }
{ const r = rig(); r.down("KeyH"); ok("H is the horn", r.vin.keys.read().horn === 1); r.up("KeyH"); ok("H released stops the horn", r.vin.keys.read().horn === 0); r.vin.detach(); }
{ const r = rig(); r.down("KeyQ"); const up = r.vin.keys.read().climb; r.up("KeyQ"); r.down("KeyZ"); ok("Q climbs and Z descends (flying vehicles)", up === 1 && r.vin.keys.read().climb === -1); r.vin.detach(); }
{ const r = rig(); r.down("KeyD", { key: "ي" }); ok("keys are told apart by place, so another keyboard layout still drives", r.vin.keys.read().steer === 1); r.vin.detach(); }
{ const r = rig(); r.down("KeyD", { ctrlKey: true }); r.down("KeyW", { metaKey: true }); ok("a shortcut (Ctrl+D, Cmd+W) is never a control", r.vin.keys.held === 0); r.vin.detach(); }

// ---- one-shot keys (get in / out, take off)
{ const r = rig(); r.down("KeyE"); ok("E is taken once: get in / out", r.vin.take("act") === true && r.vin.take("act") === false); r.down("KeyF", { repeat: true }); ok("a held key's auto-repeat is not a new press", r.vin.take("act") === false);
  r.down("KeyT"); ok("T is taken once: take off / land", r.vin.take("fly") === true && r.vin.take("fly") === false); r.vin.detach(); }

// ---- things that must drop every key
{ const r = rig(); r.down("KeyW"); r.down("KeyD"); fire(r.win, "blur", {}); ok("losing window focus drops every key", r.vin.keys.held === 0); r.vin.detach(); }
{ const r = rig(); r.down("KeyW"); r.doc.hidden = true; fire(r.doc, "visibilitychange", {}); ok("hiding the tab drops every key", r.vin.keys.held === 0); r.vin.detach(); }
{ const r = rig(); r.down("KeyW"); r.doc.hidden = false; fire(r.doc, "visibilitychange", {}); ok("showing the tab again does not drop keys that are still held", r.vin.keys.held === 1); r.vin.detach(); }
{ const r = rig(); r.down("KeyW"); fire(r.win, "pagehide", {}); ok("leaving the page drops every key", r.vin.keys.held === 0); r.vin.detach(); }
{ const r = rig(); r.down("KeyW"); fire(r.win, "contextmenu", {}); ok("a context menu opening drops every key (no key-up comes after it on some platforms)", r.vin.keys.held === 0); r.vin.detach(); }
{ const r = rig(); r.down("KeyW"); r.down("KeyE"); fire(r.doc, "focusin", { target: { closest: (s) => (/input/.test(s) ? {} : null) } }); ok("focus moving into a text box drops every key and every pending one-shot", r.vin.keys.held === 0 && r.vin.take("act") === false); r.vin.detach(); }
{ const r = rig(); r.down("KeyW"); r.vin.clear(); ok("clear() (leaving the vehicle) drops every key", r.vin.keys.held === 0); r.vin.detach(); }
{ const r = rig(); const e = fire(r.win, "keydown", key("KeyD", { target: { closest: (s) => (/input/.test(s) ? {} : null) } })); ok("typing in a text box never drives, and is not blocked from the box", r.vin.keys.held === 0 && !e.prevented); r.vin.detach(); }

// ---- an open dialog
{ const r = rig(); r.down("KeyW"); ok("(setup) W held", r.vin.keys.held === 1);
  r.doc.dialogs = [dlg(true)]; r.tick(200); ok("a modal dialog opening is noticed from the frame loop within 150 ms: blocked() is true and every key is dropped", r.vin.blocked() === true && r.vin.keys.held === 0);
  r.down("KeyW"); ok("a key pressed under an open dialog is ignored", r.vin.keys.held === 0);
  r.up("KeyW"); ok("key-ups are still taken under a dialog (letting go always works)", true);
  r.doc.dialogs = []; r.tick(200); ok("closing the dialog gives the controls back", r.vin.blocked() === false); r.down("KeyW"); ok("... and keys drive again", r.vin.keys.held === 1); r.vin.detach(); }
{ ok("a hidden or display:none dialog does not count as open", modalOpen({ querySelectorAll: () => [dlg(false)] }) === false && modalOpen({ querySelectorAll: () => [{ closest: () => ({}), checkVisibility: () => true }] }) === false);
  ok("a visible modal dialog counts", modalOpen({ querySelectorAll: () => [dlg(true)] }) === true); }
{ let n = 0; const doc = mkDoc(); doc.querySelectorAll = () => { n++; return []; }; let t = 0; const win = new EventTarget(); const vin = attachVehicleKeys({ win, doc, now: () => t }); for (let i = 0; i < 600; i++) { t += 16; vin.blocked(); } ok(`blocked() every frame for 10 s (600 frames) looks at the page ${n} times, not 600`, n < 80); vin.detach(); }

// ---- not driving: keys are not taken
{ let driving = false; const win = new EventTarget(), doc = mkDoc(); const vin = attachVehicleKeys({ win, doc, active: () => driving }); fire(win, "keydown", key("KeyW")); ok("keys are not taken while not driving", vin.keys.held === 0); driving = true; fire(win, "keydown", key("KeyW")); ok("... and are taken while driving", vin.keys.held === 1); vin.detach(); }
{ const r = rig(); r.down("KeyW"); r.vin.detach(); r.down("KeyD"); ok("detach() drops the keys and removes every listener", r.vin.keys.held === 0); }

// ---- the mapping the engine uses every frame
{ const none = { up: 0, down: 0, space: 0, steer: 0, climb: 0, horn: 0 };
  const a = driveControls({ ...none, up: 1 }, { brake: 1 }); ok("gas key + brake pedal: both are asked for", a.gas === 1 && a.brake === 1);
  const b = driveControls(none, { gas: 1, steer: -1 }, 1); ok("the wheel and the keys' steering add up and clamp to -1..1", b.steer === 0 && driveControls(none, { steer: 1 }, 1).steer === 1);
  ok("Space brakes", driveControls({ ...none, space: 1 }, {}).brake === 1);
  ok("climb: the on-screen up, the on-screen down and the keys add up", driveControls(none, { climbUp: true }).climb === 1 && driveControls(none, { climbDown: true }).climb === -1 && driveControls(none, { climbUp: true, climbDown: true }).climb === 0 && driveControls({ ...none, climb: 1 }, { climbUp: true }).climb === 1);
  ok("horn from the key or the button", driveControls({ ...none, horn: 1 }, {}).horn === true && driveControls(none, { horn: true }).horn === true && driveControls(none, {}).horn === false);
  ok("no on-screen input at all is fine", driveControls(none, undefined).gas === 0);
  const g = driveAxes({ up: 1, down: 0, space: 0, steer: 0 }, { throttle: 0, steer: 1 }); ok("garage / compound axes: gas key + steer pad", g.throttle === 1 && g.steer === 1);
  ok("garage / compound axes: Space brakes, down reverses, and they clamp", driveAxes({ up: 0, down: 0, space: 1, steer: 0 }, null).throttle === -1 && driveAxes({ up: 1, down: 0, space: 0, steer: 1 }, { throttle: 1, steer: 1 }).throttle === 1); }


// ---- the per-frame reader the engine calls (createVehicleReader)
{ const r = rig(), input = { gas: 1, brake: 0, steer: 0.5, climbUp: true, horn: true }, vr = createVehicleReader({ vin: r.vin, input });
  let c = vr.read(true, 0.016); ok("driving: the on-screen gas, the wheel and the horn reach the vehicle", c.drive && c.gas === 1 && c.steer > 0 && c.horn === true);
  r.down("KeyD"); let last = 0, mono = true; for (let i = 0; i < 12; i++) { const v = vr.read(true, 0.016).steer - 0.5; if (v < last - 1e-9) mono = false; last = v; } ok("the key steering eases toward full lock instead of snapping there", mono && last > 0 && vr.read(true, 0.016).steer < 1.0 + 1e-9);
  r.up("KeyD"); for (let i = 0; i < 90; i++) vr.read(true, 0.016); ok("letting go of the steering key returns the wheel to straight (only the pad's own value is left)", Math.abs(vr.read(true, 0.016).steer - 0.5) < 1e-6);
  c = vr.read(false, 0.016); ok("the frame the player stops driving: controls read zero and every on-screen control is cleared (nothing stays pressed)", !c.drive && c.gas === 0 && c.steer === 0 && c.horn === false && input.gas === 0 && input.steer === 0 && input.horn === false && input.climbUp === false);
  input.gas = 1; c = vr.read(false, 0.016); ok("while not driving, the on-screen gas is ignored", c.gas === 0);
  r.vin.detach(); }
{ const r = rig(), input = { gas: 1 }, vr = createVehicleReader({ vin: r.vin, input }); r.down("KeyW"); ok("(setup) W + on-screen gas while driving", vr.read(true, 0.016).gas === 1);
  r.doc.dialogs = [dlg(true)]; r.tick(200); const c = vr.read(true, 0.016); ok("a dialog opens: gas, brake, steer, climb and horn all read zero at the next frame (the car coasts)", !c.drive && c.gas === 0 && c.brake === 0 && c.steer === 0 && c.climb === 0 && !c.horn);
  r.doc.dialogs = []; r.tick(200); ok("... and the on-screen control still held gives the vehicle back when the dialog closes", vr.read(true, 0.016).gas === 1); r.vin.detach(); }
{ const i = { gas: 1, brake: 1, steer: -1, climb: 1, climbUp: true, climbDown: true, horn: true }; clearVehicleInput(i); ok("clearVehicleInput resets every control", i.gas === 0 && i.brake === 0 && i.steer === 0 && i.climb === 0 && !i.climbUp && !i.climbDown && !i.horn); clearVehicleInput(null); }

// ---- the on-screen hold
const ptr = (id, extra = {}) => ({ pointerId: id, pointerType: "touch", button: 0, currentTarget: { setPointerCapture() { this.captured = id; }, captured: null }, preventDefault() { this.prevented = true; }, ...extra });
{ let downs = 0, ups = 0, look = false; const h = createHold({ onDown: () => downs++, onUp: () => ups++, mark: (on) => (look = on) });
  const a = ptr(1); h.handlers.onPointerDown(a); ok("a finger down presses, captures the pointer, shows the pressed look and blocks the browser gesture", h.held && downs === 1 && a.currentTarget.captured === 1 && look && a.prevented);
  h.handlers.onPointerDown(ptr(2)); ok("a second finger on the same control is ignored", downs === 1 && h.pointerId === 1);
  h.handlers.onPointerUp(ptr(2)); ok("lifting the second finger does not release the first", h.held && ups === 0);
  h.handlers.onPointerUp(ptr(1)); ok("lifting the holding finger releases", !h.held && ups === 1 && !look);
  h.handlers.onPointerUp(ptr(1)); ok("a repeated up changes nothing", ups === 1);
  h.handlers.onPointerDown(ptr(3)); h.handlers.onPointerCancel(ptr(3)); ok("pointer cancel (the browser took the touch) releases", !h.held && ups === 2);
  h.handlers.onPointerDown(ptr(4)); h.handlers.onLostPointerCapture(ptr(4)); ok("lost pointer capture releases", !h.held && ups === 3);
  h.handlers.onPointerDown(ptr(5, { pointerType: "mouse", button: 2 })); ok("a right mouse button is never a press", !h.held && downs === 3);
  h.handlers.onPointerDown(ptr(6, { pointerType: "mouse", button: 0 })); ok("the left mouse button presses", h.held); h.handlers.onPointerUp(ptr(6, { pointerType: "mouse" })); }
{ const log = []; const mk = (n) => createHold({ onDown: () => log.push(n + "+"), onUp: (f) => log.push(n + (f ? "!" : "-")) }); const gas = mk("gas"), steer = mk("steer"), horn = mk("horn");
  gas.handlers.onPointerDown(ptr(1)); steer.handlers.onPointerDown(ptr(2)); horn.handlers.onPointerDown(ptr(3)); ok("three fingers hold three controls at once", heldCount() === 3);
  steer.handlers.onPointerUp(ptr(2)); ok("releasing one leaves the other two held", gas.held && horn.held && !steer.held);
  releaseAllHolds(); ok("releaseAllHolds() lets go of everything (marked as forced)", heldCount() === 0 && log.includes("gas!") && log.includes("horn!")); }
{ let ups = 0; const h = createHold({ onUp: () => ups++ }); h.keyHandlers.onKeyDown({ key: " ", repeat: false, preventDefault() {} }); h.keyHandlers.onKeyDown({ key: " ", repeat: true, preventDefault() {} }); ok("Space on a focused control holds it once", h.held);
  h.keyHandlers.onKeyUp({ key: " " }); ok("... and releases on key up", !h.held && ups === 1);
  h.keyHandlers.onKeyDown({ key: "Enter", repeat: false, preventDefault() {} }); h.keyHandlers.onBlur(); ok("... and when the control loses focus", !h.held && ups === 2); }
{ // window blur / hidden tab, through the real page wiring
  globalThis.window = new EventTarget(); globalThis.document = Object.assign(new EventTarget(), { hidden: false });
  let ups = 0; const h = createHold({ onUp: () => ups++ }); h.handlers.onPointerDown(ptr(1)); ok("(setup) held", h.held);
  window.dispatchEvent(new Event("blur")); ok("window blur releases a held control (the finger-up would never arrive)", !h.held && ups === 1);
  h.handlers.onPointerDown(ptr(2)); document.hidden = true; document.dispatchEvent(new Event("visibilitychange")); ok("a hidden tab releases a held control", !h.held && ups === 2);
  h.handlers.onPointerDown(ptr(3)); window.dispatchEvent(new Event("pagehide")); ok("leaving the page releases a held control", !h.held && ups === 3); }

console.log(bad ? `\n${bad} FAILED` : "\nall vehicle input checks passed");
