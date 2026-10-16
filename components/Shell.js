// components/Shell.js
"use client";
import Logo from "./Logo";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { call, naira, notifyError } from "@/lib/client";
import { setPlayMode, usePlayMode, useBare, resetBoot } from "@/lib/ui";
import { Icon } from "./Icon";
import Phone from "./Phone";
import { useChat } from "@/lib/chat";
import SoundToggle from "./SoundToggle";
import { toast } from "@/lib/toast";
import { game, useGame } from "@/lib/gameStore";

const moodOf = (h) =>
  h >= 80
    ? ["Very happy", "happy"]
    : h >= 60
      ? ["Happy", "happy"]
      : h >= 40
        ? ["Okay", "meh"]
        : ["Low", "sad"];
const stamp = (d) =>
  `${d.toLocaleDateString("en-NG", { weekday: "short" })} ${d.getDate()} · ${d.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s?(am|pm)/i, (m) => " " + m.trim().toUpperCase())}`;

/** Top bar across the whole window, four-tab bottom bar (Home, Buy, Map, Phone) and the phone. Hidden on the landing page and until you have a character. */
export default function Shell({ children }) {
  const path = usePathname(),
    router = useRouter(),
    mode = usePlayMode(),
    bareUi = useBare(),
    [loggingOut, setLoggingOut] = useState(false),
    g = useGame(), // one copy of the player's state, shared with the home screen: a change made anywhere shows here at once
    st = g?.character?.hostel ? g : null,
    unreadChats = useChat((x) => x.unread),
    [phone, setPhone] = useState(false),
    [phoneApp, setPhoneApp] = useState(null),
    [clock, setClock] = useState(null),
    opener = useRef(null),
    firstApp = useRef(null),
    failing = useRef(false);
  const bare = path === "/",
    full = path === "/map" || path === "/play",
    hideBars = path === "/play" && bareUi; // no top bar or bottom nav while the game loads or the player is creating a character
  // `force` asks the server no matter what. Without it, a copy younger than 15 seconds is reused, so moving between screens
  // (or flipping back to this tab) does not hit the server every time. One request at a time, however many parts of the app ask at once.
  const load = useCallback(async (force = false) => {
    const r = await (force ? game.refresh() : game.refreshIfStale(15_000));
    // 401/404 are normal (logged out / no character yet). Anything else: say so once per outage, not every poll.
    if (r.failed && r.status !== 401 && r.status !== 404) {
      if (!failing.current) {
        failing.current = true;
        notifyError(r, "We couldn't refresh your game. Check your connection.");
      }
    } else failing.current = false;
  }, []);
  useEffect(() => {
    if (bare) return;
    load();
    // Quietly re-check every minute, but only while the tab is on screen: a hidden tab costs the server nothing.
    const t = setInterval(() => !document.hidden && load(), 60000);
    const f = () => load(true); // something just changed the player's cash or stats: always ask
    const v = () => !document.hidden && load();
    window.addEventListener("game:refresh", f);
    document.addEventListener("visibilitychange", v);
    return () => {
      clearInterval(t);
      window.removeEventListener("game:refresh", f);
      document.removeEventListener("visibilitychange", v);
    };
  }, [bare, path, load]);
  useEffect(() => {
    setClock(new Date());
    const t = setInterval(() => setClock(new Date()), 20000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (phone) firstApp.current?.focus();
  }, [phone]);
  useEffect(() => {
    // old links (/career, /people ...) redirect to /play?app=x: open the phone on that app, then tidy the address bar
    const app = new URLSearchParams(window.location.search).get("app");
    if (path === "/play" && app) {
      setPhoneApp(app);
      setPhone(true);
      window.history.replaceState(null, "", "/play");
    } else setPhone(false);
  }, [path]);
  useEffect(() => {
    // the spacing that clears the bars shrinks to nothing while they are hidden
    if (!hideBars) return;
    const b = document.body;
    b.style.setProperty("--hud-h", "0px");
    b.style.setProperty("--nav-h", "0px");
    return () => {
      b.style.removeProperty("--hud-h");
      b.style.removeProperty("--nav-h");
    };
  }, [hideBars]);
  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    const r = await call("/api/logout", {});
    setLoggingOut(false);
    if (r.failed)
      return notifyError(r, "We couldn't log you out. Please try again.");
    setPhone(false);
    resetBoot(); // the stored game state was already cleared when the logout request succeeded
    toast.info("You're logged out. See you soon.", { id: "session" });
    router.push("/");
  }
  if (bare)
    return (
      <>
        {children}
        <SoundToggle />
      </>
    );
  const creating = path === "/play" && !st,
    onPlay = path === "/play" && !!st,
    buying = onPlay && mode === "buy",
    mood = st ? moodOf(st.character.happiness) : null;
  const goHome = () => {
    setPlayMode("home");
    if (path !== "/play") router.push("/play");
  };
  const goBuy = () => {
    setPlayMode("buy");
    if (path !== "/play") router.push("/play");
  };
  return (
    <>
      {!hideBars && (
      <header className="hud">
        <Link
          href={st ? "/play" : "/"}
          className="brand"
          aria-label="lifeinoau home"
          onClick={() => setPlayMode("home")}
        >
          <span className="crown" aria-hidden="true">
            <Logo size={28} />
          </span>
          <span>
            life<i>in</i>oau
          </span>
        </Link>
        {st && (
          <>
            <span className="sep" aria-hidden="true" />
            <span className="meta num">
              Week {st.week} · {st.character.level}L
            </span>
          </>
        )}
        <span className="grow" />
        {st && clock && (
          <span className="hud-mid">
            <span className="hud-time num">{stamp(clock)}</span>
            <span className="hud-mood">
              <Icon name={mood[1]} size={18} weight="fill" />
              {mood[0]}
            </span>
          </span>
        )}
        <span className="grow" />
        {st && (
          <span className="cash num" aria-label="Cash">
            <Icon name="coins" size={18} weight="fill" />
            {naira(st.balanceKobo)}
          </span>
        )}
      </header>
      )}
      {full ? (
        children
      ) : (
        <main className={"page" + (creating ? " wide" : "")}>{children}</main>
      )}
      {st && !hideBars && (
        <nav className="nav" aria-label="Main">
          <Link
            href="/play"
            aria-current={onPlay && !buying ? "page" : undefined}
            data-active={onPlay && !buying ? "1" : undefined}
            onClick={goHome}
          >
            <Icon name="home" weight={onPlay && !buying ? "fill" : "regular"} />
            <span>Home</span>
          </Link>
          <button
            type="button"
            data-active={buying ? "1" : undefined}
            aria-current={buying ? "page" : undefined}
            onClick={goBuy}
          >
            <Icon name="bag" weight={buying ? "fill" : "regular"} />
            <span>Buy</span>
          </button>
          <Link
            href="/map"
            aria-current={path === "/map" ? "page" : undefined}
            data-active={path === "/map" ? "1" : undefined}
            onClick={() => setPlayMode("home")}
          >
            <Icon name="map" weight={path === "/map" ? "fill" : "regular"} />
            <span>Map</span>
          </Link>
          <button
            type="button"
            ref={opener}
            data-sound="none"
            data-active={phone ? "1" : undefined}
            aria-expanded={phone}
            aria-haspopup="dialog"
            onClick={() => {
              setPhoneApp(null);
              setPhone(true);
            }}
          >
            <span className="nav-ico">
              <Icon name="phone" weight={phone ? "fill" : "regular"} />
              {unreadChats > 0 && <i className="nav-badge" role="status" aria-label={`${unreadChats} unread messages`}>{unreadChats > 9 ? "9+" : unreadChats}</i>}
            </span>
            <span>Phone</span>
          </button>
        </nav>
      )}
      {(!st || hideBars) && <SoundToggle />}
      <Phone
        open={phone && !!st}
        st={st}
        firstApp={firstApp}
        initialApp={phoneApp}
        loggingOut={loggingOut}
        onLogout={logout}
        onClose={() => {
          setPhone(false);
          opener.current?.focus();
        }}
        onShop={() => {
          setPhone(false);
          goBuy();
        }}
      />
    </>
  );
}