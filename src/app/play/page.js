// src/app/play/page.js
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
import { game, useGame, run as go, bump, cash, chain, deltas, canAfford } from "@/lib/gameStore";
import { resolveAction } from "@/lib/engine";
import "./play.css";

function View({ children }) {
  return <div className="gh-view">{children}</div>;
}

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
  const [now, setNow] = useState(Date.now());

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
  // The page only needs a ticking clock for the Floor O countdown: without a sentence it never re-renders on a timer.
  const jailed = !!st?.floorZero;
  useEffect(() => {
    if (!jailed) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [jailed]);

  // The moment the sentence runs out, ask the server for the fresh state (it releases the player), so everything unlocks at once.
  const releaseAt = st?.floorZero?.releaseAt;
  useEffect(() => {
    if (!releaseAt) return;
    const ms = Math.max(0, new Date(releaseAt) - Date.now()) + 300;
    const t = setTimeout(() => game.refresh(), ms);
    return () => clearTimeout(t);
  }, [releaseAt]);

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
      effects: [{ store: game, patch: bump(deltas(c, pred.stats)) }],
      after:
        action === "hustle"
          ? (r) => [{ store: game, patch: cash(r.earnedKobo ?? 0) }]
          : undefined,
    });
  };
  const risky = () => {
    if (st.character.energy < 25)
      return toast.error("You are too tired for that. Rest first.");
    return go({
      key: "risky",
      router,
      request: () => call("/api/risky", { requestId: crypto.randomUUID() }),
      effects: [{ store: game, patch: bump({ energy: -25, suspicion: 15 }) }],
      okLate: (r) =>
        r.caught
          ? {
              bad: true,
              text: `QRS HAS CAUGHT YOU. They seized ${naira(r.seizedKobo)}.${r.expelled ? " You have been expelled." : r.suspended ? " You are suspended for 2 weeks." : ""}`,
            }
          : BigInt(r.earnedKobo) > 0n
            ? { text: `The hustle paid ${naira(r.earnedKobo)}. QRS is watching.`, sound: "coin" }
            : { info: true, text: "The hustle went nowhere." },
    });
  };
  const exam = (cheat) =>
    go({
      key: "exam",
      router,
      request: () =>
        call("/api/exam", { cheat, requestId: crypto.randomUUID() }),
      effects: [
        {
          store: game,
          patch: chain(bump({ energy: -20 }), (s) => ({
            ...s,
            academics: { ...s.academics, satThisWeek: true },
          })),
        },
      ],
      okLate: (r) => ({
        bad: r.caught,
        text: r.caught
          ? `Caught cheating. Score ${r.score}, grade point ${r.gradePoint}.`
          : `Score ${r.score}, grade point ${r.gradePoint}.`,
      }),
    });
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
  const bail = () => {
    if (!canAfford(st.floorZero.billKobo))
      return toast.error("You cannot afford the bill. Wait out your sentence.");
    return go({
      key: "bail",
      router,
      sensitive: true,
      pending: "Paying your bail…",
      ok: "Bail paid. You're free.",
      sound: "coin",
      request: () => call("/api/floor0/pay", {}),
      // the money leaves the wallet at once (taken back if refused), but the Floor O screen only lifts when the server confirms
      effects: [
        { store: game, patch: (s) => (s.floorZero ? cash(-BigInt(s.floorZero.billKobo))(s) : s) },
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
  if (c.expelled)
    return (
      <View key={view}>
        <div className="gh-end gh-bad">
          <span className="gh-endico">
            <Icon name="warn" size={34} />
          </span>
          <h1>Your story ends here</h1>
          <p className="mut">
            You were expelled or withdrawn. Final CGPA so far:{" "}
            {a.cgpa ?? "none"}.
          </p>
        </div>
      </View>
    );
  const ACTIONS = [
    {
      id: "rest",
      icon: "moon",
      name: "Rest",
      note: "Free. Win back energy.",
      run: () => act("rest"),
      off: false,
    },
    {
      id: "hustle",
      icon: "hustle",
      name: "Safe hustle",
      note: "20 energy. Earns ₦8k to ₦25k.",
      run: () => act("hustle"),
      off: c.energy < 20,
      why: "Needs 20 energy",
    },
    {
      id: "risky",
      icon: "dice",
      name: "Risky hustle",
      note: "25 energy. Big money, or QRS.",
      run: risky,
      off: c.energy < 25,
      why: "Needs 25 energy",
      tone: "risk",
    },
    {
      id: "call",
      icon: "call",
      name: "Call parent",
      note: st.calledThisWeek ? "Done for this week." : "Once a week.",
      run: call_,
      off: st.calledThisWeek,
      why: "Done this week",
      free: true,
    },
  ];
  return (
    <GameHome
      key="game"
      st={st}
      now={now}
      busy={busy}
      left={left}
      actions={ACTIONS}
      exam={exam}
      bail={bail}
    />
  );
}