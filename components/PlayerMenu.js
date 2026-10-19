// components/PlayerMenu.js
// The small menu that opens when you tap another real player's name tag in the 3D world (lib3d/playerTags.js sends "oau:player-menu").
// "Message" opens the phone's existing Messages app on a chat with that exact player (Shell listens for "oau:message"). One menu for the whole game:
// it closes when you tap anywhere else, press Escape, or the player it is about leaves (the tag layer sends "oau:player-gone").
"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import "./player-tags.css";

export default function PlayerMenu() {
  const [pick, setPick] = useState(null), box = useRef(null);
  useEffect(() => {
    const open = (e) => setPick(e.detail?.id && e.detail?.name ? e.detail : null);
    const gone = (e) => setPick((p) => (p && e.detail?.ids?.includes(p.id) ? null : p));
    window.addEventListener("oau:player-menu", open); window.addEventListener("oau:player-gone", gone);
    return () => { window.removeEventListener("oau:player-menu", open); window.removeEventListener("oau:player-gone", gone); };
  }, []);
  useEffect(() => {
    if (!pick) return;
    // a tap anywhere else closes the menu but is not swallowed: it still reaches the game (a camera drag, the stick...) or another tag
    const down = (e) => { if (!box.current?.contains(e.target) && !e.target.closest?.(".pt-tag")) setPick(null); };
    const key = (e) => { if (e.key !== "Escape") return; e.stopPropagation(); e.preventDefault(); setPick(null); }; // Escape closes this first, not the building behind it
    document.addEventListener("pointerdown", down, true); document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key, true); };
  }, [pick]);
  if (!pick) return null;
  const W = typeof window === "undefined" ? 1024 : window.innerWidth, H = typeof window === "undefined" ? 768 : window.innerHeight, below = pick.y < 150;
  const style = { left: Math.max(8, Math.min(W - 228, pick.x - 110)), ...(below ? { top: Math.min(H - 150, (pick.bottom ?? pick.y) + 10) } : { bottom: H - pick.y + 10 }) };
  const sub = [pick.faculty, pick.level ? `${pick.level}L` : ""].filter(Boolean).join(" · ");
  return (
    <div className="pm" ref={box} style={style} role="dialog" aria-label={`${pick.name}, player options`} data-below={below ? "1" : undefined}>
      <div className="pm-h"><span className="pm-av" aria-hidden="true">{pick.name[0]}</span><span className="pm-t"><b>{pick.name}</b>{sub && <small>{sub}</small>}</span>
        <button type="button" className="pm-x" aria-label="Close" onClick={() => setPick(null)} data-sound="none"><Icon name="close" size={18} /></button></div>
      <button type="button" className="pm-go" autoFocus onClick={() => { const name = pick.name; setPick(null); window.dispatchEvent(new CustomEvent("oau:message", { detail: { name } })); }}><Icon name="chat" size={18} weight="fill" /> Message</button>
    </div>
  );
}