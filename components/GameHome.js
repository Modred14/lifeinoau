// components/GameHome.js
// The home screen: your room fills the whole window, with your needs, what you can do, and (in Buy mode) the furniture shop on top of it.
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { call, naira, notifyError, loggedOut } from "@/lib/client";
import { toast } from "@/lib/toast";
import { playSound } from "@/lib/sound";
import { confirmAction } from "@/lib/confirm";
import { usePlayMode, setPlayMode } from "@/lib/ui";
import { game, roomStore, useStore, begin, finish, cash, canAfford } from "@/lib/gameStore";
import { ITEMS, MAX_ITEMS, roomScore, sellKobo, priceKobo } from "@/lib/furniture.js";
import { roomFor, autoPlace } from "@/lib/room.js";
import { fmtN } from "@/lib/classes.js";
import { bailFor, HUSTLE } from "@/lib/engine.js";
import { SLEEP, wakeResult, msToFull, toMs } from "@/lib/sleep.js";
import { serverTime } from "@/lib/serverClock";
import { Icon } from "./Icon";
import BuySheet from "./BuySheet";
import PlayerAvatar from "./PlayerAvatar";
import HomeGarage from "./HomeGarage";
import "./game-home.css";

const RoomStage = dynamic(() => import("./RoomStage"), {
  ssr: false,
  loading: () => (
    <div className="rs-loading" aria-busy="true">
      <span className="rs-spin" />
      Setting up your room
    </div>
  ),
});

const NEEDS = [
  ["Health", "health", "health"],
  ["Energy", "energy", "energy"],
  ["Happiness", "happiness", "happy"],
  ["Academics", "academics", "study"],
  ["Popularity", "popularity", "social"],
  ["Suspicion", "suspicion", "eye"],
];

/** One short line about how the player is, from their worst stat. */
export function statusOf(c) {
  if (c.health < 25) return { tone: "bad", text: "Very sick. Rest up" };
  if (c.energy < 20) return { tone: "bad", text: "Exhausted. Go and rest" };
  if (c.suspicion >= 60) return { tone: "bad", text: "N-QRS is watching you" };
  if (c.happiness < 25) return { tone: "warn", text: "Feeling low. Call home" };
  if (c.energy < 40) return { tone: "warn", text: "Getting tired" };
  return null;
}

