/**
 * Token-bucket rate limiter, one per client.
 * Allows short bursts (e.g. tapping quickly) but caps the sustained rate.
 */
export class RateLimiter {
  private tokens: number;
  private last = Date.now();
  /** Number of messages dropped so far. */
  violations = 0;

  constructor(
    private readonly ratePerSecond: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
  }

  /** Returns true if the message may be processed. */
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.ratePerSecond);
    this.last = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    this.violations++;
    return false;
  }
}
