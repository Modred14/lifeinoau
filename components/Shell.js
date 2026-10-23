// components/Shell.js
"use client";
import { GAME_TIME_ZONE } from "@/lib/campus-clock.js"; // the clubs open by game time (West Africa Time), so the clock shows that time too
import Logo from "./Logo";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { call, naira, notifyError } from "@/lib/client";
import { setPlayMode, usePlayMode, useBare, resetBoot } from "@/lib/ui";
import { Icon } from "./Icon";
import Phone from "./Phone";
import PlayerMenu from "./PlayerMenu";
import BottomNav from "./BottomNav";
import { useChat } from "@/lib/chat";
import SoundToggle from "./SoundToggle";
import { toast } from "@/lib/toast";
import { game, useGame } from "@/lib/gameStore";
import { serverDate, serverTime } from "@/lib/serverClock";
import { initPrefs, syncPrefsFrom } from "@/lib/prefs";
import "./prefs.css";


const moodOf = (h) =>
  h >= 80
    ? ["Very happy", "happy"]
    : h >= 60
      ? ["Happy", "happy"]
      : h >= 40
        ? ["Okay", "meh"]
        : ["Low", "sad"];
const stamp = (d) =>
  `${d.toLocaleDateString("en-NG", { weekday: "short" })} ${d.getDate()} · ${d.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: GAME_TIME_ZONE }).replace(/\s?(am|pm)/i, (m) => " " + m.trim().toUpperCase())}`;

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
    [phoneWith, setPhoneWith] = useState(null), // a player to open a chat with (set when you tap "Message" on a name tag)
    [clock, setClock] = useState(null),
    opener = useRef(null),
    firstApp = useRef(null),
    failing = useRef(false);

  // The landing page has no bars at all.
  const bare = path === "/";
  // Screens that fill the window instead of sitting inside the padded page wrapper.
  const full = path === "/map" || path === "/home";
  // On /home the bars are hidden only while the game loads or the player is creating a character.
  const hideBars = path === "/home" && bareUi;

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
  // Preferences: show the last saved ones at once, then follow the server's copy (it comes with the game state), so a change made on another device arrives here too.
  useEffect(() => { initPrefs(); }, []);
  useEffect(() => { syncPrefsFrom(g?.character); }, [g?.character?.settings]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const open = () => { setPhoneApp("settings"); setPhoneWith(null); setPhone(true); }; // anything that asks for Settings (event "oau:settings") opens the phone on the Settings app
    window.addEventListener("oau:settings", open);
    return () => window.removeEventListener("oau:settings", open);
  }, []);
  useEffect(() => {
    setClock(serverDate());
    const t = setInterval(() => setClock(serverDate()), 20000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (phone) firstApp.current?.focus();
  }, [phone]);
  useEffect(() => {
    // old links (/career, /people ...) arrive as /home?app=x (or /play?app=x, which redirects here):
    // open the phone on that app, then tidy the address bar
    const app = new URLSearchParams(window.location.search).get("app");
    if (path === "/home" && app) {
      setPhoneApp(app);
      setPhone(true);
      window.history.replaceState(null, "", "/home");
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
  useEffect(() => {
    const open = () => {
      void game.refresh();
      setPhoneApp(null);
      setPhoneWith(null);
      setPhone(true);
    };
    // "Message" on a player's name tag: open the phone's Messages app on a chat with exactly that player
    const message = (e) => {
      const name = typeof e.detail?.name === "string" ? e.detail.name.trim() : "";
      if (!name) return;
      setPhoneApp("messages");
      setPhoneWith(name);
      setPhone(true);
    };
    window.addEventListener("oau:phone", open);
    window.addEventListener("oau:message", message);
    return () => {
      window.removeEventListener("oau:phone", open);
      window.removeEventListener("oau:message", message);
    };
  }, []);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("oau:phone-state", { detail: phone }));
    if (!phone) setPhoneWith(null); // the next time the phone opens normally it is not tied to the last name tag
  }, [phone]);
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
  const creating = path === "/home" && !st,
    onPlay = path === "/home" && !!st,
    buying = onPlay && mode === "buy",
    mood = st ? moodOf(st.character.happiness) : null,
    held = !!st?.floorZero && +new Date(st.floorZero.releaseAt) > serverTime(); // serving a sentence in Floor O (N-QRS Custody): no shop; the phone still works (the apps follow their own rules)
  // The bar stays on screen above every panel, so each tab first puts away whatever panel is open over the game (the phone, with Settings inside it).
  const closePanels = () => {
    setPhone(false);
  };
  const goHome = () => {
    closePanels();
    setPlayMode("home");
    if (path !== "/home") router.push("/home");
  };
  const goBuy = () => {
    closePanels();
    setPlayMode("buy");
    if (path !== "/home") router.push("/home");
  };
  const goMap = () => {
    closePanels();
    setPlayMode("home");
    window.dispatchEvent(new Event("oau:nav-map")); // already on the map and standing inside a building? this steps you back out to it
  };
  const togglePhone = () => {
    if (phone) return setPhone(false);
    setPhoneApp(null);
    setPhone(true);
  };
  return (
    <>
      {!hideBars && (
        <header className="hud">
          <Link
            href={st ? "/home" : "/"}
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
        <BottomNav
          path={path}
          onPlay={onPlay}
          buying={buying}
          held={held}
          phoneOpen={phone}
          unread={unreadChats}
          opener={opener}
          onHome={goHome}
          onBuy={goBuy}
          onMap={goMap}
          onPhone={togglePhone}
        />
      )}
      {(!st || hideBars) && <SoundToggle />}
      <Phone
        open={phone && !!st}
        st={st}
        held={held}
        firstApp={firstApp}
        initialApp={phoneApp}
        initialWith={phoneWith}
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
      {st && <PlayerMenu />}
    </>
  );
}