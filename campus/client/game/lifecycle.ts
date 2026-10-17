export class SubscriptionScope {
  private cleanups = new Set<() => void>();
  private closed = false;

  constructor(private readonly onError: (error: unknown) => void = (error) => console.warn("[Campus Life] subscription cleanup failed", error)) {}

  get size() {
    return this.cleanups.size;
  }

  add(...cleanups: Array<() => void>) {
    for (const cleanup of cleanups) {
      if (this.closed) this.release(cleanup);
      else this.cleanups.add(cleanup);
    }
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    const cleanups = [...this.cleanups];
    this.cleanups.clear();
    for (const cleanup of cleanups) this.release(cleanup);
  }

  private release(cleanup: () => void) {
    try { cleanup(); } catch (error) { this.onError(error); }
  }
}
