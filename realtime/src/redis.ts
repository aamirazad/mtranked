import { randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import { env } from "./env";

export const redis = new Redis(env.redisUrl);
export const sub = new Redis(env.redisUrl);
/** Unique id of this realtime process; rooms record which node owns them. */
export const NODE_ID = randomBytes(4).toString("hex");

// heartbeat so other nodes can tell whether a room's owner is still alive
const beat = () => redis.set(`node:${NODE_ID}`, "1", "EX", 10);
void beat();
setInterval(beat, 3000).unref();

export const nodeAlive = async (id: string) => id === NODE_ID || (await redis.exists(`node:${id}`)) === 1;
