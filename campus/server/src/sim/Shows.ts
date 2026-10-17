import {
  ACT_RATES,
  INTERIORS,
  MATCH_GATE_OPENS,
  PLACES,
  REAL_SECONDS_PER_GAME_MINUTE,
  SHOW_KINDS,
  VIEWING_SEAT_LABEL,
  currentMatch,
  matchState,
  matchesFor,
  scoreLine,
  showAt,
  type ActKind,
  type FootballMatch,
  type GameTime,
  type MatchState,
  type Show,
  type Spot,
  type SocialSave,
  CLUB_FUN,
  FACULTY_PERKS,
  allShowsFor,
  clubSide,
  facultyIndexOf,
  isFresher,
} from "@campuslife/shared";
import { isOutdoor, outdoorAdmit, outdoorTick, stallAdmit } from "./shows/outdoor";
import { bookFromSave, bookToSave, issueTicket, newBook, pruneTickets, type FanBook } from "./shows/state";
import { clock, naira, type Admission, type Fan, type ShowTick } from "./shows/types";

export type { Admission, Fan, ShowTick } from "./shows/types";

const VENUE_TEMPLATES = new Set(["amphitheatre", "auditorium"]);
const SHOW_ENERGY_COST = 0.06;
const MATCH_FUN = 0.9;
const MATCH_BREAK_FUN = 0.2;
const MATCH_ENERGY_COST = 0.05;
const GOAL_FUN = 4;
const THERE_WINDOW = 10;
const THERE_MIN_SECONDS = 30 * REAL_SECONDS_PER_GAME_MINUTE;
const THERE_FUN = 20;
const BIG_MATCH_FUN = 25;
const MATCH_THERE_FUN = 12;
const SOON_MINUTES = 60;
const START_MINUTES = 5;

const TEXT = {
  showBroke: (s: Show) => `🎟️ ${s.title} gate fee na ${naira(s.fee)}. Your cash no reach. Find money, then come back.`,
  showPaid: (s: Show) => `🎟️ ${naira(s.fee)} gate fee paid for ${s.title}. Enjoy the show.`,
  showFree: (s: Show) => `🎟️ ${s.title} is free entry. Enjoy the show.`,
  showStarted: (s: Show) => `🎟️ ${s.title} don start. Gate fee na ${naira(s.fee)}. Sit again to pay.`,
  facultyOwn: (s: Show) => `🎓 Na your faculty get ${s.title}. You dey enjoy am pass.`,
  matric: `🎓 Welcome to Great Ife, fresher. +${FACULTY_PERKS.matricFun} fun`,
  clubGoal: (name: string) => `🙌 ${name} don score! Your side of the room don scatter.`,
  clubConcede: (name: string) => `😬 Dem don score ${name}. The other side dey laugh you.`,
  clubWin: (name: string) => `🏆 ${name} win am. You go talk for hostel tonight. +${CLUB_FUN.win} fun`,
  clubLoss: (name: string) => `💔 ${name} lose. Dem go yab you reach your room. -${CLUB_FUN.loss} fun`,
  clubDraw: (name: string) => `🤝 ${name} draw. Nobody fit talk too much.`,
  there: (s: Show) => `⭐ You were there: ${s.title} with ${s.act}. +${THERE_FUN} fun`,
  matchBroke: (m: FootballMatch) => `⚽ Gate fee na ${naira(m.fee)} for ${m.home.name} v ${m.away.name}. No credit. Come back with cash.`,
  matchPaid: (m: FootballMatch, s: MatchState) =>
    s.phase === "soon" ? `⚽ ${naira(m.fee)} gate fee paid. ${m.home.name} v ${m.away.name} kicks off ${clock(m.kickoff)}.` : `⚽ ${naira(m.fee)} gate fee paid. ${scoreLine(m, s)}, ${s.minute} minutes gone.`,
  matchStarted: (m: FootballMatch) => `⚽ Gate don open. Gate fee na ${naira(m.fee)}. Sit again to pay.`,
  goal: (m: FootballMatch, s: MatchState) => `⚽ GOAL! ${scoreLine(m, s)}. The whole room don scatter.`,
  half: (m: FootballMatch, s: MatchState) => `⏸️ Half time. ${scoreLine(m, s)}. Argument don start.`,
  full: (m: FootballMatch, s: MatchState) => `🏁 Full time. ${scoreLine(m, s)}. ${m.banter}`,
  matchThere: (fun: number) => `⭐ You watched am from start reach end. +${fun} fun`,
};

