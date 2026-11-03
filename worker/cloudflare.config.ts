// The whole of MT Ranked runs as this one Worker on mtranked.com:
//   - static assets: the SvelteKit SPA in ../frontend/build (served without invoking the Worker)
//   - /api/*: the HTTP API (src/api), backed by D1
//   - /ws: the realtime server, one Hub Durable Object holding every socket, queue and room (src/hub)
// Every limit below is chosen to stay inside the Workers Free plan; see README "Hosting".
import { bindings, defineConfig, exports, triggers } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig(({ mode }) => {
  const dev = mode === "development";
  return {
    worker: {
      name: "mtranked",
      compatibilityDate: "2026-10-01",
      compatibilityFlags: ["nodejs_compat"],
      entrypoint,
      // only these paths reach the Worker; everything else is a static asset (free, unmetered)
      assets: { notFoundHandling: "single-page-application", runWorkerFirst: ["/api/*", "/ws"] },
      domains: dev ? [] : ["mtranked.com"],
      // daily housekeeping: expired sessions and tokens, season rollover (src/cron.ts)
      triggers: [triggers.scheduled({ schedule: "17 4 * * *" })],
      // console.error/warn only; per-request invocation logs would eat the free log quota
      observability: { enabled: true, logs: { enabled: true, invocationLogs: false } },
      env: {
        DB: bindings.d1({ name: "mtranked", id: "636fb508-8220-41ec-a6c5-97d10c7c0c9a" }),
        HUB: bindings.durableObject({ worker: "mtranked", exportName: "Hub" }),
        COMPUTE: bindings.durableObject({ worker: "mtranked", exportName: "Compute" }),
        // Workers rate limiting (free): per-colo, 10 or 60 second windows
        RL_STRICT: bindings.rateLimit({ namespace: "1001", simple: { limit: 5, period: 60 } }),
        RL_NORMAL: bindings.rateLimit({ namespace: "1002", simple: { limit: 20, period: 60 } }),
        RL_LOOSE: bindings.rateLimit({ namespace: "1003", simple: { limit: 120, period: 60 } }),
        APP_URL: bindings.text(dev ? "http://localhost:5173" : "https://mtranked.com"),
        ENVIRONMENT: bindings.text(dev ? "development" : "production"),
        MAIL_FROM: bindings.text("MT Ranked <no-reply@mtranked.com>"),
        // fallback when Resend hits its sending limit (src/mail.ts); needs the SMTP_PASSWORD secret.
        // Sent from the Mailgun domain so SPF/DKIM line up with the From address.
        SMTP_HOST: bindings.text("smtp.mailgun.org"),
        SMTP_USER: bindings.text("mtranked@mg.aamirazad.com"),
        SMTP_FROM: bindings.text("MT Ranked <no-reply@mg.aamirazad.com>"),
        // verifying one of these emails makes the account a moderator (comma separated)
        ADMIN_EMAILS: bindings.text("aamirmazad@gmail.com"),
        RANKED_MIN_ACCOUNT_AGE_HOURS: bindings.text(dev ? "0" : "24"),
        // "true" sells supporter to new signups (needs the Stripe secrets below)
        SUPPORTER_SALES: bindings.text("false"),
        STRIPE_PRICE_MONTHLY: bindings.text(""),
        STRIPE_PRICE_YEARLY: bindings.text(""),
        STRIPE_AUTOMATIC_TAX: bindings.text("false"),
        // required secrets (Worker secrets in production, .dev.vars locally; RESEND_API_KEY may be
        // empty in dev). Optional ones (SENTRY_DSN, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
        // SMTP_PASSWORD) are typed in src/env.d.ts and only need setting when used.
        AUTH_SECRET: bindings.secret(),
        RESEND_API_KEY: bindings.secret(),
      },
      exports: {
        Hub: exports.durableObject({ storage: "sqlite" }),
        Compute: exports.durableObject({ storage: "sqlite" }),
      },
    },
  };
});
