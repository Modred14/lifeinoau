import { parseSocial, type PredictionSave, type SocialSave, type TicketSave } from "@campuslife/shared";

export interface Ticket {
  seconds: number;
  bonus: boolean;
  moments: number;
  goals: number;
  half: boolean;
  full: boolean;
  day: number;
}

export interface FanBook {
  tickets: Map<string, Ticket>;
  club: string;
  predict?: PredictionSave;
  signed: Set<string>;
  shirt: number;
  shirtDay: number;
  toast: number;
  wins: number;
  paidWeek: number;
  paid: number;
}

export const TICKET_KEEP_DAYS = 1;
export const TICKET_HARD_CAP = 48;
const NO_WEEK = Number.MIN_SAFE_INTEGER;
const BONUS = 1;
const HALF = 2;
const FULL = 4;

export const newBook = (): FanBook => ({ tickets: new Map(), club: "", signed: new Set(), shirt: 0, shirtDay: -1, toast: -1, wins: 0, paidWeek: NO_WEEK, paid: 0 });

export function pruneTickets(book: FanBook, today: number) {
  for (const [key, ticket] of book.tickets) if (ticket.day < today - TICKET_KEEP_DAYS) book.tickets.delete(key);
  while (book.tickets.size > TICKET_HARD_CAP) {
    let oldest: string | undefined;
    let day = Infinity;
    for (const [key, ticket] of book.tickets)
      if (ticket.day < day) {
        day = ticket.day;
        oldest = key;
      }
    if (oldest === undefined) break;
    book.tickets.delete(oldest);
  }
}

export function issueTicket(book: FanBook, key: string, day: number, moments = 0, goals = 0): Ticket {
  pruneTickets(book, day);
  const ticket: Ticket = { seconds: 0, bonus: false, moments, goals, half: false, full: false, day };
  book.tickets.set(key, ticket);
  return ticket;
}

export function bookFromSave(raw: unknown): FanBook {
  const saved = parseSocial(raw);
  const book = newBook();
  for (const [key, t] of Object.entries(saved.tickets ?? {})) book.tickets.set(key, { seconds: t[0], bonus: (t[1] & BONUS) > 0, half: (t[1] & HALF) > 0, full: (t[1] & FULL) > 0, moments: t[2], goals: t[3], day: t[4] });
  book.club = saved.club ?? "";
  book.predict = saved.predict;
  book.signed = new Set(saved.signed ?? []);
  book.shirt = saved.shirt ?? 0;
  book.shirtDay = saved.shirtDay ?? -1;
  book.toast = saved.toast ?? -1;
  book.wins = saved.wins ?? 0;
  if (saved.paid) [book.paidWeek, book.paid] = saved.paid;
  return book;
}

export function bookToSave(book: FanBook): SocialSave {
  const tickets: Record<string, TicketSave> = {};
  for (const [key, t] of book.tickets) tickets[key] = [Math.round(t.seconds), (t.bonus ? BONUS : 0) | (t.half ? HALF : 0) | (t.full ? FULL : 0), t.moments, t.goals, t.day];
  const out: SocialSave = { tickets, signed: [...book.signed], shirt: book.shirt, wins: book.wins };
  if (book.club) out.club = book.club;
  if (book.predict) out.predict = { ...book.predict };
  if (book.shirtDay >= 0) out.shirtDay = book.shirtDay;
  if (book.toast >= 0) out.toast = book.toast;
  if (book.paid > 0) out.paid = [book.paidWeek, book.paid];
  return out;
}
