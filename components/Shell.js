// components/Shell.js
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { call, naira, notifyError } from "@/lib/client";
import { Icon } from "./Icon";

const APPS = [["Courses", "courses", "/courses", ""], ["Messages", "chat", "/people", ""], ["Map", "map", "/map", "sky"], ["Jobs", "jobs", "/career", "gold"], ["Invest", "invest", "/invest", "gold"],
  ["Love", "love", "/relationship", "rose"], ["Parties", "party", "/parties", "rose"], ["Forbes", "forbes", "/leaderboards", "gold"], ["Awards", "medal", "/achievements", ""]];

/** Status pill on top, four-item bottom navigation, and the phone. Hidden on the landing page and until you have a character. */
export default function Shell({ children }) {
  const path = usePathname(), [st, setSt] = useState(null), [phone, setPhone] = useState(false), opener = useRef(null), firstApp = useRef(null), failing = useRef(false);
  const bare = path === "/", full = path === "/map";
  const load = useCallback(async () => {
    const r = await call("/api/state");
    // 401/404 are normal (logged out / no character yet). Anything else: say so once per outage, not every poll.
    if (r.failed && r.status !== 401 && r.status !== 404) { if (!failing.current) { failing.current = true; notifyError(r, "We couldn't refresh your game. Check your connection."); } } else failing.current = false;
    setSt(r.failed || !r.character?.hostel ? null : r);
  }, []);
  useEffect(() => { if (bare) return; load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [bare, path, load]);
  useEffect(() => { if (!phone) return; firstApp.current?.focus(); const k = (e) => { if (e.key === "Escape") { setPhone(false); opener.current?.focus(); } }; document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [phone]);
  useEffect(() => { setPhone(false); }, [path]);
  if (bare) return children;
  const creating = path === "/play" && !st;
  return (<>
    <header className="hud">
      <Link href={st ? "/play" : "/"} className="brand" aria-label="lifeinoau home">life<i>in</i>oau</Link>
      {st && <><span className="sep" aria-hidden="true" /><span className="meta num">Week {st.week} · {st.character.level}L</span></>}
      <span className="grow" />
      {st && <span className="cash num" aria-label="Cash">{naira(st.balanceKobo)}</span>}
    </header>
    {full ? children : <main className={"page" + (creating ? " wide" : "")}>{children}</main>}
    {st && (<nav className="nav" aria-label="Main">
      <Link href="/play" aria-current={path === "/play" ? "page" : undefined}><Icon name="home" /><span>Home</span></Link>
      <Link href="/map" aria-current={path === "/map" ? "page" : undefined}><Icon name="map" /><span>Map</span></Link>
      <Link href="/people" aria-current={path === "/people" ? "page" : undefined}><Icon name="chat" /><span>People</span></Link>
      <button type="button" ref={opener} aria-expanded={phone} aria-haspopup="dialog" onClick={() => setPhone(true)}><Icon name="phone" /><span>Phone</span></button>
    </nav>)}
    {phone && (<div className="sheet-scrim" onClick={() => { setPhone(false); opener.current?.focus(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Phone" onClick={(e) => e.stopPropagation()}>
        <div className="top"><h2>Phone</h2><button type="button" className="ghost" aria-label="Close phone" onClick={() => { setPhone(false); opener.current?.focus(); }}><Icon name="close" /></button></div>
        <p className="mut num">Game week {st?.week}</p>
        <div className="apps">{APPS.map(([name, icon, href, tone], i) => (<Link key={href} href={href} ref={i === 0 ? firstApp : undefined}><span className={"tile " + tone}><Icon name={icon} size={26} /></span>{name}</Link>))}</div>
      </div></div>)}
  </>);
}