// components/apps/DeveloperApp.js: the Developer app. Lives inside the phone (see components/Phone.js).
// A small portfolio page for the creator of Life in OAU. All the text comes from lib/developer.js.
// "Message developer" does not build a second chat: it asks the real messages API for the thread with the developer's player name
// (the same lookup, login check and block rules every conversation uses). Only when that answers does it open the normal Messages app on
// that conversation, so existing messages are kept. If the account is missing, it is you, or the call fails, the error is shown here instead.
"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ChatCircleDots, Code, Envelope, Globe, WarningCircle } from "@phosphor-icons/react";
import { call, loggedOut } from "@/lib/client";
import { DEVELOPER, SKILLS, FEATURED, PROJECTS, messageErrorText } from "@/lib/developer.js";
import "./developer-app.css";

export default function DeveloperApp({ onOpenApp }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function messageDeveloper() {
    if (busy) return;
    setBusy(true); setError(null);
    const r = await call("/api/messages?with=" + encodeURIComponent(DEVELOPER.username)); // login, lookup and block checks all happen on the server
    if (!alive.current || r.aborted) return;
    setBusy(false);
    if (r.status === 401) return loggedOut(router);
    if (r.failed || !r.with) return setError(messageErrorText(r));
    onOpenApp?.("messages", r.with); // the exact player name the server found
  }

  return (
    <article className="dv" aria-label={`${DEVELOPER.name}, developer profile`}>
      <header className="dv-hero">
        <div className="dv-avatar" aria-hidden="true">
          <span className="dv-monogram">M</span>
          <img className="dv-badge" src="/icon.png" alt="" width="34" height="34" decoding="async" />
        </div>
        <h2 className="dv-name">{DEVELOPER.name}</h2>
        <p className="dv-nick">“{DEVELOPER.nickname}” · @{DEVELOPER.username}</p>
        <p className="dv-role"><Code size={15} weight="bold" aria-hidden="true" />{DEVELOPER.role}</p>
      </header>

      <button type="button" className="dv-btn dv-primary" onClick={messageDeveloper} disabled={busy} aria-busy={busy || undefined}>
        <ChatCircleDots size={20} weight="fill" aria-hidden="true" />{busy ? "Opening chat…" : "Message developer"}
      </button>
      {error && <p className="dv-error" role="alert"><WarningCircle size={18} weight="fill" aria-hidden="true" /><span>{error}</span></p>}

      <section className="dv-card" aria-labelledby="dv-about">
        <h3 id="dv-about" className="dv-h">About</h3>
        {DEVELOPER.bio.map((t) => <p key={t} className="dv-p">{t}</p>)}
      </section>

      <section className="dv-card" aria-labelledby="dv-contact">
        <h3 id="dv-contact" className="dv-h">Contact</h3>
        <a className="dv-link" href={DEVELOPER.portfolio} target="_blank" rel="noopener noreferrer">
          <Globe size={20} weight="duotone" aria-hidden="true" />
          <span><small>Portfolio</small>{DEVELOPER.portfolio.replace("https://", "")}</span>
          <ArrowUpRight size={16} weight="bold" aria-hidden="true" />
        </a>
        <a className="dv-link" href={`mailto:${DEVELOPER.email}`}>
          <Envelope size={20} weight="duotone" aria-hidden="true" />
          <span><small>Email</small>{DEVELOPER.email}</span>
          <ArrowUpRight size={16} weight="bold" aria-hidden="true" />
        </a>
      </section>

      <section className="dv-card" aria-labelledby="dv-skills">
        <h3 id="dv-skills" className="dv-h">Skills</h3>
        <ul className="dv-chips">{SKILLS.map((s, i) => <li key={s} style={{ "--i": i }}>{s}</li>)}</ul>
      </section>

      <section className="dv-card dv-feature" aria-labelledby="dv-featured">
        <h3 id="dv-featured" className="dv-h">Featured project</h3>
        <div className="dv-feature-top">
          <img src="/icon.png" alt="" width="52" height="52" decoding="async" />
          <div><b>{FEATURED.name}</b><small>{FEATURED.tagline}</small></div>
        </div>
        <p className="dv-p">{FEATURED.text}</p>
        <ul className="dv-chips dv-chips-sm">{FEATURED.stack.map((s) => <li key={s}>{s}</li>)}</ul>
        <p className="dv-here">You are playing it right now.</p>
      </section>

      <section className="dv-card" aria-labelledby="dv-more">
        <h3 id="dv-more" className="dv-h">More from modred.dev</h3>
        <ul className="dv-projects">
          {PROJECTS.map((p) => (
            <li key={p.name}>
              <a className="dv-project" href={p.href} target="_blank" rel="noopener noreferrer" aria-label={`${p.name}, opens in a new tab`}>
                <span className="dv-project-t"><b>{p.name}</b><small>{p.tagline}</small></span>
                <ArrowUpRight size={16} weight="bold" aria-hidden="true" />
                <span className="dv-project-d">{p.text}</span>
                <span className="dv-chips dv-chips-sm" aria-hidden="true">{p.stack.map((s) => <i key={s}>{s}</i>)}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
