// components/LectureFight.js
// Fight a lecturer: a full-screen 3D brawl (auto-played, and you can take over any time), then the server decides what it costs you.
// If you win, the QRS van comes for you 80% of the time: you are chased, carried into the van and driven to Floor O.
// The scenes live in lib3d/lectureScene.js, the rules in lib/fightSim.js (the brawl) and lib/fight.js (the consequences).
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { call, naira, loggedOut } from "@/lib/client";
import { useRouter } from "next/navigation";
import { game, useGame, resourceStore } from "@/lib/gameStore";
import { playSound } from "@/lib/sound";
import { createFight } from "@/lib/fightSim";
import { DSA_CATCH_PERCENT } from "@/lib/fight";
import "./lecture-fight.css";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * `course` is { code, difficulty, lecturer: { name } }. `encounter` is what POST /api/lecture (approach) returned: the fight is only accepted by the server
 * against that open encounter, so it can only start from the lecture room. `onClose` runs when the player is done.
 * With `onSettled`, a WIN does not play the van and Floor O scenes here: the result (with the N-QRS response timeline) is handed to the lecture room, which acts
 * it out in the room itself and then shows the result card. A loss is shown here as before.
 */
export default function LectureFight({ course, encounter = null, onSettled = null, onClose }) {
  const router = useRouter(),
    st = useGame(),
    box = useRef(null),
    scene = useRef(null),
    alive = useRef(true),
    reqId = useRef(typeof crypto !== "undefined" ? crypto.randomUUID() : String(Date.now()) + "-fight"),
    skipAll = useRef(false),
    report = useRef(null);
  const [phase, setPhase] = useState("loading"), // loading | fight | cut | result
    [hp, setHp] = useState(null),
    [auto, setAuto] = useState(true),
    [cap, setCap] = useState(null),
    [result, setResult] = useState(null),
    [mounted, setMounted] = useState(false),
    [nogl, setNogl] = useState(false);
  const c = st?.character, name = course.lecturer.name;

  const refreshGame = useCallback(() => { game.refresh(); resourceStore("/api/courses").refresh(); }, []);
  const close = useCallback(() => { refreshGame(); onClose(); }, [onClose, refreshGame]);

  // ---- tell the server how the brawl went, then play what happened ----
  const settle = useCallback(async () => {
    const send = async () => call("/api/fight", { code: course.code, report: report.current, requestId: reqId.current, encounterId: encounter?.id });
    setPhase("cut");
    let [res] = await Promise.all([send(), sleep(1700)]); // a beat of silence over the knocked-out lecturer
    while (alive.current && (res.failed || (res.duplicate && !res.incident))) {
      if (res.status === 401) return loggedOut(router);
      const retry = await new Promise((resolve) => setResult({ error: res.duplicate ? "That fight was already recorded. Check your status on the game screen." : res.error || "We could not record the fight.", retry: res.duplicate ? null : () => resolve(true), done: () => resolve(false) }));
      if (!retry) return close();
      setResult(null); res = await send();
    }
    if (!alive.current) return;
    const s = scene.current, play = async (n) => { if (s && alive.current) await s.play(n); };
    if (res.won && onSettled) { refreshGame(); onSettled(res); return; } // the lecture room plays what N-QRS does
    if (res.won && res.caught) { await play("dsa"); if (!skipAll.current) await play("floor0"); }
    else if (res.won) await play("escape");
    else await play("lost");
    if (alive.current) { setCap(null); setResult(res); setPhase("result"); refreshGame(); if (res.caught) playSound("warn"); }
  }, [course.code, encounter?.id, onSettled, router, close, refreshGame]);

  // ---- build the scene ----
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!mounted || !c) return;
    alive.current = true;
    let sc = null, timer = 0;
    (async () => {
      try {
        const { createLectureScene } = await import("@/lib3d/lectureScene");
        if (!alive.current) return;
        sc = await createLectureScene(box.current, {
          look: c.look, gender: c.gender, health: c.health, lecturer: { name, difficulty: course.difficulty },
          sound: playSound, caption: (t, ms) => { setCap(t); clearTimeout(timer); if (t && ms) timer = setTimeout(() => setCap(null), ms); },
          onFight: (s) => { setHp(s); setAuto(s.auto); },
          onFightEnd: (r) => { report.current = r; settle(); },
        });
        if (!alive.current) { sc.dispose(); return; }
        scene.current = sc;
        setPhase("fight"); await sleep(700); if (alive.current) sc.startFight({ auto: true });
      } catch (e) {
        console.error("3D fight unavailable, using the quick version", e);
        if (!alive.current) return;
        setNogl(true); setPhase("fight");
        const sim = createFight({ difficulty: course.difficulty, health: c.health, auto: true });
        while (!sim.over) sim.update(1 / 30);
        setHp({ p: { hp: sim.p.hp, maxHp: sim.p.maxHp }, l: { hp: sim.l.hp, maxHp: sim.l.maxHp }, auto: true });
        await sleep(900); report.current = sim.report(); if (alive.current) settle();
      }
    })();
    return () => { alive.current = false; clearTimeout(timer); sc?.dispose(); scene.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, !!c]);

  // ---- controls ----
  const press = (m) => { if (!auto) scene.current?.press(m); };
  const toggleAuto = () => { const v = !auto; scene.current?.setAuto(v); setAuto(v); playSound("tap"); };
  useEffect(() => {
    const down = (e) => {
      if (e.repeat && e.key !== "l") return; const k = e.key.toLowerCase();
      if (k === "t") toggleAuto();
      else if (k === " " || k === "j") { e.preventDefault(); press("punch"); }
      else if (k === "k") press("kick");
      else if (k === "s" || k === "d") press("dodge");
      else if (k === "l" || k === "shift") scene.current?.setBlock(!auto);
    };
    const up = (e) => { const k = e.key.toLowerCase(); if (k === "l" || k === "shift") scene.current?.setBlock(false); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  });
  const skip = () => { skipAll.current = true; scene.current?.skip(); };

  if (!mounted) return null;
  const pct = (f) => (f ? Math.max(0, Math.round((f.hp / f.maxHp) * 100)) : 100);
  const ui = (
    <div className="lf" role="dialog" aria-modal="true" aria-label={`Fight ${name}`}>
      <div className="lf-canvas" ref={box} />
      {nogl && phase !== "result" && <div className="lf-nogl"><b>3D view unavailable on this device.</b><span>{name} is getting what is coming...</span></div>}
      <div className="lf-hud">
        <div className="lf-bar" data-who="p"><span>You</span><div><i style={{ width: pct(hp?.p) + "%" }} /></div></div>
        <div className="lf-vs">VS</div>
        <div className="lf-bar" data-who="l"><span>{name}</span><div><i style={{ width: pct(hp?.l) + "%" }} /></div></div>
      </div>
      {phase === "loading" && <div className="lf-load">Getting to the lecture hall...</div>}
      {cap && <div className="lf-cap" key={cap}>{cap}</div>}
      {phase === "fight" && !nogl && (
        <div className="lf-ctl">
          <button type="button" className="lf-mode" data-on={auto ? "1" : "0"} onClick={toggleAuto}>
            {auto ? "Auto-fight on. Take control" : "You are fighting. Hand back to auto"}
          </button>
          {!auto && (
            <div className="lf-pad">
              <button type="button" data-sound="none" onPointerDown={() => press("punch")}>Punch<small>Space / J</small></button>
              <button type="button" data-sound="none" onPointerDown={() => press("kick")}>Kick<small>K</small></button>
              <button type="button" data-sound="none" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scene.current?.setBlock(true); }} onPointerUp={() => scene.current?.setBlock(false)} onPointerCancel={() => scene.current?.setBlock(false)} onLostPointerCapture={() => scene.current?.setBlock(false)}>Block<small>hold L</small></button>
              <button type="button" data-sound="none" onPointerDown={() => press("dodge")}>Dodge<small>S / D</small></button>
            </div>
          )}
          {auto && <p className="lf-tip">Watch it play out, or tap to take over. Dodge the swings, block when you see the red mark.</p>}
        </div>
      )}
      {phase === "cut" && !result && <button type="button" className="lf-skip" onClick={skip}>Skip</button>}
      {result && <ResultCard res={result} name={name} onClose={close} />}
    </div>
  );
  return createPortal(ui, document.body);
}

