import express, { type Router } from "express";
import Stripe from "stripe";
import { initServer } from "@ts-rest/express";
import { contract } from "@mtr/contracts";
import { sql } from "@mtr/db";
import { getAuth } from "../auth";
import { env } from "../env";
import { reportError } from "../sentry";

const s = initServer();
const stripe = env.stripe.secret ? new Stripe(env.stripe.secret) : null;
const unauth = { status: 401 as const, body: { message: "Sign in first." } };

async function customerFor(userId: string, email: string): Promise<string> {
  const [row] = await sql`select stripe_customer_id from subscriptions where user_id = ${userId}`;
  if (row?.stripe_customer_id) return row.stripe_customer_id;
  const customer = await stripe!.customers.create({ email, metadata: { userId } });
  await sql`insert into subscriptions (user_id, stripe_customer_id) values (${userId}, ${customer.id})
    on conflict (user_id) do update set stripe_customer_id = excluded.stripe_customer_id`;
  return customer.id;
}

export const billingRouter = s.router(contract.billing, {
  status: async ({ req, res }) => {
    const auth = await getAuth(req, res);
    if (!auth) return unauth;
    const [sub] = await sql`select status, renews_at from subscriptions where user_id = ${auth.user.id}`;
    return {
      status: 200,
      body: {
        enabled: !!stripe,
        status: sub?.status ?? "inactive",
        renewsAt: sub?.renews_at?.toISOString() ?? null,
        subscriber: auth.user.is_subscriber,
      },
    };
  },

  checkout: async ({ req, res, body }) => {
    const auth = await getAuth(req, res);
    if (!auth) return unauth;
    if (!stripe) return { status: 400, body: { message: "Payments aren't configured on this server." } };
    const price = body.interval === "year" ? env.stripe.priceYearly : env.stripe.priceMonthly;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: await customerFor(auth.user.id, auth.user.email),
      client_reference_id: auth.user.id,
      line_items: [{ price, quantity: 1 }],
      success_url: `${env.appUrl}/settings?subscribed=1`,
      cancel_url: `${env.appUrl}/settings`,
      automatic_tax: { enabled: env.stripe.automaticTax },
      ...(env.stripe.automaticTax ? { customer_update: { address: "auto" as const } } : {}),
    });
    return { status: 200, body: { url: session.url! } };
  },

  portal: async ({ req, res }) => {
    const auth = await getAuth(req, res);
    if (!auth) return unauth;
    if (!stripe) return { status: 400, body: { message: "Payments aren't configured on this server." } };
    const portal = await stripe.billingPortal.sessions.create({
      customer: await customerFor(auth.user.id, auth.user.email),
      return_url: `${env.appUrl}/settings`,
    });
    return { status: 200, body: { url: portal.url } };
  },

  devToggle: async ({ req, res }) => {
    if (env.prod || stripe) return { status: 404, body: { message: "Not available." } };
    const auth = await getAuth(req, res);
    if (!auth) return unauth;
    await sql`update users set is_subscriber = not is_subscriber where id = ${auth.user.id}`;
    return { status: 200, body: { ok: true } };
  },
});

async function syncSubscription(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const periodEnd =
    (sub as unknown as { current_period_end?: number }).current_period_end ?? sub.items.data[0]?.current_period_end;
  // perks last until the paid period ends; Stripe moves the status to
  // "canceled" only once that happens
  const active = ["active", "trialing", "past_due"].includes(sub.status);
  const [row] = await sql`update subscriptions set stripe_subscription_id = ${sub.id}, status = ${sub.status},
      renews_at = ${periodEnd ? new Date(periodEnd * 1000) : null}, updated_at = now()
    where stripe_customer_id = ${customerId} returning user_id`;
  if (row) await sql`update users set is_subscriber = ${active} or early_supporter where id = ${row.user_id}`;
}

/** Stripe webhook: needs the raw body for signature verification. */
export function stripeWebhook(): Router {
  const router = express.Router();
  router.post("/api/billing/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    if (!stripe || !env.stripe.webhookSecret) return void res.status(404).end();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.get("stripe-signature") ?? "", env.stripe.webhookSecret);
    } catch {
      return void res.status(400).send("bad signature");
    }
    try {
      switch (event.type) {
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted":
          await syncSubscription(event.data.object);
          break;
        case "checkout.session.completed": {
          const cs = event.data.object;
          if (cs.subscription) {
            const id = typeof cs.subscription === "string" ? cs.subscription : cs.subscription.id;
            await syncSubscription(await stripe.subscriptions.retrieve(id));
          }
          break;
        }
      }
      res.json({ received: true });
    } catch (e) {
      reportError("[stripe] webhook error", e);
      res.status(500).end();
    }
  });
  return router;
}
