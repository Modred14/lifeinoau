// components/apps/GamesApp.js: the Games app (lives inside the phone, see components/Phone.js).
// Pick a game, then challenge a friend by character name or look for a random opponent, agree a wager (or play for fun), play, and rematch. Everything that matters is decided by
// the server (lib/games/matchService.js): this screen only asks, shows and sends moves.
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../Icon";
import { call, notifyError } from "@/lib/client";
import { toast } from "@/lib/toast";
import { gamesGet, gamesPost, koboNaira, nairaOf } from "@/lib/games/gamesClient";
import StakePicker from "../games/StakePicker";
import MatchScreen from "../games/MatchScreen";
import WhotPractice from "../games/WhotPractice";
import "../games/games.css";

const TONE = { LUDO: "#d64545", CHESS: "#7d8aa5", POOL: "#1f8a4c", HOOPS: "#e8742d", CHECKERS: "#a15c2e", CONNECT4: "#3f7fd6", TICTACTOE: "#8a5cd6", WHOT: "#9c1c2b" };

/** A tiny picture for each game's tile (drawn here, no image files). */
function GameGlyph({ id }) {
  const c = TONE[id];
  return (
    <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true" focusable="false">
      <rect width="48" height="48" rx="12" fill={c} />
      {id === "LUDO" && <g fill="#fff"><rect x="9" y="9" width="12" height="12" rx="3" opacity=".95" /><rect x="27" y="27" width="12" height="12" rx="3" opacity=".6" /><circle cx="15" cy="15" r="3" fill={c} /><circle cx="33" cy="33" r="3" fill={c} /><rect x="27" y="9" width="12" height="12" rx="3" opacity=".35" /><rect x="9" y="27" width="12" height="12" rx="3" opacity=".35" /></g>}
      {id === "CHESS" && <g fill="#fff"><path d="M24 9a4 4 0 0 1 4 4c0 1.5-.8 2.7-2 3.4V19h4v3h-3.2c.9 4 3.2 5.6 3.2 9v2h4v5H14v-5h4v-2c0-3.4 2.3-5 3.2-9H18v-3h4v-2.6c-1.2-.7-2-1.9-2-3.4a4 4 0 0 1 4-4z" /></g>}
      {id === "POOL" && <g><circle cx="24" cy="24" r="14" fill="#15171c" /><circle cx="24" cy="24" r="6.5" fill="#fff" /><text x="24" y="28" textAnchor="middle" fontSize="10" fontWeight="700" fill="#15171c">8</text></g>}
      {id === "HOOPS" && <g><circle cx="24" cy="24" r="14" fill="#fff" opacity=".95" /><path d="M10 24h28M24 10v28M14 14c6 6 6 14 0 20M34 14c-6 6-6 14 0 20" stroke={c} strokeWidth="2" fill="none" /></g>}
      {id === "CHECKERS" && <g><circle cx="17" cy="18" r="7" fill="#fff" /><circle cx="31" cy="30" r="7" fill="#15171c" /><circle cx="17" cy="18" r="3.4" fill="none" stroke={c} strokeWidth="1.6" /></g>}
      {id === "CONNECT4" && <g><circle cx="15" cy="15" r="4.6" fill="#fff" /><circle cx="24" cy="15" r="4.6" fill="#ffd24d" /><circle cx="33" cy="15" r="4.6" fill="#fff" /><circle cx="15" cy="26" r="4.6" fill="#ffd24d" /><circle cx="24" cy="26" r="4.6" fill="#fff" /><circle cx="33" cy="26" r="4.6" fill="#ffd24d" /><circle cx="24" cy="37" r="4.6" fill="#fff" /></g>}
      {id === "TICTACTOE" && <g stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none"><path d="M18 10v28M30 10v28M10 18h28M10 30h28" opacity=".55" /><path d="M12 12l5 5M17 12l-5 5" /><circle cx="24" cy="24" r="3.4" /></g>}
      {id === "WHOT" && <g><rect x="13" y="8" width="22" height="32" rx="4" fill="#fffaf0" transform="rotate(-10 24 24)" /><rect x="13" y="8" width="22" height="32" rx="4" fill="#fffaf0" transform="rotate(10 24 24)" /><polygon points="24,14 27,21 34,22 29,27 30.5,34 24,30.5 17.5,34 19,27 14,22 21,21" fill={c} /></g>}
    </svg>
  );
}

/** The number on the phone icon: challenges waiting for you, plus a match where it is your move. Polls gently, and only while the phone is open. */
export function useGamesBadge(open) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!open) return;
    let off = false, t;
    const run = async () => {
      const r = await gamesGet(); if (off) return;
      if (r?.games) setN((r.incoming?.length ?? 0) + (r.rematch?.live && !r.rematch.byMe ? 1 : 0) + (r.active?.yourTurn ? 1 : 0));
      t = setTimeout(run, 20_000);
    };
    run(); return () => { off = true; clearTimeout(t); };
  }, [open]);
  return n;
}

