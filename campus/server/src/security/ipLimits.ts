import { env } from "../config/env";

const UNKNOWN_IP = "unknown";
const SWEEP_EVERY_MS = 60_000;
const MS_PER_MINUTE = 60_000;

interface Bucket {
  tokens: number;
  last: number;
}

const joinBuckets = new Map<string, Bucket>();
const connections = new Map<string, number>();

export function ipKey(ip: string | undefined): string {
  return ip?.trim() || UNKNOWN_IP;
}

export function allowJoin(ip: string): boolean {
  const now = Date.now();
  const burst = env.JOINS_PER_MINUTE_PER_IP;
  const bucket = joinBuckets.get(ip) ?? { tokens: burst, last: now };
  bucket.tokens = Math.min(burst, bucket.tokens + ((now - bucket.last) / MS_PER_MINUTE) * burst);
  bucket.last = now;
  joinBuckets.set(ip, bucket);
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

export function addConnection(ip: string): boolean {
  const count = connections.get(ip) ?? 0;
  if (count >= env.MAX_CONNECTIONS_PER_IP) return false;
  connections.set(ip, count + 1);
  return true;
}

export function removeConnection(ip: string) {
  const count = (connections.get(ip) ?? 0) - 1;
  if (count > 0) connections.set(ip, count);
  else connections.delete(ip);
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of joinBuckets) {
    if (now - bucket.last > MS_PER_MINUTE) joinBuckets.delete(ip);
  }
}, SWEEP_EVERY_MS).unref();
