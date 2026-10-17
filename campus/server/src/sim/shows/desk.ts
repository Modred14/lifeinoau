import {
  FACULTY_PERKS,
  FACULTY_TEAMS,
  PREDICT,
  PX_PER_METER,
  SIGN_SHIRT,
  SOCIAL_SITES,
  ServerMsg,
  TOAST_FROM,
  VIEWING_PLACES,
  calendarFor,
  canPredict,
  facultyDayNote,
  facultyIndexOf,
  findClub,
  interiorAt,
  isFinalist,
  liveEvent,
  nextPredictable,
  parseSocialAction,
  settle,
  viewingArea,
  weekPlan,
  weekOf,
  type GameTime,
  type SocialAction,
  type SocialStatus,
} from "@campuslife/shared";
import type { FanBook } from "./state";
import { naira } from "./types";

export interface SocialPlayer {
  x: number;
  y: number;
  cash: number;
  fun: number;
  level: string;
  department: string;
  profileId: string;
}

export interface SocialHost {
  player(id: string): SocialPlayer | undefined;
  players(): Iterable<[string, SocialPlayer]>;
  name(id: string): string;
  send(id: string, type: string, payload: unknown): void;
  notice(id: string, text: string): void;
  changed(id: string): void;
}

export interface BookKeeper {
  book(who: string): FanBook;
}

const MAX_NEED = 100;
const BOARD_Y = 0.2;
const TEXT = {
  clubSet: (name: string) => `⚽ You be ${name} fan now. No changing side when dem lose.`,
  clubTaken: (name: string) => `⚽ You don already choose ${name}. Fan na for life.`,
  noBoard: "📋 Fill your card at the fixtures board inside a hall viewing centre.",
  noMatch: "📋 No match on the card for now. Check again later.",
  late: "📋 Kick-off don pass. The card don close for this match.",
  cardBusy: "📋 You get one card wey never settle. Wait for full time.",
  cardIn: (home: string, away: string, h: number, a: number) => `📋 Card submitted: ${home} ${h} to ${a} ${away}. Free to play. Exact score wins ${naira(PREDICT.exact)}.`,
  exact: (line: string) => `🎯 Correct score! ${line}. Predict and win don pay you ${naira(PREDICT.exact)}.`,
  outcome: (line: string) => `👍 ${line}. You call the result well. ${naira(PREDICT.outcome)} for you.`,
  capped: (line: string) => `👏 ${line}. You call am again, but Predict and win pays cash only ${PREDICT.cashWinsPerWeek} times a week. +${PREDICT.cappedFun} fun`,
  miss: (line: string) => `📋 ${line}. Your card cut. Try the next match.`,
  noSignOut: "✍️ Sign-out day never reach. Check the calendar.",
  noFinalist: "✍️ Move closer to a finalist to sign the shirt.",
  signedAlready: "✍️ You don sign this shirt already. Find another finalist.",
  signed: `✍️ You don sign the shirt. Congratulations, finalist! +${SIGN_SHIRT.fun} fun`,
  signedBack: (count: number) => `✍️ The finalist don sign your own shirt too. ${count} signature${count === 1 ? "" : "s"} on your shirt.`,
  shirtSigned: (who: string, count: number) => `✍️ ${who} don sign your shirt. ${count} signature${count === 1 ? "" : "s"} now.`,
  morning: (faculty: string, note: string) => `🎓 ${faculty} Week dey on. ${note ? `Today: ${note}.` : "Rep your faculty today."} +${FACULTY_PERKS.toastFun} fun`,
  oldSchool: (faculty: string) => `🎒 ${faculty} Old School Day. Faculty students dey waka in school uniform. +${FACULTY_PERKS.weekFun} fun`,
};

export function takeCashWin(book: FanBook, week: number): boolean {
  if (book.paidWeek !== week) {
    book.paidWeek = week;
    book.paid = 0;
  }
  if (book.paid >= PREDICT.cashWinsPerWeek) return false;
  book.paid++;
  return true;
}

export class SocialDesk {
  constructor(private gate: BookKeeper, private host: SocialHost) {}

  handle(id: string, payload: unknown, now: GameTime) {
    const action = parseSocialAction(payload);
    const p = this.host.player(id);
    if (!action || !p) return;
    this.run(id, p, action, now);
    this.sendStatus(id, now);
  }

  private run(id: string, p: SocialPlayer, action: SocialAction, now: GameTime) {
    const book = this.gate.book(p.profileId || id);
    switch (action.a) {
      case "status":
        return;
      case "club":
        return this.pickClub(id, book, action.code);
      case "predict":
        return this.predict(id, p, book, action.home, action.away, now);
      case "sign":
        return this.sign(id, p, book, action.i, now);
    }
  }

  status(id: string, now: GameTime): SocialStatus | undefined {
    const p = this.host.player(id);
    if (!p) return undefined;
    const book = this.gate.book(p.profileId || id);
    const prefix = `${now.dayIndex}:`;
    return {
      club: book.club,
      predict: book.predict,
      wins: book.wins,
      shirt: book.shirtDay === now.dayIndex ? book.shirt : 0,
      finalist: isFinalist(p.level),
      faculty: facultyIndexOf(p.department),
      signed: [...book.signed].filter((k) => k.startsWith(prefix)).map((k) => Number(k.slice(prefix.length))),
    };
  }

