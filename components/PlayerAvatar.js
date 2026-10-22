// components/PlayerAvatar.js
// A player's profile picture: a head-and-shoulders snapshot of their real 3D character (their saved gender, hair, clothes, colours and build),
// drawn with the game's avatar system and cached (lib/avatarSnapshot.js). The same component is used everywhere a profile picture shows
// (messages, relationships, home, leaderboards, settings, player menu, matches, buildings, government), so they all look the same.
// The coloured initials only show while a picture cannot exist: the player is unknown, the device has no WebGL, or the model failed to load.
"use client";
import { useEffect, useRef, useState } from "react";
import { avatarDirectory } from "@/lib/avatarClient";
import { getSnapshot, peekSnapshot } from "@/lib/avatarSnapshot";
import "./player-avatar.css";

const HUES = ["#3b6fd4", "#1f8f6a", "#b5651d", "#8a4fb3", "#c2456a", "#2e8a9c", "#a0802a"];
export const hueOf = (n = "") => HUES[[...String(n)].reduce((s, ch) => s + ch.charCodeAt(0), 0) % HUES.length];
export const initialsOf = (n = "", count = 2) => String(n).replace(/[^a-z0-9]/gi, "").slice(0, count).toUpperCase() || "?";

/** True once the element has been on screen (or at once where IntersectionObserver is missing): a long list only draws the faces that are seen. */
function useSeen(ref) {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (seen || !ref.current) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: "120px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen, ref]);
  return seen;
}

/** { url, failed } for a player name. `look` ({ gender, look, key }) may be given when the caller already has it; otherwise it is looked up by name. */
export function usePlayerPicture(name, enabled = true, known = null) {
  const lc = String(name ?? "").trim().toLowerCase();
  const [entry, setEntry] = useState(() => known ?? avatarDirectory.peek(name));
  const [url, setUrl] = useState(() => { const e = known ?? avatarDirectory.peek(name); return e ? peekSnapshot(e.key) : null; });
  const [failed, setFailed] = useState(false);

  // name -> saved look (shared by everyone asking, refreshed when stale, updated live when a look is saved on this device)
  useEffect(() => {
    if (!enabled || !lc) return;
    let alive = true;
    if (known) { avatarDirectory.seed(name, known.gender, known.look, known.key); setEntry(known); setFailed(false); return; }
    setEntry(avatarDirectory.peek(name));
    avatarDirectory.request(name).then((e) => { if (!alive) return; setEntry(e); setFailed(!e); });
    const off = avatarDirectory.subscribe((k) => { if (alive && k === lc) { const e = avatarDirectory.peek(name); setEntry(e); if (e) setFailed(false); } });
    return () => { alive = false; off(); };
  }, [lc, enabled, known?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // saved look -> picture. A changed look has a new key, so a new picture is made; the old one stays until it is ready so nothing flashes.
  const key = entry?.key;
  useEffect(() => {
    if (!entry) { setUrl(null); return; }
    if (!enabled) return; // not on screen yet: nothing is drawn for a face nobody can see
    const hit = peekSnapshot(entry.key);
    if (hit) { setUrl(hit); setFailed(false); return; }
    let alive = true;
    getSnapshot(entry.key, entry.look, entry.gender).then((u) => { if (!alive) return; setUrl(u); setFailed(!u); });
    return () => { alive = false; };
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return { url, failed };
}

/** <PlayerAvatar name="Ada" size={44} /> — children (a badge, an online dot) sit on top, outside the circle's clipping. */
export default function PlayerAvatar({ name, size = 44, className = "", style, look = null, children, title, ...rest }) {
  const ref = useRef(null), seen = useSeen(ref), { url, failed } = usePlayerPicture(name, seen, look);
  const px = typeof size === "number" ? size : undefined;
  return (
    <span ref={ref} className={"pav " + className} style={{ width: size, height: size, ...style }} data-state={url ? "ready" : failed ? "fallback" : "loading"} title={title} role="img" aria-label={name ? `${name}'s profile picture` : "Profile picture"} {...rest}>
      <span className="pav-disc" style={failed && !url ? { background: hueOf(name), fontSize: px ? px * 0.36 : undefined } : undefined}>
        {url ? <img src={url} alt="" draggable={false} decoding="async" /> : failed ? initialsOf(name) : null}
      </span>
      {children}
    </span>
  );
}
