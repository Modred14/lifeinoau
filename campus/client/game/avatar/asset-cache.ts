export interface AssetLease<T> {
  value: T;
  release: () => void;
}

interface CacheEntry<T> {
  key: string;
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  value?: T;
  loaded: boolean;
  retired: boolean;
  disposed: boolean;
  leases: number;
  touched: number;
}

export class SharedAssetCache<T> {
  private entries = new Map<string, CacheEntry<T>>();
  private queue: CacheEntry<T>[] = [];
  private active = 0;
  private clock = 0;

  constructor(
    private load: (key: string) => Promise<T>,
    private dispose: (value: T) => void,
    private capacity = 24,
    private concurrency = 4,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1 || !Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error("Asset cache limits must be positive integers");
    }
  }

  async acquire(key: string): Promise<AssetLease<T>> {
    let entry = this.entries.get(key);
    if (!entry) {
      let resolve!: (value: T) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
      entry = { key, promise, resolve, reject, loaded: false, retired: false, disposed: false, leases: 0, touched: ++this.clock };
      this.entries.set(key, entry);
      this.queue.push(entry);
    }
    entry.leases++;
    entry.touched = ++this.clock;
    this.pump();
    try {
      const value = await entry.promise;
      let released = false;
      return {
        value,
        release: () => {
          if (released) return;
          released = true;
          entry.leases--;
          entry.touched = ++this.clock;
          this.disposeRetired(entry);
          this.trim();
        },
      };
    } catch (error) {
      entry.leases--;
      throw error;
    }
  }

  invalidate(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    entry.retired = true;
    this.disposeRetired(entry);
  }

  get stats() {
    return {
      cached: this.entries.size,
      loading: this.active,
      queued: this.queue.length,
      leased: [...this.entries.values()].filter((entry) => entry.leases > 0).length,
    };
  }

  private pump() {
    while (this.active < this.concurrency && this.queue.length) {
      const entry = this.queue.shift()!;
      this.active++;
      void Promise.resolve().then(() => this.load(entry.key)).then(
        (value) => {
          entry.value = value;
          entry.loaded = true;
          entry.resolve(value);
          this.disposeRetired(entry);
        },
        (error: unknown) => {
          if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
          entry.reject(error);
        },
      ).finally(() => {
        this.active--;
        this.trim();
        this.pump();
      });
    }
  }

  private trim() {
    const available = [...this.entries.values()]
      .filter((entry) => entry.loaded && entry.leases === 0)
      .sort((a, b) => a.touched - b.touched);
    while (this.entries.size > this.capacity && available.length) {
      const entry = available.shift()!;
      this.invalidate(entry.key);
    }
  }

  private disposeRetired(entry: CacheEntry<T>) {
    if (!entry.retired || !entry.loaded || entry.leases > 0 || entry.disposed) return;
    entry.disposed = true;
    this.dispose(entry.value!);
  }
}
