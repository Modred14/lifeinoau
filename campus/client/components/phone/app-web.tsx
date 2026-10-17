"use client";

import { useState } from "react";
import { PiArrowSquareOutBold, PiLockKeyBold } from "react-icons/pi";
import { PHONE_APPS, type PhoneApp } from "./apps";
import { AppIcon } from "./app-icon";

export function AppWeb({ app }: { app: PhoneApp }) {
  const [embedded, setEmbedded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  if (!app.website) return null;
  return (
    <section className="ph-web">
      <div className="ph-address"><PiLockKeyBold aria-hidden="true" /><span>{new URL(app.website).hostname}</span></div>
      {!embedded ? (
        <div className="ph-web-launch">
          <AppIcon app={app} />
          <h3>{app.label}</h3>
          <p>Visit the real {app.label} website from your phone.</p>
          <button type="button" className="ph-btn" onClick={() => setEmbedded(true)}>Load website</button>
        </div>
      ) : (
        <iframe key={attempt} className="ph-web-frame" src={app.website} title={`${app.label} website`} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" />
      )}
      <p className="ph-note">Some sites block this view or need a separate sign-in. Real sites use your real account, not your game wallet.</p>
      <div className="ph-web-actions">
        <a className="ph-btn" href={app.website} target="_blank" rel="noopener noreferrer">Open real site <PiArrowSquareOutBold aria-hidden="true" /></a>
        {embedded && <button type="button" className="ph-btn ph-btn-quiet" onClick={() => setAttempt((value) => value + 1)}>Reload</button>}
      </div>
    </section>
  );
}

export function AppBrowser() {
  const [selected, setSelected] = useState<PhoneApp | null>(null);
  if (selected) return <><button type="button" className="ph-btn ph-btn-quiet" onClick={() => setSelected(null)}>All websites</button><AppWeb key={selected.id} app={selected} /></>;
  return (
    <ul className="ph-list ph-websites">
      {PHONE_APPS.filter((app) => app.website).map((app) => (
        <li key={app.id}>
          <button type="button" className="ph-website" onClick={() => setSelected(app)}>
            <AppIcon app={app} small /><span><b>{app.label}</b><small>{new URL(app.website!).hostname}</small></span>
          </button>
        </li>
      ))}
    </ul>
  );
}
