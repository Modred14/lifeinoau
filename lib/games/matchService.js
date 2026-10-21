// lib/games/matchService.js  (SERVER ONLY)
// Two-player matches with wagers: friend challenges, random opponents, rematches, the moves themselves and the money.
//
// The rules this file keeps, whatever a browser sends:
//  - The SERVER owns the game. A player sends a move; the engine (lib/games/<game>.js) checks it and produces the next state. A result is never accepted from a player.
//  - A wager is taken from BOTH players into the GAMES system account in the same database transaction that starts the match. It is therefore not in either
//    player's balance for the whole game (it cannot be spent, sent or staked anywhere else). It leaves GAMES exactly once, when the match is settled:
//    the winner receives the whole pool, or each player gets their own stake back (a draw, an agreed cancel, a void). Every ledger key is derived from the match id,
//    so even a repeated settlement could not pay twice; and settlement only runs on an ACTIVE match whose row is locked, so it runs once.
//  - A player can be in one running match at a time (GameSeat has the player as its primary key) and can wait in the random queue only once (GameQueue likewise).
//  - Time is the server's. The player to move has the game's turn time; when it runs out they lose on time. A player who simply drops off for a few seconds loses nothing.
//    Matches nobody is watching are settled the next time anyone opens the lobby, and any match older than MATCH_HARD_CAP_MS is voided with every stake returned.
import { randomInt } from "node:crypto";
import { loadLocked, GameError } from "../gameService.js";
import { transferInTx, InsufficientFunds } from "../ledger.js";
import { currentWeek } from "../clock.js";
import { isExpelled, isSuspended, isJailed } from "../discipline.js";
import { ENGINES, GAME_LIST, isGame, cleanStake, poolOf, STAKE_CHOICES, MIN_STAKE_NAIRA, MAX_STAKE_NAIRA, INVITE_MS, QUEUE_MS, REMATCH_MS, MATCH_HARD_CAP_MS, WAGERS_IN_CUSTODY } from "./index.js";
import { RuleError } from "./errors.js";

const KEEP_RIDS = 40;
const rng = () => randomInt(0, 2 ** 32) / 2 ** 32;
const s = (k) => (k ?? 0n).toString();
const naira = (k) => "₦" + (BigInt(k) / 100n).toLocaleString("en-NG");
const needReq = (id) => { if (!/^[\w-]{8,64}$/.test(id ?? "")) throw new GameError("Missing requestId."); };
const gameName = (g) => ENGINES[g].info.name;

/** The escrow account. Read first so the upsert only ever runs the very first time. */
export const gamesAccount = async (tx) => (await tx.account.findUnique({ where: { systemName: "GAMES" } })) ?? tx.account.upsert({ where: { systemName: "GAMES" }, update: {}, create: { kind: "SYSTEM", systemName: "GAMES" } });
/** Starting a match is rare, so every start takes this one lock: "is anybody busy?" is then answered truthfully, and two starts can never share a player. */
const startLock = (tx) => tx.$queryRaw`SELECT pg_advisory_xact_lock(7771001)::text AS l`;
const lockMatch = async (tx, id) => { await tx.$queryRaw`SELECT id FROM "GameMatch" WHERE id=${id} FOR UPDATE`; return tx.gameMatch.findUnique({ where: { id } }); };
const note = (tx, characterId, body) => tx.notification.create({ data: { characterId, kind: "GAME", body } });
const parseId = (v) => { if (!/^\d{1,15}$/.test(String(v ?? ""))) throw new GameError("That match could not be found.", 404); return BigInt(v); };
const seatOf = (m, charId) => (m.hostId === charId ? 0 : m.guestId === charId ? 1 : -1);
const idOf = (m, seat) => (seat === 0 ? m.hostId : m.guestId);
const blockedPair = (tx, a, b) => tx.block.findFirst({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } });
const nameMap = async (tx, ids) => new Map((await tx.character.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, level: true } })).map((c) => [c.id, c]));

/** The player behind a login, without locking anything (used to read and to play moves). */
async function whoIs(tx, userId) {
  const c = await tx.character.findUnique({ where: { userId }, select: { id: true, name: true } });
  if (!c) throw new GameError("Create a character first.", 404);
  return c;
}
/** Can this player start or accept a match right now? (expelled, suspended, or in custody when wagers are not allowed there). */
function eligible(c, stakeKobo, now, you = true) {
  const who = you ? "You are" : `${c.name} is`;
  if (isExpelled(c, now)) throw new GameError(`${who} not allowed to play games right now.`, 403);
  if (isSuspended(c, now)) throw new GameError(`${who} suspended and cannot play games right now.`, 403);
  if (!WAGERS_IN_CUSTODY && stakeKobo > 0n && isJailed(c, now)) throw new GameError(`${who} in custody: only free games are allowed.`, 403);
}
const needBalance = async (tx, c, stakeKobo, you = true) => {
  if (stakeKobo <= 0n) return;
  const acc = await tx.account.findUnique({ where: { characterId: c.id } });
  if (!acc || acc.balance < stakeKobo) throw new GameError(you ? `You cannot afford a ${naira(stakeKobo)} wager.` : `${c.name} cannot afford a ${naira(stakeKobo)} wager.`, 402);
};
/** Anybody running a match is "busy". Waiting in the random queue does not count (a match found will take them out of it). */
const busyWith = (tx, charId) => tx.gameSeat.findUnique({ where: { characterId: charId } });

