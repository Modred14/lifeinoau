// components/Phone.js
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { naira, call } from "@/lib/client";
import { CLASS_INFO } from "@/lib/classes.js";
import { playSound } from "@/lib/sound";
import MessagesApp from "./apps/MessagesApp";
import CareerApp from "./apps/CareerApp";
import CoursesApp from "./apps/CoursesApp";
import InvestApp from "./apps/InvestApp";
import RelationshipApp from "./apps/RelationshipApp";
import PartiesApp from "./apps/PartiesApp";
import LeaderboardsApp from "./apps/LeaderboardsApp";
import AchievementsApp from "./apps/AchievementsApp";
import SettingsApp from "./apps/SettingsApp";
import HousingApp from "./apps/HousingApp";
import "./phone.css";

/** Every app opens inside the handset. `own` apps draw their own header (Messages has a chat bar). */
const APPS = {
  messages: { name: "Messages", icon: "chat", tone: "blue", own: true },
  jobs: { name: "Jobs", icon: "jobs", tone: "green", C: CareerApp },
  courses: { name: "Courses", icon: "courses", tone: "teal", C: CoursesApp },
  invest: { name: "Invest", icon: "invest", tone: "gold", C: InvestApp },
  love: { name: "Love", icon: "love", tone: "rose", C: RelationshipApp },
  parties: { name: "Parties", icon: "party", tone: "violet", C: PartiesApp },
  forbes: { name: "Forbes", icon: "forbes", tone: "amber", C: LeaderboardsApp },
  awards: { name: "Awards", icon: "medal", tone: "orange", C: AchievementsApp },
  housing: { name: "Housing", icon: "home", tone: "sky", C: HousingApp },
  settings: { name: "Settings", icon: "gear", tone: "graphite", C: SettingsApp },
};
export const PHONE_APPS = Object.keys(APPS);
const GRID = ["messages", "jobs", "courses", "invest", "love", "parties", "forbes", "awards", "housing", "settings"];

const day = (d) => d.toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long" });
const clock = (d) =>
  d
    .toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\s?(am|pm)/i, (m) => m.trim().toUpperCase())
    .replace(/^(\d+:\d+)(AM|PM)$/, "$1");

function Tile({ name, icon, tone, onClick, badge, first, sound }) {
  return (
    <button type="button" className="ph-app" ref={first} data-sound={sound} onClick={onClick} aria-label={badge ? `${name}, ${badge} unread` : name}>
      <span className="ph-ico" data-tone={tone}>
        <Icon name={icon} size={28} weight="fill" />
        {badge ? <i className="ph-badge">{badge > 9 ? "9+" : badge}</i> : null}
      </span>
      <span className="ph-name">{name}</span>
    </button>
  );
}

/** The phone. A home screen with widgets, app icons and a dock. Tapping an app opens it on the same screen, nothing navigates away. */
export default function Phone({ open, onClose, st, firstApp, initialApp, onShop, onLogout, loggingOut }) {
  const [now, setNow] = useState(() => new Date());
  const [app, setApp] = useState(null);
  const [unread, setUnread] = useState(0);
  const wasOpen = useRef(false),
    lastUnread = useRef(null);

  useEffect(() => {
    // the handset slides up and away with a sound, whichever way it was opened or closed
    if (open !== wasOpen.current) playSound(open ? "open" : "close");
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    setApp(APPS[initialApp] ? initialApp : null);
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, [open, initialApp]);
  useEffect(() => {
    if (!open || !st) return;
    let on = true;
    const load = async () => {
      const r = await call("/api/messages?unread=1"); // just a number: the old call downloaded the whole inbox every 30 seconds
      if (!on || r.failed) return;
      const n = r.unread ?? 0;
      if (lastUnread.current !== null && n > lastUnread.current) playSound("receive");
      lastUnread.current = n;
      setUnread(n);
    };
    load();
    const t = setInterval(() => !document.hidden && load(), 30000);
    return () => { on = false; clearInterval(t); };
  }, [open, !!st]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const k = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.stopPropagation();
      app ? setApp(null) : onClose();
    };
    document.addEventListener("keydown", k, true);
    return () => document.removeEventListener("keydown", k, true);
  }, [open, app, onClose]);
  const home = useCallback(() => setApp(null), []);
  if (!open) return null;
  const c = st?.character, a = st?.academics, info = c && CLASS_INFO[c.class];
  const cur = app && APPS[app];
  const Cur = cur?.C;
  return (
    <div className="ph-scrim" onClick={onClose}>
      <div className="ph" role="dialog" aria-modal="true" aria-label="Phone" data-app={app ?? undefined} onClick={(e) => e.stopPropagation()}>
        <div className="ph-screen">
          <div className="ph-status">
            <b className="num">{clock(now)}</b>
            <span className="ph-notch" aria-hidden="true" />
            <span className="ph-sys">
              <i className="ph-4g"><i /><i /><i />4G</i>
              <Icon name="battery" size={20} weight="fill" />
            </span>
          </div>

          <div className="ph-homescreen" aria-hidden={app ? true : undefined} inert={app ? true : undefined}>
            <div className="ph-body">
              {st && (
                <div className="ph-wallet" aria-label="Wallet">
                  <span className="ph-wallet-ico"><Icon name="coins" size={18} weight="fill" /></span>
                  <b className="num">{naira(st.balanceKobo)}</b>
                  <span className="ph-wallet-s">Week {st.week} · CGPA {a.cgpa ?? "–"} · Energy {c.energy}%</span>
                </div>
              )}
              <div className="ph-grid">
                {GRID.map((id, k) => (
                  <Tile key={id} {...APPS[id]} badge={id === "messages" ? unread : 0} first={k === 0 ? firstApp : undefined} onClick={() => setApp(id)} />
                ))}
                <Tile name="Shop" icon="bag" tone="mint" sound="none" onClick={onShop} />
                <Tile name={loggingOut ? "Leaving…" : "Log out"} icon="logout" tone="slate" onClick={onLogout} />
              </div>
            </div>
            <span className="ph-city" aria-hidden="true" />
          </div>

          {cur && (
            <section className="pa" key={app} aria-label={cur.name}>
              {!cur.own && (
                <header className="pa-bar">
                  <button type="button" className="pa-back" onClick={home} aria-label="Back to home screen">
                    <Icon name="back" size={24} weight="bold" />
                  </button>
                  <h2>{cur.name}</h2>
                </header>
              )}
              <div className="pa-body">
                {Cur ? <div className="pa-content"><Cur onOpenApp={setApp} onClose={onClose} /></div> : <MessagesApp onHome={home} onUnread={setUnread} />}
              </div>
            </section>
          )}

          <button type="button" className="ph-home" data-sound={app ? "home" : "none"} onClick={() => (app ? home() : onClose())} aria-label={app ? "Go to home screen" : "Close phone"}>
            <i />
          </button>
        </div>
        <button type="button" className="ph-close" data-sound="none" onClick={onClose} aria-label="Close phone">
          <Icon name="close" size={18} />
          Close
        </button>
      </div>
    </div>
  );
}