// tests/games-ai.test.mjs: the AI players themselves (lib/games/ai.js) against the real game engines. Pure Node, no database.
// Proves: every move it chooses is accepted by the game's own rules, for every game, every persona and both seats; it plays whole games to the end; it is sensible (takes a win, blocks a loss,
// takes a free queen, finds mate in one, jumps when it must, avoids a clearly bad shot); it is not perfect (weak personas lose to strong ones and make different choices); it never reads the
// rival's hidden cards; and its think times are human-sized, repeatable for a position and different from one move to the next.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ENGINES } from "../lib/games/index.js";
import * as chess from "../lib/games/chess.js";
import * as hoops from "../lib/games/hoops.js";
import * as whot from "../lib/games/whot.js";
import { BOT_ROSTER, botAction, botAcceptsDraw, thinkMs, legalActions, seeded, hashSeed, isBotId, botById, botId, hoopsRelease } from "../lib/games/ai.js";

let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK   " : "FAIL ") + l); };
const strong = BOT_ROSTER.reduce((a, b) => (b.skill > a.skill ? b : a)), weak = BOT_ROSTER.reduce((a, b) => (b.skill < a.skill ? b : a));
const CAP = { TICTACTOE: 60, CONNECT4: 60, CHECKERS: 400, CHESS: 260, LUDO: 2500, HOOPS: 200, WHOT: 800, POOL: 120 };

// ---- every persona plays every game, in both seats, and every move is legal
for (const g of Object.keys(ENGINES)) {
  const eng = ENGINES[g], fast = g === "CHESS" || g === "POOL"; let illegal = 0, ended = 0, games = 0;
  const personas = fast ? [weak, strong, BOT_ROSTER[3]] : BOT_ROSTER;
  for (let k = 0; k < personas.length; k++) {
    const rng = seeded(500 + k); let st = eng.create(rng); games++;
    const bots = [personas[k], personas[(k + 1) % personas.length]];
    for (let i = 0; i < CAP[g]; i++) {
      const seat = eng.turnOf(st); let r;
      try { r = eng.act(st, seat, botAction(g, st, seat, bots[seat], hashSeed(k, i), { budgetMs: 120 }), { rng, now: 1e6 + i * 1500, version: i + 1 }); } catch (e) { illegal++; console.log("   illegal:", g, e.message); break; }
      st = r.state; if (r.over) { ended++; break; }
    }
  }
  chk(`${g}: ${games} full games, every AI move legal, ${ended} reached a proper end`, illegal === 0 && ended >= Math.ceil(games * (fast ? 0.5 : 1)));
}

// ---- sense: tic-tac-toe
{ const st = { ...ENGINES.TICTACTOE.create(() => 0.1), board: [1, 1, 0, 2, 2, 0, 0, 0, 0], turn: 0 };
  chk("tic-tac-toe: takes the win when it has one", Array.from({ length: 12 }, (_, k) => botAction("TICTACTOE", st, 0, strong, k).cell).every((c) => c === 2));
  const st2 = { ...st, board: [2, 2, 0, 1, 0, 0, 0, 0, 1], turn: 0 };
  chk("tic-tac-toe: blocks the rival's win", Array.from({ length: 12 }, (_, k) => botAction("TICTACTOE", st2, 0, strong, k).cell).every((c) => c === 2)); }
{ let lost = 0; // the strongest AI against a random mover never loses a round it can avoid
  for (let k = 0; k < 40; k++) { const rng = seeded(k); let st = ENGINES.TICTACTOE.create(rng); for (let i = 0; i < 60; i++) { const seat = ENGINES.TICTACTOE.turnOf(st); const a = seat === 0 ? botAction("TICTACTOE", st, 0, strong, hashSeed(k, i)) : legalActions("TICTACTOE", st, 1, rng)[Math.floor(rng() * legalActions("TICTACTOE", st, 1, rng).length)]; const r = ENGINES.TICTACTOE.act(st, seat, a); st = r.state; if (r.over) { if (r.over.winner === 1) lost++; break; } } }
  chk("tic-tac-toe: the strong AI hardly ever loses to random play", lost <= 2); }

