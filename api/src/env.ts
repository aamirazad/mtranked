export const env = {
  prod: process.env.NODE_ENV === "production",
  port: Number(process.env.API_PORT ?? 4001),
  appUrl: (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, ""),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6380",
  smtpUrl: process.env.SMTP_URL ?? "",
  mailFrom: process.env.MAIL_FROM ?? "MT Ranked <no-reply@localhost>",
  rankedMinAgeHours: Number(process.env.RANKED_MIN_ACCOUNT_AGE_HOURS ?? 24),
  trustProxy: process.env.TRUST_PROXY ?? "loopback",
  /**
   * Off: every new account is quietly an early supporter (perks for life, never
   * asked to pay) and the site shows no trace of a supporter tier. On: supporter
   * is sold to new signups; existing early supporters keep their perks.
   */
  supporterSales: process.env.SUPPORTER_SALES === "true",
  stripe: {
    secret: process.env.STRIPE_SECRET_KEY ?? "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    priceMonthly: process.env.STRIPE_PRICE_MONTHLY ?? "",
    priceYearly: process.env.STRIPE_PRICE_YEARLY ?? "",
    automaticTax: process.env.STRIPE_AUTOMATIC_TAX === "true",
  },
};
