import { env } from "cloudflare:workers";
import type Stripe from "stripe";
import { contract } from "@mtr/contracts";
import { getAuth } from "../auth";
import { isoOrNull, one, run } from "../db";
import { reportError } from "../sentry";
import { flag } from "../stubs";
import { s, unauth } from "./tsr";

const sales = () => flag(env.SUPPORTER_SALES);

let client: Promise<Stripe | null> | undefined;
/** Loaded on first use: most requests never touch Stripe. */
function stripe(): Promise<Stripe | null> {
  client ??= env.STRIPE_SECRET_KEY
    ? import("stripe").then(({ default: S }) => new S(env.STRIPE_SECRET_KEY!, { httpClient: S.createFetchHttpClient() }))
    : Promise.resolve(null);
  return client;
}

async function customerFor(st: Stripe, userId: string, email: string): Promise<string> {
  const row = await one<{ stripe_customer_id: string | null }>("select stripe_customer_id from subscriptions where user_id = ?", userId);
  if (row?.stripe_customer_id) return row.stripe_customer_id;
  const customer = await st.customers.create({ email, metadata: { userId } });
  await run(
    `insert into subscriptions (user_id, stripe_customer_id, updated_at) values (?, ?, ?)
     on conflict (user_id) do update set stripe_customer_id = excluded.stripe_customer_id`,
    userId,
    customer.id,
    Date.now(),
  );
  return customer.id;
}

export const billingRouter = s.router(contract.billing, {
  status: async (_, { h }) => {
    const auth = await getAuth(h);
    if (!auth) return unauth;
    const sub = await one<{ status: string; renews_at: number | null }>(
      "select status, renews_at from subscriptions where user_id = ?",
      auth.user.id,
    );
    return {
      status: 200,
      body: {
        enabled: !!env.STRIPE_SECRET_KEY && sales(),
        status: sub?.status ?? "inactive",
        renewsAt: isoOrNull(sub?.renews_at),
        subscriber: auth.user.is_subscriber,
      },
    };
  },

  checkout: async ({ body }, { h }) => {
    const auth = await getAuth(h);
    if (!auth) return unauth;
    const st = await stripe();
    if (!st || !sales()) return { status: 400, body: { message: "Payments aren't configured on this server." } };
    const automaticTax = flag(env.STRIPE_AUTOMATIC_TAX);
    const session = await st.checkout.sessions.create({
      mode: "subscription",
      customer: await customerFor(st, auth.user.id, auth.user.email),
      client_reference_id: auth.user.id,
      line_items: [{ price: body.interval === "year" ? env.STRIPE_PRICE_YEARLY : env.STRIPE_PRICE_MONTHLY, quantity: 1 }],
      success_url: `${env.APP_URL}/settings?subscribed=1`,
      cancel_url: `${env.APP_URL}/settings`,
      automatic_tax: { enabled: automaticTax },
      ...(automaticTax ? { customer_update: { address: "auto" as const } } : {}),
    });
    return { status: 200, body: { url: session.url! } };
  },

  portal: async (_, { h }) => {
    const auth = await getAuth(h);
    if (!auth) return unauth;
    const st = await stripe();
    if (!st) return { status: 400, body: { message: "Payments aren't configured on this server." } };
    const portal = await st.billingPortal.sessions.create({
      customer: await customerFor(st, auth.user.id, auth.user.email),
      return_url: `${env.APP_URL}/settings`,
    });
    return { status: 200, body: { url: portal.url } };
  },

  devToggle: async (_, { h }) => {
    if (String(env.ENVIRONMENT) === "production" || env.STRIPE_SECRET_KEY) return { status: 404, body: { message: "Not available." } };
    const auth = await getAuth(h);
    if (!auth) return unauth;
    await run("update users set is_subscriber = not is_subscriber where id = ?", auth.user.id);
    return { status: 200, body: { ok: true } };
  },
});

async function syncSubscription(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const periodEnd =
    (sub as unknown as { current_period_end?: number }).current_period_end ?? sub.items.data[0]?.current_period_end;
  // perks last until the paid period ends; Stripe moves the status to "canceled" only once that happens
  const active = ["active", "trialing", "past_due"].includes(sub.status);
  const row = await one<{ user_id: string }>(
    `update subscriptions set stripe_subscription_id = ?, status = ?, renews_at = ?, updated_at = ?
     where stripe_customer_id = ? returning user_id`,
    sub.id,
    sub.status,
    periodEnd ? periodEnd * 1000 : null,
    Date.now(),
    customerId,
  );
  if (row) await run("update users set is_subscriber = (? or early_supporter) where id = ?", active ? 1 : 0, row.user_id);
}

/** POST /api/billing/webhook: verified against the raw body, so it's handled outside ts-rest. */
export async function stripeWebhook(request: Request): Promise<Response> {
  const st = await stripe();
  if (!st || !env.STRIPE_WEBHOOK_SECRET) return new Response(null, { status: 404 });
  const { default: S } = await import("stripe");
  let event: Stripe.Event;
  try {
    event = await st.webhooks.constructEventAsync(
      await request.text(),
      request.headers.get("stripe-signature") ?? "",
      env.STRIPE_WEBHOOK_SECRET,
      undefined,
      S.createSubtleCryptoProvider(),
    );
  } catch {
    return new Response("bad signature", { status: 400 });
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
          await syncSubscription(await st.subscriptions.retrieve(id));
        }
        break;
      }
    }
    return Response.json({ received: true });
  } catch (e) {
    reportError("[stripe] webhook error", e);
    return new Response(null, { status: 500 });
  }
}