export default function GameHome({
  st,
  now,
  busy,
  onSleep,
  onWake,
  onCall,
  bail,
  left,
}) {
  const router = useRouter(),
    c = st.character,
    a = st.academics,
    fz = st.floorZero && left > 0 ? st.floorZero : null, // time is up: free at once, without waiting for the server to answer
    mode = usePlayMode(),
    buying = mode === "buy";
  // The room is kept in a shared store: coming back to the home screen shows it at once and refreshes it quietly.
  const rd = useStore(roomStore),
    [selected, setSelected] = useState(null),
    [collapsed, setCollapsed] = useState(false),
    [needsOpen, setNeedsOpen] = useState(false),
    [garageOpen, setGarageOpen] = useState(false),
    [, bumpView] = useState(0); // the yard / house button reads the scene's view, so it re-renders when it is pressed
  const api = useRef(null),
    queue = useRef(Promise.resolve()),
    ids = useRef(new Map()); // temporary id of an item that was just bought -> its real id once the server has answered
  const real = (id) => ids.current.get(String(id)) ?? id;
  const room = useMemo(
    () => rd?.room ?? roomFor(c.hostel),
    [rd?.room, c.hostel],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const items = rd?.items ?? [];

  // ---- sleeping.
  // Tapping the bed makes the character walk over, sit, and lie down AT ONCE: nothing waits for the server. Only when the character is
  // lying down is the server told (the 15 seconds start then, on the server's clock too). If it refuses, the character gets up and
  // the reason is shown. While asleep, energy fills at a steady rate (100 in 15 seconds) and the screen shows it live; the server works
  // out the real result when you wake, from the same rule (lib/sleep.js). You wake by yourself when you are full or after 15 seconds, by
  // pressing Wake up, or by tapping the floor (you sit up, stand, and walk to where you tapped).
  const [use, setUse] = useState(null), // the bed / phone the player tapped, waiting for "Go to sleep"
    [going, setGoing] = useState(null), // id of the bed the character is walking to / lying down on, before the server has been told
    [clock, setClock] = useState(() => serverTime()),
    sleeping = !!st.sleep,
    bedItem = sleeping ? items.find((i) => String(i.id) === String(st.sleep.bedId)) : null,
    bedKey = bedItem?.key ?? "single_bed",
    since = sleeping ? toMs(st.sleep.since) : 0,
    rest = sleeping ? wakeResult(c, bedKey, since, clock) : null, // what waking right now would give
    endMs = sleeping ? msToFull(c, bedKey) : 0, // how long this sleep lasts: until full, never more than 15 seconds
    elapsedMs = sleeping ? Math.max(0, clock - since) : 0,
    secsLeft = Math.max(0, Math.ceil((endMs - elapsedMs) / 1000)),
    pct = endMs > 0 ? Math.min(100, Math.round((elapsedMs / endMs) * 100)) : 100,
    live = rest ? { ...c, energy: rest.energy, health: rest.health } : c; // the needs shown on the screen follow the sleep as it goes
  // a quick clock only while asleep, so energy climbs smoothly without the whole page ticking the rest of the time
  useEffect(() => {
    if (!sleeping) return;
    setClock(serverTime());
    const t = setInterval(() => setClock(serverTime()), 250);
    return () => clearInterval(t);
  }, [sleeping]);
  useEffect(() => {
    if (sleeping) setGoing(null); // the server's answer (or the optimistic state) has arrived
  }, [sleeping]);

  const lieDown = (u) => {
    setUse(null);
    if (api.current?.goToBed(u.id)) setGoing(u.id); // walk, sit, lie: starts this instant
    else toast.error("Your character is not ready yet. Try again in a moment.");
  };
  // the character is now lying on the bed: only NOW is the server told
  const onAsleep = async (id) => {
    const res = await onSleep(id);
    if (res?.failed) {
      api.current?.wakeUp(); // refused: get up again (the page already showed why)
      setGoing(null);
    }
  };
  const waking = useRef(false);
  /** Wake up. `visual` is false when the scene has already started the get-up itself (the player tapped the floor). */
  const wakeNow = async (visual = true) => {
    if (waking.current) return;
    waking.current = true;
    if (visual) api.current?.wakeUp(); // sit up, stand: the screen does not wait for the server
    await onWake();
    waking.current = false;
  };
  // asleep for the whole sleep (or full): get up by yourself, once per sleep
  const autoWoke = useRef(false);
  useEffect(() => {
    if (!sleeping) {
      autoWoke.current = false;
      return;
    }
    if (!autoWoke.current && elapsedMs >= endMs) {
      autoWoke.current = true;
      wakeNow();
    }
  }, [sleeping, elapsedMs, endMs]); // eslint-disable-line react-hooks/exhaustive-deps
  // came back to the page while asleep: lie in the bed straight away (the room and the character may still be loading, so keep trying for a few seconds)
  useEffect(() => {
    if (!sleeping || !st.sleep.bedId) return;
    let tries = 0, t;
    const attempt = () => { if (api.current?.isSleepBusy?.() || api.current?.lieInBed(st.sleep.bedId) || ++tries > 20) return; t = setTimeout(attempt, 400); };
    attempt();
    return () => clearTimeout(t);
  }, [sleeping, st.sleep?.bedId, items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const fail = useCallback(
    (r) =>
      r.status === 401
        ? loggedOut(router)
        : notifyError(r, "Something went wrong. Please try again."),
    [router],
  );

  // The room is drawn only once its data has arrived (room + furniture together). Until then the stage shows "Setting up your room";
  // if the data cannot be fetched it shows the reason and a Retry button, never an empty room. A failed fetch is retried a few times
  // on its own (a dropped connection); the furniture then appears by itself when the answer comes, with no reload.
  const [roomErr, setRoomErr] = useState(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const loadRoom = useCallback(async () => {
    setRoomErr(null);
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await roomStore.refresh();
      if (!alive.current) return;
      if (!r.failed || roomStore.get()) return; // loaded (or we already hold a copy and only a refresh failed)
      if (r.status === 401) return fail(r);
      if (r.aborted) return;
      if (attempt === 3 || (r.status >= 400 && r.status < 500 && r.status !== 409 && r.status !== 408 && r.status !== 429)) { setRoomErr(r.error || "Your room could not be loaded."); return; }
      await new Promise((ok) => setTimeout(ok, 800 * 2 ** attempt)); // only after a failure: wait a little longer each time
      if (!alive.current) return;
    }
  }, [fail]);
  useEffect(() => {
    loadRoom();
  }, [loadRoom]);
  const roomReady = !!(rd?.room && rd?.items);
  useEffect(() => () => setPlayMode("home"), []); // leaving the screen always leaves Buy mode
  useEffect(() => {
    if (!buying) setSelected(null);
  }, [buying]);

  // Every change to the room goes through here. It shows on screen at ONCE; its request then runs in order behind the previous
  // ones (so quick drags never overlap). If the server refuses, only that change is taken back and the reason is shown.
  // `body` is a function so a just-bought item's temporary id can be swapped for its real one when the request actually runs.
  const send = useCallback(
    (body, { room: patch, cash: delta }) => {
      const handles = begin([
        { store: roomStore, patch, settle: (res) => (res.room && res.items ? res : null) }, // the answer is the whole room: use it, unless it is only a "done already" (then a refresh brings the room)
        delta ? { store: game, patch: cash(delta) } : null, // the top bar's cash moves too
      ]);
      const go = async () => finish(handles, await call("/api/room", body()));
      const p = queue.current.then(go, go);
      queue.current = p.catch(() => {});
      return p.then((res) => {
        if (res.failed) {
          fail(res);
          return null;
        }
        return res;
      });
    },
    [fail],
  );
  const patchItem = (id, change) => (v) => ({
    ...v,
    items: v.items.map((i) => (String(i.id) === String(id) ? { ...i, ...change } : i)),
  });

  const buy = async (key) => {
    const d = ITEMS[key],
      price = priceKobo(key);
    if (
      d.price >= 100_000 &&
      !(await confirmAction({
        title: `Buy ${d.name}?`,
        message: `${fmtN(d.price)} leaves your wallet. If you sell it later you get 60% back.`,
        confirmLabel: `Buy for ${fmtN(d.price)}`,
      }))
    )
      return;
    if (items.length >= MAX_ITEMS)
      return toast.error("Your storage is full. Sell something first.");
    if (!canAfford(price)) return toast.error("You cannot afford that.");
    const requestId = crypto.randomUUID(),
      tmp = "tmp-" + requestId,
      spot = rd?.room ? autoPlace(rd.room, items, key) : null; // same function the server uses, so it lands where the server will put it
    const msg = spot
      ? `${d.name} is in your room.`
      : `${d.name} bought. Your room is full, so it is in storage.`;
    const tid = toast.pending(`Buying ${d.name}…`); // the item appears at once, but "bought" is only said once the server has taken the money
    if (spot) setSelected(tmp);
    const r = await send(() => ({ action: "buy", key, requestId }), {
      cash: -price,
      room: (v) => ({
        ...v,
        balanceKobo: (BigInt(v.balanceKobo) - price).toString(),
        items: [
          ...v.items,
          { id: tmp, key, placed: !!spot, x: spot?.x ?? null, z: spot?.z ?? null, rot: spot?.rot ?? 0, paidKobo: price.toString() },
        ],
      }),
    });
    if (!r) {
      toast.dismiss(tid); // refused: the item is gone again
      return setSelected((s) => (s === tmp ? null : s));
    }
    if (r.duplicate && !r.replayed) {
      toast.dismiss(tid);
      return toast.info("That was already bought.");
    }
    toast.success(msg, { id: tid, sound: "coin" });
    if (r.boughtId) {
      ids.current.set(tmp, String(r.boughtId));
      setSelected((s) => (s === tmp ? String(r.boughtId) : s));
    }
  };
  const place = async (id) => {
    const it = items.find((i) => String(i.id) === String(id));
    if (!it) return;
    const spot = rd?.room
      ? autoPlace(rd.room, items.filter((i) => i !== it), it.key)
      : null;
    if (rd?.room && !spot)
      return toast.error("There is no space left in your room.");
    setSelected(String(id));
    const r = await send(() => ({ action: "place", id: real(id) }), {
      room: spot
        ? patchItem(id, { placed: true, x: spot.x, z: spot.z, rot: spot.rot })
        : (v) => v,
    });
    if (!r) setSelected((s) => (s === String(id) ? null : s));
  };
  const sel = items.find((i) => String(i.id) === selected) ?? null;
  const store = async () => {
    if (!sel) return;
    const id = sel.id;
    setSelected(null);
    await send(() => ({ action: "store", id: real(id) }), {
      room: patchItem(id, { placed: false, x: null, z: null, rot: 0 }),
    });
  };
  const sell = async () => {
    if (!sel) return;
    const backKobo = sellKobo(sel.paidKobo),
      back = backKobo / 100n,
      d = ITEMS[sel.key],
      id = sel.id;
    if (
      !(await confirmAction({
        title: `Sell ${d.name}?`,
        message: `You get ${fmtN(back)} back, which is 60% of what you paid.`,
        confirmLabel: `Sell for ${fmtN(back)}`,
        tone: "danger",
      }))
    )
      return;
    setSelected(null);
    const tid = toast.pending(`Selling ${d.name}…`);
    const r = await send(() => ({ action: "sell", id: real(id) }), {
      cash: backKobo,
      room: (v) => ({
        ...v,
        balanceKobo: (BigInt(v.balanceKobo) + backKobo).toString(),
        items: v.items.filter((i) => String(i.id) !== String(id)),
      }),
    });
    if (!r) toast.dismiss(tid);
    else toast.success(`Sold ${d.name} for ${naira(backKobo.toString())}.`, { id: tid, sound: "coin" });
  };
  const onMove = useCallback(
    (id, p) => {
      playSound("place"); // the piece lands where you dropped it
      send(() => ({ action: "place", id: real(id), x: p.x, z: p.z, rot: p.rot }), {
        room: patchItem(id, { placed: true, x: p.x, z: p.z, rot: p.rot }),
      });
    },
    [send], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const tool = sel && {
    name: ITEMS[sel.key].name,
    onRotate: () => api.current?.rotateSelected(),
    onStore: store,
    onSell: sell,
    sellLabel:
      BigInt(sel.paidKobo) > 0n ? fmtN(sellKobo(sel.paidKobo) / 100n) : null,
  };
  const status = statusOf(live),
    score = roomScore(items),
    mood =
      c.happiness >= 80
        ? ["Very happy", "happy"]
        : c.happiness >= 60
          ? ["Happy", "happy"]
          : c.happiness >= 40
            ? ["Okay", "meh"]
            : ["Low", "sad"];
  const examToday = a.nextExamWeek === st.week && !a.satThisWeek,
    stopped = !!fz,
    sessionDone = Math.min(
      100,
      Math.round(((12 - a.weeksLeftInSession) / 12) * 100),
    );
  const hours = fz ? left : 0;

  return (
    <div
      className="gx"
      data-mode={buying ? "buy" : "home"}
      data-sheet={collapsed ? "min" : "full"}
    >
      <div className="gx-bg" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="gx-scene">
        {garageOpen ? <HomeGarage character={c} onBack={() => setGarageOpen(false)} /> : <RoomStage
          room={roomReady ? rd.room : null}
          items={roomReady ? rd.items : null}
          roomError={roomReady ? null : roomErr}
          onRetry={loadRoom}
          look={c.look ?? undefined}
          gender={c.gender}
          mode={mode}
          selected={selected}
          onSelect={setSelected}
          onMove={onMove}
          onUse={(u) => !buying && !sleeping && !going && setUse(u)}
          onAsleep={onAsleep}
          onWakeTap={() => wakeNow(false)}
          onSleepCancel={() => setGoing(null)}
          apiRef={api}
          tool={tool}
        />}
      </div>

      {/* top left: what needs attention */}
      <div className="gx-tl">
        {buying ? (
          <div className="gx-pill gx-pill--solid">
            <Icon name="bag" size={18} />
            <b>Buy mode</b>
            <span className="mut">Drag furniture and garden things to move them</span>
            <button
              type="button"
              className="gx-done"
              onClick={() => setPlayMode("home")}
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {fz && (
              <section
                className="gx-alert"
                data-tone="bad"
                aria-labelledby="fz-h"
              >
                <span className="gx-alert-ico">
                  <Icon name="siren" size={22} />
                </span>
                <div>
                  <h2 id="fz-h">You are in Floor O (N-QRS Custody)</h2>
                  <p>
                    {Math.floor(hours / 3600000)}h{" "}
                    {String(Math.floor(hours / 60000) % 60).padStart(2, "0")}m{" "}
                    {String(Math.floor(hours / 1000) % 60).padStart(2, "0")}s
                    left · bail drops {fmtN(HUSTLE.bailPerMinute)} every minute
                  </p>
                </div>
                <button
                  type="button"
                  className="go"
                  disabled={busy}
                  onClick={bail}
                >
                  Pay {naira(bailFor(fz.releaseAt, now))}
                </button>
              </section>
            )}
            {examToday && (
              <section
                className="gx-alert"
                data-tone="warn"
                aria-labelledby="ex-h"
              >
                <span className="gx-alert-ico">
                  <Icon name="warn" size={22} />
                </span>
                <div>
                  <h2 id="ex-h">Exam week</h2>
                  <p>
                    Exams are sat in person. Go to the examination hall of your
                    own faculty ({c.faculty}) before the week ends.
                  </p>
                </div>
                <div className="gx-alert-acts">
                  <button
                    type="button"
                    className="go"
                    disabled={stopped}
                    onClick={() => router.push("/map")}
                  >
                    Open the map
                  </button>
                </div>
              </section>
            )}
            <section className="gx-card gx-acad" aria-labelledby="ac-h">
              <div className="gx-acad-top">
                <div>
                  <h2 id="ac-h">Academics</h2>
                  <p className="mut">
                    {a.weeksLeftInSession} weeks left this session
                  </p>
                </div>
                <div className="gx-cgpa">
                  <b className="num">{a.cgpa ?? "–"}</b>
                  <span className="mut">
                    {a.standing ? `CGPA · ${a.standing}` : "CGPA"}
                  </span>
                </div>
              </div>
              <div
                className="gx-bar gx-bar--gold"
                role="progressbar"
                aria-label="Session progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={sessionDone}
              >
                <i style={{ width: sessionDone + "%" }} />
              </div>
              <div className="gx-strikes">
                <span className="mut">Strikes</span>
                <span
                  className="gx-pips"
                  aria-label={`${c.strikes} of 5 strikes`}
                >
                  {Array.from({ length: 5 }, (_, i) => (
                    <i key={i} data-on={i < c.strikes ? "true" : undefined} />
                  ))}
                </span>
                {!examToday && (
                  <span className="mut gx-next">
                    <Icon name="timer" size={14} /> Exam week {a.nextExamWeek}
                  </span>
                )}
              </div>
            </section>
          </>
        )}
      </div>

      {/* top right: look around */}
      <div className={"gx-tr" + (garageOpen ? " gx-tr--garage" : "")}>
        {!garageOpen && <><button
          type="button"
          className="gx-round"
          aria-label="Turn the room left"
          onClick={() => api.current?.rotateView(-1)}
        >
          <Icon name="rotateLeft" size={20} />
        </button>
        <button
          type="button"
          className="gx-round"
          aria-label="Turn the room right"
          onClick={() => api.current?.rotateView(1)}
        >
          <Icon name="rotateRight" size={20} />
        </button></>}
        {buying && !garageOpen && (() => { const yard = api.current?.getView?.() === "yard"; return <button type="button" className="gx-round" aria-label={yard ? "Look at the house" : "Look at the yard"} title={yard ? "Look at the house" : "Look at the yard"} aria-pressed={yard} onClick={() => { api.current?.setView?.(yard ? "house" : "yard"); bumpView((n) => n + 1); }}><Icon name={yard ? "hostel" : "farm"} size={20} /></button>; })()}
        <button type="button" className="gx-round gx-garage-toggle" aria-label={garageOpen ? "Return to your room" : "Open your home garage"} title={garageOpen ? "Return to your room" : "Open your home garage"} onClick={() => { setGarageOpen((v) => !v); setSelected(null); setUse(null); }}>
          <Icon name={garageOpen ? "hostel" : "ride"} size={20} />
        </button>
      </div>

      {/* bottom left: you */}
      {!buying && (
        <section
          className="gx-me"
          data-open={needsOpen ? "1" : "0"}
          style={{ "--cls": `var(--${c.class.toLowerCase()})` }}
          aria-label="How you are doing"
        >
          {status && (
            <div className="gx-status" data-tone={status.tone}>
              <Icon name="warn" size={14} />
              {status.text}
            </div>
          )}
          <div className="gx-me-card">
            <button
              type="button"
              className="gx-face"
              onClick={() => setNeedsOpen((o) => !o)}
              aria-expanded={needsOpen}
              aria-label={needsOpen ? "Hide details" : "Show details"}
            >
              <PlayerAvatar name={c.name} size="100%" className="pav-fill" />
            </button>
            <div className="gx-needs">
              {NEEDS.map(([n, k, ic]) => {
                const v = live[k], // while asleep, Energy and Health climb here as you sleep
                  tone =
                    k === "suspicion"
                      ? v >= 60
                        ? "risk"
                        : v >= 30
                          ? "warn"
                          : "ok"
                      : v < 25
                        ? "low"
                        : "ok";
                return (
                  <div
                    key={k}
                    className="gx-need"
                    data-tone={tone}
                    title={`${n} ${v}`}
                  >
                    <Icon name={ic} size={15} />
                    {needsOpen && <span className="gx-need-n">{n}</span>}
                    <div
                      className="gx-bar"
                      role="meter"
                      aria-label={n}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={v}
                    >
                      <i style={{ width: v + "%" }} />
                    </div>
                    {needsOpen && <b className="num">{v}</b>}
                  </div>
                );
              })}
            </div>
            {needsOpen && (
              <div className="gx-id">
                <b>{c.name}</b>
                <span className="mut">
                  {c.class} · {c.faculty} · {c.hostel}
                </span>
                <span className="mut">Room score {score}</span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* the room itself is the menu: tap your bed to sleep, tap the phone on your desk or bedside table to call home */}
      {!buying && use && !sleeping && !going && (
        <section className="gx-use" role="dialog" aria-labelledby="use-h">
          <button type="button" className="gx-use-x" aria-label="Close" onClick={() => setUse(null)}>
            <Icon name="close" size={16} />
          </button>
          {use.kind === "bed" ? (
            <>
              <h2 id="use-h"><Icon name="moon" size={18} /> {ITEMS[use.key]?.name ?? "Your bed"}</h2>
              <p>Lie down and sleep. Your energy fills up while you sleep, up to 100. Energy now {c.energy}/100.</p>
              <p className="mut">
                {c.energy < 100 ? `Full in about ${Math.ceil(msToFull(c, use.key) / 1000)} seconds.` : "You are fully rested."} Tap the floor any time to get up.
              </p>
              <button type="button" className="go" disabled={busy || stopped || c.energy >= SLEEP.stopAt - 4} onClick={() => lieDown(use)}>
                {c.energy >= SLEEP.stopAt - 4 ? "Not tired" : "Go to sleep"}
              </button>
            </>
          ) : (
            <>
              <h2 id="use-h"><Icon name="call" size={18} /> Call home</h2>
              <p>{st.calledThisWeek ? "You have already called home this week." : "Ring your parent. Once a week."}</p>
              <button type="button" className="go" disabled={busy || stopped || st.calledThisWeek} onClick={() => { setUse(null); onCall(); }}>
                {st.calledThisWeek ? "Done this week" : "Call parent"}
              </button>
            </>
          )}
        </section>
      )}
      {!buying && going && !sleeping && (
        <section className="gx-sleep" role="status" aria-live="polite">
          <h2><Icon name="moon" size={18} /> Going to bed</h2>
          <p className="mut">Tap the floor to cancel.</p>
        </section>
      )}
      {!buying && sleeping && (
        <section className="gx-sleep" role="status" aria-live="polite">
          <h2><Icon name="moon" size={18} /> Sleeping</h2>
          <p className="gx-sleep-t num">{secsLeft > 0 ? `Wakes in ${secsLeft}s` : "Waking up…"}</p>
          <p>
            Energy {c.energy} <span className="mut">→</span> <b>{rest.energy}</b> <span className="mut">/ 100</span>
          </p>
          <div
            className="gx-bar gx-bar--gold"
            role="progressbar"
            aria-label="Sleep progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <i style={{ width: pct + "%" }} />
          </div>
          <p className="mut">Tap the floor to get up and walk.</p>
          <button type="button" className="go" disabled={busy} onClick={() => wakeNow()}>Wake up</button>
        </section>
      )}

      {/* home: a small label; buy: the shop */}
      {!buying && (
        <div className="gx-room-tag">
          <Icon name="hostel" size={16} />
          {c.hostel} · {room.occupants ? `${room.occupants} in the room` : `${room.w}×${room.d} room`}<i>Room score {score}</i>
          <span className="gx-mood" title="Mood">
            <Icon name={mood[1]} size={16} />
            {mood[0]}
          </span>
        </div>
      )}
      {buying && (
        <BuySheet
          items={items}
          balanceKobo={rd?.balanceKobo ?? st.balanceKobo}
          busy={busy || !roomReady}
          onBuy={buy}
          onPlace={place}
          collapsed={collapsed}
          onToggle={() => setCollapsed((v) => !v)}
        />
      )}
    </div>
  );
}
