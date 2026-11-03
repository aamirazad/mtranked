import * as Sentry from "@sentry/cloudflare";

/** Sentry options; a no-op unless the SENTRY_DSN secret is set. */
export const sentryOptions = (env: Env) => ({
  dsn: env.SENTRY_DSN || undefined,
  environment: env.ENVIRONMENT,
  tracesSampleRate: 0,
});

/** Log an error and report it to Sentry. */
export function reportError(label: string, e: unknown, extra: Record<string, unknown> = {}) {
  console.error(label, ...Object.values(extra), e);
  Sentry.captureException(e, { tags: { where: label }, extra });
}
