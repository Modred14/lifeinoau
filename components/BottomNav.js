// components/BottomNav.js
"use client";
import { useLayoutEffect } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import "./bottom-nav.css";

/**
 * The persistent four-tab bar (Home, Buy, Map, Phone).
 *
 * It is a fixed layer of its own (`--z-nav`, see bottom-nav.css) that sits above every full-screen layer of the game: the phone, travel sheets,
 * building interiors, the trip HUD, dialogs and settings. While it is mounted it marks <body data-nav="on">, and that is what tells those layers
 * to keep their bottom controls clear of the bar. The Shell decides WHETHER the bar exists (a character with a hostel, past the first load);
 * nothing else gets to hide it.
 */
export default function BottomNav({ path, onPlay, buying, held, phoneOpen, unread = 0, opener, onHome, onBuy, onMap, onPhone }) {
  useLayoutEffect(() => {
    document.body.dataset.nav = "on";
    return () => {
      delete document.body.dataset.nav;
    };
  }, []);
  const home = onPlay && !buying,
    map = path === "/map";
  return (
    <nav className="nav" aria-label="Main">
      <Link href="/home" aria-current={home ? "page" : undefined} data-active={home ? "1" : undefined} onClick={onHome}>
        <Icon name="home" weight={home ? "fill" : "regular"} />
        <span>Home</span>
      </Link>
      <button
        type="button"
        data-active={buying ? "1" : undefined}
        aria-current={buying ? "page" : undefined}
        disabled={held}
        title={held ? "Not while you are in Floor O (N-QRS Custody)" : undefined}
        onClick={onBuy}
      >
        <Icon name="bag" weight={buying ? "fill" : "regular"} />
        <span>Buy</span>
      </button>
      <Link href="/map" aria-current={map ? "page" : undefined} data-active={map ? "1" : undefined} onClick={onMap}>
        <Icon name="map" weight={map ? "fill" : "regular"} />
        <span>Map</span>
      </Link>
      <button
        type="button"
        ref={opener}
        data-sound="none"
        data-active={phoneOpen ? "1" : undefined}
        aria-expanded={phoneOpen}
        aria-haspopup="dialog"
        onClick={onPhone}
      >
        <span className="nav-ico">
          <Icon name="phone" weight={phoneOpen ? "fill" : "regular"} />
          {unread > 0 && (
            <i className="nav-badge" role="status" aria-label={`${unread} unread messages`}>
              {unread > 9 ? "9+" : unread}
            </i>
          )}
        </span>
        <span>Phone</span>
      </button>
    </nav>
  );
}