// ------------------------------------------------------------------------------------------------ views
function pubRematch(m, seat, now) {
  const r = m.rematch; if (!r) return null;
  const gone = r.declined != null, live = !gone && !r.nextId && now - r.at < REMATCH_MS;
  return { by: r.by, byMe: r.by === seat, stakeNaira: r.stakeNaira, live, declined: r.declined ?? null, expired: !gone && !r.nextId && !live, nextId: r.nextId ? String(r.nextId) : null, expiresAt: r.at + REMATCH_MS };
}
/** Everything one player's screen needs to draw the match. `names` is a Map of character id -> { name, level }. */
export function matchView(m, seat, names, now = Date.now(), { since = 0 } = {}) {
  const eng = ENGINES[m.game], me = seat >= 0 ? seat : 0;
  const you = names.get(idOf(m, me)), opp = names.get(idOf(m, 1 - me));
  const won = m.winnerSeat == null ? null : m.winnerSeat === seat;
  const outcome = m.status === "ACTIVE" || m.status === "INVITED" ? null : m.status === "CANCELLED" ? "CANCELLED" : m.status === "VOID" ? "VOID" : won == null ? "DRAW" : won ? "WON" : "LOST";
  return {
    id: String(m.id), game: m.game, gameName: eng.info.name, mode: m.mode, status: m.status, seat, version: m.version,
    you: { name: you?.name ?? "You" }, opponent: { name: opp?.name ?? "Opponent", level: opp?.level ?? null },
    stakeKobo: s(m.stakeKobo), stakeNaira: Number(m.stakeKobo / 100n), poolKobo: s(poolOf(m.stakeKobo)),
    escrowKobo: m.status === "ACTIVE" ? s(poolOf(m.stakeKobo)) : "0",
    turn: m.turn, yourTurn: m.status === "ACTIVE" && m.turn === seat, deadline: m.status === "ACTIVE" && m.turnDeadline ? +m.turnDeadline : null, now,
    turnSeconds: eng.info.turnSeconds, outcome, result: m.result, reason: m.reason, payoutKobo: s(m.payoutKobo),
    netKobo: outcome === "WON" ? s(m.payoutKobo - m.stakeKobo) : outcome === "LOST" ? s(-m.stakeKobo) : "0",
    drawOffer: m.status === "ACTIVE" ? (m.drawOffer == null ? null : m.drawOffer === seat ? "mine" : "theirs") : null,
    rematch: m.status === "FINISHED" || m.status === "VOID" ? pubRematch(m, seat, now) : null,
    startedAt: m.startedAt ? +m.startedAt : null, finishedAt: m.finishedAt ? +m.finishedAt : null,
    board: m.status === "ACTIVE" || m.status === "FINISHED" || m.status === "VOID" ? eng.view(m.state, seat, { since }) : null,
  };
}
const viewFor = async (tx, m, charId, opts) => matchView(m, seatOf(m, charId), await nameMap(tx, [m.hostId, m.guestId]), Date.now(), opts);