export function ResultCard({ res, name, onClose }) {
  if (res.error)
    return (
      <div className="lf-card" role="alertdialog"><h2>Could not record it</h2><p>{res.error}</p>
        <div className="lf-row">{res.retry && <button type="button" className="lf-go" onClick={res.retry}>Try again</button>}<button type="button" onClick={res.done}>Close</button></div></div>
    );
  const caught = res.won && res.caught, escaped = res.won && !res.caught;
  const mins = res.releaseAt ? Math.max(1, Math.round((new Date(res.releaseAt) - Date.now()) / 60000)) : null;
  return (
    <div className="lf-card" data-tone={caught ? "bad" : escaped ? "good" : "meh"}>
      <h2>{caught ? "Floor O (N-QRS Custody)" : escaped ? "You got away" : "You lost"}</h2>
      {caught && (<>
        <p>You knocked out {name} and N-QRS caught you ({DSA_CATCH_PERCENT}% chance, and the dice said yes).</p>
        <ul><li>Cash seized: <b>{naira(res.seizedKobo)}</b></li><li>Bill to leave early: <b>{naira(res.billKobo)}</b></li>{mins && <li>Sentence: about <b>{mins} min</b></li>}<li>Strikes: <b>{res.strikes}</b>{res.expelled ? " (expelled for 5 hours)" : res.suspended ? " (suspended for 2 hours)" : ""}</li></ul>
      </>)}
      {escaped && <p>You knocked out {name} and slipped away. N-QRS came, rescued {name}, found nobody to arrest and left. Happiness and fame up, but your suspicion jumped.</p>}
      {!res.won && <p>{name} beat you and carried on with the class. Your health and happiness took a hit.</p>}
      <button type="button" className="lf-go" onClick={onClose}>{caught ? "Go to Floor O" : "Back to class"}</button>
    </div>
  );
}