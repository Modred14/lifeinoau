// components/Loader.js
"use client";
import { useLayoutEffect, useRef } from "react";
import "./loader.css";
import { LOGO_VIEWBOX, LOGO_RATIO, LOGO_SUN, LOGO_PARTS } from "./logoData";

/**
 * Branded loading indicator: the lifeinoau logo draws itself, piece by piece. The "i", the ring, the tower, the road,
 * the birds, and last of all the sun rises. When it is complete the sun keeps a slow glow until the page is ready.
 *   <Loader />                          the big loader, covers the whole screen (this is the default everywhere in the game)
 *   <Loader label="Loading your life" /> changes the caption
 *   <Loader fullscreen={false} />        only if you ever need it to sit inside its container instead of covering the screen
 *   <Loader size={28} />                 below 44px it becomes a small spinner, for use inside buttons or rows
 * Fast loads never flash a half-drawn logo (it fades in after 180ms). Announced to screen readers as a polite status;
 * with reduced motion the finished logo is shown, gently pulsing.
 */
// Remember when the last big loader went away. If another one mounts straight after (the route loader, then the page's own), it carries on
// from the same point of the logo animation instead of fading in and drawing from scratch, which looked like a glitch.
const FADE_MS = 200, RESUME_MS = 700;
let chainStart = 0, goneAt = 0, goneVisible = false;

const STAGES = [
  ["stem", "0s"],
  ["ring", "0.25s"],
  ["tower", "0.7s"],
  ["road", "1.05s"],
  ["birds", "1.4s"],
];

export default function Loader({ label = "Loading", showLabel = true, fullscreen = true, size, className = "" }) {
  const small = size != null && size < 44;
  const root = useRef(null);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !fullscreen || small) return;
    const mountedAt = performance.now(), resumed = goneVisible && mountedAt - goneAt < RESUME_MS;
    if (resumed) {
      el.setAttribute("data-resume", "");
      el.style.setProperty("--skip", Math.min(5, (mountedAt - chainStart) / 1000) + "s");
    } else chainStart = mountedAt;
    return () => {
      const t = performance.now();
      goneAt = t;
      goneVisible = resumed || t - mountedAt > FADE_MS;
    };
  }, [fullscreen, small]);
  const h = size ?? (fullscreen ? 170 : 96);
  const cls = ["lo", fullscreen ? "lo-full" : "", small ? "lo-small" : "", className].filter(Boolean).join(" ");
  const caption = label && showLabel
    ? <span className="lo-label">{label}<span className="lo-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></span>
    : <span className="lo-sr">{label}</span>;

  if (small) {
    return (
      <div className={cls} role="status" aria-live="polite" aria-busy="true">
        <span className="lo-mark" style={{ "--lo-size": `${size}px` }} aria-hidden="true">
          <span className="lo-ring" />
          <span className="lo-orbit"><i /></span>
          <span className="lo-core" />
        </span>
        {caption}
      </div>
    );
  }

  return (
    <div ref={root} className={cls} role="status" aria-live="polite" aria-busy="true">
      {fullscreen && <span className="lo-glow" aria-hidden="true" />}
      <svg className="lo-logo" viewBox={LOGO_VIEWBOX} width={Math.round(h * LOGO_RATIO)} height={h} aria-hidden="true" focusable="false">
        {STAGES.map(([g, d]) => (
          <g key={g} className={`lf-g lf-${g}`} style={{ "--d": d }}>
            {LOGO_PARTS[g].map((p, i) => <path key={i} d={p} pathLength="1" />)}
          </g>
        ))}
        <g className="lf-sunwrap" style={{ "--d": "1.7s" }}>
          <circle cx={LOGO_SUN.cx} cy={LOGO_SUN.cy} r={LOGO_SUN.r} />
        </g>
      </svg>
      {caption}
    </div>
  );
}