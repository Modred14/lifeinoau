// components/DrivePad.js
// The on-screen driving pad of the home garage (components/HomeGarage.js) and of the compound on the home screen (components/CompoundDrive.js): steer left / right on one side, brake (hold to
// reverse) and go on the other. They used to carry a copy of this each, and a copy that was wrong: left and right (and brake and go) shared ONE number, so letting go of one while the other was
// still held cleared both, and nothing tracked which finger was where. Now every button is its own hold (components/HoldButton.js, lib/pointerHold.js): gas, brake, left and right are four
// independent booleans, any combination can be held by any fingers at once, and the pad reports { throttle, steer } to the vehicle engine from them.
// Nothing here re-renders while driving: the pressed look is written straight to the element.
"use client";
import { useRef } from "react";
import { Icon } from "./Icon";
import { useHold } from "./HoldButton";

/** setInput({ throttle (-1 brake / reverse .. 1 go), steer (-1 left .. 1 right) }): the engine's setInput (lib3d/homeGarage.js, lib3d/compoundFleet.js). */
export default function DrivePad({ setInput }) {
  const down = useRef({ gas: false, brake: false, left: false, right: false }).current, send = useRef(setInput), L = useRef(null), R = useRef(null), B = useRef(null), G = useRef(null);
  send.current = setInput;
  const set = (k, on) => { down[k] = on; send.current?.({ throttle: (down.gas ? 1 : 0) - (down.brake ? 1 : 0), steer: (down.right ? 1 : 0) - (down.left ? 1 : 0) }); };
  const left = useHold(L, () => set("left", true), () => set("left", false)), right = useHold(R, () => set("right", true), () => set("right", false));
  const brake = useHold(B, () => set("brake", true), () => set("brake", false)), gas = useHold(G, () => set("gas", true), () => set("gas", false));
  return (
    <div className="hg-pad" role="group" aria-label="Driving controls. Keyboard: arrow keys or W A S D, Space to brake.">
      <div className="hg-steer"><button type="button" ref={L} aria-label="Steer left" data-sound="none" {...left.handlers}><Icon name="left" size={26} /></button><button type="button" ref={R} aria-label="Steer right" data-sound="none" {...right.handlers}><Icon name="right" size={26} /></button></div>
      <div className="hg-pedals"><button type="button" ref={B} className="hg-brake" aria-label="Brake and reverse" data-sound="none" {...brake.handlers}>Brake<small>Reverse</small></button><button type="button" ref={G} className="hg-gas" aria-label="Accelerate" data-sound="none" {...gas.handlers}>Go</button></div>
    </div>
  );
}
