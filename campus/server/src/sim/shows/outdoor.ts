import {
  ACT_RATES,
  FACULTY_PERKS,
  FACULTY_TEAMS,
  FORECOURT_JOLLOF,
  FORECOURT_LABEL,
  GROUND_IDS,
  GYRATION_FUN,
  GYRATION_LABEL,
  SOCIAL_SITES,
  SPOTS,
  TOUCHLINE_FUN,
  TOUCHLINE_LABEL,
  closedText,
  currentPitchMatch,
  facultyIndexOf,
  freshBatchAt,
  FRESH_BATCH,
  liveEvent,
  matchState,
  matchWinner,
  pitchResult,
  scoreLine,
  stallOfSpot,
  stallOpen,
  type ActKind,
  type GroundId,
  type PitchMatch,
  type Spot,
} from "@campuslife/shared";
import { issueTicket, type FanBook } from "./state";
import type { Admission, Fan, Now, ShowTick } from "./types";

const MAX_NEED = 100;
const TEXT = {
  noMatch: "⚽ No match for this pitch now. Check Events on your phone for fixtures.",
  pitchIn: (m: PitchMatch) => `⚽ ${m.competition}: ${m.home.name} v ${m.away.name}. Free at the touchline.`,
  goal: (m: PitchMatch, line: string) => `⚽ GOAL! ${line}. ${m.competition}.`,
  half: (line: string) => `⏸️ Half time. ${line}. Pure water sellers don rush the touchline.`,
  full: (m: PitchMatch) => `🏁 Full time. ${pitchResult(m)}. ${m.banter}`,
  pride: (name: string) => `🏆 ${name} don win! Your faculty go shout tonight. +${FACULTY_PERKS.winFun} fun`,
  pitchOver: "⚽ Match don finish. The pitch don empty.",
  noGyration: "🌴 The shrine dey quiet. Gyration na some evenings only. Check Events.",
  gyrationIn: "🥁 You don join the gyration. Follow the drums.",
  gyrationOver: "🌴 Gyration don close for tonight. The drums don rest.",
  noGames: "🎲 Nothing dey here now. Jollof and games na Union Week afternoon.",
  jollof: `🍚 Union Week jollof, free. +${FORECOURT_JOLLOF} food`,
  gamesOver: "🎲 Union Week games don pack up.",
};

const SPOT_INDEX = new Map<Spot, number>();
const GROUND_OF = new Map<Spot, GroundId>();
for (const ground of GROUND_IDS) for (const i of SOCIAL_SITES.touchline[ground]) GROUND_OF.set(SPOTS[i], ground);

function indexOf(spot: Spot): number {
  if (!SPOT_INDEX.size)
    SPOTS.forEach((s, i) => {
      if (s.kind === "eat" && s.place < 0) SPOT_INDEX.set(s, i);
    });
  return SPOT_INDEX.get(spot) ?? -1;
}

export function isOutdoor(spot: Spot): boolean {
  return spot.place < 0 && (spot.label === TOUCHLINE_LABEL || spot.label === GYRATION_LABEL || spot.label === FORECOURT_LABEL);
}

export function stallAdmit(fan: Fan, spot: Spot, now: Now): Admission | undefined {
  if (spot.kind !== "eat" || spot.place >= 0) return undefined;
  const stall = stallOfSpot(indexOf(spot));
  if (stall < 0) return undefined;
  if (!stallOpen(stall, now)) return { refuse: closedText(stall) };
  const fresh = fan.cash >= (spot.price ?? 0) ? freshBatchAt(stall, now) : undefined;
  if (!fresh) return undefined;
  fan.fun += FRESH_BATCH.fun;
  return { text: fresh };
}

export function outdoorAdmit(book: FanBook, fan: Fan, spot: Spot, now: Now): Admission {
  if (spot.label === TOUCHLINE_LABEL) {
    const ground = GROUND_OF.get(spot);
    const match = ground ? currentPitchMatch(ground, now) : undefined;
    if (!match || matchState(match, now.total).phase === "full") return { refuse: TEXT.noMatch };
    if (book.tickets.has(match.key)) return {};
    const state = matchState(match, now.total);
    issueTicket(book, match.key, now.dayIndex, 0, state.home + state.away);
    return { text: TEXT.pitchIn(match) };
  }
  if (spot.label === GYRATION_LABEL) {
    const event = liveEvent("gyration", now);
    if (!event) return { refuse: TEXT.noGyration };
    if (book.tickets.has(event.key)) return {};
    issueTicket(book, event.key, now.dayIndex);
    return { text: TEXT.gyrationIn };
  }
  const event = liveEvent("games", now);
  if (!event) return { refuse: TEXT.noGames };
  if (book.tickets.has(event.key)) return {};
  issueTicket(book, event.key, now.dayIndex);
  if (fan.food !== undefined) fan.food = Math.min(MAX_NEED, fan.food + FORECOURT_JOLLOF);
  return { text: TEXT.jollof };
}

function watchPitch(book: FanBook, fan: Fan, kind: ActKind, match: PitchMatch, now: Now, dt: number): ShowTick {
  const out: ShowTick = { notices: [], leave: false };
  const state = matchState(match, now.total);
  const ticket = book.tickets.get(match.key) ?? issueTicket(book, match.key, now.dayIndex, 0, state.home + state.away);
  const playing = state.phase === "first" || state.phase === "second";
  if (playing) {
    ticket.seconds += dt;
    fan.fun += TOUCHLINE_FUN * dt;
    fan.energy -= Math.max(0, ACT_RATES[kind].energy ?? 0) * dt;
  }
  if (state.home + state.away > ticket.goals) {
    ticket.goals = state.home + state.away;
    out.notices.push(TEXT.goal(match, scoreLine(match, state)));
  }
  if (state.phase === "half" && !ticket.half) {
    ticket.half = true;
    out.notices.push(TEXT.half(scoreLine(match, state)));
  }
  if (state.phase === "full" && !ticket.full) {
    ticket.full = true;
    out.notices.push(TEXT.full(match));
    const mine = facultyIndexOf(fan.department);
    const winner = matchWinner(match);
    const won = mine >= 0 && (match.stage === "novelty" ? match.teams[0] === mine : (winner === 0 || winner === 1) && match.teams[winner] === mine);
    if (won && ticket.seconds > 0) {
      fan.fun += FACULTY_PERKS.winFun;
      out.notices.push(TEXT.pride(FACULTY_TEAMS[mine].name));
    }
  }
  return out;
}

export function outdoorTick(book: FanBook, fan: Fan, kind: ActKind, spot: Spot, now: Now, dt: number): ShowTick {
  if (spot.label === TOUCHLINE_LABEL) {
    const ground = GROUND_OF.get(spot);
    const match = ground ? currentPitchMatch(ground, now) : undefined;
    return match ? watchPitch(book, fan, kind, match, now, dt) : { notices: [TEXT.pitchOver], leave: true };
  }
  if (spot.label === GYRATION_LABEL) {
    if (!liveEvent("gyration", now)) return { notices: [TEXT.gyrationOver], leave: true };
    fan.fun += GYRATION_FUN * dt;
    return { notices: [], leave: false };
  }
  return liveEvent("games", now) ? { notices: [], leave: false } : { notices: [TEXT.gamesOver], leave: true };
}
