// src/app/map/page.js
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ICON_OF, KIND_LABEL, MAP_GROUPS } from "@/lib3d/landmarks.js";
import { loadCampusData, listPlaces, buildingPlace } from "@/lib3d/campusData.js";
import { Icon } from "@/components/Icon";
import BillboardPanel from "@/components/BillboardPanel";
import TravelSheet from "@/components/TravelSheet";
import TripHud from "@/components/TripHud";
import PlaceActivities from "@/components/PlaceActivities";
import { featuresAt } from "@/lib/features.js";
import BuildingInside from "@/components/BuildingInside";
import CustodyCell from "@/components/CustodyCell";
import { createTargetTracker } from "@/lib/tripTarget.js";
import { hasInterior } from "@/lib3d/interiors/registry.js";
import { isOpenSpace } from "@/lib3d/interiors/openSpaces.js";
import { call, naira } from "@/lib/client";
import { toast } from "@/lib/toast";
import { game, useGame, run, cash } from "@/lib/gameStore";
import { fareKobo, placeOf, ownsCar, driverActive, MODE_INFO } from "@/lib/travel.js";
import { playSound } from "@/lib/sound";
import { serverTime } from "@/lib/serverClock";
import { isClub, clubOf, clubStatus, closedMessage, HOURS_LABEL } from "@/lib/clubs.js";
import { CUSTODY_NAME } from "@/lib/discipline";

const CampusMap = dynamic(() => import("@/components/CampusMap"), {
  ssr: false,
});

