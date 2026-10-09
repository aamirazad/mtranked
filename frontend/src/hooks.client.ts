import * as Sentry from "@sentry/sveltekit";

// Errors only (no tracing), from production builds that set PUBLIC_SENTRY_DSN.
Sentry.init({
  dsn: __SENTRY_DSN__,
  enabled: import.meta.env.PROD,
  // Turns off collection of data that could identify users. Adjust per category:
  // https://docs.sentry.io/platforms/javascript/configuration/options/#dataCollection
  dataCollection: {
    userInfo: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    httpBodies: [],
    httpHeaders: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
    cookies: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
    urlQueryParams: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
  },
});

export const handleError = Sentry.handleErrorWithSentry();
