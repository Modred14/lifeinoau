// components/BottomNav.js
"use client";
import { useEffect, useLayoutEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import "./bottom-nav.css";

/**
 * The persistent bottom bar: a frosted-glass pill with the three places you go (Home, Buy, Map) and, beside it, a round Phone button.
 * The tab you are on is the one that opens up into icon + name (the others are icons, still named for screen readers and on hover).
 *
 * It is a fixed layer of its own (`--z-nav`, see bottom-nav.css) that sits above the game's full-screen layers (travel sheets, building interiors, the trip HUD, dialogs and settings), so it stays on
 * screen above them. The ONE thing above it is the phone: the handset is a floating layer over everything, the bar included (phone.css), and while it is open the bar is inert behind it.
 * While it is mounted it marks <body data-nav="on">, and that is what tells those layers to keep their bottom controls clear of the bar. The Shell decides WHETHER the bar exists
 * (a character with a hostel, past the first load); nothing else gets to hide it.
 */
export default function BottomNav({ path, onPlay, buying, held, phoneOpen, unread = 0, opener, onHome, onBuy, onMap, onPhone }) {
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
  const shown = tapped ?? nowOn,
    home = shown === "home",
    map = shown === "map",
    buy = shown === "buy",
    tap = (id, fn) => (e) => {
      setTapped(id);
      fn?.(e);
    };
  return (
    <nav className="nav" aria-label="Main" inert={phoneOpen || undefined}>
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
          <Icon name="phone" weight={phoneOpen ? "fill" : "regular"} />
          {unread > 0 && (
            <i className="nav-badge" role="status" aria-hidden="true">
              {unread > 9 ? "9+" : unread}
            </i>
          )}
        </span>
      </button>
    </nav>
  );
}