export default function MapPage() {
  const [sel, setSel] = useState(null),
    [list, setList] = useState(false),
    [places, setPlaces] = useState([]),
    [q, setQ] = useState("");
  const [bb, setBb] = useState(null);
  const [data, setData] = useState(null), [sheet, setSheet] = useState(false), [trip, setTrip] = useState(null), [tripSt, setTripSt] = useState(null), [inside, setInside] = useState(null), [fade, setFade] = useState(false), [counts, setCounts] = useState({}), [focus, setFocus] = useState(null), [want, setWant] = useState(null);
  const g = useGame(), ch = g?.character, here = ch ? placeOf(ch) : null, miniRef = useRef(null), previewRef = useRef(null), input = useRef({}).current, tripRef = useRef(null), targetRef = useRef(null);
  tripRef.current = trip;
  // Serving a sentence: held at Floor O (N-QRS Custody) and not allowed to travel. The server refuses every trip too; this only stops offering it.
  const held = !!g?.floorZero && +new Date(g.floorZero.releaseAt) > serverTime();
  const refreshBb = () =>
    call("/api/billboards").then((r) => {
      if (!r.failed) setBb(r);
    });
  useEffect(() => {
    refreshBb();
    const t = setInterval(refreshBb, 60000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let on = true;
    loadCampusData()
      .then((d) => { if (on) { setPlaces(listPlaces(d)); setData(d); } })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, []);
  // The OAU Guide sends the player here with ?to=<place>&do=<activity> (or, when the map is already open, an "oau:goto" event):
  // open that place's panel and highlight the activity.
  useEffect(() => {
    const apply = (to, act) => { if (!to) return; setSel(to); setWant(act || null); };
    const q = new URLSearchParams(window.location.search);
    if (q.get("to")) { apply(q.get("to"), q.get("do")); window.history.replaceState(null, "", "/map"); }
    const h = (e) => apply(e.detail?.to, e.detail?.act);
    window.addEventListener("oau:goto", h);
    return () => window.removeEventListener("oau:goto", h);
  }, []);
  useEffect(() => {
    if (!list) return;
    const k = (e) => e.key === "Escape" && setList(false);
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [list]);
  // where everybody is: a ping every minute so others see you, and the little "N here" numbers
  useEffect(() => {
    if (!ch) return; let on = true;
    const ping = () => !document.hidden && call("/api/travel", { action: "ping" });
    const cnt = async () => { const r = await call("/api/travel?counts=1"); if (on && !r.failed) setCounts(r.counts ?? {}); };
    ping(); cnt(); const a = setInterval(ping, 60000), b = setInterval(() => !document.hidden && cnt(), 20000);
    return () => { on = false; clearInterval(a); clearInterval(b); };
  }, [!!ch]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (trip) document.body.dataset.trip = "1"; else delete document.body.dataset.trip; return () => { delete document.body.dataset.trip; }; }, [!!trip]);
  const find = useCallback((id) => places.find((l) => l.id === id) ?? (data && buildingPlace(data, id)) ?? null, [places, data]);
  const L = find(sel), youPlace = here ? find(here) : null,
    shown = useMemo(
      () =>
        places.filter((p) =>
          p.name.toLowerCase().includes(q.trim().toLowerCase()),
        ),
      [places, q],
    );
  // Tapping a normal building goes straight to the "How do you want to go?" sheet, which carries the building's description.
  // Billboards (they have their own panel) and the place you are standing in still use the small info card.
  const direct = !!(L && !trip && ch && !held && L.located && L.id !== here && L.kind !== "billboard");
  const closeSheet = () => { setSheet(false); if (direct) setSel(null); };
  // ---- how long each way of going would take ----
  // Worked out on this device from the road map (no network call): the road distance divided by the speed of the vehicle, plus the walk to and from it.
  // They appear one by one as each is ready, and are worked out again whenever the destination, where you are, or whether a driver is hired changes.
  const driverOn = !!ch && driverActive(ch, g?.week), [eta, setEta] = useState({}), sheetOpen = (sheet || direct) && !!L, etaTo = sheetOpen ? L.id : null;
  useEffect(() => {
    setEta({}); if (!etaTo || !data) return; let live = true;
    (async () => {
      const [{ loadServices }, { planTrip }, { resolvePlace }] = await Promise.all([import("@/lib3d/worldsvc.js"), import("@/lib3d/tripplan.js"), import("@/lib3d/travel.js")]);
      const svc = await loadServices(data), from = resolvePlace(data, here) ?? resolvePlace(data, "senate"), to = resolvePlace(data, etaTo); if (!to) return;
      const jobs = [["trek", false, "trek"], ["keke", false, "keke"], ["bus", false, "bus"], ["car", false, "car"], ...(driverOn ? [["car", true, "carDriver"]] : [])];
      for (const [mode, drv, key] of jobs) {
        await new Promise((r) => setTimeout(r, 0)); // let the screen breathe between the (quick) calculations
        if (!live) return; let r; try { const t = planTrip(svc, { from, to, mode, driver: drv }); r = t.ok ? { ok: true, secs: t.secs, len: t.len, approx: t.approx } : { ok: false, reason: t.reason }; } catch { r = { ok: false, reason: "error" }; }
        setEta((e) => ({ ...e, [key]: r }));
      }
    })().catch(() => {});
    return () => { live = false; };
  }, [etaTo, here, data, driverOn]); // eslint-disable-line react-hooks/exhaustive-deps
  // ---- travelling ----
  // The trip starts the moment the player taps Go. The real players standing at the door are fetched alongside (handed over as a promise)
  // and drawn when the list arrives; if that request is slow or fails, the trip is not held up and the door is simply empty.
  function begin(mode, withDriver, act = null) {
    const dest = L; if (!dest) return; setSheet(false);
    if (held) return toast.error(`You are held in ${CUSTODY_NAME}. You cannot travel until your sentence ends.`);
    if (isClub(dest.id) && !clubStatus(serverTime()).open) return toast.error(closedMessage(clubOf(dest.id)), { duration: 7000 }); // the server refuses too: the clubs open 8 PM to 5 AM
    // who is standing at the door: always asked about the place being gone to NOW. An answer about an earlier choice (a slow one, after the player tapped another name tag) comes back null and is dropped.
    const target = (targetRef.current = createTargetTracker(dest.id));
    const fetchPeople = () => target.answer(call("/api/travel?at=" + encodeURIComponent(target.id)).then((r) => (r.failed ? [] : r.people ?? [])), null);
    const people = fetchPeople();
    setTripSt(null); input.jx = input.jy = input.steer = input.gas = input.brake = 0; input.run = false;
    setTrip({ id: crypto.randomUUID(), from: here, to: dest.id, mode, driver: withDriver, act, look: ch?.look ?? null, gender: ch?.gender ?? "M", car: ch?.activeCar || "", carColor: ch?.activeCarColor || "", people, pollPeople: fetchPeople, isEnterable: (id) => { const p = find(id); return !!p && (hasInterior(p.id, p.kind) || isOpenSpace(p.id)); }, selfName: ch?.name ?? "", name: dest.name });
    setSel(null);
  }
  /** A tapped name tag has already sent the trip there (locally, at once). This keeps the page in step: the destination, its name, the people at its door. Nothing here waits for the server. */
  function retargeted(id) {
    const t = tripRef.current, p = find(id); if (!t || !p) return;
    targetRef.current?.choose(id); const next = { ...t, to: id, name: p.name, act: null }; tripRef.current = next; setTrip(next);   // same trip id: the engine keeps going, it is not restarted
  }
  /** Why a tapped place cannot be gone to right now (the server would refuse it too), or null. */
  const tripGuard = (id) => (isClub(id) && !clubStatus(serverTime()).open ? closedMessage(clubOf(id)) : null);
  async function pay() { // the vehicle has stopped: the fare leaves the wallet now, and you are at the new place
    const t = tripRef.current; if (!t) return false; const fare = fareKobo(t.mode);
    const res = await run({ key: "trip:" + t.id + ":" + t.to, sensitive: fare > 0n, pending: "Paying the fare…", ok: fare > 0n ? `Paid ${naira(fare.toString())} · ${MODE_INFO[t.mode].name}` : undefined, sound: "coin", request: () => call("/api/travel", { to: t.to, mode: t.mode, requestId: crypto.randomUUID() }),
      effects: [{ store: game, patch: (x) => ({ ...cash(-fare)(x), character: { ...x.character, placeId: t.to } }) }] });
    return !res.failed;
  }
  function entered() { // only enclosed buildings open an interior; open-air places (billboards, grounds, statues, gates...) just end the trip with you standing there
    const t = tripRef.current, p = t ? find(t.to) : null, indoors = !!p && (hasInterior(p.id, p.kind) || isOpenSpace(p.id)); setFade(true); setTimeout(() => { if (t && indoors) { setFocus(t.act ?? null); setInside(t.to); } else if (t) setSel(t.to); setTrip(null); setFade(false); }, 520); }
  const tripEnded = (why) => { setTrip(null); if (why === "error") toast.error("The trip could not start. Try again."); };
  const tripNotice = (m) => toast.error(m); // a ride that cannot reach you, a way that is blocked: said plainly, and you can try again from the sheet
  const tripPlace = trip ? find(trip.to) : null, insidePlace = inside ? find(inside) : null;
  return (
    <>
      <div className="mapwrap">
        <CampusMap
          selectedId={sel}
          onSelect={(id) => { if (!trip) setSel(id); }}
          billboards={bb?.boards ?? null}
          youId={here}
          trip={trip}
          tripInput={input}
          getMini={() => miniRef.current}
          getPreview={() => previewRef.current}
          onTripState={setTripSt}
          onTripArrive={pay}
          onTripEnter={entered}
          onTripEnd={tripEnded}
          onTripNotice={tripNotice}
          onTripRetarget={retargeted}
          tripGuard={tripGuard}
        />
      </div>
      {trip && <TripHud trip={trip} placeName={trip.name} st={tripSt} input={input} miniRef={miniRef} previewRef={previewRef} onCancel={() => setTrip(null)} />}
      <div className="trip-fade" data-on={fade ? "1" : undefined} aria-hidden="true" />
      {insidePlace && held && insidePlace.id === "floor0" ? <CustodyCell st={g ?? {}} look={ch?.look ?? null} gender={ch?.gender ?? "M"} selfName={ch?.name ?? ""} onFree={() => { setInside(null); setFocus(null); }} /> : insidePlace && <BuildingInside place={insidePlace} look={ch?.look ?? null} gender={ch?.gender ?? "M"} focus={focus} selfName={ch?.name ?? ""} onLeave={() => { setInside(null); setFocus(null); }} />}
      {(sheet || direct) && L && <TravelSheet place={L} here={youPlace?.name} hasCar={ownsCar(ch)} driver={driverActive(ch, g?.week) ? { name: ch.driverName } : null} people={counts[L.id] ?? 0} distanceM={youPlace && L.located && youPlace.located ? Math.round(Math.hypot(L.x - youPlace.x, L.z - youPlace.z)) : null} character={ch} balanceKobo={g?.balanceKobo ?? null} jailed={held} highlight={want} eta={eta} onGo={begin} onClose={() => { closeSheet(); setWant(null); }} />}
      {youPlace && !trip && <div className="map-here" role="status"><Icon name="pin" size={14} weight="fill" /> {held ? <>You are held in <b>{CUSTODY_NAME}</b> until your sentence ends</> : <>You are at <b>{youPlace.name}</b></>}</div>}
      <div
        className="map-chrome"
        style={{
          position: "fixed",
          zIndex: 20,
          left: 10,
          top: "calc(var(--safe-t) + 74px)",
        }}
      >
        <button
          type="button"
          onClick={() => setList(true)}
          style={{ background: "rgba(13,19,33,0.88)" }}
        >
          <Icon name="list" /> Places
        </button>
      </div>
      {L && !trip && !direct && (
        <div className="dock map-chrome">
          <div
            className={"card" + (L.kind === "billboard" ? " bb" : "")}
            role="region"
            aria-label={L.name}
          >
            <div className="top">
              <h2>{L.name}</h2>
              <button
                type="button"
                className="ghost"
                aria-label="Close details"
                onClick={() => setSel(null)}
              >
                <Icon name="close" />
              </button>
            </div>
            {/* <p className="mut">
              <Icon name={ICON_OF[L.kind] ?? "town"} size={16} />{" "}
              {KIND_LABEL[L.kind] ?? "Place"} · {trustNote(L)}
            </p> */}
            <p>{L.blurb}</p>
            {L.kind === "billboard" && (
              <BillboardPanel
                board={Number(L.id.slice(3))}
                state={bb}
                onChanged={refreshBb}
              />
            )}
            {counts[L.id] > 0 && <p className="mut"><Icon name="users" size={15} /> {counts[L.id]} player{counts[L.id] === 1 ? "" : "s"} here now</p>}
            {isClub(L.id) && (() => { const cs = clubStatus(serverTime()); return <p className="mut" role="status"><Icon name={cs.open ? "moon" : "clock"} size={15} /> <b style={{ color: cs.open ? "var(--green-text)" : "var(--danger-text)" }}>{cs.label}</b> · Opening hours {HOURS_LABEL} · {cs.note}</p>; })()}
            <div className="row">
              {L.id === here ? (hasInterior(L.id, L.kind) || isOpenSpace(L.id) ? <button type="button" className="go go-there" onClick={() => (isClub(L.id) && !clubStatus(serverTime()).open ? toast.error(closedMessage(clubOf(L.id)), { duration: 7000 }) : setInside(L.id))}><Icon name={isOpenSpace(L.id) ? "users" : "door"} size={18} /> {isOpenSpace(L.id) ? "Hang out here" : "Go inside"}</button> : <p className="mut"><Icon name="pin" size={15} /> You are here. This is an open-air place, so there are no rooms to enter.</p>)
                : <button type="button" className="go go-there" disabled={!L.located || !ch || held} onClick={() => (isClub(L.id) && !clubStatus(serverTime()).open ? toast.error(closedMessage(clubOf(L.id)), { duration: 7000 }) : setSheet(true))}><Icon name="nav" size={18} weight="fill" /> {held ? "Held in Floor O" : L.located ? "Go there" : "Not on the map yet"}</button>}
            </div>
            {L.kind !== "billboard" && (() => { const fa = featuresAt(L.id, L.kind); return L.id === here ? <PlaceActivities activities={fa.activities} extra={fa.extra} links={[]} character={ch} balanceKobo={g?.balanceKobo ?? null} jailed={held} here highlight={want} actionLabel="Go inside and start" onDo={(a) => { if (isClub(L.id) && !clubStatus(serverTime()).open) return toast.error(closedMessage(clubOf(L.id)), { duration: 7000 }); setFocus(a.act); setInside(L.id); }} /> : null; })()}
            {L.actions?.length > 0 && (
              <div className="row">
                {L.actions.map((a) => (
                  <Link key={a.href} href={a.href} className="btn go">
                    {a.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {list && (
        <div className="sheet-scrim" onClick={() => setList(false)}>
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Places"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="top">
              <h2>Places</h2>
              <button
                type="button"
                className="ghost"
                aria-label="Close list"
                onClick={() => setList(false)}
              >
                <Icon name="close" />
              </button>
            </div>
            {/* <p className="mut">Building outlines, roads and names come from the OpenStreetMap map of OAU. Heights are assumed (most OAU buildings are 5 to 8 m; the Senate Building is 24 m) and shown taller than life so you can read the map. Places marked approximate were placed from another map. Ojaja, Akintola Hall, the Postgraduate hall, Floor O, the clubs and the billboards are game placements: no map shows where they really are.</p> */}
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a place"
              aria-label="Find a place"
              style={{ width: "100%", marginTop: 10, rounded: 4, padding: 6, fontSize: 16,outline: "none", border: "1px solid #888" }}
            />
            {MAP_GROUPS.map(([title, kinds]) => {
              const items = shown.filter((l) => kinds.includes(l.kind));
              if (!items.length) return null;
              return (
                <div key={title}>
                  <h3 style={{ marginTop: 16 }}>{title}</h3>
                  {items.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      className="ghost"
                      style={{
                        width: "100%",
                        justifyContent: "flex-start",
                        marginTop: 6,
                      }}
                      onClick={() => {
                        setSel(l.id);
                        setList(false);
                      }}
                    >
                      <Icon name={ICON_OF[l.kind] ?? "town"} />
                      {l.name}
                      {!l.located
                        ? " (no map position yet)"
                        : l.conf === "approximate"
                          ? " (approx.)"
                          : ""}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}