// ------------------------------------------------------------------------------------------------ settlement (the only place stakes leave escrow)
/** Finish an ACTIVE match and move the money. winner is a seat or null (stakes go back). Returns the updated row. A match that is not ACTIVE is left alone, so this runs once. */
async function settle(tx, m, { winner = null, result, reason }) {
  if (m.status !== "ACTIVE") return m;
  const week = await currentWeek(tx), pool = poolOf(m.stakeKobo), ids = [m.hostId, m.guestId], voided = result === "VOID";
  const pays = winner != null && !voided;
  if (m.stakeKobo > 0n) {
    const house = await gamesAccount(tx), accs = await Promise.all(ids.map((id) => tx.account.findUnique({ where: { characterId: id } })));
    if (pays) await transferInTx(tx, { fromId: house.id, toId: accs[winner].id, amount: pool, memo: `${gameName(m.game)} winnings`, key: `game:payout:${m.id}`, week });
    else for (let i = 0; i < 2; i++) await transferInTx(tx, { fromId: house.id, toId: accs[i].id, amount: m.stakeKobo, memo: `${gameName(m.game)} wager returned`, key: `game:refund:${m.id}:${ids[i]}`, week });
  }
  const done = await tx.gameMatch.update({ where: { id: m.id }, data: { status: voided ? "VOID" : "FINISHED", winnerSeat: pays ? winner : null, result: voided ? "VOID" : pays ? result : "DRAW", reason: reason ?? null,
    payoutKobo: pays ? pool : 0n, finishedAt: new Date(), turnDeadline: null, drawOffer: null, updatedAt: new Date() } });
  await tx.gameSeat.deleteMany({ where: { matchId: m.id } });
  const names = await nameMap(tx, ids), g = gameName(m.game), stake = m.stakeKobo > 0n;
  for (let i = 0; i < 2; i++) {
    const them = names.get(ids[1 - i])?.name ?? "your rival";
    const body = voided ? `Your ${g} match with ${them} was cancelled.${stake ? ` Your ${naira(m.stakeKobo)} wager was returned.` : ""}`
      : pays ? (i === winner ? `You beat ${them} at ${g}.${stake ? ` You won ${naira(pool)}.` : ""}` : `${them} beat you at ${g}.${stake ? ` You lost your ${naira(m.stakeKobo)} wager.` : ""}`)
      : `Your ${g} match with ${them} ended in a draw.${stake ? ` Your ${naira(m.stakeKobo)} wager was returned.` : ""}`;
    await note(tx, ids[i], body);
  }
  return done;
}

/** Apply time to a match: a lapsed invite is cancelled, a match past its hard cap is voided, a player out of time loses. Returns the (possibly changed) row. */
async function tick(tx, m, now = Date.now()) {
  if (m.status === "INVITED" && now - +m.createdAt > INVITE_MS) return tx.gameMatch.update({ where: { id: m.id }, data: { status: "CANCELLED", result: "CANCELLED", reason: "Nobody answered in time.", finishedAt: new Date() } });
  if (m.status !== "ACTIVE") return m;
  if (m.startedAt && now - +m.startedAt > MATCH_HARD_CAP_MS) return settle(tx, m, { result: "VOID", reason: "The match ran too long and was cancelled. Every wager was returned." });
  if (m.turnDeadline && now > +m.turnDeadline + 500) { // half a second of grace for a move that was on its way
    const slow = m.turn, names = await nameMap(tx, [m.hostId, m.guestId]);
    return settle(tx, m, { winner: 1 - slow, result: "TIMEOUT", reason: `${names.get(idOf(m, slow))?.name ?? "A player"} ran out of time.` });
  }
  return m;
}

// ------------------------------------------------------------------------------------------------ starting a match
/** Start a match between two players: take both wagers into escrow and deal the game. `row` is an existing INVITED match (a friend accepted), otherwise a new one is made. */
async function begin(tx, { row = null, game, mode, hostId, guestId, stakeKobo, rematchOfId = null, actorId }) {
  const [a, b] = await Promise.all([hostId, guestId].map((id) => tx.character.findUnique({ where: { id }, include: { account: true } })));
  if (!a || !b) throw new GameError("That player could not be found.", 404);
  const now = Date.now();
  for (const c of [a, b]) {
    const you = c.id === actorId;
    eligible(c, stakeKobo, now, you);
    if (await busyWith(tx, c.id)) throw new GameError(you ? "You are already in a match. Finish it first." : `${c.name} is already in a match.`, 409);
    await needBalance(tx, c, stakeKobo, you);
  }
  const eng = ENGINES[game], state = eng.create(rng), data = { status: "ACTIVE", state, turn: eng.turnOf(state), turnDeadline: new Date(now + eng.info.turnSeconds * 1000), startedAt: new Date(now), version: 0, drawOffer: null, rids: [], updatedAt: new Date() };
  const m = row ? await tx.gameMatch.update({ where: { id: row.id }, data }) : await tx.gameMatch.create({ data: { game, mode, hostId, guestId, stakeKobo, rematchOfId, ...data } });
  await tx.gameSeat.create({ data: { characterId: hostId, matchId: m.id, seat: 0 } });
  await tx.gameSeat.create({ data: { characterId: guestId, matchId: m.id, seat: 1 } });
  if (stakeKobo > 0n) {
    const week = await currentWeek(tx), house = await gamesAccount(tx);
    for (const c of [a, b]) {
      try { await transferInTx(tx, { fromId: c.account.id, toId: house.id, amount: stakeKobo, memo: `${gameName(game)} wager`, key: `game:stake:${m.id}:${c.id}`, week }); }
      catch (e) { if (e instanceof InsufficientFunds) throw new GameError(c.id === actorId ? `You cannot afford a ${naira(stakeKobo)} wager.` : `${c.name} cannot afford a ${naira(stakeKobo)} wager.`, 402); throw e; }
    }
  }
  const other = (c) => (c.id === a.id ? b : a).name;
  for (const c of [a, b]) if (c.id !== actorId) await note(tx, c.id, `Your ${gameName(game)} match with ${other(c)} has started.${stakeKobo > 0n ? ` ${naira(poolOf(stakeKobo))} is at stake.` : ""}`);
  await tx.gameQueue.deleteMany({ where: { characterId: { in: [hostId, guestId] } } });
  return m;
}