export class ShowGate {
  private books = new Map<string, FanBook>();

  get size(): number {
    return this.books.size;
  }

  book(who: string): FanBook {
    let book = this.books.get(who);
    if (!book) this.books.set(who, (book = newBook()));
    return book;
  }

  load(who: string, saved: unknown) {
    this.books.set(who, bookFromSave(saved));
  }

  save(who: string, today?: number): SocialSave {
    const book = this.book(who);
    if (today !== undefined) pruneTickets(book, today);
    return bookToSave(book);
  }

  forget(who: string) {
    this.books.delete(who);
  }

  admit(who: string, fan: Fan, spot: Spot, now: GameTime): Admission {
    const stall = stallAdmit(fan, spot, now);
    if (stall) return stall;
    if (isOutdoor(spot)) return outdoorAdmit(this.book(who), fan, spot, now);
    const show = venueShow(spot, now);
    if (show && watches(spot, show)) return this.enter(who, fan, show.key, show.fee, now, now.total >= show.startTotal, show.moments.filter((m) => show.startTotal + m.at <= now.total).length, 0, TEXT.showBroke(show), show.fee ? TEXT.showPaid(show) : TEXT.showFree(show));
    const match = viewingMatch(spot, now);
    if (!match) return {};
    const state = matchState(match, now.total);
    if (state.phase === "full") return {};
    return this.enter(who, fan, match.key, match.fee, now, true, 0, state.home + state.away, TEXT.matchBroke(match), TEXT.matchPaid(match, state));
  }

  tick(who: string, fan: Fan, kind: ActKind, spot: Spot, now: GameTime, dt: number): ShowTick | undefined {
    if (isOutdoor(spot)) return outdoorTick(this.book(who), fan, kind, spot, now, dt);
    const show = venueShow(spot, now);
    if (show && watches(spot, show)) return this.watchShow(who, fan, kind, show, now, dt);
    const match = viewingMatch(spot, now);
    return match ? this.watchMatch(who, fan, kind, match, now, dt) : undefined;
  }

  private enter(who: string, fan: Fan, key: string, fee: number, now: GameTime, charge: boolean, moments: number, goals: number, broke: string, paid: string): Admission {
    const book = this.book(who);
    if (book.tickets.has(key) || !charge) return {};
    if (fan.cash < fee) return { refuse: broke };
    fan.cash -= fee;
    issueTicket(book, key, now.dayIndex, moments, goals);
    return { text: paid };
  }

  private watchShow(who: string, fan: Fan, kind: ActKind, show: Show, now: GameTime, dt: number): ShowTick {
    const out: ShowTick = { notices: [], leave: false };
    const book = this.book(who);
    let ticket = book.tickets.get(show.key);
    if (!ticket) {
      if (show.fee > 0) return { notices: [TEXT.showStarted(show)], leave: true };
      ticket = issueTicket(book, show.key, now.dayIndex);
    }
    const own = show.faculty !== undefined && show.faculty >= 0 && show.faculty === facultyIndexOf(fan.department);
    if (own && ticket.seconds === 0) out.notices.push(TEXT.facultyOwn(show));
    ticket.seconds += dt;
    fan.fun += show.fun * (own ? FACULTY_PERKS.showBoost : 1) * dt;
    fan.energy -= (Math.max(0, ACT_RATES[kind].energy ?? 0) + SHOW_ENERGY_COST) * dt;
    while (ticket.moments < show.moments.length && show.startTotal + show.moments[ticket.moments].at <= now.total) {
      const moment = show.moments[ticket.moments++];
      fan.fun += moment.fun;
      out.notices.push(moment.text);
    }
    if (!ticket.bonus && now.total >= show.endTotal - THERE_WINDOW && ticket.seconds >= THERE_MIN_SECONDS) {
      ticket.bonus = true;
      fan.fun += THERE_FUN;
      out.notices.push(TEXT.there(show));
      if (show.special === "matric" && isFresher(fan.level)) {
        fan.fun += FACULTY_PERKS.matricFun;
        out.notices.push(TEXT.matric);
      }
    }
    return out;
  }

