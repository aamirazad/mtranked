export const env = {
  prod: process.env.NODE_ENV === "production",
  port: Number(process.env.REALTIME_PORT ?? 4002),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6380",
  rankedMinAgeHours: Number(process.env.RANKED_MIN_ACCOUNT_AGE_HOURS ?? 24),
  appUrl: (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, ""),
};
