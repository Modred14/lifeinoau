// components/Shell.js
"use client";
import Logo from "./Logo";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { call, naira, notifyError } from "@/lib/client";
import { setPlayMode, usePlayMode } from "@/lib/ui";
import { Icon } from "./Icon";
import Phone from "./Phone";
import { toast } from "@/lib/toast";

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
    [loggingOut, setLoggingOut] = useState(false),
    [st, setSt] = useState(null),
    [phone, setPhone] = useState(false),
    [clock, setClock] = useState(null),
    opener = useRef(null),
    firstApp = useRef(null),
    failing = useRef(false);
  const bare = path === "/",
    full = path === "/map" || path === "/play";
  const load = useCallback(async () => {
    const r = await call("/api/state");
    // 401/404 are normal (logged out / no character yet). Anything else: say so once per outage, not every poll.
    if (r.failed && r.status !== 401 && r.status !== 404) {
      if (!failing.current) {
        failing.current = true;
        notifyError(r, "We couldn't refresh your game. Check your connection.");
      }
    } else failing.current = false;
    setSt(r.failed || !r.character?.hostel ? null : r);
  }, []);
  useEffect(() => {
    if (bare) return;
    load();
    const t = setInterval(load, 60000);
    const f = () => load();
    window.addEventListener("game:refresh", f);
    return () => {
      clearInterval(t);
      window.removeEventListener("game:refresh", f);
    };
  }, [bare, path, load]);
  useEffect(() => {
    setClock(new Date());
    const t = setInterval(() => setClock(new Date()), 20000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!phone) return;
    firstApp.current?.focus();
    const k = (e) => {
      if (e.key === "Escape") {
        setPhone(false);
        opener.current?.focus();
      }
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [phone]);
  useEffect(() => {
    setPhone(false);
  }, [path]);
  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    const r = await call("/api/logout", {});
    setLoggingOut(false);
    if (r.failed)
      return notifyError(r, "We couldn't log you out. Please try again.");
    setPhone(false);
    setSt(null);
    toast.info("You're logged out. See you soon.", { id: "session" });
    router.push("/");
  }
  if (bare) return children;
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
      {full ? (
        children
      ) : (
        <main className={"page" + (creating ? " wide" : "")}>{children}</main>
      )}
      {st && (
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
            data-active={phone ? "1" : undefined}
            aria-expanded={phone}
            aria-haspopup="dialog"
            onClick={() => setPhone(true)}
          >
            <Icon name="phone" weight={phone ? "fill" : "regular"} />
            <span>Phone</span>
          </button>
        </nav>
      )}
      <Phone
        open={phone && !!st}
        st={st}
        firstApp={firstApp}
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