export default function GamesApp({ onHome }) {
  const [lobby, setLobby] = useState(null), [tab, setTab] = useState("play"), [setup, setSetup] = useState(null), [matchId, setMatchId] = useState(null), [err, setErr] = useState(null), [busy, setBusy] = useState(false), [practice, setPractice] = useState(false);
  const alive = useRef(true), timer = useRef(0), searching = useRef(false);

  const load = useCallback(async () => {
    clearTimeout(timer.current);
    const r = await gamesGet(); if (!alive.current) return;
    if (r?.games) { setLobby(r); setErr(null); searching.current = !!r.queue; } else if (r?.error) setErr(r.error);
    timer.current = setTimeout(load, searching.current ? 1500 : document.hidden ? 15_000 : 4000);
  }, []);
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; clearTimeout(timer.current); }; }, [load]);
  // a random search that found someone opens the match by itself
  const wasSearching = useRef(false);
  useEffect(() => {
    if (!lobby) return;
    if (wasSearching.current && !lobby.queue && lobby.active && !matchId) { setMatchId(lobby.active.id); toast.success(`Opponent found: ${lobby.active.opponent}. Game on!`); }
    wasSearching.current = !!lobby.queue;
  }, [lobby, matchId]);

  const run = async (op, body, after) => {
    setBusy(true); const r = await gamesPost(op, body); setBusy(false);
    if (r.error || r.failed) { notifyError(r); load(); return null; }
    after?.(r); load(); return r;
  };
  const openMatch = useCallback((id) => { setSetup(null); setMatchId(String(id)); load(); }, [load]);
  const leave = useCallback(() => { setMatchId(null); load(); }, [load]);

  if (practice) return <div className="gm"><WhotPractice onExit={() => setPractice(false)} /></div>;
  if (matchId) return <div className="gm"><MatchScreen id={matchId} onExit={leave} onOpen={openMatch} balanceKobo={lobby?.balanceKobo} /></div>;

  return (
    <div className="gm">
      <header className="gm-head">
        <button type="button" className="gm-back" onClick={setup ? () => setSetup(null) : onHome} aria-label={setup ? "Back to games" : "Back to home screen"}><Icon name="back" size={22} weight="bold" /></button>
        <h2>{setup ? setup.gameName : "Games"}</h2>
        {lobby && <span className="gm-wallet" aria-label="Your cash"><Icon name="coins" size={15} weight="fill" /><b className="num">{koboNaira(lobby.balanceKobo)}</b></span>}
      </header>
      {err && !lobby && <div className="gm-pad"><p className="gm-note">{err}</p><button type="button" className="gm-btn" onClick={load}>Try again</button></div>}
      {!lobby && !err && <div className="gm-pad gm-center"><i className="gm-spin" aria-hidden="true" /></div>}
      {lobby && setup && <Setup key={setup.id} game={setup} lobby={lobby} busy={busy} run={run} openMatch={openMatch} onPractice={() => setPractice(true)} />}
      {lobby && !setup && (
        <>
          <nav className="gm-tabs" aria-label="Games sections">
            {[["play", "Play"], ["inbox", `Challenges${lobby.incoming.length + (lobby.rematch?.live && !lobby.rematch.byMe ? 1 : 0) ? ` (${lobby.incoming.length + (lobby.rematch?.live && !lobby.rematch.byMe ? 1 : 0)})` : ""}`], ["history", "History"]].map(([k, label]) => (
              <button key={k} type="button" data-on={tab === k ? "1" : undefined} onClick={() => setTab(k)}>{label}</button>
            ))}
          </nav>
          <div className="gm-scroll">
            {lobby.active && (
              <div className="gm-banner" role="status">
                <div><b>Match in progress</b><small>{lobby.active.gameName} vs {lobby.active.opponent}{lobby.active.stakeKobo !== "0" ? ` · ${koboNaira(lobby.active.stakeKobo)} each` : ""}{lobby.active.yourTurn ? " · your move" : ""}</small></div>
                <button type="button" className="gm-btn gm-btn-sm gm-btn-go" onClick={() => openMatch(lobby.active.id)}>Play</button>
              </div>
            )}
            {lobby.queue && (
              <div className="gm-search" role="status" aria-live="polite">
                <span className="gm-radar" aria-hidden="true"><i /><i /><i /></span>
                <div><b>Looking for an opponent…</b><small>{lobby.queue.gameName} · {lobby.queue.stakeKobo === "0" ? "for fun" : `${koboNaira(lobby.queue.stakeKobo)} wager`}. We will start the game the moment someone matching joins.</small></div>
                <button type="button" className="gm-btn gm-btn-sm" disabled={busy} onClick={() => run("unqueue", {}, (r) => { if (r.matched) openMatch(r.id); else toast.info("Search cancelled."); })}>Cancel</button>
              </div>
            )}
            {tab === "play" && (
              <>
                <p className="gm-lead">Pick a game. Play a friend or a random player, for fun or for a wager.</p>
                <div className="gm-grid">
                  {lobby.games.map((g) => (
                    <button key={g.id} type="button" className="gm-tile" onClick={() => setSetup(g)} disabled={!!lobby.active}>
                      <GameGlyph id={g.id} /><b>{g.name}</b><small>{g.blurb}</small>
                    </button>
                  ))}
                </div>
                {lobby.active && <p className="gm-note">Finish your current match to start another.</p>}
              </>
            )}
            {tab === "inbox" && <Inbox lobby={lobby} busy={busy} run={run} openMatch={openMatch} />}
            {tab === "history" && <History lobby={lobby} />}
          </div>
        </>
      )}
    </div>
  );
}