// ------------------------------------------------------------------------------------------------ the lobby
let lastSweep = 0;
/** Settle what nobody is watching: matches whose clock ran out, lapsed invitations, old queue entries. Cheap, and runs at most every 20 seconds per server. */
export async function sweepStale(db, now = Date.now(), force = false) {
  if (!force && now - lastSweep < 20_000) return 0;
  lastSweep = now;
  await db.gameQueue.deleteMany({ where: { joinedAt: { lt: new Date(now - QUEUE_MS) } } });
  await db.gameMatch.updateMany({ where: { status: "INVITED", createdAt: { lt: new Date(now - INVITE_MS) } }, data: { status: "CANCELLED", result: "CANCELLED", reason: "Nobody answered in time.", finishedAt: new Date(now) } });
  const due = await db.gameMatch.findMany({ where: { status: "ACTIVE", turnDeadline: { lt: new Date(now - 2_000) } }, orderBy: { turnDeadline: "asc" }, take: 8 });
  const old = await db.gameMatch.findMany({ where: { status: "ACTIVE", startedAt: { lt: new Date(now - MATCH_HARD_CAP_MS) } }, take: 8 });
  let n = 0;
  for (const m of [...due, ...old]) {
    try { await db.$transaction(async (tx) => { const row = await lockMatch(tx, m.id); if (row) { const after = await tick(tx, row, now); if (after.status !== row.status) n++; } }); } catch (e) { console.error("game sweep", e); }
  }
  return n;
}

const historyRow = (m, charId, names) => {
  const seat = seatOf(m, charId), opp = names.get(idOf(m, 1 - seat)), won = m.winnerSeat == null ? null : m.winnerSeat === seat;
  const outcome = m.status === "CANCELLED" ? "CANCELLED" : m.status === "VOID" ? "VOID" : won == null ? "DRAW" : won ? "WON" : "LOST";
  return { id: String(m.id), game: m.game, gameName: gameName(m.game), opponent: opp?.name ?? "A player", stakeKobo: s(m.stakeKobo), outcome, result: m.result, reason: m.reason,
    winningsKobo: outcome === "WON" ? s(m.payoutKobo) : "0", netKobo: outcome === "WON" ? s(m.payoutKobo - m.stakeKobo) : outcome === "LOST" ? s(-m.stakeKobo) : "0", at: +(m.finishedAt ?? m.createdAt), mode: m.mode };
};

