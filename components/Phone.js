// components/Phone.js
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import { naira } from "@/lib/client";
import { CLASS_INFO } from "@/lib/classes.js";
import "./phone.css";

// [name, icon, route, colour]. Colours are gradients defined in phone.css.
const DOCK = [
  ["Messages", "chat", "/people", "blue"],
  ["Jobs", "jobs", "/career", "green"],
  ["Courses", "courses", "/courses", "teal"],
  ["Map", "map", "/map", "sky"],
];
const APPS = [
  ["Invest", "invest", "/invest", "gold"],
  ["Love", "love", "/relationship", "rose"],
  ["Parties", "party", "/parties", "violet"],
  ["Forbes", "forbes", "/leaderboards", "amber"],
  ["Awards", "medal", "/achievements", "orange"],
];

const day = (d) =>
  d.toLocaleDateString("en-NG", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
const clock = (d) =>
  d
    .toLocaleTimeString("en-NG", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .replace(/\s?(am|pm)/i, (m) => m.trim().toUpperCase())
    .replace(/^(\d+:\d+)(AM|PM)$/, "$1");

function App({ name, icon, href, tone, onClick, first, badge }) {
  const inner = (
    <>
      <span className="ph-ico" data-tone={tone}>
        <Icon name={icon} size={30} weight="fill" />
        {badge ? <i className="ph-badge">{badge}</i> : null}
      </span>
      <span className="ph-name">{name}</span>
    </>
  );
  return href ? (
    <Link href={href} className="ph-app" ref={first} onClick={onClick}>
      {inner}
    </Link>
  ) : (
    <button type="button" className="ph-app" ref={first} onClick={onClick}>
      {inner}
    </button>
  );
}

/** The phone: a lock-screen style home with widgets, app icons and a dock. Every icon opens a real part of the game. */
export default function Phone({
  open,
  onClose,
  st,
  firstApp,
  onShop,
  onLogout,
  loggingOut,
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, [open]);
  if (!open) return null;
  const c = st?.character,
    a = st?.academics,
    info = c && CLASS_INFO[c.class];
  return (
    <div className="ph-scrim" onClick={onClose}>
      <div
        className="ph"
        role="dialog"
        aria-modal="true"
        aria-label="Phone"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ph-screen">
          <div className="ph-status">
            <b className="num">{clock(now)}</b>
            <span className="ph-notch" aria-hidden="true" />
            <span className="ph-sys">
              <Icon name="signal" size={16} weight="fill" />
              <Icon name="wifi" size={16} weight="bold" />
              <Icon name="battery" size={20} weight="fill" />
            </span>
          </div>
          <div className="ph-body">
            <header className="ph-time">
              <h2 className="num">{clock(now)}</h2>
              <p>{day(now)} · Ile-Ife</p>
              {st && (
                <span className="ph-chip">
                  <Icon name="moon" size={14} weight="fill" />
                  Game week {st.week}
                </span>
              )}
            </header>
            {st && (
              <section className="ph-widgets" aria-label="Today">
                <div className="ph-w ph-w--wide">
                  <span className="ph-w-k">Wallet</span>
                  <b className="num">{naira(st.balanceKobo)}</b>
                  <span className="ph-w-s" style={{ color: info?.color }}>
                    {c.class} · {c.hostel}
                  </span>
                </div>
                <div className="ph-w">
                  <span className="ph-w-k">CGPA</span>
                  <b className="num">{a.cgpa ?? "–"}</b>
                  <span className="ph-w-s">Exam wk {a.nextExamWeek}</span>
                </div>
                <div className="ph-w">
                  <span className="ph-w-k">Energy</span>
                  <b className="num">{c.energy}%</b>
                  <span className="ph-w-bar">
                    <i style={{ width: c.energy + "%" }} />
                  </span>
                </div>
              </section>
            )}
            <div className="ph-grid">
              {APPS.map(([n, i, h, t], k) => (
                <App
                  key={h}
                  name={n}
                  icon={i}
                  href={h}
                  tone={t}
                  first={k === 0 ? firstApp : undefined}
                  onClick={onClose}
                />
              ))}
              <App name="Shop" icon="bag" tone="mint" onClick={onShop} />
              <App
                name={loggingOut ? "Leaving…" : "Log out"}
                icon="logout"
                tone="slate"
                onClick={onLogout}
              />
            </div>
          </div>
          <nav className="ph-dock" aria-label="Favourite apps">
            {DOCK.map(([n, i, h, t]) => (
              <App
                key={h}
                name={n}
                icon={i}
                href={h}
                tone={t}
                onClick={onClose}
              />
            ))}
          </nav>
          <span className="ph-home" aria-hidden="true" />
        </div>
        <button
          type="button"
          className="ph-close"
          onClick={onClose}
          aria-label="Close phone"
        >
          <Icon name="close" size={18} />
          Close
        </button>
      </div>
    </div>
  );
}