function Setup({ game, lobby, busy, run, openMatch, onPractice }) {
  const [mode, setMode] = useState("friend"), [name, setName] = useState(""), [stake, setStake] = useState(0), [sugg, setSugg] = useState([]), [chosen, setChosen] = useState(false);
  const recent = [...new Set(lobby.history.map((h) => h.opponent))].slice(0, 5);
  useEffect(() => {
    if (mode !== "friend" || chosen || name.trim().length < 2) { setSugg([]); return; }
    let off = false; const t = setTimeout(async () => { const r = await call(`/api/players?q=${encodeURIComponent(name.trim())}`); if (!off && r?.players) setSugg(r.players.filter((p) => p.name.toLowerCase() !== lobby.name.toLowerCase()).slice(0, 5)); }, 250);
    return () => { off = true; clearTimeout(t); };
  }, [name, mode, chosen, lobby.name]);
  const poor = BigInt(stake) * 100n > BigInt(lobby.balanceKobo);
  const go = () => {
    if (mode === "friend") { if (!name.trim()) { toast.error("Type your friend's character name."); return; } run("challenge", { to: name.trim(), game: game.id, stakeNaira: stake }, (r) => { toast.success(`Challenge sent to ${r.to ?? name.trim()}. They have 10 minutes to answer.`); }); }
    else run("queue", { game: game.id, stakeNaira: stake }, (r) => { if (r.matched) openMatch(r.id); else toast.info("Searching for an opponent…"); });
  };
  return (
    <div className="gm-scroll gm-setup">
      <div className="gm-setup-hero"><GameGlyph id={game.id} /><p>{game.blurb}</p></div>
      {game.id === "WHOT" && <button type="button" className="gm-btn gm-btn-wide" onClick={onPractice}>Practice against the computer<small>For fun: nothing at stake and nothing saved</small></button>}
      <div className="gm-seg" role="tablist" aria-label="Who to play">
        <button type="button" role="tab" aria-selected={mode === "friend"} data-on={mode === "friend" ? "1" : undefined} onClick={() => setMode("friend")}>Challenge a friend</button>
        <button type="button" role="tab" aria-selected={mode === "random"} data-on={mode === "random" ? "1" : undefined} onClick={() => setMode("random")}>Random opponent</button>
      </div>
      {mode === "friend" ? (
        <div className="gm-field">
          <label htmlFor="gm-friend">Friend's character name</label>
          <input id="gm-friend" value={name} onChange={(e) => { setName(e.target.value); setChosen(false); }} placeholder="Start typing a name" autoComplete="off" maxLength={20} />
          {sugg.length > 0 && <ul className="gm-sugg">{sugg.map((p) => <li key={p.name}><button type="button" onClick={() => { setName(p.name); setChosen(true); setSugg([]); }}><b>{p.name}</b><small>{p.level}L · {p.faculty}</small></button></li>)}</ul>}
          {recent.length > 0 && !name && <div className="gm-recent"><small>Recent opponents</small>{recent.map((r) => <button key={r} type="button" className="gm-chip" onClick={() => { setName(r); setChosen(true); }}>{r}</button>)}</div>}
        </div>
      ) : <p className="gm-note">We will pair you with another player who picked the same game and the same wager. You wait here while we look; you can cancel any time.</p>}
      <div className="gm-field"><label>Wager (each player)</label><StakePicker value={stake} onChange={setStake} balanceKobo={lobby.balanceKobo} disabled={busy} /></div>
      <button type="button" className="gm-btn gm-btn-go gm-btn-wide" disabled={busy || poor || !!lobby.active || !!lobby.queue} onClick={go}>{mode === "friend" ? "Send challenge" : "Find a player"}{stake ? ` · ${nairaOf(stake)}` : ""}</button>
      {lobby.queue && <p className="gm-note">You are already searching. Cancel that search first.</p>}
      {mode === "friend" && <p className="gm-note">Nothing is taken until your friend accepts. If they cannot afford the wager or are already playing, they will be told.</p>}
    </div>
  );
}