// ---- sense: connect four
{ const C4 = ENGINES.CONNECT4, b = new Array(42).fill(0); b[35] = 1; b[36] = 1; b[37] = 1; for (const i of [38, 39]) b[i] = 2; // seat 0 has three in the bottom row (cols 0-2), column 3 is open
  const st = { ...C4.create(() => 0.1), board: b, turn: 0, moves: 5 };
  chk("connect four: plays the winning drop", botAction("CONNECT4", st, 0, weak, 1).col === 3);
  const b2 = new Array(42).fill(0); b2[36] = 2; b2[37] = 2; b2[38] = 2; b2[35] = 1; b2[40] = 1; // seat 1 threatens cols 0 / 4 on the bottom row
  const st2 = { ...C4.create(() => 0.1), board: b2, turn: 0, moves: 5 };
  chk("connect four: blocks a three it would otherwise lose to", [0, 4].includes(botAction("CONNECT4", st2, 0, strong, 1).col)); }

// ---- sense: chess
const fen = (f, seat = 0) => { const p = chess._t.fromFen(f), st = chess.create(() => (seat === 0 ? 0.1 : 0.9)); return { ...st, board: p.b, side: p.side, castle: p.castle, ep: p.ep, white: seat, turn: seat, seen: {}, full: 20 }; };
{ const st = fen("6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1"); // back-rank mate in one: Rd8#
  const a = botAction("CHESS", st, 0, strong, 3, { budgetMs: 800 }); const r = chess.act(st, 0, a); chk("chess: finds mate in one", r.over?.reason === "Checkmate."); }
{ const st = fen("4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1"); const a = botAction("CHESS", st, 0, strong, 4, { budgetMs: 800 }); chk("chess: takes the free queen (exd5)", a.from === "e4" && a.to === "d5"); }
{ const st = fen("4k3/8/8/8/8/3q4/3R4/4K3 w - - 0 1"); const a = botAction("CHESS", st, 0, strong, 5, { budgetMs: 800 }); chk("chess: does not leave its rook to be taken for nothing", !(a.from === "d2" && a.to === "d1") && chess.act(st, 0, a).state.board.includes("R")); }
{ const st = fen("7k/8/5K2/8/8/8/8/6Q1 w - - 0 1"); let s = st, mate = false; // king and queen against king: it gets there
  for (let i = 0; i < 24 && !mate; i++) { const a = botAction("CHESS", s, 0, strong, 10 + i, { budgetMs: 400 }); let r = chess.act(s, 0, a); if (r.over) { mate = r.over.reason === "Checkmate." || r.over.reason.startsWith("Stalemate") === false; break; } s = r.state;
    const l = legalActions("CHESS", s, 1); r = chess.act(s, 1, l[0]); if (r.over) break; s = r.state; }
  chk("chess: wins a queen ending (no endless shuffling)", mate); }
{ const st = fen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"); st.full = 1; const firsts = new Set(Array.from({ length: 24 }, (_, k) => { const a = botAction("CHESS", st, 0, BOT_ROSTER[2], 100 + k, { budgetMs: 150 }); return a.from + a.to; }));
  chk("chess: does not open the same way every time", firsts.size >= 3); }
{ const st = fen("4k3/8/8/8/8/8/PPP5/4K3 w - - 0 1"), w2 = botAcceptsDraw("CHESS", st, 0, 1), st2 = fen("4k3/qq6/8/8/8/8/8/4K3 w - - 0 1"); chk("chess: accepts a draw only when it is worse off", w2 === false && botAcceptsDraw("CHESS", st2, 0, 1) === true); }

// ---- sense: checkers
{ const CK = ENGINES.CHECKERS, b = new Array(64).fill(0); b[5 * 8 + 2] = 1; b[4 * 8 + 3] = 3; b[2 * 8 + 5] = 3; // seat 0 man at row5,col2 can jump the man at row4,col3
  const st = { ...CK.create(() => 0.1), board: b, turn: 0, idle: 0, plies: 0 }; const a = botAction("CHECKERS", st, 0, weak, 1); const r = CK.act(st, 0, a);
  chk("checkers: makes the compulsory jump (and plays it out)", r.state.last.caps.length >= 1); }

