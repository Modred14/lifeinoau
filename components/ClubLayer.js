// components/ClubLayer.js
// Everything on screen that belongs to a nightclub while you are inside it (mounted by BuildingInside only for 0203, Royal Divas and Quantum):
//   - the OPEN / CLOSED chip with the hours, the VIP badge and the buyout countdown;
//   - the VIP button that opens the club menu (ClubPanel.js), and the DJ screen (ClubMusicPlayer.js): music plays while the club is open and you are inside;
//   - the DJ booth and bottle-service rings in the room ("oau:club-ui", sent by BuildingInside for lib/hubActions.js) open the DJ screen and the menu too;
//   - asking the server every few seconds what is happening on the floor, and handing each server-confirmed show to the 3D scene (the same for you and for everyone
//     else in the room: an effect appears only because a purchase really went through), with the announcement banner and the sound;
//   - a club that is shut (you are stepped back outside before it draws), one that is about to close, and one that has just closed (nobody is moved).
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import ClubPanel from "./ClubPanel";
import ClubMusicPlayer from "./ClubMusicPlayer";
import { call } from "@/lib/client";
import { serverTime } from "@/lib/serverClock";
import { toast } from "@/lib/toast";
import { playSound } from "@/lib/sound";
import { closedMessage, clubOf, drinkById } from "@/lib/clubs.js";
import { gameZoneLabel } from "@/lib/campus-clock.js";
import { danceAnimFor, danceById, DANCE_RENEW_SEC } from "@/lib/danceStyles.js";
import "./club.css";

const POLL_MS = 2500, BANNER_MS = 6500;
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
function useTick(ms, on = true) { const [, set] = useState(0); useEffect(() => { if (!on) return; const t = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(t); }, [ms, on]); }

