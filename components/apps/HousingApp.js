// components/apps/HousingApp.js: lives inside the phone (see components/Phone.js)
// Rent a new home (a private one-bedroom, a 1-bedroom flat, the 2-bedroom flat) or go back to a school hostel. Paying and moving in
// happen together and show at once: the wallet, the home in the top bar and the room on the home screen all change.
"use client";
import { useState } from "react";
import { call, naira } from "@/lib/client";
import { Icon } from "../Icon";
import { toast } from "@/lib/toast";
import { confirmAction } from "@/lib/confirm";
import { game, roomStore, run, cash, canAfford, useResource } from "@/lib/gameStore";
import { fmtN } from "@/lib/classes.js";
import { LAYOUTS, wallRuns } from "@/lib/layouts.js";
import LoadError from "@/components/LoadError";
import Loader from "@/components/Loader";
import "./housing-app.css";

const FLOOR = { bed: "#f1e7d3", kitchen: "#c9cdd0", bath: "#c8d3df", passage: "#efe9db", living: "#e8dcc4", dining: "#efe3cb", store: "#e3e0da" };

/** The floor plan of a home, drawn small: rooms in colour, walls in black, gaps where the doors are. */
function Plan({ home }) {
  const L = home.layout && LAYOUTS[home.layout];
  if (!L)
    return ( // a school hostel is one big room with bunks along the walls
      <svg viewBox="0 0 9 7" className="hs-plan" role="img" aria-label="Plan: one big shared room">
        <rect x="0.1" y="0.1" width="8.8" height="6.8" fill="#d9d6cb" stroke="#1a1d24" strokeWidth="0.2" />
        {[0.6, 2.6, 4.6, 6.6].map((x) => <g key={x}><rect x={x} y="0.5" width="1.2" height="2" fill="#8d96a0" /><rect x={x} y="4.5" width="1.2" height="2" fill="#8d96a0" /></g>)}
      </svg>
    );
  const { walls } = wallRuns(L);
  return (
    <svg viewBox={`-0.1 -0.1 ${L.w + 0.2} ${L.d + 0.2}`} className="hs-plan" role="img" aria-label={`Plan: ${L.zones.map((z) => z.name).join(", ")}`}>
      {L.grid.map((row, z) => row.map((zn, x) => <rect key={x + "," + z} x={x} y={z} width="1.02" height="1.02" fill={FLOOR[zn.kind] ?? "#eee"} />))}
      {walls.map((w, i) => <line key={i} x1={w.x1} y1={w.z1} x2={w.x2} y2={w.z2} stroke="#1a1d24" strokeWidth="0.16" strokeLinecap="square" />)}
      <rect x="0" y="0" width={L.w} height={L.d} fill="none" stroke="#1a1d24" strokeWidth="0.26" />
      <rect x={L.entry.at - 0.5} y={L.d - 0.16} width="1" height="0.32" fill="#f7f4ec" />
    </svg>
  );
}

const roomsText = (h) => (h.kind === "school" ? "One shared room" : h.bedrooms === 1 ? "1 bedroom" : `${h.bedrooms} bedrooms`);