  private watchMatch(who: string, fan: Fan, kind: ActKind, match: FootballMatch, now: GameTime, dt: number): ShowTick | undefined {
    const out: ShowTick = { notices: [], leave: false };
    const state = matchState(match, now.total);
    const book = this.book(who);
    const ticket = book.tickets.get(match.key);
    if (!ticket) return state.phase === "full" ? undefined : { notices: [TEXT.matchStarted(match)], leave: true };
    const side = clubSide(match, book.club);
    const mine = side === 0 ? match.home.name : match.away.name;
    const playing = state.phase === "first" || state.phase === "second";
    if (playing) ticket.seconds += dt;
    if (state.phase !== "soon" && state.phase !== "full") {
      fan.fun += (playing ? MATCH_FUN : MATCH_BREAK_FUN) * dt;
      fan.energy -= (Math.max(0, ACT_RATES[kind].energy ?? 0) + MATCH_ENERGY_COST) * dt;
    }
    if (state.home + state.away > ticket.goals) {
      const scorer = match.goals[state.home + state.away - 1]?.side;
      ticket.goals = state.home + state.away;
      fan.fun += GOAL_FUN;
      out.notices.push(TEXT.goal(match, state));
      if (side >= 0) {
        if (scorer === side) fan.fun += CLUB_FUN.goal;
        out.notices.push(scorer === side ? TEXT.clubGoal(mine) : TEXT.clubConcede(mine));
      }
    }
    if (state.phase === "half" && !ticket.half) {
      ticket.half = true;
      out.notices.push(TEXT.half(match, state));
    }
    if (state.phase === "full" && !ticket.full) {
      ticket.full = true;
      out.notices.push(TEXT.full(match, state));
      if (ticket.seconds >= THERE_MIN_SECONDS) {
        const fun = match.tier === "normal" ? MATCH_THERE_FUN : BIG_MATCH_FUN;
        fan.fun += fun;
        out.notices.push(TEXT.matchThere(fun));
      }
      if (side >= 0 && ticket.seconds > 0) this.clubResult(fan, mine, side === 0 ? state.home - state.away : state.away - state.home, out);
    }
    return out;
  }

  private clubResult(fan: Fan, name: string, margin: number, out: ShowTick) {
    if (margin > 0) {
      fan.fun += CLUB_FUN.win;
      out.notices.push(TEXT.clubWin(name));
    } else if (margin < 0) {
      fan.fun = Math.max(0, fan.fun - CLUB_FUN.loss);
      out.notices.push(TEXT.clubLoss(name));
    } else out.notices.push(TEXT.clubDraw(name));
  }
}

export const showGate = new ShowGate();

function venueShow(spot: Spot, now: GameTime): Show | undefined {
  if (spot.place < 0 || !VENUE_TEMPLATES.has(INTERIORS[spot.place]?.template.id ?? "")) return undefined;
  return showAt(spot.place, now);
}

function watches(spot: Spot, show: Show): boolean {
  if (spot.kind === "dance") return show.dance;
  return spot.kind === "sit" && spot.seat !== undefined;
}

function viewingMatch(spot: Spot, now: GameTime): FootballMatch | undefined {
  if (spot.kind !== "tv" || spot.label !== VIEWING_SEAT_LABEL || spot.place < 0) return undefined;
  return currentMatch(now);
}

export function showAnnouncements(t: GameTime): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  for (const s of allShowsFor(t.dayIndex)) {
    const { emoji } = SHOW_KINDS[s.kind];
    const gate = s.fee ? `Gate ${naira(s.fee)}` : "Free entry";
    if (t.total >= s.startTotal - SOON_MINUTES && t.total < s.startTotal) out.push({ key: `show:soon:${s.key}`, text: `${emoji} ${clock(s.start)} today: ${s.title} with ${s.act} at ${PLACES[s.place].name}. ${gate}.` });
    if (t.total >= s.startTotal && t.total < s.startTotal + START_MINUTES) out.push({ key: `show:start:${s.key}`, text: `${emoji} ${s.title} don start at ${PLACES[s.place].name}. Find a seat.` });
  }
  for (const m of matchesFor(t.dayIndex)) {
    if (m.tier === "normal") continue;
    const what = `${m.competition}: ${m.home.name} v ${m.away.name}`;
    if (t.total >= m.startTotal - SOON_MINUTES && t.total < m.startTotal - MATCH_GATE_OPENS) out.push({ key: `match:soon:${m.key}`, text: `⚽ Big match tonight. ${what}, ${clock(m.kickoff)} at every hall viewing centre. Gate ${naira(m.fee)}.` });
    if (t.total >= m.startTotal && t.total < m.startTotal + START_MINUTES) out.push({ key: `match:start:${m.key}`, text: `⚽ Kick-off! ${what}. Viewing centres don full.` });
  }
  return out;
}
