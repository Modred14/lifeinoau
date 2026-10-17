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
import { Icon } from "./Icon";
import BuySheet from "./BuySheet";
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
  if (c.suspicion >= 60) return { tone: "bad", text: "QRS is watching you" };
  if (c.happiness < 25) return { tone: "warn", text: "Feeling low. Call home" };
  if (c.energy < 40) return { tone: "warn", text: "Getting tired" };
  return null;
}

export default function GameHome({
  st,
  now,
  busy,
  actions,
  exam,
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
    [needsOpen, setNeedsOpen] = useState(false);
  const api = useRef(null),
    queue = useRef(Promise.resolve()),
    ids = useRef(new Map()); // temporary id of an item that was just bought -> its real id once the server has answered
  const real = (id) => ids.current.get(String(id)) ?? id;
  const room = useMemo(
    () => rd?.room ?? roomFor(c.hostel),
    [rd?.room, c.hostel],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const items = rd?.items ?? [];
  const fail = useCallback(
    (r) =>
      r.status === 401
        ? loggedOut(router)
        : notifyError(r, "Something went wrong. Please try again."),
    [router],
  );

  const loadRoom = useCallback(async () => {
    const r = await roomStore.refresh();
    if (r.failed && (r.status === 401 || !roomStore.get())) fail(r);
  }, [fail]);
  useEffect(() => {
    loadRoom();
  }, [loadRoom]);
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
  const status = statusOf(c),
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
        <RoomStage
          room={room}
          items={items}
          look={c.look ?? undefined}
          gender={c.gender}
          mode={mode}
          selected={selected}
          onSelect={setSelected}
          onMove={onMove}
          apiRef={api}
          tool={tool}
        />
      </div>

      {/* top left: what needs attention */}
      <div className="gx-tl">
        {buying ? (
          <div className="gx-pill gx-pill--solid">
            <Icon name="bag" size={18} />
            <b>Buy mode</b>
            <span className="mut">Drag furniture to move it</span>
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
                  <h2 id="fz-h">You are on Floor O</h2>
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
                  <h2 id="ex-h">Exam today</h2>
                  <p>Sit it before the week ends.</p>
                </div>
                <div className="gx-alert-acts">
                  <button
                    type="button"
                    className="go"
                    disabled={busy || stopped}
                    onClick={() => exam(false)}
                  >
                    Sit honestly
                  </button>
                  <button
                    type="button"
                    className="gx-risk"
                    disabled={busy || stopped}
                    onClick={() => exam(true)}
                  >
                    Try to cheat
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
      <div className="gx-tr">
        <button
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
              <span>{c.name.slice(0, 1).toUpperCase()}</span>
            </button>
            <div className="gx-needs">
              {NEEDS.map(([n, k, ic]) => {
                const v = c[k],
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

      {/* right: what will you do */}
      {!buying && (
        <nav className="gx-do" aria-label="What will you do?">
          {actions.map((x) => (
            <button
              key={x.id}
              type="button"
              className="gx-act"
              data-tone={x.tone}
              disabled={busy || stopped || x.off}
              onClick={x.run}
              title={x.off && x.why && !x.free ? x.why : x.note}
            >
              <span className="gx-act-ico">
                <Icon name={x.icon} size={22} />
              </span>
              <span className="gx-act-txt">
                <b>{x.name}</b>
                <span>{x.off && x.why && !x.free ? x.why : x.note}</span>
              </span>
            </button>
          ))}
        </nav>
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
          busy={busy}
          onBuy={buy}
          onPlace={place}
          collapsed={collapsed}
          onToggle={() => setCollapsed((v) => !v)}
        />
      )}
    </div>
  );
}