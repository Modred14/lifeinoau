// lib3d/tripkeys.js
// The keyboard on a trip: which physical key is which control, and a key set that can never get stuck. Pure JS (it only reads the fields of a KeyboardEvent), so it is tested headless.
//
//   - Keys are told apart by their PHYSICAL place (event.code: KeyW, KeyA, ArrowLeft, ...) so W A S D is the same four keys on a QWERTY, AZERTY or any other layout, whatever the
//     language, caps lock or shift. Only when a browser gives no code does it fall back to the letter that was typed.
//   - A key pressed together with Ctrl, Cmd or Alt is a shortcut (Cmd+D, Ctrl+F, Alt+A...), never a control. Macs also stop sending key-up events for the other keys while Cmd is held,
//     so letting go of Cmd drops everything that was held rather than leaving the car steering by itself.
//   - Typing in a text box never drives the car.
//   - Left and right together (or up and down together) cancel out.

const KNOWN = /^(Key[A-Z]|Arrow(Up|Down|Left|Right)|Space|Shift(Left|Right)|Meta(Left|Right))$/;
const ARROWS = { arrowup: "ArrowUp", arrowdown: "ArrowDown", arrowleft: "ArrowLeft", arrowright: "ArrowRight" };

/** A stable name for the key of a keyboard event: "KeyW", "ArrowLeft", "Space", "ShiftLeft"... (right Shift is reported as left Shift). */
export function keyId(e) {
  const c = e?.code; if (c && KNOWN.test(c)) return c === "ShiftRight" ? "ShiftLeft" : c === "MetaRight" ? "MetaLeft" : c;
  const k = String(e?.key ?? "").toLowerCase();
  if (k.length === 1 && k >= "a" && k <= "z") return "Key" + k.toUpperCase();
  if (k === " " || k === "spacebar") return "Space";
  if (ARROWS[k]) return ARROWS[k]; if (k === "left" || k === "right" || k === "up" || k === "down") return "Arrow" + k[0].toUpperCase() + k.slice(1); // very old browsers
  if (k === "shift") return "ShiftLeft"; if (k === "meta" || k === "os") return "MetaLeft";
  return k;
}

const inField = (t) => !!t?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true']");
const CONTROL_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "ShiftLeft"]);
const BLOCKS_PAGE = (id) => id === "Space" || id.startsWith("Arrow"); // the page must not scroll under the car

/** True for the keys that act once (E or F: get in, get out, open the door), pressed on their own. */
export const isActKey = (e) => !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !inField(e.target) && (keyId(e) === "KeyE" || keyId(e) === "KeyF");

/** A set of held keys. press / release take the keyboard events; read() says what is asked for right now. */
export function createKeys() {
  const down = new Set();
  const has = (...ids) => ids.some((i) => down.has(i));
  return {
    /** A key went down. Returns true when it is a driving key the caller should stop the browser acting on (scrolling the page). */
    press(e) {
      if (inField(e.target)) return false;
      const id = keyId(e); if (!CONTROL_KEYS.has(id)) return false;
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      down.add(id); return BLOCKS_PAGE(id);
    },
    release(e) { const id = keyId(e); if (id === "MetaLeft") down.clear(); else down.delete(id); },
    clear() { down.clear(); },
    get held() { return down.size; },
    /** What the keys ask for: walking / driving directions as 0 or 1, steer = right - left (-1, 0 or 1). */
    read() {
      const up = has("KeyW", "ArrowUp"), dn = has("KeyS", "ArrowDown"), left = has("KeyA", "ArrowLeft"), right = has("KeyD", "ArrowRight");
      return { up: up ? 1 : 0, down: dn ? 1 : 0, left: left ? 1 : 0, right: right ? 1 : 0, space: has("Space") ? 1 : 0, run: has("ShiftLeft") ? 1 : 0, steer: (right ? 1 : 0) - (left ? 1 : 0) };
    },
  };
}
