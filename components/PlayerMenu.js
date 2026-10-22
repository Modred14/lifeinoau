// components/PlayerMenu.js
// The small menu that opens when you tap another real player's name tag in the 3D world (lib3d/playerTags.js sends "oau:player-menu").
// "Message" opens the phone's existing Messages app on a chat with that exact player (Shell listens for "oau:message"). One menu for the whole game:
// it closes when you tap anywhere else, press Escape, or the player it is about leaves (the tag layer sends "oau:player-gone").
//
// Where it goes: always fully on screen and ABOVE the bottom bar (Home, Buy, Map, Phone). It is drawn in a portal on <body> (so no building, sheet or
// scrim can trap it in a lower stacking context), above the bar's own layer, and placed from the bar's real position, the device's safe areas and the
// menu's own measured height. When there is not enough room it shrinks and scrolls instead of reaching under the bar.
"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import PlayerAvatar from "./PlayerAvatar";
import "./player-tags.css";

const EDGE = 8, GAP = 10, NARROW = 640, WIDTH = 220;

/** The device's safe-area insets in px (notch, home indicator), measured with a throw-away element because env() cannot be read from script. */
function insets() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe), r = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
  probe.remove(); return r;
}

/** The free band of the screen for the menu: { top, bottom, left, right } in viewport px. The bottom edge is the top of the bar when it is on screen. */
function freeArea() {
  const root = document.documentElement, W = root.clientWidth || window.innerWidth, H = window.innerHeight || root.clientHeight, s = insets();
  const nav = document.querySelector('nav.nav[aria-label="Main"]'), r = nav?.getBoundingClientRect();
  const navTop = r && r.height > 0 && r.top < H ? r.top : H - s.b;
  return { top: s.t + EDGE, bottom: Math.min(navTop, H - s.b) - EDGE, left: s.l + EDGE, right: W - s.r - EDGE };
}

export default function PlayerMenu() {
  const [pick, setPick] = useState(null), [pos, setPos] = useState(null), box = useRef(null);
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

  // Place the menu: before the browser paints (so it never flashes in the wrong spot), and again whenever the screen, the bar or the menu's content changes size.
  useLayoutEffect(() => {
    if (!pick) { setPos(null); return; }
    const place = () => {
      const el = box.current; if (!el) return;
      const a = freeArea(), narrow = (document.documentElement.clientWidth || window.innerWidth) <= NARROW, room = Math.max(120, a.bottom - a.top);
      el.style.maxHeight = `${room}px`; // measured below with the cap already applied: a tall menu shrinks and scrolls
      const h = Math.min(el.offsetHeight || 150, room), tagTop = Number.isFinite(pick.y) ? pick.y : a.bottom, tagBottom = Number.isFinite(pick.bottom) ? pick.bottom : tagTop;
      // above the tag when it fits there, otherwise below it, otherwise wherever the free band allows; never below the bar's top edge
      let top = tagTop - GAP - h >= a.top ? tagTop - GAP - h : tagBottom + GAP + h <= a.bottom ? tagBottom + GAP : a.bottom - h;
      top = Math.max(a.top, Math.min(top, a.bottom - h));
      const width = narrow ? Math.max(0, a.right - a.left) : WIDTH, left = narrow ? a.left : Math.max(a.left, Math.min(a.right - WIDTH, (Number.isFinite(pick.x) ? pick.x : a.left) - WIDTH / 2));
      setPos((p) => (p && p.top === top && p.left === left && p.width === width && p.maxHeight === room ? p : { top, left, width, maxHeight: room }));
    };
    place();
    const nav = document.querySelector('nav.nav[aria-label="Main"]'), ro = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
    if (nav) ro?.observe(nav); if (box.current) ro?.observe(box.current);
    window.addEventListener("resize", place); window.addEventListener("orientationchange", place); window.visualViewport?.addEventListener("resize", place);
    return () => { ro?.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("orientationchange", place); window.visualViewport?.removeEventListener("resize", place); };
  }, [pick]);

  if (!pick || typeof document === "undefined") return null;
  const sub = [pick.faculty, pick.level ? `${pick.level}L` : ""].filter(Boolean).join(" · ");
  const style = pos ? { top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight } : { top: 0, left: 0, width: WIDTH, visibility: "hidden" }; // hidden for the one pass in which it is measured
  return createPortal(
    <div className="pm" ref={box} style={style} role="dialog" aria-label={`${pick.name}, player options`}>
      <div className="pm-h"><PlayerAvatar name={pick.name} size={34} className="pm-av" /><span className="pm-t"><b>{pick.name}</b>{sub && <small>{sub}</small>}</span>
        <button type="button" className="pm-x" aria-label="Close" onClick={() => setPick(null)} data-sound="none"><Icon name="close" size={18} /></button></div>
      <button type="button" className="pm-go" autoFocus onClick={() => { const name = pick.name; setPick(null); window.dispatchEvent(new CustomEvent("oau:message", { detail: { name } })); }}><Icon name="chat" size={18} weight="fill" /> Message</button>
    </div>,
    document.body
  );
}
