import { Redis } from "ioredis";
import { env } from "./env";

export const redis = new Redis(env.redisUrl, { maxRetriesPerRequest: 3 });

/** Fixed-window rate limiter. Returns true if the request is allowed. */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  const k = `rl:${key}`;
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, windowSec);
  return n <= limit;
}
