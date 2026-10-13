// components/Loader.js
"use client";
import "./loader.css";
import { LOGO_VIEWBOX, LOGO_RATIO, LOGO_SUN, LOGO_PARTS } from "./logoData";

/**
 * Branded loading indicator: the lifeinoau logo draws itself, piece by piece. The "i", the ring, the tower, the road,
 * the birds, and last of all the sun rises. When it is complete the sun keeps a slow glow until the page is ready.
 *   <Loader />                          inline, centred in its container
 *   <Loader label="Loading your life" /> changes the caption
 *   <Loader fullscreen label="..." />    covers the whole screen (landing page session check)
 *   <Loader size={28} />                 below 44px it becomes a small spinner, for use inside buttons or rows
 * Fast loads never flash a half-drawn logo (it fades in after 180ms). Announced to screen readers as a polite status;
 * with reduced motion the finished logo is shown, gently pulsing.
 */
const STAGES = [
  ["stem", "0s"],
  ["ring", "0.25s"],
  ["tower", "0.7s"],
  ["road", "1.05s"],
  ["birds", "1.4s"],
];

export default function Loader({ label = "Loading", showLabel = true, fullscreen = false, size, className = "" }) {
  const small = size != null && size < 44;
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
    <div className={cls} role="status" aria-live="polite" aria-busy="true">
      {fullscreen && <span className="lo-glow" aria-hidden="true" />}
      <svg className="lf" viewBox={LOGO_VIEWBOX} width={Math.round(h * LOGO_RATIO)} height={h} aria-hidden="true" focusable="false">
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