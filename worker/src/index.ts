// MT Ranked on Cloudflare. Static assets are served by Cloudflare before this runs; only
// /api/* and /ws reach the Worker (cloudflare.config.ts, assets.runWorkerFirst).
import * as Sentry from "@sentry/cloudflare";
import { handleApi } from "./api";
import { Compute as ComputeBase } from "./compute";
import { daily } from "./cron";
import { Hub as HubBase } from "./hub";
import { sentryOptions } from "./sentry";
import { hub } from "./stubs";

const handler = {
  async fetch(request, env, cx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/ws") return hub().fetch(request);
    if (pathname.startsWith("/api/")) return handleApi(request, cx);
    return new Response("Not found", { status: 404 });
  },

  async scheduled(_event, _env, cx) {
    cx.waitUntil(daily());
  },
} satisfies ExportedHandler<Env>;

export default Sentry.withSentry(sentryOptions, handler);
export const Hub = Sentry.instrumentDurableObjectWithSentry(sentryOptions, HubBase);
export const Compute = Sentry.instrumentDurableObjectWithSentry(sentryOptions, ComputeBase);
