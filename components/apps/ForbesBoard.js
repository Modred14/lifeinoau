// components/apps/ForbesBoard.js
// The FORBES OAU screen inside the phone: a podium for the richest three, then a ranked row for every player on the board.
// All data comes from /api/leaderboard?board=forbes (lib/leaderboards.js): order, ranks, names and money are the server's; nothing is re-sorted here.
// Profile pictures are the players' real 3D snapshots (components/PlayerAvatar.js).
"use client";
import { useId, useState } from "react";
import { naira } from "@/lib/client";
import { Icon } from "@/components/Icon";
import PlayerAvatar from "@/components/PlayerAvatar";
import { compactNaira, wealthShares, podiumSlots, sameName } from "@/lib/forbesFormat";
import "./forbes.css";

const PARTS = { cash: "Cash", business: "Business", investments: "Investments" };
const metal = (rank) => Math.min(Math.max(Number(rank) || 3, 1), 3); // 1 gold, 2 silver, 3 and below bronze: ties share a metal

function Crown() {
  return (
    <svg className="fb-crown" viewBox="0 0 48 34" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="fb-crown-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3c4" />
          <stop offset="1" stopColor="#d9a233" />
        </linearGradient>
      </defs>
      <path d="M3 27 7 9l11 10L24 4l6 15L41 9l4 18Z" fill="url(#fb-crown-g)" />
      <rect x="3" y="28" width="42" height="5" rx="2.5" fill="url(#fb-crown-g)" />
      <circle cx="7" cy="8" r="2.6" fill="#fff3c4" /><circle cx="24" cy="3.6" r="2.8" fill="#fff3c4" /><circle cx="41" cy="8" r="2.6" fill="#fff3c4" />
    </svg>
  );
}

const ClassChip = ({ cls }) => (cls ? <i className="fb-cls" data-cls={cls}>{cls}</i> : null);

function Podium({ rows }) {
  return (
    <ol className="fb-podium" aria-hidden="true">
      {podiumSlots(rows).map((slot, k) =>
        slot ? (
          <li key={slot.row.rank + slot.row.name} className="fb-pod" data-place={slot.place} data-metal={metal(slot.row.rank)}>
            {slot.row.rank === 1 && <Crown />}
            <span className="fb-ring"><PlayerAvatar name={slot.row.name} size="100%" className="pav-fill" /></span>
            <b className="fb-pod-name">{slot.row.name}</b>
            <span className="fb-pod-val num">{compactNaira(slot.row.value)}</span>
            <span className="fb-plinth"><b>{slot.row.rank}</b></span>
          </li>
        ) : (
          <li key={"empty" + k} className="fb-pod fb-pod-empty" />
        ),
      )}
    </ol>
  );
}

function Row({ r, index, me, open, onToggle }) {
  const id = useId(), shares = wealthShares(r), Hit = shares ? "button" : "div";
  const hit = shares ? { type: "button", onClick: onToggle, "aria-expanded": open, "aria-controls": id } : {};
  const sub = [r.faculty, r.graduated && "graduated"].filter(Boolean).join(" · ");
  return (
    <li className="fb-row" data-top={r.rank <= 3 ? metal(r.rank) : undefined} data-me={me ? "" : undefined} data-open={open ? "" : undefined} style={{ "--i": Math.min(index, 9) }}>
      <Hit className="fb-hit" {...hit}>
        <span className="fb-pos num">{r.rank}</span>
        <PlayerAvatar name={r.name} size={44} className="fb-av" />
        <span className="fb-id">
          <span className="fb-name"><b>{r.name}</b>{me && <i className="fb-you">You</i>}<ClassChip cls={r.class} /></span>
          {sub && <small>{sub}</small>}
        </span>
        <span className="fb-worth num" title={naira(r.value)}>
          {compactNaira(r.value)}
          {shares && <Icon name="down" size={14} weight="bold" />}
        </span>
      </Hit>
      {shares && (
        <div className="fb-detail" id={id} inert={open ? undefined : true}>
          <div className="fb-detail-in">
            <div className="fb-detail-pad">
              <div className="fb-bar" role="img" aria-label={shares.map((s) => `${PARTS[s.key]} ${Math.round(s.pct)}%`).join(", ")}>
                {shares.map((s) => <i key={s.key} data-k={s.key} style={{ width: open ? s.pct + "%" : "0%" }} />)}
              </div>
              <ul className="fb-legend">
                {shares.map((s) => (
                  <li key={s.key} data-k={s.key}>
                    <span>{PARTS[s.key]}</span>
                    <b className="num">{naira(s.kobo)}</b>
                    <em>{Math.round(s.pct)}%</em>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

function Hero({ count }) {
  return (
    <header className="fb-hero">
      <h3 className="fb-mark">Forbes OAU</h3>
      <p className="fb-tag">{count ? `The ${count === 1 ? "richest player" : `${count} richest players`} in Life in OAU` : "The richest players in Life in OAU"}</p>
    </header>
  );
}

/** Shown while the very first answer is on its way. */
export function ForbesSkeleton() {
  return (
    <div className="fb fb-skel" role="status" aria-live="polite" aria-busy="true">
      <Hero />
      <div className="fb-podium" aria-hidden="true">
        {[2, 1, 3].map((p) => <div key={p} className="fb-pod" data-place={p} data-metal={p}><span className="fb-ring" /><span className="fb-sk-line" /><span className="fb-plinth" /></div>)}
      </div>
      <div className="fb-sheet" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="fb-sk-row"><span className="fb-sk-dot" /><span className="fb-sk-av" /><span className="fb-sk-line" /></div>)}
      </div>
      <span className="lo-sr">Loading the richest players</span>
    </div>
  );
}

export default function ForbesBoard({ board, me }) {
  const [open, setOpen] = useState(null);
  const rows = Array.isArray(board?.rows) ? board.rows : [];
  const at = board?.updatedAt ? new Date(board.updatedAt) : null;
  const time = at && !isNaN(at) ? at.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" }) : null;
  return (
    <div className="fb">
      <Hero count={rows.length} />
      {rows.length ? (
        <>
          <Podium rows={rows} />
          <ol className="fb-sheet fb-list" aria-label="Richest players, ranked">
            {rows.map((r, i) => {
              const key = r.rank + ":" + r.name;
              return <Row key={key} r={r} index={i} me={sameName(r.name, me)} open={open === key} onToggle={() => setOpen(open === key ? null : key)} />;
            })}
          </ol>
        </>
      ) : (
        <div className="fb-sheet fb-empty">
          <Icon name="forbes" size={34} weight="duotone" />
          <b>No fortunes ranked yet</b>
          <p>Earn cash, run a business or invest. The richest players show up here.</p>
        </div>
      )}
      <p className="fb-foot">
        {board?.note}
        {time && <><br />Updated {time}. Refreshes about once a minute.</>}
      </p>
    </div>
  );
}
