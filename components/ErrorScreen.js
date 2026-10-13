// components/ErrorScreen.js
"use client";
import { useEffect, useState } from "react";
import "./error-screen.css";
import Logo from "./Logo";
import { Icon } from "./Icon";
import { call } from "@/lib/client";

/**
 * Full-screen "something went wrong" page with two ways out: Try again, or Log out.
 * Used by src/app/error.js (a page crashed) and src/app/global-error.js (the layout itself crashed).
 *   onRetry   re-attempts the render
 *   digest    the error id Next.js gives for server errors, shown as a reference the player can quote
 */
export default function ErrorScreen({ onRetry, digest }) {
  const [retrying, setRetrying] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [problem, setProblem] = useState("");

  // hide the site header while this page is showing
  useEffect(() => {
    document.body.setAttribute("data-bare", "");
    return () => document.body.removeAttribute("data-bare");
  }, []);

  function retry() {
    if (retrying || leaving) return;
    setProblem("");
    setRetrying(true);
    onRetry?.();
    setTimeout(() => setRetrying(false), 900); // if the page is still broken we come straight back here
  }

  async function logout() {
    if (leaving || retrying) return;
    setProblem("");
    setLeaving(true);
    const r = await call("/api/logout", {});
    if (r.failed) {
      setLeaving(false);
      return setProblem("We couldn't log you out. Check your connection and try again.");
    }
    window.location.assign("/"); // a full reload clears whatever state caused the crash
  }

  return (
    <main className="er" role="alert" aria-labelledby="er-title">
      <span className="er-sky" aria-hidden="true" />
      <div className="er-card">
        <div className="er-art">
          <span className="er-halo" aria-hidden="true" />
          <Logo size={190} className="er-logo" sunClass="er-sun">
            <g className="er-cloud">
              <ellipse cx="600" cy="404" rx="132" ry="38" />
              <circle cx="540" cy="384" r="40" />
              <circle cx="602" cy="350" r="56" />
              <circle cx="662" cy="388" r="36" />
            </g>
          </Logo>
        </div>

        <p className="er-chip"><i aria-hidden="true" />Something broke</p>
        <h1 id="er-title">Looks like the sun went behind a cloud</h1>
        <p className="er-copy">
          That one&rsquo;s on us, not you. Give it another go. If it keeps happening, log out and sign back in.
        </p>

        <div className="er-actions">
          <button type="button" className="go er-try" onClick={retry} disabled={retrying || leaving} autoFocus>
            <span className={retrying ? "er-spin" : ""}><Icon name="spin" size={20} weight="bold" /></span>
            {retrying ? "Trying again…" : "Try again"}
          </button>
          <button type="button" className="ghost er-out" onClick={logout} disabled={retrying || leaving}>
            <Icon name="logout" size={20} />
            {leaving ? "Logging out…" : "Log out"}
          </button>
        </div>

        {problem && <p className="er-problem">{problem}</p>}
        {digest && <p className="er-ref">Reference <code>{digest}</code></p>}
      </div>
      <p className="er-brand">life<i>in</i>oau</p>
    </main>
  );
}