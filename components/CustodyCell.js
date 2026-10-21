// components/CustodyCell.js
// What a player in custody sees: not a full-screen card but the real holding cell at Floor O, in 3D, with the bars in front of them and the other prisoners
// they share the cells with. A small banner (not full screen) shows the time left and the bail. The phone stays available (all its apps, except the ones that
// need the road). Custody blocks LEAVING, nothing else: the server keeps the prisoner inside their cell (lib/custodyCells.js) whatever this screen does.
"use client";
import { useEffect, useState } from "react";
import { game } from "@/lib/gameStore";
import { toast } from "@/lib/toast";
import { serverTime } from "@/lib/serverClock";
import { Icon } from "@/components/Icon";
import BuildingInside from "@/components/BuildingInside";
import { countdown } from "@/components/DisciplineScreens";
import { call } from "@/lib/client";
import { naira } from "@/lib/client";
import { bailFor } from "@/lib/engine";
import { CUSTODY_PLACE, CUSTODY_NAME, isExpelled } from "@/lib/discipline";
import "./custody.css";

const PLACE = { id: CUSTODY_PLACE, name: CUSTODY_NAME, kind: "jail", blurb: "You are held here until your sentence ends or the bail is paid." };
const openPhone = () => window.dispatchEvent(new Event("oau:phone"));

/**
 * st: the game state ({ floorZero?, character }). `now` and `bail` are optional: the home screen passes its own clock and bail function; anywhere else (the map)
 * this ticks on the server clock by itself and pays the bail through /api/floor0/pay, then calls onFree.
 */
export default function CustodyCell({ st, now: nowIn = null, busy: busyIn = false, bail: bailIn = null, look = null, gender = "M", selfName = "", onFree = null }) {
  const [tick, setTick] = useState(0), [paying, setPaying] = useState(false);
  useEffect(() => { if (nowIn != null) return; const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, [nowIn]);
  void tick;
  const now = nowIn ?? serverTime(), c = st.character ?? {}, fz = st.floorZero ?? { releaseAt: c.jailedUntil }, expelled = isExpelled(c, now), busy = busyIn || paying;
  async function pay() {
    if (bailIn) return bailIn();
    if (paying) return; setPaying(true);
    const r = await call("/api/floor0/pay", {}); setPaying(false);
    if (r.failed) return toast.error(r.error || "Could not pay the bail. Try again.");
    toast.success(r.served ? "Your sentence is over. You are free." : "Bail paid. You are free.", { sound: "coin" });
    await game.refresh(); onFree?.();
  }
  const [cell, setCell] = useState(null), [failed, setFailed] = useState(false);
  // the server decides which cell this prisoner is held in (the same one every time)
  useEffect(() => {
    let on = true;
    (async () => { const r = await call("/api/travel"); if (!on) return; if (r.failed || !r.custody?.cell) setFailed(true); else setCell(r.custody.cell); })();
    return () => { on = false; };
  }, []);
  if (failed) return <p className="mut" role="status">Could not reach the cells. Check your connection.</p>;
  if (!cell) return <div className="cc-load" role="status"><Icon name="siren" size={30} /><b>Taking you to your cell…</b></div>;
  const left = Math.max(0, +new Date(fz.releaseAt) - now);
  const banner = (
    <div className="cc-bar" role="status" aria-live="polite">
      <span className="cc-ico"><Icon name="siren" size={20} /></span>
      <div className="cc-txt"><b>{CUSTODY_NAME} · {cell.name}</b><span>Time left <em className="num">{countdown(left)}</em> · Bail <em className="num">{naira(bailFor(fz.releaseAt, now))}</em></span>
        {expelled && <span>Expelled: you cannot pay bail.</span>}</div>
      <button type="button" className="cc-btn" onClick={openPhone}><Icon name="chat" size={16} /> Phone</button>
      <button type="button" className="cc-btn go" disabled={busy || expelled} onClick={pay}>Pay bail</button>
    </div>
  );
  return <BuildingInside place={PLACE} look={look} gender={gender} selfName={selfName} cell={cell} banner={banner} onLeave={() => onFree?.()} />;
}