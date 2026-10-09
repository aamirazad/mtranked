import { randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import { env } from "./env";

export const redis = new Redis(env.redisUrl);
export const sub = new Redis(env.redisUrl);
/** Unique id of this realtime process; rooms record which node owns them. */
export const NODE_ID = randomBytes(4).toString("hex");

// heartbeat so other nodes can tell whether a room's owner is still alive:
// one sorted set scored by last beat, so counting nodes never needs KEYS
const NODES = "nodes";
const ALIVE_MS = 10_000;
const beat = () =>
  redis
    .multi()
    .zadd(NODES, Date.now(), NODE_ID)
    .zremrangebyscore(NODES, "-inf", Date.now() - 6 * ALIVE_MS)
    .exec()
    .catch((e) => console.error("[redis] heartbeat failed", e));
void beat();
setInterval(beat, 3000).unref();

export const nodeAlive = async (id: string) => {
  if (id === NODE_ID) return true;
  const at = await redis.zscore(NODES, id);
  return at !== null && Number(at) > Date.now() - ALIVE_MS;
};

/** Number of nodes that beat recently. */
export const liveNodes = () => redis.zcount(NODES, Date.now() - ALIVE_MS, "+inf");
