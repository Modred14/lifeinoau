// components/NotFound.js
// The 404 page: "4 ○ 4", where the zero is the logo's ring with its sun inside. Two ways out: home, or the map.
"use client";
import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";
import "./not-found.css";

export default function NotFound() {
  const path = usePathname();
  // hide the site header while this page is showing (same switch the error page uses)
  useEffect(() => {
    document.body.setAttribute("data-bare", "");
    return () => document.body.removeAttribute("data-bare");
  }, []);
  return (
    <main className="nf" aria-labelledby="nf-title">
      <div className="nf-card">
        <div className="nf-num" aria-hidden="true">
          <span>4</span>
          <svg className="nf-zero" viewBox="0 0 100 100" focusable="false">
            <circle className="nf-ring" cx="50" cy="50" r="40" pathLength="100" />
            <circle className="nf-sun" cx="58" cy="54" r="16" />
          </svg>
          <span>4</span>
        </div>
        <p className="nf-chip">Error 404</p>
        <h1 id="nf-title">This road doesn&rsquo;t lead anywhere</h1>
        <p className="nf-copy">The page you&rsquo;re after isn&rsquo;t on the campus map. It may have moved, or the link is a letter off.</p>
        <div className="nf-actions">
          <Link href="/home" className="btn go nf-main" autoFocus><Icon name="door" size={20} weight="fill" /> Back home</Link>
          <Link href="/map" className="btn nf-alt"><Icon name="pin" size={20} /> Open the map</Link>
        </div>
        {path && <p className="nf-path"><code>{path}</code></p>}
      </div>
      <p className="nf-brand">life<i>in</i>oau</p>
    </main>
  );
}