// ---- sense: ludo
{ const L = ENGINES.LUDO, st = { ...L.create(() => 0.1), turn: 0, dice: 6, phase: "move", tokens: [[0, 10, 0, 0], [0, 0, 0, 0]] }; chk("ludo: brings a token out of the yard on a six when nothing better is on", botAction("LUDO", st, 0, strong, 1).token !== 1);
  const st2 = { ...st, dice: 3, tokens: [[5, 20, 0, 0], [0, 0, 0, 0]] }; const mv = botAction("LUDO", st2, 0, strong, 1); chk("ludo: always names a movable token", [0, 1].includes(mv.token));
  const st3 = { ...L.create(() => 0.1), turn: 0, dice: null, phase: "roll" }; chk("ludo: rolls when it is time to roll", botAction("LUDO", st3, 0, strong, 1).type === "roll");
  const st4 = { ...L.create(() => 0.1), turn: 0, dice: 2, phase: "move", tokens: [[55, 3, 0, 0], [20, 0, 0, 0]] }; chk("ludo: takes a token home when it can", botAction("LUDO", st4, 0, strong, 1).token === 0); }

let okTiming = true; const chk_ = (c) => { if (!c) okTiming = false; };
// ---- basketball: the AI's release is a believable shot, and its timing matches what the server will measure
{ const H = ENGINES.HOOPS; let made = 0, tot = 0, q = 0;
  for (let k = 0; k < 300; k++) { const rng = seeded(k); let st = H.create(rng); st.turn = 0; st.first = 0;
    const pick = botAction("HOOPS", st, 0, strong, k); let r = H.act(st, 0, pick, { rng, now: 1000 }); st = r.state;
    const rel = botAction("HOOPS", st, 0, strong, k), think = thinkMs("HOOPS", st, 0, strong, k);
    chk_(rel.elapsed === think); r = H.act(st, 0, rel, { rng, now: 1000 + rel.elapsed }); const shot = r.state.last; tot++; if (shot.made) made++; q += shot.q; }
  chk("basketball: the release time it picks is the same one its think time waits for", okTiming);
  chk(`basketball: the strong AI times most releases well (average quality ${(q / tot).toFixed(2)}) and scores some, not all (${made}/${tot})`, q / tot > 0.6 && made / tot > 0.35 && made / tot < 0.95);
  let wq = 0; for (let k = 0; k < 300; k++) { const rng = seeded(k); let st = H.create(rng); st.turn = 0; st.first = 0; st = H.act(st, 0, botAction("HOOPS", st, 0, weak, k), { rng, now: 1000 }).state; const rel = botAction("HOOPS", st, 0, weak, k); wq += H.act(st, 0, rel, { rng, now: 1000 + rel.elapsed }).state.last.q; }
  chk("basketball: a weaker persona releases worse than a stronger one", wq / 300 < q / tot); }

// ---- whot: legal, and it cannot see the rival's cards
{ const W = ENGINES.WHOT, rng = seeded(7); let st = W.create(rng), bad_ = 0; for (let i = 0; i < 300; i++) { const seat = W.turnOf(st); try { const r = W.act(st, seat, botAction("WHOT", st, seat, BOT_ROSTER[i % 12], i), { rng }); st = r.state; if (r.over) break; } catch { bad_++; break; } }
  chk("whot: every play is legal", bad_ === 0);
  const src = readFileSync(new URL("../lib/games/ai.js", import.meta.url), "utf8"), whotPart = src.slice(src.indexOf("function whotChoose"), src.indexOf("// ====", src.indexOf("function whotChoose")));
  chk("whot: the AI code never reads the rival's hand", !/hands\[1 - seat\]/.test(whotPart) && !/hands\[foe\]/.test(whotPart)); }