export default function HousingApp({ onClose }) {
  const { d, store, load, loadFailed, router } = useResource("/api/housing");
  const [tab, setTab] = useState("homes"),
    [moving, setMoving] = useState(null),
    [arrived, setArrived] = useState(null);
  if (!d) return loadFailed ? <LoadError onRetry={load} /> : <Loader label="Finding homes" />;

  const homes = d.homes.filter((h) => (tab === "homes" ? h.kind !== "school" : h.kind === "school")),
    priciest = Math.max(...d.homes.map((h) => h.sessionRent)),
    cheapest = Math.min(...d.homes.map((h) => h.sessionRent)),
    now = d.homes.find((h) => h.current);

  async function move(h) {
    const net = BigInt(h.netKobo), weeks = h.weeksLeft;
    if (net > 0n && !canAfford(net)) return toast.error("You cannot afford the rent for that home.");
    const pay = net > 0n ? `You pay ${naira(net.toString())} now: the rent for the last ${weeks} week${weeks === 1 ? "" : "s"} of this session.` : net < 0n ? `You get ${naira((-net).toString())} back, and pay nothing more this session.` : "Nothing to pay this session.",
      back = BigInt(h.refundKobo) > 0n && net > 0n ? ` Rent you already paid up front for ${d.hostel} (${naira(h.refundKobo)}) is taken off.` : "";
    if (!(await confirmAction({
      title: `Move into ${h.hostel}?`,
      message: `${pay}${back} You move in straight away. Your own furniture comes with you, and what the old home came with stays behind. Next session the rent goes back to weekly instalments.`,
      confirmLabel: net > 0n ? `Pay ${naira(net.toString())} and move in` : "Move in",
    }))) return;
    setMoving(h.hostel);
    const res = await run({
      key: "housing:move",
      router,
      ok: `You moved into ${h.hostel}.`,
      sound: "coin",
      request: () => call("/api/housing", { hostel: h.hostel, requestId: crypto.randomUUID() }),
      effects: [
        { store, patch: (x) => ({ ...x, hostel: h.hostel, blocked: x.blocked, homes: x.homes.map((y) => ({ ...y, current: y.hostel === h.hostel })) }) },
        { store: game, patch: (s) => ({ ...cash(-net)(s), character: { ...s.character, hostel: h.hostel } }) },
        { store: roomStore, patch: (v) => v, settle: (r) => ({ room: r.room, items: r.items, score: r.score, balanceKobo: r.balanceKobo }) }, // the answer is the whole new room
      ],
    });
    setMoving(null);
    if (!res.failed) setArrived(h.hostel);
  }

  return (
    <div className="hs">
      <div className="hs-now">
        <span className="hs-now-ico"><Icon name="home" size={22} weight="fill" /></span>
        <div>
          <small>You live in</small>
          <b>{d.hostel}</b>
        </div>
      </div>
      {arrived && (
        <div className="hs-done" role="status">
          <b>Welcome to {arrived}.</b>
          <span>Your room is ready on the home screen.</span>
          <button type="button" className="go" onClick={onClose}>See my room</button>
        </div>
      )}
      {d.blocked ? <p className="hs-note">{d.blocked}</p> : (
        <p className="hs-note">
          Moving takes effect at once. You pay the rent for the rest of this session up front ({now?.weeksLeft ?? 0} week{now?.weeksLeft === 1 ? "" : "s"} left), then rent goes back to weekly instalments.
        </p>
      )}
      <div className="hs-tabs" role="tablist" aria-label="Kind of home">
        {[["homes", "Rent a home"], ["school", "School hostels"]].map(([k, name]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{name}</button>
        ))}
      </div>
      {homes.map((h) => {
        const net = BigInt(h.netKobo), poor = net > 0n && !canAfford(net);
        return (
          <article className="hs-card" key={h.hostel} data-current={h.current ? "1" : undefined}>
            <Plan home={h} />
            <div className="hs-info">
              <div className="hs-top">
                <b>{h.hostel}</b>
                {h.sessionRent === priciest && <em className="hs-tag hs-gold">Most expensive</em>}
                {h.sessionRent === cheapest && <em className="hs-tag">Cheapest</em>}
              </div>
              <span className="hs-meta">{roomsText(h)} · {h.occupancy}</span>
              <span className="hs-about">{h.about}</span>
              <span className="hs-rent"><b className="num">{fmtN(h.sessionRent)}</b> a session <span>· {fmtN(h.weeklyRent)} a week</span></span>
            </div>
            {h.current ? (
              <span className="hs-here"><Icon name="check" size={16} weight="bold" /> You live here</span>
            ) : (
              <button type="button" className="go hs-go" disabled={!!moving || !!d.blocked || poor} onClick={() => move(h)}>
                {moving === h.hostel ? "Moving in…" : poor ? `Need ${naira(net.toString())}` : net > 0n ? `Pay ${naira(net.toString())} and move in` : net < 0n ? `Move in and get ${naira((-net).toString())} back` : "Move in"}
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}