function Inbox({ lobby, busy, run, openMatch }) {
  const nothing = !lobby.incoming.length && !lobby.outgoing.length && !(lobby.rematch?.live);
  return (
    <>
      {lobby.rematch?.live && !lobby.rematch.byMe && (
        <div className="gm-card"><b>Rematch request</b><p>{lobby.rematch.opponent} wants to play {lobby.rematch.gameName} again{lobby.rematch.stakeNaira ? ` for ${nairaOf(lobby.rematch.stakeNaira)} each (winner takes ${nairaOf(lobby.rematch.stakeNaira * 2)})` : " for fun"}.</p>
          <div className="gm-row"><button type="button" className="gm-btn gm-btn-sm gm-btn-go" disabled={busy || !!lobby.active} onClick={() => run("rematchReply", { matchId: lobby.rematch.matchId, accept: true }, (r) => r.id && openMatch(r.id))}>Accept</button>
            <button type="button" className="gm-btn gm-btn-sm" disabled={busy} onClick={() => run("rematchReply", { matchId: lobby.rematch.matchId, accept: false })}>Decline</button></div></div>
      )}
      {lobby.incoming.map((c) => (
        <div key={c.id} className="gm-card">
          <b>{c.from} challenged you</b>
          <p>{c.gameName} · {c.stakeKobo === "0" ? "just for fun" : `${koboNaira(c.stakeKobo)} each, winner takes ${koboNaira(c.poolKobo)}`}</p>
          <div className="gm-row"><button type="button" className="gm-btn gm-btn-sm gm-btn-go" disabled={busy || !!lobby.active} onClick={() => run("respond", { matchId: c.id, accept: true }, (r) => r.started && openMatch(r.id ?? c.id))}>Accept</button>
            <button type="button" className="gm-btn gm-btn-sm" disabled={busy} onClick={() => run("respond", { matchId: c.id, accept: false })}>Decline</button></div>
          {lobby.active && <small>Finish your current match before accepting.</small>}
        </div>
      ))}
      {lobby.outgoing.map((c) => (
        <div key={c.id} className="gm-card gm-card-quiet">
          <b>Waiting for {c.to}</b><p>{c.gameName} · {c.stakeKobo === "0" ? "for fun" : `${koboNaira(c.stakeKobo)} each`}</p>
          <button type="button" className="gm-btn gm-btn-sm" disabled={busy} onClick={() => run("withdraw", { matchId: c.id })}>Withdraw</button>
        </div>
      ))}
      {nothing && <p className="gm-empty">No challenges right now. Challenge a friend from the Play tab.</p>}
    </>
  );
}

function History({ lobby }) {
  const [h, setH] = useState(null);
  useEffect(() => { let off = false; gamesGet("history=1").then((r) => { if (!off && r?.history) setH(r); }); return () => { off = true; }; }, []);
  const rows = h?.history ?? lobby.history;
  if (!rows.length) return <p className="gm-empty">No games played yet.</p>;
  const t = h?.totals;
  return (
    <>
      {t && <div className="gm-totals"><div><b className="num">{t.played}</b><small>played</small></div><div><b className="num">{t.won}</b><small>won</small></div><div><b className="num">{t.lost}</b><small>lost</small></div><div><b className="num" data-neg={BigInt(t.netKobo) < 0n ? "1" : undefined}>{BigInt(t.netKobo) > 0n ? "+" : ""}{koboNaira(t.netKobo)}</b><small>net</small></div></div>}
      <ul className="gm-hist">
        {rows.map((r) => (
          <li key={r.id} data-o={r.outcome}>
            <span className="gm-hist-r">{r.outcome === "WON" ? "Won" : r.outcome === "LOST" ? "Lost" : r.outcome === "DRAW" ? "Draw" : "Void"}</span>
            <div><b>{r.gameName} vs {r.opponent}</b><small>{new Date(r.at).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {r.mode === "FRIEND" ? "friend" : r.mode === "RANDOM" ? "random" : "rematch"}{r.reason ? ` · ${r.reason}` : ""}</small></div>
            <em className="num" data-neg={r.netKobo.startsWith("-") ? "1" : undefined}>{r.stakeKobo === "0" ? "–" : `${BigInt(r.netKobo) > 0n ? "+" : ""}${koboNaira(r.netKobo)}`}</em>
          </li>
        ))}
      </ul>
    </>
  );
}
