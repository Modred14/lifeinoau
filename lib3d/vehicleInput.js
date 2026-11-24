// lib3d/vehicleInput.js
// The ONE place the keyboard is wired to a vehicle. The map trip (lib3d/travel.js), the home compound (lib3d/compoundFleet.js) and the garage (lib3d/homeGarage.js) all use it, so a key
// behaves the same everywhere and there is one set of rules for "a key can never stay pressed". (The on-screen controls have their own single implementation: lib/pointerHold.js.)
// Pure JS, no three.js: the window and the document are passed in, so it runs headless in the tests (tests/vehicle-input.test.mjs) and in a real browser (tests/e2e/vehicle-controls.e2e.mjs).
//
//   const vin = attachVehicleKeys({ active: () => driving });      // vin.keys is a lib3d/tripkeys.js key set: vin.keys.read() -> { up, down, left, right, space, steer, climb, horn, run }
//   vin.take("act")  // E / F pressed since the last call (get in, get out, open the door)        vin.take("fly") // T pressed since the last call
//   vin.blocked()    // a dialog is open: controls read as zero while it is                         vin.clear()     // let go of everything (leaving the vehicle)
//   vin.detach()
//
// Keys are dropped (all of them, at once) when:
//   - the window loses focus, the tab is hidden, or the page is left (the key-up goes to whoever has focus, never to us);
//   - focus moves into a text box or a select (the key-up would go there; and typing never drives);
//   - a context menu opens (some platforms send no key-up afterwards);
//   - a modal dialog opens over the game (the Phone, the travel sheet, a confirmation): a held W must not keep the car accelerating under it. Checked when a key goes down and about
//     six times a second from the frame loop through blocked(), with no observer and nothing per frame.
// Key-ups are ALWAYS taken, whatever is open, so letting go works everywhere. A shortcut key (Cmd/Ctrl/Alt) is never a control (lib3d/tripkeys.js).
import { createKeys, isActKey, isFlyKey } from "./tripkeys.js";
import { stepKeySteer } from "./keysteer.js";

const MODAL = '[aria-modal="true"], [role="alertdialog"]';
const HIDDEN_ANCESTOR = "[inert], [hidden], [aria-hidden='true']";
const FIELD = "input, textarea, select, [contenteditable=''], [contenteditable='true']";

/** Is a modal dialog open and showing? (A hidden, inert or display:none one does not count.) */
export function modalOpen(doc = globalThis.document) {
  const list = doc?.querySelectorAll?.(MODAL); if (!list || !list.length) return false;
  for (const el of list) { if (el.closest?.(HIDDEN_ANCESTOR)) continue; if (typeof el.checkVisibility === "function" && !el.checkVisibility()) continue; return true; }
  return false;
}

/** keys: a createKeys() set to fill (a new one by default). active(): are keys taken at all right now (e.g. only while driving). */
export function attachVehicleKeys({ keys = createKeys(), active = () => true, win = globalThis.window, doc = globalThis.document, pollMs = 150, now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) } = {}) {
  const hits = new Set(); let shut = false, last = -Infinity;
  const clear = () => { keys.clear(); hits.clear(); };
  const check = () => { const open = modalOpen(doc); if (open && !shut) clear(); shut = open; last = now(); return open; };
  /** Is a dialog open? Cheap enough to call every frame: it looks at the page at most once every `pollMs`. */
  const blocked = () => { if (now() - last >= pollMs) check(); return shut; };

  const kd = (e) => {
    if (!active() || (e.repeat ? blocked() : check())) return;   // an auto-repeat is not a new press: it uses the throttled check
    if (keys.press(e)) e.preventDefault?.();
    if (isActKey(e)) hits.add("act"); if (isFlyKey(e)) hits.add("fly");
  };
  const ku = (e) => keys.release(e);
  const hide = () => { if (doc.hidden) clear(); };
  const focusin = (e) => { if (e.target?.closest?.(FIELD)) clear(); };
  win.addEventListener("keydown", kd); win.addEventListener("keyup", ku); win.addEventListener("blur", clear); win.addEventListener("pagehide", clear); win.addEventListener("contextmenu", clear);
  doc.addEventListener("visibilitychange", hide); doc.addEventListener("focusin", focusin);
  return {
    keys, clear, blocked,
    /** True once if the one-shot key `name` ("act" or "fly") was pressed since the last call. */
    take: (name) => hits.delete(name),
    detach() { clear(); win.removeEventListener("keydown", kd); win.removeEventListener("keyup", ku); win.removeEventListener("blur", clear); win.removeEventListener("pagehide", clear); win.removeEventListener("contextmenu", clear); doc.removeEventListener("visibilitychange", hide); doc.removeEventListener("focusin", focusin); },
  };
}

