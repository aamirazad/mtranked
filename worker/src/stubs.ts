// Typed handles on this Worker's Durable Objects (the config's binding types can't see them).
import { env } from "cloudflare:workers";
import type { Compute } from "./compute";
import type { Hub } from "./hub";
import { randomInt } from "./crypto";

/** The one Hub: every socket, queue and room. */
export const hub = () => (env.HUB as DurableObjectNamespace<Hub>).getByName("hub");

/** One of a few Compute instances, so CPU-heavy calls run in parallel. */
export const compute = () => (env.COMPUTE as DurableObjectNamespace<Compute>).getByName(`c${randomInt(4)}`);

/** Text bindings are typed as their literal config value; compare them as plain strings. */
export const flag = (v: string | undefined) => String(v) === "true";