export default function ClubLayer({ place, api, ready, selfName = "", people = [], onLeave }) {
  const club = clubOf(place.id);
  const [st, setSt] = useState(null), [menu, setMenu] = useState(false), [banners, setBanners] = useState([]);
  const since = useRef(0), played = useRef(new Set()), prev = useRef({ open: null, warned: false, first: true }), busy = useRef(false), leave = useRef(onLeave); leave.current = onLeave;
  useTick(1000, !!(st?.buyout || st?.vip || st?.closing));

  // ---- dancing: the scene plays the clip at once; the server is told (and the lease renewed) so everyone else in the club sees it too
  const [dance, setDanceId] = useState(null), danceRef = useRef(null);
  const where = useCallback(() => { const p = api.current?.state; return p ? { x: p.x, z: p.z, floor: p.floor } : {}; }, [api]);
  const sendDance = useCallback((style) => call("/api/activity", { op: "dance", style, ...(style ? where() : {}) }), [where]);
  const endDance = useCallback((tell = true) => { // stop here, and (unless the server already knows) tell it
    api.current?.setDance?.(null); if (danceRef.current == null) return; danceRef.current = null; setDanceId(null); if (tell) sendDance(null);
  }, [api, sendDance]);
  const startDance = useCallback(async (id) => {
    const a = api.current, anim = danceAnimFor(id); if (!a?.setDance || !anim) return;
    if (!a.setDance(anim)) { toast.info("Stand still on the floor to dance."); return; } // walking or busy with an activity: no dance
    danceRef.current = id; setDanceId(id); setMenu(false);
    const r = await sendDance(id);
    if (r.failed && danceRef.current === id) { endDance(false); toast.error(r.error ?? "You cannot dance right now."); }
  }, [api, sendDance, endDance]);
  useEffect(() => { // keep the lease alive while dancing
    if (!dance) return; const t = setInterval(async () => { const id = danceRef.current; if (!id) return; const r = await sendDance(id); if (r.failed && danceRef.current === id) endDance(false); }, DANCE_RENEW_SEC * 1000);
    return () => clearInterval(t);
  }, [dance, sendDance, endDance]);
  useEffect(() => { // the scene says the dance ended (you walked away, or started an activity)
    const h = () => endDance(true); window.addEventListener("oau:dance-end", h); return () => window.removeEventListener("oau:dance-end", h);
  }, [endDance]);
  useEffect(() => { // the scene started a dance with a partner on the floor: your side goes to the server like any dance, so everyone in the club sees you dancing
    const h = async (e) => {
      const id = e.detail?.style ?? "bounce"; danceRef.current = id; setDanceId(id); setMenu(false); toast.info(`Dancing with ${e.detail?.name ?? "her"}. Walk away to stop.`);
      const r = await sendDance(id); if (r.failed && danceRef.current === id) { endDance(false); toast.error(r.error ?? "You cannot dance right now."); }
    };
    window.addEventListener("oau:partner-dance", h); return () => window.removeEventListener("oau:partner-dance", h);
  }, [sendDance, endDance]);
  useEffect(() => () => { if (danceRef.current) { danceRef.current = null; call("/api/activity", { op: "dance", style: null }); } }, []); // leaving the club ends it for everyone else too

  const apply = useCallback((r) => {
    if (r.club == null) return;
    const was = prev.current;
    if (was.first) { was.first = false; if (!r.canEnter) { toast.error(closedMessage(club), { duration: 8000 }); leave.current?.(); return; } } // shut and you were not already in: step back out
    if (was.open === true && !r.status.open) { toast.info(`${club.name} has closed. Purchases are off, but nobody is moved: finish your night and head out when you like.`, { duration: 9000 }); setMenu(false); }
    if (r.status.open && r.closing && !was.warned) { was.warned = true; toast.info(`${club.name} closes soon (${r.status.note.toLowerCase()}). Buy now; you will not be moved when it shuts.`, { duration: 8000 }); }
    if (!r.status.open) was.warned = false;
    was.open = r.status.open; setSt(r);
    const a = api.current; if (!a) return;
    a.setClubTables(r.tables); a.setClubMood(r.mood); // the table and the lights as the server says they are now (reconnecting lands on the right state)
    for (const s of r.shows) {
      since.current = Math.max(since.current, Number(s.id)); if (played.current.has(s.id)) continue; played.current.add(s.id);
      a.playClubShow(s);
      const parts = s.data?.parts ?? [];
      if (parts.includes("banner")) { setBanners((b) => [...b.slice(-3), { id: s.id, text: s.title, level: s.level }]); setTimeout(() => setBanners((b) => b.filter((x) => x.id !== s.id)), BANNER_MS + s.level * 700); }
      playSound(parts.includes("spray") ? "coin" : s.level >= 4 ? "success" : "pop");
      if (s.to && s.to.toLowerCase() === selfName.toLowerCase()) toast.success(`${s.actor} bought you ${drinkById(s.data?.drink)?.name ?? "a drink"}. Cheers!`, { duration: 7000 }); // the friend is told, by name
    }
    if (played.current.size > 200) played.current = new Set([...played.current].slice(-100));
  }, [api, club, selfName]);

  const load = useCallback(async () => {
    if (busy.current) return; busy.current = true;
    try { const r = await call(`/api/club?at=${encodeURIComponent(place.id)}&since=${since.current}`); if (!r.failed) apply(r); } finally { busy.current = false; }
  }, [place.id, apply]);

  useEffect(() => { // the first look happens as soon as the room is drawn (so the lights and tables are right when you walk in), then every few seconds while the tab is showing
    if (!ready) return; load(); const t = setInterval(() => !document.hidden && load(), POLL_MS), v = () => !document.hidden && load();
    document.addEventListener("visibilitychange", v); return () => { clearInterval(t); document.removeEventListener("visibilitychange", v); };
  }, [ready, load]);

  const isOpen = !!st?.status?.open;
  useEffect(() => { // the yellow DJ-booth and bottle-service rings in the room
    const h = (e) => { if (e.detail?.panel === "menu") (isOpen ? setMenu(true) : toast.error(closedMessage(club))); };
    window.addEventListener("oau:club-ui", h); return () => window.removeEventListener("oau:club-ui", h);
  }, [isOpen, club]);
  if (!club) return null;
  const now = serverTime(), open = st?.status?.open, buyout = st?.buyout, vipLeft = st?.vip ? st.vip.until - now : 0, guests = st?.vips ?? [];
  return (
    <>
      <div className="cl-chip" data-open={open ? "1" : st ? "0" : undefined} role="status" style={{ "--neon": club.neon }}>
        <b>{st ? (open ? "OPEN" : "CLOSED") : "…"}</b><span>{st ? `${st.status.hours} ${gameZoneLabel()} · ${st.status.note}` : "Checking the doors"}</span>
        {vipLeft > 0 && <em><Icon name="sparkle" size={12} weight="fill" /> VIP {mmss(vipLeft)}</em>}
        {buyout && <em><Icon name="timer" size={12} /> {buyout.host}: {buyout.name} {mmss(buyout.endsAt - now)}</em>}
        {guests.length > 0 && <small title="Gold VIP badge in the guest list">VIP here: {guests.slice(0, 3).map((v) => v.name).join(", ")}{guests.length > 3 ? ` +${guests.length - 3}` : ""}</small>}
      </div>
      <button type="button" className="cl-open" onClick={() => (open ? setMenu(true) : toast.error(closedMessage(club)))} data-sound="none" aria-label="Open the club menu: activities, music and spending"><Icon name="sparkle" size={18} weight="fill" /> Club</button>
      <ClubMusicPlayer club={club} live={isOpen} />
      {dance && <button type="button" className="cl-open cl-stopdance" onClick={() => endDance(true)} data-sound="none" aria-label="Stop dancing"><Icon name="music" size={18} /> Stop: {danceById(dance)?.label}</button>}
      <div className="cl-banners" aria-live="polite">{banners.map((b) => <div key={b.id} className="cl-banner" data-lv={b.level}>{b.text}</div>)}</div>
      {menu && st && <ClubPanel club={{ ...club, ...(st.club ?? {}) }} state={st} people={people} selfName={selfName} getPos={() => { const p = api.current?.state; return p ? { x: p.x, z: p.z, floor: p.floor } : null; }} dance={dance} onDance={startDance} onStopDance={() => endDance(true)} onClose={() => setMenu(false)} onBought={() => load()} />}
    </>
  );
}