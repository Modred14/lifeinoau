// components/BuildingPanel.js
// The Building Activities Panel: a drawer docked directly above the bottom bar (Home, Buy, Map, Phone) inside a building. It lists what can be
// done HERE, and choosing one makes the character WALK to that activity's ring (the scene's own automatic walk: same movement code, same
// collision, same position reports to the server) before the activity panel opens or starts. Nothing teleports, and nothing is paid or
// rewarded here: the server still checks position, cost and limits (lib/activityService.js).
//
// The cards come from lib/buildingPanel.js (the activity registry + the rings that exist in this room + the server's list for this player),
// so a new activity added to lib/activities.js appears here with no edit to this file.
"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { confirmAction } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { buildCards, chipsFor, nearestRing, walkLabel, waitLabel, walkSeconds } from "@/lib/buildingPanel.js";
import { pickCard } from "@/lib/hubActions.js";
import "./building-panel.css";

const ON_RING = 0.3; // metres: closer than this to the centre of a ring counts as standing on it

function Card({ c, state, selected, eta, onSelect, onGo, goLabel }) {
  const bodyId = useId();
  const groups = [
    ["Needs", c.requires, null],
    [c.certainty === "variable" ? "Gives · not guaranteed" : "Gives · sure", c.gives, "good"],
    ["Costs", c.costs, c.risk === "risky" ? "bad" : null],
    ["Limits", c.limits, null],
  ].filter((g) => g[1]?.length > 0);
  return (
    <div className="bp-card" data-state={state} data-risk={c.risk} data-open={selected ? "1" : undefined}>
      <button type="button" className="bp-card-h" aria-expanded={selected} aria-controls={bodyId} onClick={onSelect} data-sound="none">
        <span className="bp-ico"><Icon name={c.icon} size={20} weight="fill" /></span>
        <span className="bp-card-t">
          <b>{c.label}{c.risk === "risky" && <i className="bp-risky">RISKY</i>}{state === "running" && <i className="bp-pill" data-k="run">In progress</i>}{state === "unavailable" && <i className="bp-pill" data-k="wait">Not now</i>}</b>
          <small>{c.summary}</small>
          <span className="bp-meta">
            <span className="bp-chipm" data-k="price">{c.price ?? "Free"}</span>
            {eta != null && <span className="bp-chipm"><Icon name="trek" size={13} /> {walkLabel(eta)}</span>}
            <span className="bp-chipm"><Icon name="timer" size={13} /> {c.seconds}s</span>
          </span>
        </span>
        <span className="bp-chev" aria-hidden="true"><Icon name="down" size={16} /></span>
      </button>
      <div className="bp-card-b" id={bodyId} data-open={selected ? "1" : undefined}>
        <div className="bp-card-bi">
          {c.blocked && <p className="bp-why" role="note">{c.blocked}{c.until ? ` Ready in ${waitLabel(c.until - Date.now())}.` : ""}</p>}
          {c.risky && (
            <div className="bp-risk" role="note">
              <b><Icon name="warn" size={15} weight="fill" /> RISKY · {c.risky.short}</b>
              <ul>{c.risky.lines.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          )}
          {c.note && <p className="bp-note">{c.note}</p>}
          <button type="button" className={`bp-go${c.risk === "risky" ? " risk" : ""}`} disabled={!!c.blocked || c.hard || state === "running"} onClick={onGo} data-sound="none">
            <Icon name={eta === 0 ? "door" : "nav"} size={18} weight="fill" /> {goLabel}
          </button>
          {c.explain && <p className="bp-ex">{c.explain}</p>}
          {groups.length > 0 && <div className="bp-det">{groups.map(([t, list, tone]) => <div key={t} className="bp-grp" data-tone={tone ?? undefined}><b>{t}</b><ul>{list.map((x, i) => <li key={i}>{x}</li>)}</ul></div>)}</div>}
        </div>
      </div>
    </div>
  );
}

/**
 * place            the building / open space
 * rings            the activity rings of this interior
 * state            the server's /api/activity answer ({ hubs, ... }), { failed } on an error, or null while loading
 * api              ref to the 3D scene (walkTo, routeInfo, cancelWalk, state)
 * ready            the scene has been built
 * runHubId         the ring whose activity is running now (from ActivityLayer)
 * ringOpen         the ring whose activity panel is showing
 * character, jailed, balanceKobo   what the screen knows (only used to lock plainly impossible activities)
 * onArrive(ring, { auto })   the character stands at the ring: open its panel (and, if `auto`, start it)
 * onReload         ask the server again (used by the error state's button)
 * controlRef        ref the panel fills with { goAct(acts, label) }: the yellow desks in the room use it to walk to the matching activity (components/BuildingInside.js)
 */
export default function BuildingPanel({ place, rings, state, api, ready, runHubId = null, ringOpen = null, character, jailed, balanceKobo, onArrive, onReload, controlRef = null }) {
  const root = useRef(null), seq = useRef(0), going = useRef(false), sheetId = useId();
  const [userOpen, setUserOpen] = useState(null); // null: automatic (open when there is something to choose), true/false: the person's choice
  const [chip, setChip] = useState("all"), [sel, setSel] = useState(null), [walk, setWalk] = useState(null), [etas, setEtas] = useState({}), [problem, setProblem] = useState(null), [, tick] = useState(0);
  const hubs = state && !state.failed ? state.hubs ?? [] : null, failed = !!state?.failed;
  const cards = useMemo(() => buildCards({ placeId: place.id, kind: place.kind, rings, hubs, character, jailed, balanceKobo }), [place.id, place.kind, rings, hubs, character, jailed, balanceKobo]); // eslint-disable-line react-hooks/exhaustive-deps
  const chips = useMemo(() => chipsFor(cards), [cards]);
  useEffect(() => { if (chip !== "all" && !chips.some((c) => c.id === chip)) setChip("all"); }, [chips, chip]);
  const shown = cards ? (chip === "all" ? cards : cards.filter((c) => c.category === chip)) : [];
  const running = runHubId ? rings.find((r) => r.id === runHubId) : null;
  const stateOf = (c) => (running && running.act === c.act && running.label === c.label ? "running" : walk?.card.key === c.key ? "selected" : c.blocked ? "unavailable" : "available");

  // ---- the panel and the bottom bar are ONE surface: tell the page the bar is docked, and keep our height/offset in step with the real sizes
  useLayoutEffect(() => {
    document.body.dataset.dock = "on";
    const el = root.current, scene = el?.closest(".bi3"), nav = document.querySelector(".nav");
    const measure = () => {
      if (!el) return;
      el.style.setProperty("--bp-nav-h", `${Math.round(nav?.getBoundingClientRect().height ?? 0)}px`);
      scene?.style.setProperty("--bp-h", `${Math.round(el.getBoundingClientRect().height)}px`);
    };
    measure();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (ro) { if (el) ro.observe(el); if (nav) ro.observe(nav); }
    window.addEventListener("resize", measure); window.addEventListener("orientationchange", measure);
    return () => { delete document.body.dataset.dock; ro?.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("orientationchange", measure); scene?.style.removeProperty("--bp-h"); };
  }, []);

  // While we walk, the panel folds to its compact bar so the character, the room and the controls stay in view. It opens again by itself afterwards.
  const busy = !!walk || !!ringOpen || !!running;
  const loading = !cards && !failed, open = !busy && (userOpen ?? (loading || failed || (cards?.length ?? 0) > 0));

  // ---- walking time to every card (live, while the list is showing)
  useEffect(() => {
    if (!ready || !open || !cards?.length) return;
    const calc = () => {
      const s = api.current?.state; if (!s) return; const next = {};
      for (const c of cards) { const t = nearestRing(c.rings, (r) => api.current.routeInfo(r.x, r.z, r.floor ?? 0), s); next[c.key] = t ? t.seconds : null; }
      setEtas(next);
    };
    calc(); const t = setInterval(calc, 1500); return () => clearInterval(t);
  }, [ready, open, cards, api]);

  // ---- the walk itself
  const stop = useCallback((silent = true) => { seq.current++; api.current?.cancelWalk?.(); setWalk(null); if (!silent) toast.info("You stopped walking."); }, [api]);
  useEffect(() => () => { seq.current++; }, []);
  /** Walk to the activity's ring and open its panel there. opts.auto: start a plain activity as soon as the character arrives (the "Walk there" button says the price first). */
  async function go(c, opts = {}) {
    if (going.current || walk) { toast.info(walk ? "You are already walking. Cancel that first if you want to go somewhere else." : "One moment, that is already being set up."); return; }
    if (!ready || !api.current) { toast.info("The room is still loading. Try again in a moment."); return; }
    setProblem(null);
    if (c.hard) { toast.info(c.blocked || "You cannot do that right now."); return; }
    going.current = true;
    try {
      if (c.risky && !(await confirmAction({ tone: "danger", ...c.risky.confirm }))) return; // a risky activity is always confirmed before the character sets off
      if (!api.current) return; // the room was closed while the question was open
      const s = api.current.state, target = nearestRing(c.rings, (r) => api.current.routeInfo(r.x, r.z, r.floor ?? 0), s);
      if (!target) { setProblem({ key: c.key, text: "There is no way to walk there from where you stand. Move to another part of the building and try again." }); toast.error(`No way to walk to ${c.label} from here.`); return; }
      const ring = target.ring, token = ++seq.current, auto = opts.auto ?? true;
      if (target.metres <= ON_RING && (s.floor ?? 0) === (ring.floor ?? 0)) { onArrive(ring, { auto, confirmed: !!c.risky }); setSel(null); return; } // already standing on it: no walking needed (anything farther is walked, so the ring is the nearest thing to the character when the panel opens)
      setWalk({ card: c, ring, seconds: target.seconds });
      const ok = await api.current.walkTo(ring.x, ring.z, ring.floor ?? 0);
      if (token !== seq.current) return; // cancelled, or another activity was chosen meanwhile
      setWalk(null);
      if (!ok) { setProblem({ key: c.key, text: "The way was blocked, or you took the controls. Choose it again to resume." }); toast.info("You stopped before you got there."); return; }
      setSel(null); onArrive(ring, { auto, confirmed: !!c.risky });
    } finally { going.current = false; }
  }
  // The yellow desks in the room (reception, stewards' desk, back stairwell...) lead to an activity here: walk to it exactly as if its card had been chosen.
  useEffect(() => {
    if (!controlRef) return;
    controlRef.current = {
      goAct(acts, label = "that") {
        if (!cards) { toast.info(failed ? "Could not load what you can do here. Open the activities panel and press Try again." : "Still looking up what you can do here. Try again in a moment."); return false; }
        const c = pickCard(cards, acts);
        if (!c) { toast.info(`${label} is not available here right now.`); return false; }
        if (c.blocked) { toast.info(`${c.blocked}${c.until ? ` Ready in ${waitLabel(c.until - Date.now())}.` : ""}`); return false; }
        go(c, { auto: false }); return true; // the person presses Start at the ring: a desk never spends money by itself
      },
    };
    return () => { if (controlRef.current) controlRef.current = null; };
  });
  // live remaining time while walking (from the real route, not a fixed timer)
  useEffect(() => {
    if (!walk) return;
    const t = setInterval(() => {
      const r = api.current?.routeInfo(walk.ring.x, walk.ring.z, walk.ring.floor ?? 0); setWalk((w) => (w ? { ...w, seconds: r ? walkSeconds(r.length, r.speed) : 0 } : w)); tick((n) => n + 1);
    }, 400);
    return () => clearInterval(t);
  }, [walk?.ring.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- drag handle: a tap toggles, a swipe up or down opens or folds
  const drag = useRef(null);
  const toggle = () => { if (busy) { if (walk) stop(false); return; } setUserOpen(!open); };
  const onDown = (e) => { drag.current = { y: e.clientY, id: e.pointerId }; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const onUp = (e) => { const d = drag.current; drag.current = null; if (!d) return; const dy = e.clientY - d.y; if (dy < -24) setUserOpen(true); else if (dy > 24) setUserOpen(false); else toggle(); };
  const onKey = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } };

  const nOpen = cards?.filter((c) => !c.blocked).length ?? 0;
  const where = place.name;
  const goLabel = (c) => { const e = etas[c.key]; const base = e === 0 ? "Start here" : e != null ? `Walk there · ${walkLabel(e).replace(" walk", "")}` : "Walk there"; return c.price && !c.risky ? `${base} · ${c.price}` : base; };

  return (
    <section ref={root} className="bp" data-open={open ? "1" : undefined} data-busy={busy ? "1" : undefined} aria-label={`Activities at ${where}`}>
      <div className="bp-handle" role="button" tabIndex={0} aria-expanded={open} aria-controls={sheetId} aria-label={open ? "Fold the activities panel" : "Open the activities panel"} onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; }} onKeyDown={onKey}><i /></div>
      {/* the compact bar: always there; it is the whole panel while folded */}
      <div className="bp-bar" role="status" aria-live="polite">
        {walk ? (
          <>
            <span className="bp-bar-ico" data-k="walk"><Icon name="trek" size={18} weight="fill" /></span>
            <span className="bp-bar-t"><b>Walking to {walk.card.label}</b><small>{walk.ring.room} · {walk.seconds > 0 ? `about ${walk.seconds}s` : "almost there"}</small></span>
            <button type="button" className="bp-bar-x" onClick={() => stop(false)} data-sound="none"><Icon name="close" size={16} /> Cancel</button>
          </>
        ) : running ? (
          <>
            <span className="bp-bar-ico" data-k="run"><Icon name={cards?.find((c) => stateOf(c) === "running")?.icon ?? "timer"} size={18} weight="fill" /></span>
            <span className="bp-bar-t"><b>{running.label}</b><small>In progress · stay on the ring</small></span>
          </>
        ) : ringOpen ? (
          <>
            <span className="bp-bar-ico"><Icon name="pin" size={18} weight="fill" /></span>
            <span className="bp-bar-t"><b>{ringOpen.label}</b><small>You are at the spot</small></span>
          </>
        ) : (
          <>
            <span className="bp-bar-ico"><Icon name="pin" size={18} weight="fill" /></span>
            <span className="bp-bar-t"><b>{where}</b><small>{loading ? "Looking for activities…" : failed ? "Could not load activities" : cards.length === 0 ? "No activities here" : `${nOpen} of ${cards.length} activit${cards.length === 1 ? "y" : "ies"} available`}</small></span>
            <button type="button" className="bp-bar-x" onClick={toggle} aria-expanded={open} aria-controls={sheetId} data-sound="none"><Icon name="down" size={16} /> {open ? "Fold" : "Activities"}</button>
          </>
        )}
      </div>
      <div className="bp-sheet" id={sheetId} data-open={open ? "1" : undefined} aria-hidden={!open}>
        <div className="bp-sheet-i">
          {chips.length > 0 && (
            <div className="bp-chips" role="group" aria-label="Filter activities">
              <button type="button" className="bp-chip" aria-pressed={chip === "all"} onClick={() => setChip("all")} data-sound="none" tabIndex={open ? 0 : -1}>All <small>{cards.length}</small></button>
              {chips.map((c) => <button key={c.id} type="button" className="bp-chip" aria-pressed={chip === c.id} onClick={() => setChip(c.id)} data-sound="none" tabIndex={open ? 0 : -1}>{c.label} <small>{c.n}</small></button>)}
            </div>
          )}
          <div className="bp-scroll">
            {loading && <ul className="bp-list" aria-busy="true" aria-label="Loading activities">{[0, 1, 2].map((i) => <li key={i} className="bp-wrap"><div className="bp-card bp-skel"><span /><span /></div></li>)}</ul>}
            {failed && (
              <div className="bp-empty" role="alert"><Icon name="alert" size={26} /><b>Could not load what you can do here</b><p>{state.error || "The connection dropped."}</p><button type="button" className="bp-go" onClick={onReload} data-sound="none" tabIndex={open ? 0 : -1}><Icon name="spin" size={16} /> Try again</button></div>
            )}
            {cards && cards.length === 0 && <div className="bp-empty"><Icon name="door" size={26} /><b>Nothing to do here right now</b><p>{place.name} has no activities you can use at the moment. You are free to look around, or open the Map to go somewhere else.</p></div>}
            {cards && cards.length > 0 && shown.length > 0 && (
              <ul className="bp-list">
                {shown.map((c) => (
                  <li key={c.key} className="bp-wrap">
                    <Card c={c} state={stateOf(c)} selected={sel === c.key && open} eta={etas[c.key] ?? null} onSelect={() => { setSel((k) => (k === c.key ? null : c.key)); setProblem(null); }} onGo={() => go(c)} goLabel={goLabel(c)} />
                    {problem?.key === c.key && <p className="bp-problem" role="alert">{problem.text}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
