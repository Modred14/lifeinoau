// components/OfflineGate.js
// Covers the whole app with a "no network" page while the device is offline, and goes away by itself when the connection returns.
// It also registers /sw.js, which serves /offline.html if the player reloads or opens the site with no connection at all.
"use client";
import { useEffect, useState } from "react";
import "./error-screen.css";
import Logo from "./Logo";
import { initPwa, watchPwaUpdates } from "@/lib/pwa";
import { Icon } from "./Icon";

export default function OfflineGate() {
  const [offline, setOffline] = useState(false), [checking, setChecking] = useState(false), [still, setStill] = useState(false);

  useEffect(() => {
    initPwa(); // listen for the browser's install prompt from the very start (Settings > Install Game shows it)
    setOffline(!navigator.onLine);
    const down = () => setOffline(true), up = () => { setOffline(false); setStill(false); };
    window.addEventListener("offline", down);
    window.addEventListener("online", up);
    if ("serviceWorker" in navigator) {
      if (process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js").then(watchPwaUpdates).catch(() => {});
      else navigator.serviceWorker.getRegistrations().then(async (registrations) => {
        for (const registration of registrations) {
          if (registration.active && new URL(registration.active.scriptURL).pathname === "/sw.js") await registration.unregister();
        }
        if ("caches" in window) for (const key of await caches.keys()) if (key === "offline-v1" || key.startsWith("oau-campus-")) await caches.delete(key);
      }).catch(() => {});
    }
    return () => { window.removeEventListener("offline", down); window.removeEventListener("online", up); };
  }, []);

  useEffect(() => {
    if (!offline) return;
    document.body.setAttribute("data-bare", "");
    return () => document.body.removeAttribute("data-bare");
  }, [offline]);

  // "Try again": the browser flag can be wrong, so ask the server for a tiny file
  async function retry() {
    if (checking) return;
    setChecking(true); setStill(false);
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 6000); // a network that never answers must not leave "Checking…" up forever
    try {
      await fetch("/icon.png?ping=" + Date.now(), { method: "HEAD", cache: "no-store", signal: ac.signal });
      setOffline(false);
    } catch {
      setStill(true);
    } finally {
      clearTimeout(t);
    }
    setChecking(false);
  }

  if (!offline) return null;
  return (
    <main className="er" role="alert" aria-labelledby="off-title" style={{ zIndex: 200 }}>
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
        <p className="er-chip"><i aria-hidden="true" />No connection</p>
        <h1 id="off-title">You are offline</h1>
        <p className="er-copy">We can&rsquo;t reach lifeinoau right now. Check your Wi-Fi or mobile data. The game will carry on as soon as you are back online.</p>
        <div className="er-actions">
          <button type="button" className="go er-try" onClick={retry} disabled={checking} autoFocus>
            <span className={checking ? "er-spin" : ""}><Icon name="spin" size={20} weight="bold" /></span>
            {checking ? "Checking…" : "Try again"}
          </button>
        </div>
        {still && <p className="er-problem">Still no connection.</p>}
      </div>
      <p className="er-brand">life<i>in</i>oau</p>
    </main>
  );
}
