// src/app/home/page.js
"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { call, naira, notifyError, loggedOut } from "@/lib/client";
import { toast } from "@/lib/toast";
import CreateFlow from "@/components/CreateFlow";
import LifeRoll from "@/components/LifeRoll";
import HostelPicker from "@/components/HostelPicker";
import LoadError from "@/components/LoadError";
import Loader from "@/components/Loader";
import { Icon } from "@/components/Icon";

import GameHome from "@/components/GameHome";
import { setBare, isBooted, markBooted } from "@/lib/ui";
import { game, useGame, run as go, begin, finish, bump, cash, chain, deltas, canAfford } from "@/lib/gameStore";
import { HUSTLE_NAMES } from "@/lib/activities";
import { resolveAction, hustleBlock, safeHustleAt, bailFor, waitText, HUSTLE } from "@/lib/engine";
import { confirmAction } from "@/lib/confirm";
import { serverTime } from "@/lib/serverClock";
import { isJailed, isSuspended, isExpelled } from "@/lib/discipline";
import { Custody, Suspension, Expulsion } from "@/components/DisciplineScreens";
import { fmtN } from "@/lib/classes";
import { wakeResult } from "@/lib/sleep";
import "./play.css";

function View({ children }) {
  return <div className="gh-view">{children}</div>;
}

/** Show one more hustle used today, until the server's own count arrives. */
const usedHustle = (kind) => (s) => {
  const h = s.hustle;
  if (!h) return s;
  const fresh = serverTime() >= h.resetsAt; // a screen that kept the old day: count from a clean day
  return {
    ...s,
    hustle:
      kind === "safe"
        ? { ...h, safeLeft: Math.max(0, (fresh ? HUSTLE.safe.perDay : h.safeLeft) - 1), safeUsed: (fresh ? 0 : h.safeUsed) + 1, safeGapEndsAt: serverTime() + HUSTLE.safe.gapMs, ...(fresh ? { resetsAt: h.resetsAt + Math.ceil((serverTime() - h.resetsAt + 1) / 86_400_000) * 86_400_000 } : {}) }
        : { ...h, riskyLeft: 0, riskyUsed: (fresh ? 0 : h.riskyUsed) + 1, ...(fresh ? { resetsAt: h.resetsAt + Math.ceil((serverTime() - h.resetsAt + 1) / 86_400_000) * 86_400_000 } : {}) },
  };
};

