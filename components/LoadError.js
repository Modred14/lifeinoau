// components/LoadError.js
"use client";
import { useState } from "react";
import "./load-error.css";
import Logo from "./Logo";
import { Icon } from "./Icon";
import { call } from "@/lib/client";

/**
 * The "this didn't load" state that sits inside a page (the header and menu stay visible). Two ways out: Try again, or Log out.
 *   <LoadError onRetry={load} />
 *   <LoadError title="Your game didn't load" message="..." onRetry={load} />
 * For a whole-page crash see ErrorScreen.
 */
export default function LoadError({ title = "This page didn't load", message = "Check your connection and try again.", onRetry }) {
  const [leaving, setLeaving] = useState(false);
  const [problem, setProblem] = useState("");

  async function logout() {
    if (leaving) return;
    setProblem("");
    setLeaving(true);
    const r = await call("/api/logout", {});
    if (r.failed) {
      setLeaving(false);
      return setProblem("We couldn't log you out. Check your connection and try again.");
    }
    window.location.assign("/");
  }

  return (
    <section className="le" role="alert">
      <Logo size={84} className="le-logo" sunClass="le-sun">
        <g className="le-cloud">
          <ellipse cx="600" cy="404" rx="132" ry="38" />
          <circle cx="540" cy="384" r="40" />
          <circle cx="602" cy="350" r="56" />
          <circle cx="662" cy="388" r="36" />
        </g>
      </Logo>
      <h2>{title}</h2>
      <p className="le-copy">{message}</p>
      <div className="le-actions">
        <button type="button" className="go" onClick={onRetry} disabled={leaving}>
          <Icon name="spin" size={18} weight="bold" />
          Try again
        </button>
        <button type="button" className="ghost le-out" onClick={logout} disabled={leaving}>
          <Icon name="logout" size={18} />
          {leaving ? "Logging out…" : "Log out"}
        </button>
      </div>
      {problem && <p className="le-problem">{problem}</p>}
    </section>
  );
}