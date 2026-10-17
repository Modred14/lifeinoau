import { isToken, newToken, sha256 } from "./secrets";

const TICKET_TTL_MS = 30_000;
const SWEEP_EVERY_MS = 60_000;

export interface TicketHolder {
  accountId: string;
  playerId: string;
  username: string;
  oau?: { characterId: string; level: string; department: string; background: string; look?: string };
}

interface Ticket extends TicketHolder {
  expiresAt: number;
}

const tickets = new Map<string, Ticket>();

export function issueTicket(holder: TicketHolder): string {
  const ticket = newToken();
  tickets.set(sha256(ticket), { ...holder, expiresAt: Date.now() + TICKET_TTL_MS });
  return ticket;
}

/** A ticket works once. Returns who it was issued to, or null when it is unknown, used or expired. */
export function redeemTicket(ticket: unknown): TicketHolder | null {
  if (!isToken(ticket)) return null;
  const id = sha256(ticket);
  const found = tickets.get(id);
  if (!found) return null;
  tickets.delete(id);
  if (found.expiresAt < Date.now()) return null;
  return { accountId: found.accountId, playerId: found.playerId, username: found.username, ...(found.oau ? { oau: found.oau } : {}) };
}

setInterval(() => {
  const now = Date.now();
  for (const [id, ticket] of tickets) {
    if (ticket.expiresAt < now) tickets.delete(id);
  }
}, SWEEP_EVERY_MS).unref();
