import { MarketError, type MarketErrorCode } from "@campuslife/shared/market";

const STATUS: Record<MarketErrorCode, number> = {
  [MarketError.Invalid]: 400,
  [MarketError.SignedOut]: 401,
  [MarketError.Forbidden]: 403,
  [MarketError.NotFound]: 404,
  [MarketError.Conflict]: 409,
  [MarketError.NotDeliverable]: 409,
  [MarketError.TooManyOpen]: 429,
  [MarketError.TooManyRequests]: 429,
  [MarketError.Unavailable]: 503,
};

export class MarketFailure extends Error {
  readonly status: number;

  constructor(readonly code: MarketErrorCode) {
    super(code);
    this.status = STATUS[code];
  }
}