/**
 * The garage and the compound steer a car from two numbers: throttle (-1 brake / reverse .. +1 gas) and steer (+1 right). The keys (W S A D, arrows, Space = brake) and the on-screen pad add up.
 * k: keys.read(); pad: { throttle, steer }.
 */
export function driveAxes(k, pad) {
  const c = (v) => Math.max(-1, Math.min(1, v));
  return { throttle: c(k.up - Math.max(k.down, k.space) + (pad?.throttle ?? 0)), steer: c(k.steer + (pad?.steer ?? 0)) };
}

/**
 * The controls of a vehicle on the map, from the keys and the on-screen controls TOGETHER (they add up: W and the gas pedal, A and the steering pad). kk: keys.read(); input: what the HUD wrote
 * (gas, brake, steer, climb, climbUp, climbDown, horn); keySteer: the keyboard's eased steering (lib3d/keysteer.js). Returns { gas 0..1, brake 0..1, steer -1..1 (+1 right), climb -1..1, horn }.
 * This is the single mapping lib3d/travel.js uses every frame, so the tests exercise the real thing.
 */
export function driveControls(kk, input, keySteer = 0) {
  const c = (v) => Math.max(-1, Math.min(1, v)), i = input ?? {};
  return { gas: Math.max(kk.up, i.gas ?? 0), brake: Math.max(kk.down, kk.space, i.brake ?? 0), steer: c((i.steer ?? 0) + keySteer), climb: c(kk.climb + (i.climb ?? 0) + (i.climbUp ? 1 : 0) - (i.climbDown ? 1 : 0)), horn: !!kk.horn || !!i.horn };
}

/** Let go of everything the on-screen controls wrote into `input` (gas, brake, wheel, climb, horn). Called the moment the player leaves a vehicle, so nothing is left pressed for the next one. */
export function clearVehicleInput(input) { if (!input) return; input.gas = input.brake = input.steer = input.climb = 0; input.climbUp = input.climbDown = input.horn = false; }

/**
 * The per-frame reader of the vehicle controls, the ONE the map trip (lib3d/travel.js) calls every frame and the browser test drives. `vin` is an attachVehicleKeys() binding, `input` the object
 * the HUD writes to. read(driving, dt) says what the vehicle is asked to do this frame:
 *   - the keys and the on-screen controls add up (driveControls); the keyboard's steering is eased (lib3d/keysteer.js) like a wheel, not thrown to full lock;
 *   - under an open dialog (the Phone, a sheet) everything reads as zero: the vehicle coasts, it never keeps accelerating under a screen;
 *   - the frame the player stops driving (exit, arrival) lets go of everything the on-screen controls wrote (clearVehicleInput), so nothing is left pressed for the next vehicle.
 * Returns { kk (the raw key read, for walking), drive, gas, brake, steer, climb, horn }.
 */
export function createVehicleReader({ vin, input }) {
  let keySteer = 0, was = false;
  return {
    read(driving, dt = 0) {
      const kk = vin.keys.read(), drive = !!driving && !vin.blocked();
      keySteer = drive ? stepKeySteer(keySteer, kk.steer, dt) : 0;
      if (was && !driving) clearVehicleInput(input);
      was = !!driving;
      const dc = driveControls(kk, input, keySteer);
      return drive ? { kk, drive, gas: dc.gas, brake: dc.brake, steer: dc.steer, climb: dc.climb, horn: dc.horn } : { kk, drive: false, gas: 0, brake: 0, steer: 0, climb: 0, horn: false };
    },
  };
}
