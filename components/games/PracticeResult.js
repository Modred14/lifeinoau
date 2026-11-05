// components/games/PracticeResult.js: the small centred result card shown when a practice game against the computer ends (nothing was at stake, so there is no money line).
"use client";

export default function PracticeResult({ head, tone, reason, onAgain, onExit }) {
  return (
    <div className="gm-result" data-tone={tone} role="dialog" aria-modal="true" aria-label="Game result">
      <div className="gm-result-card">
        <h3>{head}</h3>
        {reason && <p className="gm-reason">{reason}</p>}
        <button type="button" className="gm-btn gm-btn-go gm-btn-wide" onClick={onAgain} autoFocus>Play again</button>
        <button type="button" className="gm-link" onClick={onExit}>Back to games</button>
      </div>
    </div>
  );
}
