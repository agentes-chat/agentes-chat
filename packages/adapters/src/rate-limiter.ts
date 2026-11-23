import { isIPv6 } from "node:net";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

/**
 * Throttling for our own endpoints (posting messages, WebSocket frames, password tries).
 * Better Auth keeps its own limiter per IP. Core: in-memory fixed
 * window, per process. Cloud: Redis.
 */
export interface RateLimiter {
  consume(key: string, rule: { limit: number; windowMs: number }): Promise<RateLimitResult>;
  /** Gives back one take of `key` in its current window, never below none. */
  release(key: string): Promise<void>;
}

/** Seconds until a rate limit's window opens again, at least 1. */
export const retryInSeconds = (resetAt: Date) => Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));

/** The most windows the memory limiter keeps: an address per key, and no key named by a stranger is kept past this. */
export const MEMORY_LIMIT_KEYS = 100_000;

/**
 * Fixed windows per process, in memory. Past `MEMORY_LIMIT_KEYS` the oldest windows go, whatever their time: a flood
 * of keys from fabricated addresses (each `X-Forwarded-For` its own, with no trusted proxy) then costs a bounded map
 * and never a sweep of it on every call. A key dropped early gets a fresh window, which only ever loosens a limit
 * under a flood; the sweeping keeps maps small enough that an honest key is not the oldest.
 */
export function createMemoryRateLimiter(now: () => number = Date.now): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    async consume(key, rule) {
      const t = now();
      let w = windows.get(key);
      if (!w || w.resetAt <= t) {
        w = { count: 0, resetAt: t + rule.windowMs };
        windows.set(key, w);
      }
      w.count++;
      if (windows.size > MEMORY_LIMIT_KEYS) {
        // Expired first (a Map keeps insertion order), then the oldest live ones, so the map never grows past the cap.
        for (const [k, v] of windows) {
          if (windows.size <= MEMORY_LIMIT_KEYS) break;
          if (v.resetAt <= t) windows.delete(k);
        }
        for (const k of windows.keys()) {
          if (windows.size <= MEMORY_LIMIT_KEYS) break;
          windows.delete(k);
        }
      }
      return {
        allowed: w.count <= rule.limit,
        remaining: Math.max(0, rule.limit - w.count),
        resetAt: new Date(w.resetAt),
      };
    },
    async release(key) {
      const w = windows.get(key);
      if (w && w.resetAt > now() && w.count > 0) w.count--;
    },
  };
}

/**
 * The part of an address a rate limit counts: an IPv4 address whole, an IPv6 one by its /64, which one customer
 * usually holds whole (each of its 2^64 addresses would get a fresh count otherwise), as Better Auth counts its own.
 */
export function limitIp(ip: string): string {
  const address = ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");
  if (!isIPv6(address)) return address;
  const [head = "", tail] = (address.split("%")[0] ?? "").toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  // An IPv4 tail (`64:ff9b::192.0.2.1`) takes two groups' room.
  const room = 8 - left.length - right.reduce((n, group) => n + (group.includes(".") ? 2 : 1), 0);
  const groups = tail === undefined ? left : [...left, ...Array<string>(room).fill("0"), ...right];
  return `${groups
    .slice(0, 4)
    .map((group) => Number.parseInt(group, 16).toString(16))
    .join(":")}::/64`;
}
