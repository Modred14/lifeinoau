// components/bet/Lobby.js: the game list of the Bet app. It is the home screen of the app and it stays inside the phone;
// picking a game opens that game full screen (see BetApp.js and the "full screen" section of bet.css).
"use client";
import { Icon } from "../Icon";

export default function Lobby({ games, bets, open, onPick }) {
  const row = (g, badge) => (
    <li key={g.id}>
      <button type="button" className="bt-game" data-game={g.id} onClick={() => onPick(g.id)} aria-label={badge ? `${g.name}, ${badge} open` : g.name}>
        <span className="bt-game-i" aria-hidden="true"><Icon name={g.icon} size={26} weight="fill" /></span>
        <span className="bt-game-t"><b>{g.name}</b><small>{g.blurb}</small></span>
        {badge ? <i className="bt-dot" aria-hidden="true">{badge}</i> : null}
        <Icon name="caret" size={18} weight="bold" />
      </button>
    </li>
  );
  return (
    <div className="bt-scroll bt-lobby">
      <ul className="bt-games" aria-label="Games">{games.map((g) => row(g))}</ul>
      <ul className="bt-games bt-games-alt" aria-label="Your slips">{row(bets, open > 0 ? open : 0)}</ul>
      <p className="fine">18+ · Games are simulated and use only your in-game cash.</p>
    </div>
  );
}