/** The Games app's home screen: your running match, your search, challenges to and from you, and your recent results. */
export async function getLobby(db, userId) {
  const me = await whoIs(db, userId);
  await sweepStale(db);
  // anything of mine that is overdue is settled right now, not at the next sweep
  const seat = await busyWith(db, me.id);
  if (seat) { const m0 = await db.gameMatch.findUnique({ where: { id: seat.matchId } });
    if (m0 && (m0.turnDeadline ? Date.now() > +m0.turnDeadline + 500 : false)) await db.$transaction(async (tx) => { const row = await lockMatch(tx, m0.id); if (row) await tick(tx, row); }); }
  const [active, queue, incoming, outgoing, past, acc] = await Promise.all([
    busyWith(db, me.id), db.gameQueue.findUnique({ where: { characterId: me.id } }),
    db.gameMatch.findMany({ where: { guestId: me.id, status: "INVITED", createdAt: { gte: new Date(Date.now() - INVITE_MS) } }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.gameMatch.findMany({ where: { hostId: me.id, status: "INVITED", createdAt: { gte: new Date(Date.now() - INVITE_MS) } }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.gameMatch.findMany({ where: { OR: [{ hostId: me.id }, { guestId: me.id }], status: { in: ["FINISHED", "VOID"] } }, orderBy: { finishedAt: "desc" }, take: 15 }),
    db.account.findUnique({ where: { characterId: me.id } }),
  ]);
  const am = active ? await db.gameMatch.findUnique({ where: { id: active.matchId } }) : null;
  const ids = [...new Set([...incoming, ...outgoing, ...past, ...(am ? [am] : [])].flatMap((m) => [m.hostId, m.guestId]))], names = await nameMap(db, ids);
  const inv = (m, mine) => ({ id: String(m.id), game: m.game, gameName: gameName(m.game), stakeKobo: s(m.stakeKobo), poolKobo: s(poolOf(m.stakeKobo)), from: names.get(m.hostId)?.name, to: names.get(m.guestId)?.name, mine, expiresAt: +m.createdAt + INVITE_MS });
  // a rematch someone has asked me for in my most recent finished match
  const lastDone = past.find((m) => m.status === "FINISHED" || m.status === "VOID");
  const rematch = lastDone?.rematch && !lastDone.rematch.nextId ? { matchId: String(lastDone.id), ...pubRematch(lastDone, seatOf(lastDone, me.id), Date.now()), opponent: names.get(idOf(lastDone, 1 - seatOf(lastDone, me.id)))?.name, game: lastDone.game, gameName: gameName(lastDone.game) } : null;
  return {
    games: GAME_LIST, stakes: STAKE_CHOICES, minStakeNaira: MIN_STAKE_NAIRA, maxStakeNaira: MAX_STAKE_NAIRA, balanceKobo: s(acc?.balance ?? 0n), name: me.name,
    active: am ? { id: String(am.id), game: am.game, gameName: gameName(am.game), opponent: names.get(idOf(am, 1 - active.seat))?.name, stakeKobo: s(am.stakeKobo), yourTurn: am.turn === active.seat } : null,
    queue: queue ? { game: queue.game, gameName: gameName(queue.game), stakeKobo: s(queue.stakeKobo), since: +queue.joinedAt, expiresAt: +queue.joinedAt + QUEUE_MS } : null,
    incoming: incoming.map((m) => inv(m, false)), outgoing: outgoing.map((m) => inv(m, true)), rematch,
    history: past.map((m) => historyRow(m, me.id, names)),
  };
}

export async function getHistory(db, userId, limit = 50) {
  const me = await whoIs(db, userId);
  const rows = await db.gameMatch.findMany({ where: { OR: [{ hostId: me.id }, { guestId: me.id }], status: { in: ["FINISHED", "VOID"] } }, orderBy: { finishedAt: "desc" }, take: Math.min(100, limit) });
  const names = await nameMap(db, [...new Set(rows.flatMap((m) => [m.hostId, m.guestId]))]);
  const list = rows.map((m) => historyRow(m, me.id, names));
  const won = list.filter((r) => r.outcome === "WON").length, lost = list.filter((r) => r.outcome === "LOST").length;
  return { history: list, totals: { played: list.length, won, lost, draws: list.filter((r) => r.outcome === "DRAW").length, netKobo: s(list.reduce((t, r) => t + BigInt(r.netKobo), 0n)) } };
}

// ------------------------------------------------------------------------------------------------ friends
const dup = (e) => e?.code === "P2002";

/** Challenge a friend (found by character name) to a game for a wager. Nothing is taken from either player yet: that happens when the friend accepts. */
export async function challenge(db, userId, { to, game, stakeNaira, requestId }) {
  needReq(requestId);
  if (!isGame(game)) throw new GameError("Pick a game.");
  const n = cleanStake(stakeNaira ?? 0); if (n == null) throw new GameError(`A wager is ₦0 (friendly) or between ₦${MIN_STAKE_NAIRA.toLocaleString("en-NG")} and ₦${MAX_STAKE_NAIRA.toLocaleString("en-NG")}.`);
  const stake = BigInt(n) * 100n, week = await currentWeek(db);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId, { allowJailed: true });
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "game:challenge", gameWeek: week } }); // P2002 on replay
      const r = await tx.character.findFirst({ where: { name: { equals: String(to ?? "").trim(), mode: "insensitive" } } });
      if (!r) throw new GameError("No player with that name.", 404);
      if (r.id === c.id) throw new GameError("You cannot challenge yourself.");
      if (await blockedPair(tx, c.id, r.id)) throw new GameError("You cannot challenge this player.", 403);
      eligible(c, stake, Date.now(), true); eligible(r, stake, Date.now(), false);
      if (await busyWith(tx, c.id)) throw new GameError("You are already in a match. Finish it first.", 409);
      await needBalance(tx, c, stake, true);
      if (await busyWith(tx, r.id)) throw new GameError(`${r.name} is in a match right now. Try again in a moment.`, 409);
      if ((await tx.gameMatch.count({ where: { hostId: c.id, status: "INVITED" } })) >= 5) throw new GameError("You already have 5 challenges waiting. Withdraw one first.", 409);
      await tx.gameMatch.updateMany({ where: { hostId: c.id, guestId: r.id, status: "INVITED" }, data: { status: "CANCELLED", result: "CANCELLED", reason: "Replaced by a newer challenge.", finishedAt: new Date() } });
      const m = await tx.gameMatch.create({ data: { game, mode: "FRIEND", status: "INVITED", hostId: c.id, guestId: r.id, stakeKobo: stake, state: {} } });
      await note(tx, r.id, `${c.name} challenged you to ${gameName(game)}${stake > 0n ? ` for ${naira(stake)} (winner takes ${naira(poolOf(stake))})` : " (friendly)"}. Open Games to answer.`);
      return { ok: true, id: String(m.id), to: r.name, game, stakeKobo: s(stake), poolKobo: s(poolOf(stake)) };
    });
  } catch (e) { if (dup(e)) return { ok: true, duplicate: true }; throw e; }
}

