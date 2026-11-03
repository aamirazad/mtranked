// Optional secrets: set with `cf workers secrets` only when the feature is used.
declare namespace Cloudflare {
  interface Env {
    /** backend error reporting (Sentry project mtranked-server) */
    SENTRY_DSN?: string;
    /** supporter subscriptions; SUPPORTER_SALES must also be "true" */
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
  }
}
