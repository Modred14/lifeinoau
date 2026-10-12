// components/LifeRoll.js
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import {
  CLASS_INFO,
  CLASS_ORDER,
  ODDS,
  PARENT_GIFT,
  classPackage,
  fmtN,
  range,
} from "@/lib/classes.js";
import "./liferoll.css";

const REPEATS = 13,
  ROLL_MS = 5600;
const STRIP = Array.from(
  { length: CLASS_ORDER.length * REPEATS },
  (_, i) => CLASS_ORDER[i % CLASS_ORDER.length],
);

/**
 * The class roll. The server has already decided `result`; this only performs it: a vertical reel that winds up,
 * falls from top to bottom, crawls over the last few symbols and settles on the answer. Then it lists everything that comes with it.
 */
export default function LifeRoll({ result, hostels = [], onContinue }) {
  const [phase, setPhase] = useState("waiting"); // waiting, spinning, landed
  const win = useRef(null),
    strip = useRef(null),
    anims = useRef([]);
  const idx = CLASS_ORDER.indexOf(result),
    target = CLASS_ORDER.length + idx,
    start = CLASS_ORDER.length * (REPEATS - 2) + 1;
  const info = CLASS_INFO[result],
    pkg = useMemo(() => classPackage(result, hostels), [result, hostels]);

  const land = useCallback(() => {
    setPhase((p) => {
      if (p === "landed") return p;
      try {
        navigator.vibrate?.([30, 40, 60]);
      } catch {}
      return "landed";
    });
  }, []);

  useEffect(() => {
    const el = strip.current,
      h = win.current.clientHeight / 3,
      y = (i) => -(i - 1) * h;
    el.style.transform = `translateY(${y(start)}px)`;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) {
      el.style.transform = `translateY(${y(target)}px)`;
      const t = setTimeout(land, 250);
      return () => clearTimeout(t);
    }
    let alive = true;
    const go = setTimeout(() => {
      if (!alive) return;
      setPhase("spinning");
      const move = el.animate(
        [
          {
            transform: `translateY(${y(start)}px)`,
            offset: 0,
            easing: "cubic-bezier(0.33, 1, 0.68, 1)",
          }, // wind-up: the reel dips back first
          {
            transform: `translateY(${y(start) - 0.22 * h}px)`,
            offset: 0.05,
            easing: "cubic-bezier(0.5, 0, 0.08, 1)",
          }, // then falls fast and brakes for a long time
          {
            transform: `translateY(${y(target) + 0.2 * h}px)`,
            offset: 0.93,
            easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          }, // overshoots the line a little
          { transform: `translateY(${y(target)}px)`, offset: 1 }, // and settles back
        ],
        { duration: ROLL_MS, fill: "forwards" },
      );
      const blur = el.animate(
        [
          { filter: "blur(0px)", offset: 0 },
          { filter: "blur(0px)", offset: 0.05 },
          { filter: "blur(2.5px)", offset: 0.14 },
          { filter: "blur(2.5px)", offset: 0.6 },
          { filter: "blur(0.8px)", offset: 0.86 },
          { filter: "blur(0px)", offset: 0.94 },
        ],
        { duration: ROLL_MS, fill: "forwards" },
      );
      anims.current = [move, blur];
      move.finished
        .then(() => {
          if (alive) land();
        })
        .catch(() => {});
    }, 700);
    return () => {
      alive = false;
      clearTimeout(go);
      anims.current.forEach((a) => a.cancel());
    };
  }, [start, target, land]);

  const skip = () => {
    anims.current.forEach((a) => a.finish());
  };

  return (
    <div
      className="lr"
      data-phase={phase}
      data-class={phase === "landed" ? result : undefined}
      style={{ "--cls": info.color }}
    >
      <header className="lr-head">
        <h1>
          {phase === "landed"
            ? "Here is the life you got"
            : "Rolling your life"}
        </h1>
        <p className="mut">
          {phase === "landed"
            ? info.tagline
            : "Your family is drawn once. It can't be rerolled."}
        </p>
      </header>

      <div className="lr-grid">
        <section className="lr-machine" aria-label="Class roll">
          <div className="lr-lamps" aria-hidden="true">
            {Array.from({ length: 9 }, (_, i) => (
              <i key={i} style={{ "--i": i }} />
            ))}
          </div>
          <div className="lr-window" ref={win}>
            <div className="lr-strip" ref={strip} aria-hidden="true">
              {STRIP.map((c, i) => (
                <div
                  key={i}
                  className="lr-item"
                  data-hit={i === target ? "true" : undefined}
                >
                  {c}
                </div>
              ))}
            </div>
            <div className="lr-shade lr-shade-top" aria-hidden="true" />
            <div className="lr-shade lr-shade-bot" aria-hidden="true" />
            <div className="lr-line lr-line-top" aria-hidden="true" />
            <div className="lr-line lr-line-bot" aria-hidden="true" />
            <i className="lr-arrow lr-arrow-l" aria-hidden="true" />
            <i className="lr-arrow lr-arrow-r" aria-hidden="true" />
          </div>
          <p className="lr-status" role="status" aria-live="polite">
            {phase === "landed" ? `You are ${result}` : "Rolling…"}
          </p>
          <div className="lr-odds">
            <div className="lr-oddsbar" aria-hidden="true">
              {CLASS_ORDER.map((c) => (
                <i
                  key={c}
                  data-c={c}
                  data-on={
                    phase === "landed" && c === result ? "true" : undefined
                  }
                  style={{ flexGrow: ODDS[c], "--c": CLASS_INFO[c].color }}
                />
              ))}
            </div>
            <ul className="lr-oddslist">
              {CLASS_ORDER.map((c) => (
                <li
                  key={c}
                  data-on={
                    phase === "landed" && c === result ? "true" : undefined
                  }
                  style={{ "--c": CLASS_INFO[c].color }}
                >
                  <span>{c}</span>
                  <b className="num">{ODDS[c]}%</b>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section
          className="lr-pack"
          aria-label={`What comes with ${result}`}
          aria-busy={phase !== "landed"}
        >
          {phase !== "landed" ? <Waiting /> : <Package pkg={pkg} info={info} />}
        </section>
      </div>

      <div className="lr-cta">
        {phase === "landed" ? (
          <button type="button" className="go lr-go" onClick={onContinue}>
            Choose where to live <Icon name="next" size={20} />
          </button>
        ) : (
          <button
            type="button"
            className="ghost lr-skip"
            disabled={phase !== "spinning"}
            onClick={skip}
          >
            <Icon name="skip" size={18} /> Skip the roll
          </button>
        )}
      </div>
    </div>
  );
}

function Waiting() {
  return (
    <div className="lr-wait" aria-hidden="true">
      {[70, 100, 84, 92, 60].map((w, i) => (
        <div
          key={i}
          className="lr-ghost"
          style={{ "--w": w + "%", "--d": i * 120 + "ms" }}
        />
      ))}
    </div>
  );
}

function Row({ icon, label, children, i }) {
  return (
    <li className="lr-row" style={{ "--d": 120 + i * 70 + "ms" }}>
      <span className="lr-ico">
        <Icon name={icon} size={20} />
      </span>
      <div>
        <span className="lr-label">{label}</span>
        <div className="lr-val">{children}</div>
      </div>
    </li>
  );
}

function Package({ pkg, info }) {
  let n = 0;
  return (
    <div className="lr-list">
      <div className="lr-title">
        <h2>
          <span className="lr-pill">{pkg.cls}</span> comes with
        </h2>
        <p className="mut">{pkg.odds / 10} in 10 players start here.</p>
      </div>
      <h3 className="lr-group">Money</h3>
      <ul className="lr-rows">
        <Row i={n++} icon="wallet" label="Allowance every game week">
          <b className="num lr-big">{fmtN(pkg.allowance)}</b>
        </Row>
        <Row i={n++} icon="hostel" label="Rent every game week">
          <span className="num">{range(pkg.rentMin, pkg.rentMax)}</span>
        </Row>
        <Row i={n++} icon="coins" label="What you keep after rent">
          <span className="num">{range(pkg.keepMin, pkg.keepMax)}</span>
        </Row>
        <Row i={n++} icon="gift" label="When you call your parent">
          <span>{PARENT(pkg)}</span>
        </Row>
        <Row i={n++} icon="hustle" label="A safe hustle adds">
          <span className="num">
            {pkg.hustlePct[0]}% to {pkg.hustlePct[1]}%
          </span>{" "}
          <span className="mut">of your weekly allowance</span>
        </Row>
      </ul>
      <h3 className="lr-group">Where you live and how you move</h3>
      <ul className="lr-rows">
        <Row i={n++} icon="hall" label="Places you can live">
          <span className="lr-chips">
            {pkg.hostels.map((h) => (
              <em key={h}>{h}</em>
            ))}
            {pkg.ojajaAt200 && (
              <em className="lr-later">
                <Icon name="lock" size={13} /> Ojaja at 200L
              </em>
            )}
          </span>
        </Row>
        <Row
          i={n++}
          icon={pkg.transport === "Trek" ? "trek" : "ride"}
          label="How you get around"
        >
          <span>{pkg.transport}</span>
        </Row>
      </ul>
      <p className="lr-note">
        {info.play} Call home once a week to keep the allowance whole: each
        missed week cuts the next one by 10%, up to 50%.
      </p>
    </div>
  );
}
const PARENT = (p) => (
  <>
    <span className="num">{PARENT_GIFT.chancePct}% chance</span> of{" "}
    <span className="num">{fmtN(p.gift)}</span>{" "}
    <span className="mut">once a week</span>
  </>
);