export default function Play() {
  const router = useRouter();
  // The game state lives in one shared store (also read by the top bar), so a change made here shows everywhere at once,
  // and coming back to this page from the map shows the game straight away instead of a loading screen.
  const st = useGame();
  const [view, setView] = useState(() =>
      game.get()?.character?.hostel ? "game" : "loading",
    ),
    [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false),
    [reveal, setReveal] = useState(null);
  const shown = useRef(new Set()),
    pending = useRef(0);
  const [now, setNow] = useState(serverTime());

  // Game notifications become persistent info toasts. Once the last one is closed they are marked read.
  const showNotes = useCallback((list) => {
    const fresh = (list ?? []).filter((n) => !shown.current.has(n.id));
    if (!fresh.length) return;
    fresh.forEach((n) => shown.current.add(n.id));
    const groups =
      fresh.length > 3
        ? [
            {
              id: "batch-" + fresh[0].id,
              body: fresh.map((n) => n.body).join("\n"),
            },
          ]
        : fresh;
    pending.current += groups.length;
    const closed = () => {
      pending.current = Math.max(0, pending.current - 1);
      if (pending.current === 0) call("/api/notifications", {});
    };
    groups.forEach((n) =>
      toast.info(n.body, {
        id: "note-" + n.id,
        sound: "notify",
        persistent: true,
        onDismiss: closed,
      }),
    );
  }, []);

  const load = useCallback(async () => {
    // already holding a fresh copy (for example coming back from the map)? Use it instead of asking the server again.
    const s = await (game.get() ? game.refreshIfStale(15_000) : game.refresh());
    if (s.status === 401) return loggedOut(router);
    if (s.status === 404) {
      const m = await call("/api/meta");
      setMeta(m);
      return setView((v) => (v === "reveal" ? v : "create"));
    } // a late reply must never pull the player off the roll
    if (s.failed) {
      notifyError(s);
      return game.get() ? undefined : setView("error"); // keep showing the game we already have if only a refresh failed
    }
    setView((v) =>
      v === "reveal" ? v : s.character.hostel ? "game" : "hostel",
    );
  }, [router]);
  useEffect(() => {
    load();
  }, [load]);
  // New notifications (from any refresh, including the top bar's) pop up once each.
  useEffect(() => {
    if (view === "game" && st) showNotes(st.notifications);
  }, [view, st, showNotes]);
  // The top bar and bottom nav stay hidden until the game home shows for the first time (loading, error, create, roll, hostel).
  // useLayoutEffect so they never flash in before this runs.
  useLayoutEffect(() => {
    if (view === "game") markBooted();
    setBare(view !== "game" && !isBooted());
    return () => setBare(false);
  }, [view]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [view]); // a new screen always starts at its top
  // The page only needs a ticking clock while a penalty runs (Floor O, suspension, expulsion) or a hustle cooldown is counting: without any it never
  // re-renders on a timer. The next moment something unlocks is also scheduled exactly, so a button comes back the second it is allowed.
  // All of it is measured on the SERVER's clock (lib/serverClock.js), so two devices with different clocks show the same countdown.
  const ch0 = st?.character,
    jailed = !!st?.floorZero,
    penalty = jailed || !!ch0?.suspendedUntil || (!!ch0?.expelled && !!ch0?.expelledUntil),
    hs = st?.hustle,
    nextUnlock = hs ? Math.min(...[safeHustleAt(hs, serverTime()), hs.riskyLeft > 0 ? Infinity : hs.resetsAt].filter((t) => t > serverTime()), Infinity) : Infinity;
  useEffect(() => {
    if (!penalty && nextUnlock === Infinity) return;
    setNow(serverTime());
    const t = setInterval(() => setNow(serverTime()), penalty ? 1000 : 15_000),
      u = nextUnlock === Infinity ? null : setTimeout(() => setNow(serverTime()), Math.max(0, nextUnlock - serverTime()) + 100);
    return () => { clearInterval(t); clearTimeout(u); };
  }, [penalty, nextUnlock]);

  useEffect(() => {
    if (hs) setNow(serverTime()); // a fresh answer from the server: show cooldowns against the server's time
  }, [hs]);

  // The moment a penalty ends (sentence, suspension, expulsion), ask the server for the fresh state: it releases or restarts the player,
  // so everything unlocks at once. One timer for the soonest deadline, replaced (never added to) whenever the deadlines change.
  const deadline = Math.min(...[st?.floorZero?.releaseAt, ch0?.suspendedUntil, ch0?.expelled ? ch0?.expelledUntil : null].filter(Boolean).map((d) => +new Date(d)).filter((t) => t > serverTime()), Infinity);
  useEffect(() => {
    if (deadline === Infinity) return;
    const t = setTimeout(() => game.refresh(), Math.max(0, deadline - serverTime()) + 300);
    return () => clearTimeout(t);
  }, [deadline]);

  // Choosing a hostel: the game opens straight away. If the server refuses (or cannot be reached) the picker comes back with the reason.
  const chooseHostel = (h) => {
    const hasState = !!game.get(); // without a copy of the state there is nothing to show yet, so wait for the answer instead
    if (hasState) setView("game");
    return go({
      key: "hostel",
      router,
      ok: `You moved into ${h}. Welcome home.`,
      request: () => call("/api/character/hostel", { hostel: h }),
      effects: hasState
        ? [{ store: game, patch: (s) => ({ ...s, hostels: null, character: { ...s.character, hostel: h } }) }]
        : [],
      then: () => {
        if (!hasState) load();
      },
    }).then((res) => {
      if (res.failed && !res.skipped) {
        setView("hostel");
        load(); // if it had in fact gone through (a lost answer), the fresh state sends the player on to the game
      }
      return res;
    });
  };

  // ---- Instant actions. Each one changes the screen and shows its message at once, then asks the server in the background.
  // If the server refuses, that one change is taken back and the reason is shown. Amounts nobody can know in advance (a random
  // payout, the result of an exam) are filled in the moment the server answers; the energy they cost is shown immediately.
  const act = (action) => {
    const c = st.character,
      pred = resolveAction(c, action, () => 0); // the same rules the server uses, so rest and hustle are predicted exactly
    if (pred.error) return toast.error(pred.error);
    const why = action === "hustle" && st.hustle ? hustleBlock("safe", st.hustle, serverTime()) : null; // the server decides; this only saves a round trip
    if (why) return toast.error(why);
    return go({
      key: "action:" + action,
      router,
      ok:
        action === "rest"
          ? "You rested and feel better."
          : "Safe hustle done. Cash added.",
      sound: action === "rest" ? undefined : "coin",
      sensitive: action === "hustle", // it pays money: "cash added" is only said once the server has paid
      pending: "Hustling…",
      request: () =>
        call("/api/action", { action, requestId: crypto.randomUUID() }),
      effects: [
        { store: game, patch: bump(deltas(c, pred.stats)) },
        action === "hustle" ? { store: game, patch: usedHustle("safe") } : null, // the cooldown starts on screen at once (the server keeps the real count)
      ],
      after:
        action === "hustle"
          ? (r) => [{ store: game, patch: cash(r.earnedKobo ?? 0) }]
          : undefined,
    });
  };
  const goTo = (what, where) => toast.info(`${what} is done inside ${where}. Open the map, go there and walk to the gold ring.`);
  const exam = () => goTo("The examination", "your faculty building or a lecture theatre"); // exams are sat at the examination ring there
  const call_ = () =>
    go({
      key: "call-parent",
      router,
      ok: "Your parent was glad to hear from you.",
      request: () => call("/api/parent/call", {}),
      effects: [
        {
          store: game,
          patch: chain(bump({ happiness: 3 }), (s) => ({
            ...s,
            calledThisWeek: true,
          })),
        },
      ],
      after: (r) => [{ store: game, patch: cash(r.gift ?? 0) }],
      then: (r) =>
        BigInt(r.gift) > 0n &&
        toast.success(`Your parent sent you ${naira(r.gift)}.`, { sound: "coin" }),
    });

  // ---- Sleeping. GameHome calls onSleep only once the character is lying on the bed, and onWake as soon as the player starts to get up.
  // Both change the screen at once (taken back if the server refuses) and return the answer, so GameHome knows whether it failed.
  const sleep_ = async (bedId) => {
    const since = serverTime(),
      handles = begin([{ store: game, patch: (s) => ({ ...s, sleep: { bedId: String(bedId), since } }) }]); // lying in bed shows at once
    const res = await finish(
      handles,
      await call("/api/sleep", { action: "start", bedId: String(bedId), requestId: crypto.randomUUID() }),
    );
    if (res.failed) {
      if (res.status === 401) loggedOut(router);
      else notifyError(res, "You could not go to sleep. Please try again.");
      return res;
    }
    game.refresh(); // the server's own start time replaces ours
    return res;
  };
  const wake_ = async () => {
    const s0 = game.get(),
      sl = s0?.sleep,
      r = sl ? wakeResult(s0.character, "single_bed", sl.since, serverTime()) : null; // the same rule the server uses (every bed sleeps at the same speed)
    const handles = begin([
      {
        store: game,
        patch: (s) => ({ ...s, sleep: null, character: r ? { ...s.character, energy: r.energy, health: r.health } : s.character }),
      },
    ]);
    const res = await finish(handles, await call("/api/sleep", { action: "wake", requestId: crypto.randomUUID() }));
    if (res.failed) {
      if (res.status === 401) loggedOut(router);
      else notifyError(res, "You could not wake up. Please try again.");
      return res;
    }
    game.refresh(); // the server's real energy and health
    return res;
  };

  const bail = () => {
    if (!canAfford(bailFor(st.floorZero.releaseAt, serverTime())))
      return toast.error("You cannot afford the bail. Wait out your sentence.");
    return go({
      key: "bail",
      router,
      sensitive: true,
      pending: "Paying your bail…",
      ok: "Bail paid. You're free.",
      sound: "coin",
      request: () => call("/api/floor0/pay", {}),
      // the money leaves the wallet at once (taken back if refused), but the custody screen only lifts when the server confirms
      effects: [
        { store: game, patch: (s) => (s.floorZero ? cash(-bailFor(s.floorZero.releaseAt, serverTime()))(s) : s) },
      ],
      after: () => [{ store: game, patch: (s) => ({ ...s, floorZero: null }) }],
    });
  };

  async function create(payload) {
    setBusy(true);
    const res = await call("/api/character", payload);
    setBusy(false);
    if (res.status === 401) return loggedOut(router);
    if (res.failed)
      return notifyError(
        res,
        "We couldn't create your character. Please try again.",
      );
    setReveal(res);
    setView("reveal");
  }

  if (view === "loading") return <Loader fullscreen label="Loading your life" />;
  // if (view === "error")
  //   return (
  //     <View key={view}>
  //       <LoadError title="Your game didn't load" onRetry={load} />
  //     </View>
  //   );
  if (view === "create")
    return (
      <View key={view}>
        <CreateFlow meta={meta} busy={busy} onSubmit={create} />
      </View>
    );
  if (view === "reveal")
    return (
      <View key={view}>
        <LifeRoll
          result={reveal.class}
          hostels={reveal.hostels}
          onContinue={() => {
            setView("hostel");
            load();
          }}
        />
      </View>
    );
  if (view === "hostel")
    return (
      <View key={view}>
        <HostelPicker
          cls={st?.character?.class ?? reveal?.class}
          hostels={st?.hostels ?? reveal?.hostels ?? []}
          busy={busy}
          onChoose={chooseHostel}
        />
      </View>
    );

  if (!st) return <Loader fullscreen label="Loading your life" />;
  const c = st.character,
    a = st.academics,
    left = st.floorZero ? Math.max(0, new Date(st.floorZero.releaseAt) - now) : 0;
  if (c.graduated)
    return (
      <View key={view}>
        <div className="gh-end">
          <span className="gh-endico">
            <Icon name="forbes" size={34} />
          </span>
          <h1>You did it</h1>
          <p className="gh-endclass">{c.classification}</p>
          <div className="gh-endstats">
            <div>
              <span className="mut">Final CGPA</span>
              <b className="num">{(c.finalCgpaX100 / 100).toFixed(2)}</b>
            </div>
            <div>
              <span className="mut">Cash</span>
              <b className="num">{naira(st.balanceKobo)}</b>
            </div>
          </div>
        </div>
      </View>
    );
  // A player in custody is held INSIDE Floor O: they do not get the home room. (Expelled players in custody are told about both.)
  if (isJailed(c, now) && st.floorZero)
    return (
      <View key={view}>
        <Custody st={st} now={now} busy={busy} bail={bail} />
      </View>
    );
  if (isExpelled(c, now))
    return (
      <View key={view}>
        <Expulsion c={c} a={a} now={now} />
      </View>
    );
  if (isSuspended(c, now))
    return (
      <View key={view}>
        <Suspension c={c} now={now} />
      </View>
    );
  // The old action tiles (rest, hustles, call) now live in the room itself: tap the bed to sleep, the phone to call home, and go to the
  // map for hustles and exams. GameHome no longer takes `actions` or `exam`, so they are not passed.
  return (
    <GameHome
      key="game"
      st={st}
      now={now}
      busy={busy}
      left={left}
      bail={bail}
      onSleep={sleep_}
      onWake={wake_}
      onCall={call_}
    />
  );
}