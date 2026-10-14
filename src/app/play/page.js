// src/app/play/page.js
"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { call, naira, notifyError, loggedOut, say } from "@/lib/client";
import { toast } from "@/lib/toast";
import CreateFlow from "@/components/CreateFlow";
import LifeRoll from "@/components/LifeRoll";
import HostelPicker from "@/components/HostelPicker";
import LoadError from "@/components/LoadError";
import Loader from "@/components/Loader";
import { Icon } from "@/components/Icon";
import GameHome from "@/components/GameHome";
import { refreshShell, setBare, isBooted, markBooted } from "@/lib/ui";
import "./play.css";

function View({ children }) {
  return <div className="gh-view">{children}</div>;
}

export default function Play() {
  const router = useRouter();
  const [view, setView] = useState("loading"),
    [st, setSt] = useState(null),
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
    const s = await call("/api/state");
    if (s.status === 401) return loggedOut(router);
    if (s.status === 404) {
      const m = await call("/api/meta");
      setMeta(m);
      return setView((v) => (v === "reveal" ? v : "create"));
    } // a late reply must never pull the player off the roll
    if (s.failed) {
      notifyError(s);
      return setView("error");
    }
    setSt(s);
    setView((v) =>
      v === "reveal" ? v : s.character.hostel ? "game" : "hostel",
    );
    showNotes(s.notifications);
  }, [router, showNotes]);
  useEffect(() => {
    load();
  }, [load]);
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
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function run(path, body, describe) {
    if (busy) return;
    setBusy(true);
    const res = await call(path, body);
    setBusy(false);
    if (res.status === 401) return loggedOut(router);
    if (res.failed) notifyError(res, "Something went wrong. Please try again.");
    else if (res.duplicate) toast.info("That was already done.");
    else if (describe) say(describe(res));
    await load();
    refreshShell();
  }
  const act = (action) =>
    run("/api/action", { action, requestId: crypto.randomUUID() }, () => ({
      text:
        action === "rest"
          ? "You rested and feel better."
          : "Safe hustle done. Cash added.",
      sound: action === "rest" ? undefined : "coin",
    }));
  const risky = () =>
    run("/api/risky", { requestId: crypto.randomUUID() }, (r) =>
      r.caught
        ? {
            bad: true,
            text: `DSA HAS CAUGHT YOU. They seized ${naira(r.seizedKobo)}.${r.expelled ? " You have been expelled." : r.suspended ? " You are suspended for 2 weeks." : ""}`,
          }
        : BigInt(r.earnedKobo) > 0n
          ? { text: `The hustle paid ${naira(r.earnedKobo)}. DSA is watching.`, sound: "coin" }
          : { info: true, text: "The hustle went nowhere." },
    );
  const exam = (cheat) =>
    run("/api/exam", { cheat, requestId: crypto.randomUUID() }, (r) => ({
      bad: r.caught,
      text: r.caught
        ? `Caught cheating. Score ${r.score}, grade point ${r.gradePoint}.`
        : `Score ${r.score}, grade point ${r.gradePoint}.`,
    }));
  const call_ = () =>
    run("/api/parent/call", {}, (r) => ({
      text:
        BigInt(r.gift) > 0n
          ? `Your parent sent you ${naira(r.gift)}.`
          : "Your parent was glad to hear from you.",
      sound: BigInt(r.gift) > 0n ? "coin" : undefined,
    }));

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
  if (view === "error")
    return (
      <View key={view}>
        <LoadError title="Your game didn't load" onRetry={load} />
      </View>
    );
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
          onChoose={(h) =>
            run("/api/character/hostel", { hostel: h }, () => ({
              text: `You moved into ${h}. Welcome home.`,
            }))
          }
        />
      </View>
    );

  const c = st.character,
    a = st.academics,
    fz = st.floorZero,
    left = fz ? Math.max(0, new Date(fz.releaseAt) - now) : 0;
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
      note: "25 energy. Big money, or DSA.",
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
      reload={load}
      actions={ACTIONS}
      exam={exam}
      bail={() =>
        run("/api/floor0/pay", {}, () => ({ text: "Bail paid. You're free.", sound: "coin" }))
      }
    />
  );
}