// components/games/StakePicker.js: choosing a wager and seeing exactly what it means (what each player puts in, the prize pool, what the winner takes).
"use client";
import { STAKE_CHOICES } from "@/lib/games/index";
import { nairaOf } from "@/lib/games/gamesClient";

export default function StakePicker({ value, onChange, balanceKobo, disabled }) {
  const bal = BigInt(balanceKobo ?? 0);
  return (
    <div className="gm-stake">
      <div className="gm-chips" role="radiogroup" aria-label="Wager">
        {STAKE_CHOICES.map((n) => {
          const poor = BigInt(n) * 100n > bal;
          return (
            <button key={n} type="button" role="radio" aria-checked={value === n} className="gm-chip" data-on={value === n ? "1" : undefined} disabled={disabled || poor} onClick={() => onChange(n)} title={poor ? "You cannot afford that" : undefined}>
              {n === 0 ? "For fun" : nairaOf(n)}
            </button>
          );
        })}
      </div>
      <PrizeLine stake={value} />
    </div>
  );
}

/** "You put in ₦1,000 · Your rival puts in ₦1,000 · Prize pool ₦2,000" with the rules for a draw. */
export function PrizeLine({ stake }) {
  if (!stake) return <p className="gm-prize">A friendly game: nothing is at stake.</p>;
  return (
    <div className="gm-prize" aria-live="polite">
      <dl>
        <div><dt>You put in</dt><dd className="num">{nairaOf(stake)}</dd></div>
        <div><dt>Your rival puts in</dt><dd className="num">{nairaOf(stake)}</dd></div>
        <div className="gm-prize-pool"><dt>Winner takes</dt><dd className="num">{nairaOf(stake * 2)}</dd></div>
      </dl>
      <small>Both wagers are held from the moment the game starts, so neither of you can spend them elsewhere. A draw or a cancelled game returns both.</small>
    </div>
  );
}
