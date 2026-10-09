import * as Sentry from "@sentry/node";

// Error reporting only (no tracing); a no-op unless SENTRY_DSN is set.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    // keep passwords, session cookies, tokens in URLs and local variables out of reports
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    },
    // report unhandled rejections, then crash as Node would without Sentry
    integrations: [Sentry.onUnhandledRejectionIntegration({ mode: "strict" })],
  });
}

/** Log an error and report it to Sentry. */
export function reportError(label: string, e: unknown, extra: Record<string, unknown> = {}) {
  console.error(label, ...Object.values(extra), e);
  Sentry.captureException(e, { tags: { where: label }, extra });
}