/** Answer a challenge. Accepting starts the match: both players must still be free and able to afford the wager, and both wagers are taken in the same step. */
export async function respond(db, userId, { matchId, accept, requestId }) {
  needReq(requestId); const id = parseId(matchId), week = await currentWeek(db);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId, { allowJailed: true });
      await startLock(tx);
      let m = await lockMatch(tx, id);
      if (!m || m.guestId !== c.id) throw new GameError("That challenge could not be found.", 404);
      m = await tick(tx, m);
      if (m.status === "ACTIVE") return { ok: true, duplicate: true, id: String(m.id), started: true }; // pressed twice
      if (m.status !== "INVITED") throw new GameError("That challenge is no longer open.", 409);
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "game:respond", gameWeek: week } }); // P2002 on replay
      if (!accept) {
        await tx.gameMatch.update({ where: { id: m.id }, data: { status: "CANCELLED", result: "CANCELLED", reason: `${c.name} declined.`, finishedAt: new Date() } });
        await note(tx, m.hostId, `${c.name} declined your ${gameName(m.game)} challenge.`);
        return { ok: true, declined: true };
      }
      if (await blockedPair(tx, m.hostId, c.id)) throw new GameError("You cannot play this player.", 403);
      await begin(tx, { row: m, game: m.game, mode: "FRIEND", hostId: m.hostId, guestId: c.id, stakeKobo: m.stakeKobo, actorId: c.id });
      return { ok: true, id: String(m.id), started: true };
    });
  } catch (e) { if (dup(e)) return { ok: true, duplicate: true }; throw e; }
}

/** Take back a challenge you sent. */
export async function withdraw(db, userId, { matchId }) {
  const id = parseId(matchId);
  return db.$transaction(async (tx) => {
    const c = await whoIs(tx, userId), m = await lockMatch(tx, id);
    if (!m || m.hostId !== c.id) throw new GameError("That challenge could not be found.", 404);
    if (m.status !== "INVITED") return { ok: true, duplicate: true };
    await tx.gameMatch.update({ where: { id: m.id }, data: { status: "CANCELLED", result: "CANCELLED", reason: "Withdrawn.", finishedAt: new Date() } });
    return { ok: true };
  });
}

// ------------------------------------------------------------------------------------------------ random opponents
/** Look for a random opponent playing the same game for the same wager. If someone is already waiting, the match starts at once; otherwise you wait in the queue. */
export async function joinQueue(db, userId, { game, stakeNaira, requestId }) {
  needReq(requestId);
  if (!isGame(game)) throw new GameError("Pick a game.");
  const n = cleanStake(stakeNaira ?? 0); if (n == null) throw new GameError(`A wager is ₦0 (friendly) or between ₦${MIN_STAKE_NAIRA.toLocaleString("en-NG")} and ₦${MAX_STAKE_NAIRA.toLocaleString("en-NG")}.`);
  const stake = BigInt(n) * 100n;
  return db.$transaction(async (tx) => {
    const c = await loadLocked(tx, userId, { allowJailed: true });
    await startLock(tx);
    if (await busyWith(tx, c.id)) throw new GameError("You are already in a match. Finish it first.", 409);
    eligible(c, stake, Date.now(), true); await needBalance(tx, c, stake, true);
    const mine = await tx.gameQueue.findUnique({ where: { characterId: c.id } });
    if (mine && mine.game === game && mine.stakeKobo === stake) return { ok: true, searching: true, duplicate: true };
    await tx.gameQueue.deleteMany({ where: { characterId: c.id } }); // a different search replaces the old one
    const waiting = await tx.gameQueue.findMany({ where: { game, stakeKobo: stake, characterId: { not: c.id }, joinedAt: { gte: new Date(Date.now() - QUEUE_MS) } }, orderBy: { joinedAt: "asc" }, take: 12 });
    for (const w of waiting) {
      const o = await tx.character.findUnique({ where: { id: w.characterId }, include: { account: true } });
      const stale = async () => { await tx.gameQueue.deleteMany({ where: { characterId: w.characterId } }); };
      if (!o) { await stale(); continue; }
      if (await busyWith(tx, o.id)) { await stale(); continue; }
      try { eligible(o, stake, Date.now(), false); } catch { await stale(); continue; }
      if (stake > 0n && (!o.account || o.account.balance < stake)) { await stale(); continue; }
      if (await blockedPair(tx, o.id, c.id)) continue;
      const m = await begin(tx, { game, mode: "RANDOM", hostId: o.id, guestId: c.id, stakeKobo: stake, actorId: c.id });
      return { ok: true, matched: true, id: String(m.id) };
    }
    await tx.gameQueue.create({ data: { characterId: c.id, game, stakeKobo: stake } });
    return { ok: true, searching: true };
  });
}

