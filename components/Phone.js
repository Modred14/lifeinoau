// components/Phone.js
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { naira, call } from "@/lib/client";
import { CLASS_INFO } from "@/lib/classes.js";
import { playSound } from "@/lib/sound";
import { InPhone } from "./phoneContext";
import { serverDate } from "@/lib/serverClock";
import MessagesApp from "./apps/MessagesApp";
import { chat, useChat } from "@/lib/chat";
import CareerApp from "./apps/CareerApp";
import CoursesApp from "./apps/CoursesApp";
import InvestApp from "./apps/InvestApp";
import RelationshipApp from "./apps/RelationshipApp";
import PartiesApp from "./apps/PartiesApp";
import LeaderboardsApp from "./apps/LeaderboardsApp";
import AchievementsApp from "./apps/AchievementsApp";
import SettingsApp from "./apps/SettingsApp";
import HousingApp from "./apps/HousingApp";
import HireApp from "./apps/HireApp";
import RideApp from "./apps/RideApp";
import GuideApp from "./apps/GuideApp";
import BetApp from "./bet/BetApp";
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
  hire: { name: "Hire", icon: "driver", tone: "indigo", C: HireApp },
  ride: { name: "Ride", icon: "ride", tone: "orange", C: RideApp },
  bet: { name: "Bet", icon: "ticket", tone: "bet", own: true, C: BetApp }, // draws its own header and tab bar, like Messages
  settings: { name: "Settings", icon: "gear", tone: "graphite", C: SettingsApp },
  guide: { name: "OAU Guide", icon: "study", tone: "lime", C: GuideApp }, // generated from lib/features.js
};
export const PHONE_APPS = Object.keys(APPS);
const GRID = ["messages", "jobs", "courses", "invest", "love", "parties", "forbes", "awards", "housing", "ride", "hire", "bet", "guide", "settings"];
/** In Floor O (N-QRS Custody) the phone only does messages (and settings). The server refuses everything else too; this just stops offering it. */
const CUSTODY_GRID = ["messages", "settings"];

/** "Friday 16 October · Ile-Ife" */
const dateLine = (d) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-NG", { weekday: "long", day: "numeric", month: "long" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month} · Ile-Ife`;
};
/** "10:10" for the big clock, "10:10PM" (ampm = true) for the status bar. */
const clock = (d, ampm = false) => {
  const t = d.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s?(am|pm)/i, (m) => m.trim().toUpperCase());
  return ampm ? t : t.replace(/(AM|PM)$/, "");
};
const isNight = (d) => d.getHours() >= 19 || d.getHours() < 6;

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
export default function Phone({ open, onClose, st, held = false, firstApp, initialApp, initialWith = null, onShop, onLogout, loggingOut }) {
  const [now, setNow] = useState(() => serverDate());
  const [app, setApp] = useState(null);
  const unread = useChat((s) => s.unread); // pushed by the chat connection: nothing is polled for it any more
  const wasOpen = useRef(false);

  useEffect(() => {
    // the handset slides up and away with a sound, whichever way it was opened or closed
    if (open !== wasOpen.current) playSound(open ? "open" : "close");
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    setApp(APPS[initialApp] && (!held || CUSTODY_GRID.includes(initialApp)) ? initialApp : null);
    setNow(serverDate());
    const t = setInterval(() => setNow(serverDate()), 15000);
    return () => clearInterval(t);
  }, [open, initialApp, held]);
  // the chat connection lives as long as the player is in the game, so messages arrive even while the phone is closed
  const me = st?.character?.name;
  useEffect(() => { if (me) chat.begin(me); }, [me]);
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
    <InPhone.Provider value={true}>
    <div className="ph-scrim" data-over={initialWith ? "1" : undefined} onClick={onClose}>
      <div className="ph" role="dialog" aria-modal="true" aria-label="Phone" data-app={app ?? undefined} onClick={(e) => e.stopPropagation()}>
        <div className="ph-screen">
          <div className="ph-status">
            <b className="num">{clock(now, true)}</b>
            <span className="ph-notch" aria-hidden="true" />
            <span className="ph-sys">
              <i className="ph-4g"><i /><i /><i />4G</i>
              <Icon name="battery" size={20} weight="fill" />
            </span>
          </div>

          <div className="ph-homescreen" aria-hidden={app ? true : undefined} inert={app ? true : undefined}>
            <div className="ph-body">
              <div className="ph-hero">
                <b className="ph-time num" aria-label={`Time ${clock(now, true)}`}>{clock(now)}</b>
                <p className="ph-date">{dateLine(now)}</p>
                {/* <span className="ph-mode"><Icon name={isNight(now) ? "moon" : "sun"} size={17} weight="fill" />{isNight(now) ? "Night mode" : "Day mode"}</span> */}
              </div>
              {st && (
                <div className="ph-wallet" aria-label="Wallet">
                  <span className="ph-wallet-ico"><Icon name="coins" size={22} weight="fill" /></span>
                  <span className="ph-wallet-t">
                    <b className="num">{naira(st.balanceKobo)}</b>
                    <small>{a.cgpa && `CGPA ${a.cgpa ?? "–"} · `}Energy {c.energy}%</small>
                  </span>
                  <span className="ph-wallet-wk">Week {st.week}</span>
                </div>
              )}
              <div className="ph-grid">
                {(held ? CUSTODY_GRID : GRID).map((id, k) => (
                  <Tile key={id} {...APPS[id]} badge={id === "messages" ? unread : 0} first={k === 0 ? firstApp : undefined} onClick={() => setApp(id)} />
                ))}
                {!held && <Tile name="Shop" icon="bag" tone="mint" sound="none" onClick={onShop} />}
                <Tile name={loggingOut ? "Leaving…" : "Log out"} icon="logout" tone="slate" onClick={onLogout} />
              </div>
            </div>
            <span className="ph-city" aria-hidden="true" />
          </div>

          {cur && (
            <section className="pa" key={app + (initialWith ?? "")} aria-label={cur.name}>
              {!cur.own && (
                <header className="pa-bar">
                  <button type="button" className="pa-back" onClick={home} aria-label="Back to home screen">
                    <Icon name="back" size={24} weight="bold" />
                  </button>
                  <h2>{cur.name}</h2>
                </header>
              )}
              <div className="pa-body">
                {Cur ? (cur.own ? <Cur onHome={home} onClose={onClose} /> : <div className="pa-content"><Cur onOpenApp={setApp} onClose={onClose} /></div>) : <MessagesApp onHome={home} initialWho={app === "messages" ? initialWith : null} />}
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
    </InPhone.Provider>
  );
}