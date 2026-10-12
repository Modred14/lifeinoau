// components/HostelPicker.js
"use client";
import { useState } from "react";
import { Icon } from "./Icon";
import { CLASS_INFO, allowanceOf, fmtN } from "@/lib/classes.js";
import { rentOf } from "@/lib/rules.js";
import "./hostel-picker.css";

/** Choose where to live. Picking only selects; the move happens when the player confirms, because it can't be changed yet. */
export default function HostelPicker({ cls, hostels = [], busy, onChoose }) {
  const [pick, setPick] = useState(""),
    allowance = allowanceOf(cls),
    info = CLASS_INFO[cls];
  const list = [...hostels].sort((a, b) => rentOf(a) - rentOf(b)),
    rents = list.map(rentOf);
  // Only call out the cheapest or priciest place when exactly one of them is, otherwise the tag means nothing.
  const only = (v) =>
      list.length > 1 && rents.filter((r) => r === v).length === 1 ? v : null,
    cheapest = only(rents[0]),
    priciest = only(rents[rents.length - 1]);
  const kind = (h) =>
    h === "Off-campus" ? "Off campus" : h === "Ojaja" ? "" : "On campus";
  return (
    <div className="hp" style={{ "--cls": info?.color }}>
      <header className="hp-head">
        <h1>Where will you stay?</h1>
        <p className="mut">
          These are the places open to a <b className="hp-cls">{cls}</b>{" "}
          student. Rent comes out of your allowance every game week. Moving
          later isn't available yet, so choose with care.
        </p>
      </header>
      <div className="hp-grid" role="radiogroup" aria-label="Hostel">
        {list.map((h, i) => {
          const rent = rentOf(h),
            share = Math.max(1, Math.round((rent / allowance) * 100)),
            on = pick === h;
          return (
            <button
              key={h}
              type="button"
              role="radio"
              aria-checked={on}
              className="hp-card"
              disabled={busy}
              onClick={() => setPick(h)}
              style={{ "--i": i }}
            >
              <span className="hp-top">
                <span className="hp-ico">
                  <Icon name="hostel" size={22} />
                </span>
                <span className="hp-tags">
                  {kind(h) && <em>{kind(h)}</em>}
                  {rent === cheapest && (
                    <em className="hp-cheap">Lowest rent</em>
                  )}
                  {rent === priciest && <em>Highest rent</em>}
                </span>
              </span>
              <b className="hp-name">{h}</b>
              <span className="hp-rent">
                <b className="num">{fmtN(rent)}</b>{" "}
                <span className="mut">a week</span>
              </span>
              <span className="hp-share">
                <span className="hp-bar" aria-hidden="true">
                  <i style={{ width: Math.min(100, share) + "%" }} />
                </span>
                <span className="mut num">{share}% of your allowance</span>
              </span>
              <span className="hp-tick" aria-hidden="true">
                <Icon name="check" size={14} weight="bold" />
              </span>
            </button>
          );
        })}
      </div>
      <div className="hp-cta">
        <button
          type="button"
          className="go"
          disabled={!pick || busy}
          onClick={() => onChoose(pick)}
        >
          {busy ? (
            "Moving in…"
          ) : pick ? (
            <>
              Move into {pick} <Icon name="next" size={18} />
            </>
          ) : (
            "Pick a place to continue"
          )}
        </button>
      </div>
    </div>
  );
}
