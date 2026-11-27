// components/BottomNav.js
"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import PlayerAvatar from "./PlayerAvatar";
import NeedsSheet from "./NeedsSheet";
import { RING, moodOf } from "@/lib/needs.js";
import "./bottom-nav.css";

/**
 * The persistent bottom bar: your avatar (its ring is how you are doing; tap it for the needs sheet), a frosted-glass pill with the three places you go (Home, Buy, Map) and a Phone button drawn as a little handset.
 * The tab you are on is the one that opens up into icon + name (the others are icons, still named for screen readers and on hover).
 *
 * It is a fixed layer of its own (`--z-nav`, see bottom-nav.css) that sits above the game's full-screen layers (travel sheets, building interiors, the trip HUD, dialogs and settings), so it stays on
 * screen above them. The ONE thing above it is the phone: the handset is a floating layer over everything, the bar included (phone.css), and while it is open the bar is inert behind it.
 * While it is mounted it marks <body data-nav="on">, and that is what tells those layers to keep their bottom controls clear of the bar. The Shell decides WHETHER the bar exists
 * (a character with a hostel, past the first load); nothing else gets to hide it.
 */
export default function BottomNav({ path, onPlay, buying, held, phoneOpen, unread = 0, opener, character, onHome, onBuy, onMap, onPhone }) {
  useLayoutEffect(() => {
    document.body.dataset.nav = "on";
    return () => {
      delete document.body.dataset.nav;
    };
  }, []);
  const nowOn = onPlay && !buying ? "home" : buying ? "buy" : path === "/map" ? "map" : null;
  // The tab lights up the moment it is tapped, not when the next screen has finished loading: going to another page can take a moment, and the bar should not wait for it
  // (waiting is what made the move between tabs look late and jumpy). It settles on the real tab as soon as that matches, or after a short while if the trip never happens.
  const [tapped, setTapped] = useState(null);
  useEffect(() => {
    if (tapped && nowOn === tapped) setTapped(null);
  }, [nowOn, tapped]);
  useEffect(() => {
    if (!tapped) return;
    const t = setTimeout(() => setTapped(null), 2500);
    return () => clearTimeout(t);
  }, [tapped]);
  const [me, setMe] = useState(false), // the avatar's needs sheet
    meBtn = useRef(null),
    closeMe = useCallback(() => {
      if (document.activeElement?.closest?.(".ns")) meBtn.current?.focus(); // closed from inside the sheet (X, Escape): the avatar gets focus back; a tap elsewhere keeps its own
      setMe(false);
    }, []);
  useEffect(() => { if (phoneOpen) setMe(false); }, [phoneOpen]); // the phone is above everything: it takes over
  useEffect(() => { setMe(false); }, [path]);
  const mood = moodOf(character),
    shown = tapped ?? nowOn,
    home = shown === "home",
    map = shown === "map",
    buy = shown === "buy",
    tap = (id, fn) => (e) => {
      setTapped(id);
      fn?.(e);
    };
  return (
    <>
    <nav className="nav" aria-label="Main" inert={phoneOpen || undefined}>
      {character && (
        <button
          type="button"
          className="nav-me"
          ref={meBtn}
          data-active={me ? "1" : undefined}
          data-sound="none"
          aria-expanded={me}
          aria-haspopup="dialog"
          aria-controls="nav-needs"
          aria-label={`You, ${character.name}, feeling ${mood.text.toLowerCase()}. ${me ? "Close" : "Open"} your needs`}
          title="You"
          onClick={() => setMe((v) => !v)}
        >
          <svg className="nav-ring" viewBox="0 0 54 54" aria-hidden="true">
            <g fill="none" strokeWidth="3.5" strokeLinecap="round" transform="rotate(-90 27 27)">
              {RING.map(([k, color], i) => {
                const v = Math.max(0, Math.min(100, Number(character[k] ?? 0))), off = -(i * 20 + 1.5);
                return (
                  <g key={k}>
                    <circle cx="27" cy="27" r="24.5" pathLength="100" stroke="rgba(255,255,255,0.14)" strokeDasharray="17 83" strokeDashoffset={off} />
                    {v > 0 && <circle cx="27" cy="27" r="24.5" pathLength="100" stroke={v < 25 ? "#ff4d5e" : color} strokeDasharray={`${Math.max(0.2, (17 * v) / 100)} 100`} strokeDashoffset={off} />}
                  </g>
                );
              })}
            </g>
          </svg>
          <PlayerAvatar name={character.name} size={38} className="nav-me-pic" />
          <i className="nav-mood" data-tone={mood.tone} aria-hidden="true"><Icon name={mood.icon} size={12} weight="fill" /></i>
        </button>
      )}
      <div className="nav-pill">
        <Link href="/home" aria-current={home ? "page" : undefined} data-active={home ? "1" : undefined} title="Home" onClick={tap("home", onHome)}>
          <Icon name="home" weight={home ? "fill" : "regular"} />
          <span>Home</span>
        </Link>
        <button
          type="button"
          data-active={buy ? "1" : undefined}
          aria-current={buy ? "page" : undefined}
          disabled={held}
          title={held ? "Not while you are in Floor O (N-QRS Custody)" : "Buy"}
          onClick={tap("buy", onBuy)}
        >
          <Icon name="bag" weight={buy ? "fill" : "regular"} />
          <span>Buy</span>
        </button>
        <Link href="/map" aria-current={map ? "page" : undefined} data-active={map ? "1" : undefined} title="Map" onClick={tap("map", onMap)}>
          <Icon name="map" weight={map ? "fill" : "regular"} />
          <span>Map</span>
        </Link>
      </div>
      <button
        type="button"
        className="nav-phone"
        ref={opener}
        data-sound="none"
        data-active={phoneOpen ? "1" : undefined}
        aria-expanded={phoneOpen}
        aria-haspopup="dialog"
        aria-label={unread > 0 ? `Phone, ${unread} unread messages` : "Phone"}
        title="Phone"
        onClick={onPhone}
      >
        <span className="nav-ico">
          <span className="nav-handset" aria-hidden="true">
            <i className="nh-island" />
            <i className="nh-screen"><b /><b /><b /><b /></i>
            <i className="nh-home" />
          </span>
          {unread > 0 && (
            <i className="nav-badge" role="status" aria-hidden="true">
              {unread > 9 ? "9+" : unread}
            </i>
          )}
        </span>
      </button>
    </nav>
    {me && character && <NeedsSheet id="nav-needs" character={character} onClose={closeMe} />}
    </>
  );
}