/** Stop searching. If a match was found in the meantime, say so instead (the screen then opens it). */
export async function leaveQueue(db, userId) {
  const me = await whoIs(db, userId), seat = await busyWith(db, me.id);
  if (seat) return { ok: true, matched: true, id: String(seat.matchId) };
  await db.gameQueue.deleteMany({ where: { characterId: me.id } });
  return { ok: true };
}

// ------------------------------------------------------------------------------------------------ playing
/** Read a match as one of its players. Only the two players can read it. `since` (pool) asks only for the shots newer than the screen already has. */
export async function getMatch(db, userId, matchId, { since = 0 } = {}) {
  const me = await whoIs(db, userId), id = parseId(matchId);
  let m = await db.gameMatch.findUnique({ where: { id } });
  if (!m || seatOf(m, me.id) < 0) throw new GameError("That match could not be found.", 404);
  const late = (m.status === "ACTIVE" && m.turnDeadline && Date.now() > +m.turnDeadline + 500) || (m.status === "ACTIVE" && m.startedAt && Date.now() - +m.startedAt > MATCH_HARD_CAP_MS) || (m.status === "INVITED" && Date.now() - +m.createdAt > INVITE_MS);
  if (late) m = await db.$transaction(async (tx) => { const row = await lockMatch(tx, id); return tick(tx, row); });
  return { ok: true, match: await viewFor(db, m, me.id, { since }) };
}

/** Play a move. The engine decides whether it is legal and what happens; this adds idempotency, the clock and the money. */
export async function move(db, userId, { matchId, action, requestId, since = 0 }) {
  needReq(requestId); const id = parseId(matchId);
  if (!action || typeof action !== "object" || typeof action.type !== "string") throw new GameError("Make a move.");
  return db.$transaction(async (tx) => {
    const me = await whoIs(tx, userId);
    let m = await lockMatch(tx, id);
    const seat = m ? seatOf(m, me.id) : -1;
    if (seat < 0) throw new GameError("That match could not be found.", 404);
    const rid = `${seat}:${requestId}`;
    if (Array.isArray(m.rids) && m.rids.includes(rid)) return { ok: true, duplicate: true, match: await viewFor(tx, m, me.id, { since }) }; // the same move sent twice is played once
    m = await tick(tx, m);
    if (m.status !== "ACTIVE") return { ok: true, over: true, match: await viewFor(tx, m, me.id, { since }) };
    const eng = ENGINES[m.game], now = Date.now();
    let res;
    try { res = eng.act(m.state, seat, action, { rng, now, version: m.version + 1 }); }
    catch (e) { if (e instanceof RuleError) throw new GameError(e.message, e.status ?? 409); throw e; }
    const rids = [...(Array.isArray(m.rids) ? m.rids : []), rid].slice(-KEEP_RIDS);
    m = await tx.gameMatch.update({ where: { id: m.id }, data: { state: res.state, version: m.version + 1, turn: eng.turnOf(res.state), turnDeadline: new Date(now + eng.info.turnSeconds * 1000), drawOffer: null, rids, updatedAt: new Date(now) } });
    if (res.over) m = await settle(tx, m, { winner: res.over.winner ?? null, result: "WIN", reason: res.over.reason });
    return { ok: true, match: await viewFor(tx, m, me.id, { since }) };
  });
}

/** Give up: the rival wins (and takes the pool). */
export async function resign(db, userId, { matchId }) {
  const id = parseId(matchId);
  return db.$transaction(async (tx) => {
    const me = await whoIs(tx, userId); let m = await lockMatch(tx, id); const seat = m ? seatOf(m, me.id) : -1;
    if (seat < 0) throw new GameError("That match could not be found.", 404);
    m = await tick(tx, m);
    if (m.status === "ACTIVE") m = await settle(tx, m, { winner: 1 - seat, result: "FORFEIT", reason: `${me.name} resigned.` });
    return { ok: true, match: await viewFor(tx, m, me.id) };
  });
}

