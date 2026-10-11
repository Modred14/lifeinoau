// components/Loader.js
"use client";
import "./loader.css";

/**
 * Branded loading indicator: a gold orbit around a pulsing green core, with the wordmark's "in" at the centre.
 *   <Loader />                          inline, centred in its container
 *   <Loader label="Loading your life" /> adds a caption under the spinner
 *   <Loader fullscreen label="..." />    covers the whole screen (landing page session check)
 *   <Loader size={28} />                 small, for use inside buttons or rows
 * It is announced to screen readers as a polite status and respects reduced-motion (it pulses instead of spinning).
 */
export default function Loader({ label = "Loading", showLabel = true, fullscreen = false, size = 64, className = "" }) {
  const cls = ["lo", fullscreen ? "lo-full" : "", className].filter(Boolean).join(" ");
  return (
    <div className={cls} role="status" aria-live="polite" aria-busy="true">
      <span className="lo-mark" style={{ "--lo-size": `${size}px` }} aria-hidden="true">
        <span className="lo-ring" />
        <span className="lo-orbit"><i /></span>
        <span className="lo-core" />
      </span>
      {label && showLabel ? <span className="lo-label">{label}<span className="lo-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></span> : <span className="lo-sr">{label}</span>}
    </div>
  );
}