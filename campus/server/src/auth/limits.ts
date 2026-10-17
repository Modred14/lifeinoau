import { env } from "../config/env";

const MS_PER_MINUTE = 60_000;
const SWEEP_EVERY_MS = 5 * MS_PER_MINUTE;
const ACCOUNT_WINDOW_MS = 15 * MS_PER_MINUTE;
const IP_WINDOW_MS = 15 * MS_PER_MINUTE;
const SIGN_UP_WINDOW_MS = 60 * MS_PER_MINUTE;

interface Bucket {
  tokens: number;
  last: number;
}

export class KeyedLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    setInterval(() => this.sweep(), SWEEP_EVERY_MS).unref();
  }

  allowed(key: string): boolean {
    return this.refill(key).tokens >= 1;
  }

  spend(key: string) {
    const bucket = this.refill(key);
    bucket.tokens = Math.max(0, bucket.tokens - 1);
  }

  take(key: string): boolean {
    if (!this.allowed(key)) return false;
    this.spend(key);
    return true;
  }

  private refill(key: string): Bucket {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.limit, last: now };
    bucket.tokens = Math.min(this.limit, bucket.tokens + ((now - bucket.last) / this.windowMs) * this.limit);
    bucket.last = now;
    this.buckets.set(key, bucket);
    return bucket;
  }

  private sweep() {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.last > this.windowMs) this.buckets.delete(key);
    }
  }
}

export const accountFailures = new KeyedLimiter(env.SIGN_IN_FAILURES_PER_ACCOUNT, ACCOUNT_WINDOW_MS);
export const ipRequests = new KeyedLimiter(env.AUTH_REQUESTS_PER_IP, IP_WINDOW_MS);
export const ipSignUps = new KeyedLimiter(env.SIGN_UPS_PER_IP, SIGN_UP_WINDOW_MS);