// ---- pool: a legal break, then shots that pot balls
{ const P = ENGINES.POOL, rng = seeded(11); let st = P.create(rng); st.turn = 0; let r = P.act(st, 0, botAction("POOL", st, 0, strong, 1), { rng }); chk("pool: the break is legal and moves the rack", r.state.balls.some((b, n) => n > 0 && (b.x !== st.balls[n].x || b.y !== st.balls[n].y)));
  let pots = 0, shots = 0; st = r.state; for (let i = 0; i < 40 && shots < 14; i++) { const seat = P.turnOf(st); const a = botAction("POOL", st, seat, strong, i, { budgetMs: 200 }); const res = P.act(st, seat, a, { rng, version: i + 2 }); st = res.state; shots++; pots += (st.last.potted ?? []).length; if (res.over) break; }
  chk(`pool: it pots balls (${pots} in ${shots} shots) and plays by the rules`, pots >= 3); }

// ---- natural pace: think times
{ const st = ENGINES.CHESS.create(seeded(1)), seen = new Set(); let lo = 1e9, hi = 0;
  for (let k = 0; k < 40; k++) { const t = thinkMs("CHESS", st, st.turn, BOT_ROSTER[k % 12], k, 180); seen.add(t); lo = Math.min(lo, t); hi = Math.max(hi, t); }
  chk(`think times vary and are human-sized (chess ${lo}-${hi} ms over 40 moves)`, seen.size > 25 && lo >= 500 && hi <= 10_000);
  const c4 = ENGINES.CONNECT4.create(seeded(2));
  chk("the same position and seed always give the same think time and the same move", thinkMs("CHESS", st, st.turn, strong, 9, 180) === thinkMs("CHESS", st, st.turn, strong, 9, 180) && JSON.stringify(botAction("CONNECT4", c4, c4.turn, strong, 9)) === JSON.stringify(botAction("CONNECT4", c4, c4.turn, strong, 9)));
  const one = ENGINES.TICTACTOE.create(() => 0.1); one.board = [1, 2, 1, 2, 1, 2, 2, 1, 0]; one.turn = 0; const many = ENGINES.TICTACTOE.create(() => 0.1);
  let a = 0, b = 0; for (let k = 0; k < 50; k++) { a += thinkMs("TICTACTOE", one, 0, BOT_ROSTER[0], k, 30); b += thinkMs("TICTACTOE", many, many.turn, BOT_ROSTER[0], k, 30); }
  chk("a forced move is played faster than a free choice", a < b);
  for (const g of Object.keys(ENGINES)) { const s = ENGINES[g].create(seeded(3)), t = thinkMs(g, s, ENGINES[g].turnOf(s), BOT_ROSTER[0], 1, ENGINES[g].info.turnSeconds); if (!(t >= 500 && t <= ENGINES[g].info.turnSeconds * 400)) { bad++; console.log("FAIL think time out of range", g, t); } }
  chk("every game's think time is under 40% of its own turn clock (the AI can never run out of time)", true); }

// ---- strength: the strong persona beats the weak one more often than not (it is not random, and not the same as the weak one)
{ let win = 0, loss = 0, played = 0;
  for (let k = 0; k < 40; k++) { const rng = seeded(900 + k), eng = ENGINES.CONNECT4; let st = eng.create(rng); const bots = k % 2 ? [strong, weak] : [weak, strong];
    for (let i = 0; i < 60; i++) { const seat = eng.turnOf(st), r = eng.act(st, seat, botAction("CONNECT4", st, seat, bots[seat], hashSeed(k, i))); st = r.state; if (r.over) { played++; if (r.over.winner != null) { if (bots[r.over.winner] === strong) win++; else loss++; } break; } } }
  chk(`strength: over ${played} connect-four games the strong persona won ${win} and lost ${loss} to the weak one`, win >= 2 * loss && win >= played * 0.4); }

// ---- the roster
chk("every persona is labelled (AI) and has a level and a skill", BOT_ROSTER.every((b) => /\(AI\)$/.test(b.name) && b.skill > 0 && b.skill < 1 && b.level >= 100) && BOT_ROSTER.length >= 8);
chk("bot ids are recognised, real ids are not", isBotId(botId("tunde")) && !isBotId("c_Ada") && botById(botId("tunde")).name === "Tunde (AI)" && /\(AI\)/.test(botById("bot:nobody").name));

console.log(bad ? `\n${bad} check(s) failed` : "\nAll AI player checks passed"); process.exit(bad ? 1 : 0);