/** Offer to end the match as a draw (both wagers go back), answer the rival's offer, or take your offer back. Any move declines an open offer. */
export async function drawOffer(db, userId, { matchId, op }) {
  const id = parseId(matchId);
  if (!["offer", "accept", "decline"].includes(op)) throw new GameError("Unknown choice.");
  return db.$transaction(async (tx) => {
    const me = await whoIs(tx, userId); let m = await lockMatch(tx, id); const seat = m ? seatOf(m, me.id) : -1;
    if (seat < 0) throw new GameError("That match could not be found.", 404);
    m = await tick(tx, m);
    if (m.status !== "ACTIVE") return { ok: true, match: await viewFor(tx, m, me.id) };
    if (op === "offer") {
      if (m.drawOffer === 1 - seat) m = await settle(tx, m, { result: "DRAW", reason: "Both players agreed to a draw." }); // both asked: that is an agreement
      else if (m.drawOffer == null) { m = await tx.gameMatch.update({ where: { id: m.id }, data: { drawOffer: seat } }); await note(tx, idOf(m, 1 - seat), `${me.name} offered you a draw in ${gameName(m.game)}.`); }
    } else if (op === "accept") {
      if (m.drawOffer !== 1 - seat) throw new GameError("There is no draw offer to accept.", 409);
      m = await settle(tx, m, { result: "DRAW", reason: "Both players agreed to a draw." });
    } else if (m.drawOffer != null) m = await tx.gameMatch.update({ where: { id: m.id }, data: { drawOffer: null } });
    return { ok: true, match: await viewFor(tx, m, me.id) };
  });
}

// ------------------------------------------------------------------------------------------------ rematch (never starts by itself: both must say yes, and the wager is confirmed in that yes)
/** Ask for a rematch of a finished match, at a wager you choose (the same one by default). */
export async function rematchAsk(db, userId, { matchId, stakeNaira, requestId }) {
  needReq(requestId); const id = parseId(matchId);
  return db.$transaction(async (tx) => {
    const c = await loadLocked(tx, userId, { allowJailed: true });
    let m = await lockMatch(tx, id); const seat = m ? seatOf(m, c.id) : -1;
    if (seat < 0) throw new GameError("That match could not be found.", 404);
    if (m.status !== "FINISHED" && m.status !== "VOID") throw new GameError("The match is still going.", 409);
    const n = cleanStake(stakeNaira ?? Number(m.stakeKobo / 100n)); if (n == null) throw new GameError("That wager is not allowed.");
    const stake = BigInt(n) * 100n, now = Date.now(), cur = m.rematch;
    if (cur?.nextId) return { ok: true, duplicate: true, nextId: String(cur.nextId) };
    if (cur && cur.declined == null && now - cur.at < REMATCH_MS) {
      if (cur.by === seat) return { ok: true, duplicate: true };
      throw new GameError("Your rival already asked for a rematch. Accept or decline it.", 409);
    }
    const other = idOf(m, 1 - seat);
    if (await blockedPair(tx, c.id, other)) throw new GameError("You cannot play this player.", 403);
    eligible(c, stake, now, true); await needBalance(tx, c, stake, true);
    if (await busyWith(tx, c.id)) throw new GameError("You are already in a match. Finish it first.", 409);
    m = await tx.gameMatch.update({ where: { id: m.id }, data: { rematch: { by: seat, stakeNaira: n, at: now } } });
    await note(tx, other, `${c.name} wants a rematch at ${gameName(m.game)}${stake > 0n ? ` for ${naira(stake)}` : " (friendly)"}. Open Games to answer.`);
    return { ok: true, match: await viewFor(tx, m, c.id) };
  });
}

/** Accept (starts the new match: both wagers are checked and taken now) or decline a rematch. The asker can also cancel it by declining their own. */
export async function rematchReply(db, userId, { matchId, accept, requestId }) {
  needReq(requestId); const id = parseId(matchId);
  return db.$transaction(async (tx) => {
    const c = await loadLocked(tx, userId, { allowJailed: true });
    await startLock(tx);
    let m = await lockMatch(tx, id); const seat = m ? seatOf(m, c.id) : -1;
    if (seat < 0) throw new GameError("That match could not be found.", 404);
    const r = m.rematch, now = Date.now();
    if (r?.nextId) return { ok: true, duplicate: true, started: true, id: String(r.nextId) };
    if (!r || r.declined != null) throw new GameError("There is no rematch request.", 409);
    if (now - r.at >= REMATCH_MS) throw new GameError("The rematch request has expired.", 409);
    const other = idOf(m, 1 - seat);
    if (r.by === seat) { // the asker cancels
      if (accept) throw new GameError("Waiting for your rival to answer.", 409);
      await tx.gameMatch.update({ where: { id: m.id }, data: { rematch: { ...r, declined: seat } } });
      return { ok: true, cancelled: true };
    }
    if (!accept) { await tx.gameMatch.update({ where: { id: m.id }, data: { rematch: { ...r, declined: seat } } }); await note(tx, other, `${c.name} declined your rematch.`); return { ok: true, declined: true }; }
    if (await blockedPair(tx, c.id, other)) throw new GameError("You cannot play this player.", 403);
    const next = await begin(tx, { game: m.game, mode: "REMATCH", hostId: other, guestId: c.id, stakeKobo: BigInt(r.stakeNaira) * 100n, rematchOfId: m.id, actorId: c.id });
    await tx.gameMatch.update({ where: { id: m.id }, data: { rematch: { ...r, nextId: String(next.id) } } });
    return { ok: true, started: true, id: String(next.id) };
  });
}