  sendStatus(id: string, now: GameTime) {
    const status = this.status(id, now);
    if (status) this.host.send(id, ServerMsg.Social, status);
  }

  private pickClub(id: string, book: FanBook, code: string) {
    const current = findClub(book.club);
    if (current) return this.host.notice(id, TEXT.clubTaken(current.name));
    const club = findClub(code);
    if (!club) return;
    book.club = club.code;
    this.host.notice(id, TEXT.clubSet(club.name));
    this.host.changed(id);
  }

  private atBoard(p: SocialPlayer): boolean {
    const it = interiorAt(p.x, p.y);
    if (!it || !VIEWING_PLACES.includes(it.place)) return false;
    const board = viewingArea(it.template.w);
    return Math.hypot(p.x - (it.ox + board.boardX * PX_PER_METER), p.y - (it.oy + BOARD_Y * PX_PER_METER)) <= PREDICT.boardReach * PX_PER_METER;
  }

  private predict(id: string, p: SocialPlayer, book: FanBook, home: number, away: number, now: GameTime) {
    this.settleOne(id, p, book, now);
    if (book.predict) return this.host.notice(id, TEXT.cardBusy);
    if (!this.atBoard(p)) return this.host.notice(id, TEXT.noBoard);
    const match = nextPredictable(now);
    if (!match) return this.host.notice(id, TEXT.noMatch);
    if (!canPredict(match, now.total)) return this.host.notice(id, TEXT.late);
    book.predict = { key: match.key, home, away };
    this.host.notice(id, TEXT.cardIn(match.home.name, match.away.name, home, away));
    this.host.changed(id);
  }

  private settleOne(id: string, p: SocialPlayer, book: FanBook, now: GameTime): boolean {
    if (!book.predict) return false;
    const done = settle(book.predict, now.total);
    if (!done) return false;
    book.predict = undefined;
    if (done !== "void") {
      const line = `${done.match.home.name} ${done.home} to ${done.away} ${done.match.away.name}`;
      const cash = done.prize > 0 && takeCashWin(book, weekOf(done.match.dayIndex));
      if (cash) p.cash += done.prize;
      else if (done.prize > 0) p.fun = Math.min(MAX_NEED, p.fun + PREDICT.cappedFun);
      if (done.prize > 0) book.wins++;
      this.host.notice(id, done.prize <= 0 ? TEXT.miss(line) : !cash ? TEXT.capped(line) : done.result === "exact" ? TEXT.exact(line) : TEXT.outcome(line));
    }
    this.host.changed(id);
    return true;
  }

  private sign(id: string, p: SocialPlayer, book: FanBook, index: number, now: GameTime) {
    if (!liveEvent("signout", now)) return this.host.notice(id, TEXT.noSignOut);
    const finalist = SOCIAL_SITES.finalists[index];
    if (!finalist || interiorAt(p.x, p.y) || Math.hypot(finalist.x - p.x, finalist.y - p.y) > SIGN_SHIRT.reach) return this.host.notice(id, TEXT.noFinalist);
    const key = `${now.dayIndex}:${index}`;
    if (book.signed.has(key)) return this.host.notice(id, TEXT.signedAlready);
    for (const old of book.signed) if (!old.startsWith(`${now.dayIndex}:`)) book.signed.delete(old);
    book.signed.add(key);
    p.fun = Math.min(MAX_NEED, p.fun + SIGN_SHIRT.fun);
    this.host.notice(id, TEXT.signed);
    if (isFinalist(p.level)) this.host.notice(id, TEXT.signedBack(this.addSignature(book, p, now)));
    for (const [other, q] of this.host.players()) {
      if (other === id || !isFinalist(q.level) || interiorAt(q.x, q.y) || Math.hypot(q.x - p.x, q.y - p.y) > SIGN_SHIRT.share) continue;
      const count = this.addSignature(this.gate.book(q.profileId || other), q, now);
      this.host.notice(other, TEXT.shirtSigned(this.host.name(id), count));
      this.host.changed(other);
    }
    this.host.changed(id);
  }

  private addSignature(book: FanBook, p: SocialPlayer, now: GameTime): number {
    if (book.shirtDay !== now.dayIndex) {
      book.shirtDay = now.dayIndex;
      book.shirt = 0;
    }
    book.shirt++;
    p.fun = Math.min(MAX_NEED, p.fun + SIGN_SHIRT.ownFun);
    return book.shirt;
  }

  tick(now: GameTime) {
    const team = FACULTY_TEAMS[weekPlan(weekOf(now.dayIndex)).faculty];
    const oldSchool = team ? calendarFor(now.dayIndex).some((e) => e.kind === "oldschool") : false;
    for (const [id, p] of this.host.players()) {
      const book = this.gate.book(p.profileId || id);
      if (this.settleOne(id, p, book, now)) this.sendStatus(id, now);
      if (!team || now.minute < TOAST_FROM || book.toast === now.dayIndex || facultyIndexOf(p.department) !== team.index) continue;
      book.toast = now.dayIndex;
      p.fun = Math.min(MAX_NEED, p.fun + FACULTY_PERKS.toastFun + (oldSchool ? FACULTY_PERKS.weekFun : 0));
      this.host.notice(id, TEXT.morning(team.name, facultyDayNote(now.dayIndex)));
      if (oldSchool) this.host.notice(id, TEXT.oldSchool(team.name));
      this.host.changed(id);
    }
  }
}
