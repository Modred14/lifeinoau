// components/GameHome.js
// The home screen: your room fills the whole window, with your needs, what you can do, and (in Buy mode) the furniture shop on top of it.
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { call, naira, notifyError, loggedOut } from "@/lib/client";
import { toast } from "@/lib/toast";
import { confirmAction } from "@/lib/confirm";
import { refreshShell, usePlayMode, setPlayMode } from "@/lib/ui";
import { ITEMS, roomScore, sellKobo } from "@/lib/furniture.js";
import { roomFor } from "@/lib/room.js";
import { fmtN } from "@/lib/classes.js";
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
  if (c.suspicion >= 60) return { tone: "bad", text: "DSA is watching you" };
  if (c.happiness < 25) return { tone: "warn", text: "Feeling low. Call home" };
  if (c.energy < 40) return { tone: "warn", text: "Getting tired" };
  return null;
}

export default function GameHome({
  st,
  now,
  busy,
  reload,
  actions,
  exam,
  bail,
  left,
}) {
  const router = useRouter(),
    c = st.character,
    a = st.academics,
    fz = st.floorZero,
    mode = usePlayMode(),
    buying = mode === "buy";
  const [rd, setRd] = useState(null),
    [selected, setSelected] = useState(null),
    [roomBusy, setRoomBusy] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [needsOpen, setNeedsOpen] = useState(false);
  const api = useRef(null),
    pending = useRef(0),
    chain = useRef(Promise.resolve());
  const room = useMemo(
    () => rd?.room ?? roomFor(c.hostel),
    [rd?.room, c.hostel],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const items = rd?.items ?? [];
  const failRoom = useCallback(
    (r) =>
      r.status === 401
        ? loggedOut(router)
        : notifyError(r, "Something went wrong. Please try again."),
    [router],
  );

  const loadRoom = useCallback(async () => {
    const r = await call("/api/room");
    if (r.failed) failRoom(r);
    else setRd(r);
  }, [failRoom]);
  useEffect(() => {
    loadRoom();
  }, [loadRoom]);
  useEffect(() => () => setPlayMode("home"), []); // leaving the screen always leaves Buy mode
  useEffect(() => {
    if (!buying) setSelected(null);
  }, [buying]);

  // Everything that changes the room goes through one queue, so quick drags never overlap.
  const send = useCallback(
    (body, { quiet = false } = {}) => {
      pending.current++;
      if (!quiet) setRoomBusy(true);
      const run = async () => {
        const r = await call("/api/room", body);
        pending.current--;
        if (pending.current === 0) setRoomBusy(false);
        if (r.failed) {
          failRoom(r);
          if (pending.current === 0) await loadRoom();
          return null;
        }
        if (pending.current === 0) setRd(r);
        refreshShell();
        reload?.();
        return r;
      };
      const p = chain.current.then(run, run);
      chain.current = p.catch(() => {});
      return p;
    },
    [failRoom, loadRoom, reload],
  );

  const buy = async (key) => {
    const d = ITEMS[key];
    if (
      d.price >= 100_000 &&
      !(await confirmAction({
        title: `Buy ${d.name}?`,
        message: `${fmtN(d.price)} leaves your wallet. If you sell it later you get 60% back.`,
        confirmLabel: `Buy for ${fmtN(d.price)}`,
      }))
    )
      return;
    const r = await send({
      action: "buy",
      key,
      requestId: crypto.randomUUID(),
    });
    if (!r) return;
    if (r.duplicate) return toast.info("That was already bought.");
    toast.success(
      r.placed
        ? `${d.name} is in your room.`
        : `${d.name} bought. Your room is full, so it is in storage.`,
    );
    if (r.placed && r.boughtId) setSelected(r.boughtId);
  };
  const place = async (id) => {
    const r = await send({ action: "place", id });
    if (r) setSelected(String(id));
  };
  const sel = items.find((i) => String(i.id) === selected) ?? null;
  const store = async () => {
    if (!sel) return;
    setSelected(null);
    await send({ action: "store", id: sel.id });
  };
  const sell = async () => {
    if (!sel) return;
    const back = sellKobo(sel.paidKobo) / 100n,
      d = ITEMS[sel.key];
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
    const r = await send({ action: "sell", id: sel.id });
    if (r) toast.success(`Sold ${d.name} for ${naira(r.soldKobo)}.`);
  };
  const onMove = useCallback(
    (id, p) => {
      send(
        { action: "place", id, x: p.x, z: p.z, rot: p.rot },
        { quiet: true },
      );
    },
    [send],
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
                  <h2 id="fz-h">You are on Floor 0</h2>
                  <p>
                    {Math.floor(hours / 3600000)}h{" "}
                    {String(Math.floor(hours / 60000) % 60).padStart(2, "0")}m{" "}
                    {String(Math.floor(hours / 1000) % 60).padStart(2, "0")}s
                    left
                  </p>
                </div>
                <button
                  type="button"
                  className="go"
                  disabled={busy}
                  onClick={bail}
                >
                  Pay {naira(fz.billKobo)}
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
          {c.hostel} · {room.w}×{room.d} room<i>Room score {score}</i>
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
          busy={roomBusy || busy}
          onBuy={buy}
          onPlace={place}
          collapsed={collapsed}
          onToggle={() => setCollapsed((v) => !v)}
        />
      )}
    </div>
  );
}
