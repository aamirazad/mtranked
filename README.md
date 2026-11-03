# MT Ranked

Competitive typing races built on [monkeytype](https://github.com/monkeytypegame/monkeytype)'s typing engine:

- **Ranked 1v1**: compete against people of your caliper and gain elo
- **Casual 1v1**: unrated quick match, no account needed
- **Private rooms**: compete against your friends in a typing match, or mix it up with funbox
- **Friends**: race your friends in one click and compete to get the best stats

## Credits and license

MT Ranked is a fork of [monkeytype](https://github.com/monkeytypegame/monkeytype) by Miodec and contributors. Its WPM and accuracy formulas, typing behavior, word lists, quotes, fonts and themes come from that project. Monkeytype's backend, accounts, branding, ads and links are not used. Not affiliated with monkeytype.com.

Licensed under **GPL-3.0** (see [LICENSE](./LICENSE)).

## Game Mechanics

At its core, MT Ranked has two different game modes, ranked mode and private room.

When playing ranked, you will be matched with another person at a similar level of experience to you. Once both players accept, the game is on. Type as fast as possible to beat the other player. If you do, you will gain elo. Elo is a number that represents your skill level compared to other typists. Try to increase your elo to reach the next level.

At some point you may find yourself with a group of friends whom you want to challenge to a typing competition. For that, we have private rooms. Private rooms allow you to invite all your friends to race to type the same text as fast as possible. As the host, you get to adjust what game mode everyone plays, or even mix it up and add debuffs by choosing one of the options in the the funbox.

I am always open to new feature ideas, I appreciate all issues with your feedback, both positive and negative. Thank you!

<details>
<summary>All the details</summary>

- **Ranked format**: 50 words from the 200 most common English words, no punctuation.
- **Queue**: players are kept ordered by rating. Every second the matcher pairs the closest players whose ranges overlap. Ranked range: ±50, +25 every 5s, max ±400. Casual searches wider. Back-to-back rematches are avoided unless the queue is nearly empty.
- **Ready check**: 20s. Whoever declines or misses it is taken out of the queue and given a warning; the player who accepted is put back in the queue.
- **Strikes**: declining, missing a ready check, or forfeiting a ranked or casual race (leaving it, or disconnecting past the 15s grace) is a strike. Three strikes in 10 minutes means a 5-minute queue timeout. A player who forfeits by closing the tab sees the warning when they come back.
- **Ghost races**: after 60 seconds in a ranked queue you can race a recorded replay from a player near your rating to practice while you wait
- **Race**: 3s countdown against a server timestamp (client clocks are synced by ping). Keystrokes stream in 100 ms batches. Positions stream out 10×/s, and opponent carets glide between updates.
- **Finish time** is server receipt time minus your measured one-way latency, capped at 150 ms. The final key is sent immediately.
- **Disconnects**: 15 s grace to reconnect and resume. After that, or after 25s idle, it's a forfeit, which counts as a loss in ranked. If the server restarts mid-race (a deploy), the match is voided with no rating change.
- **Ratings**: Glicko-2, starting at 1500/350. The first 5 ranked races are placements. Tiers: Bronze <1200, Silver, Gold, Platinum, Diamond, Master ≥2000.
- **Anti-cheat**: only trusted keyboard events count, and paste or multi-character insertion is ignored. Races with very uniform key timing or bursts of impossibly fast keys are flagged, and the account moves to the shadow queue. Results above 250 WPM are held for review before ratings change. Large jumps over recent form are flagged, and shared signup IPs are a soft flag. Every race keeps its seed plus keystroke log as a replay. Moderators handle reports, held results and flags at `/mod`. A ban gives back the rating that recent opponents lost.
- **Friends**: requests need the other player to accept. Presence (online, queued, racing, in a private room) is pushed to friends live. "Race" opens a private room with that friend invited; creating any room offers to invite every friend who's around. Friends in a private room can ask to join, and a host lets them in. Rooms can have several hosts: any host can promote players and remove the host role from any host, themselves included, as long as one is left. Friends can watch each other's ranked, casual and private-room races (not locked rooms); spectators are listed in the room. Players who join a private room mid-race watch it and play the next one.
- **Progression**: XP per race (bonus for wins) unlocks caret colors and shapes, win animations and profile banners. Tier rewards are granted at season peaks. Supporter cosmetics are separate. Nothing affects play.

</details>

## Technical Details

<details>
<summary>Running locally</summary>

## Running locally

### Layout

```
frontend/                 SvelteKit (Svelte 5) static SPA, Tailwind
worker/                   the Cloudflare Worker: HTTP API, realtime Hub, D1 migrations
  src/api/                ts-rest routes: auth, profiles, leaderboard, reports, moderation, Stripe
  src/hub/                the Hub Durable Object: WebSockets, matchmaking, rooms, races, ratings, anti-cheat
  src/compute.ts          Durable Object for CPU-heavy work (password hashing, scoring practice tests)
  migrations/             D1 (SQLite) schema and seed
packages/engine           typing engine shared by browser and server (seeded text, keystroke replay, wpm/acc)
packages/race-protocol    Zod schemas for every WebSocket message
packages/contracts        ts-rest HTTP contract
packages/shared           tiers, Glicko-2, XP/levels, cosmetics catalog
```

D1 is the system of record (accounts, sessions, ratings, matches, replays, reports). One Durable Object, the Hub, holds every WebSocket plus the matchmaking queue, live rooms and friends presence in memory.

Requirements: Node 22+, pnpm 11. No Docker: `pnpm dev` runs the Worker, D1 and the Durable Objects locally (workerd).

```sh
pnpm install
pnpm db:migrate           # local D1: schema, Season 0 and 12 "ghost" bots with replays
pnpm dev                  # Worker :8787, site http://localhost:5173
```

- Emails (verification, password reset) are printed in the `pnpm dev` output instead of sent.
- Local secrets live in `worker/.dev.vars` (created from `.dev.vars.example` on the first `pnpm dev`).
- New accounts can play ranked straight away locally (production waits 24h).
- With no Stripe keys, the settings page has a **dev: toggle supporter** button so you can try supporter perks.
- Local data lives in `worker/.cloudflare/state`; delete it to start over.

### Racing on your own

The dev bot signs up, queues and types at a chosen speed (with `pnpm dev` running):

```sh
pnpm bot --mode ranked --wpm 70              # ranked opponent for you
pnpm bot --mode casual --wpm 50 --races 5
pnpm bot --room ABC123 --wpm 90 --count 3    # fill a private room with 3 bots
```

You can also open a second browser profile (or a private window) and play against yourself. Each identity can have one active tab.

### Useful commands

| Command          | What it does                                                    |
| ---------------- | --------------------------------------------------------------- |
| `pnpm build`     | production builds of the frontend and the Worker                |
| `pnpm check`     | type-check everything                                           |
| `pnpm test`      | unit tests                                                      |
| `pnpm db:migrate`| apply new migrations to the local D1 database                   |

</details>

<details>
<summary>Hosting</summary>

## Hosting

Production runs entirely on Cloudflare's free plan, as one Worker named `mtranked` on `mtranked.com`:

- **Static site**: `frontend/build` is the Worker's static assets. Only `/api/*` and `/ws` invoke the Worker, so page loads cost nothing.
- **API** (`/api/*`): the Worker, reading and writing the D1 database `mtranked`.
- **Realtime** (`/ws`): the Hub Durable Object. It uses WebSocket hibernation: idle tabs send a fixed keepalive that Cloudflare answers without waking the Hub, and the Hub only runs its 100 ms timer while a queue, room or rematch offer exists.
- **Email**: Resend's HTTP API (`RESEND_API_KEY`), from `no-reply@mtranked.com`. When Resend answers 429 (daily or monthly quota, or rate limit), the email goes through Mailgun's SMTP instead (`smtp.mailgun.org:465` as `mtranked@mg.aamirazad.com`, from `no-reply@mg.aamirazad.com`), if `SMTP_PASSWORD` is set.
- **Cron**: daily at 04:17 UTC, deletes expired sessions and email tokens and starts the next season once the current one ends (3 months, ratings pulled toward 1500).

### Deploys

Every push to `main` runs `.github/workflows/deploy.yml`: the CI checks, then `cf d1 migrations apply` and `cf deploy`. A run whose commit is no longer the head of `main` skips the deploy (the newer run ships it). Deploying restarts the Hub, so races in progress at that moment are voided (players are told when they reconnect) and private rooms close.

Repository settings it uses:

| Name | Kind | |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | secret | user token "mtranked GitHub Actions deploy": Workers Scripts, D1 and Account Settings on the account; Workers Routes, DNS and Zone Read on mtranked.com |
| `CLOUDFLARE_ACCOUNT_ID` | secret | |
| `PUBLIC_SOURCE_URL`, `PUBLIC_CONTACT_EMAIL`, `PUBLIC_SENTRY_DSN` | variables | baked into the frontend build |
| `SENTRY_AUTH_TOKEN` | secret, optional | uploads frontend source maps |

To deploy by hand: `pnpm deploy` (uses your `cf auth login`). Apply new migrations first with `pnpm --filter @mtr/worker db:migrate:prod`.

### Worker settings

Plain settings are in `worker/cloudflare.config.ts` (`APP_URL`, `ADMIN_EMAILS`, `RANKED_MIN_ACCOUNT_AGE_HOURS`, `SUPPORTER_SALES`, Stripe prices). Secrets are set with `cf workers secrets update <NAME> --worker mtranked --text ...`:

- `AUTH_SECRET` (required): signs guest cookies and WebSocket tickets. Changing it signs out every guest.
- `RESEND_API_KEY` (required): verification and password reset emails.
- `SMTP_PASSWORD`: Mailgun SMTP password for `mtranked@mg.aamirazad.com`, the fallback when Resend hits its sending limit.
- `SENTRY_DSN`: backend error reporting (project `mtranked-server`).
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`: supporter subscriptions.

**Moderators**: accounts whose email is in `ADMIN_EMAILS` become moderators when that email is verified. Moderators can promote others from `/mod`.

### Stripe (subscriptions)

For now every new account is an **early supporter**: supporter perks for life, and they're never shown the price. To start selling supporter to new signups, set `SUPPORTER_SALES` to `"true"` in `worker/cloudflare.config.ts`. Accounts that are already early supporters keep their perks.

1. In the Stripe dashboard, create a product "MT Ranked Supporter" with a monthly and a yearly recurring price. Put the price IDs in `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY`.
2. Add a webhook endpoint `https://mtranked.com/api/billing/webhook` with the events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`. Set its signing secret as `STRIPE_WEBHOOK_SECRET`.
3. Set `STRIPE_SECRET_KEY`. Enable the Customer Portal (Settings → Billing → Customer portal) so users can cancel or switch plans.
4. Selling outside the US: turn on Stripe Tax and set `STRIPE_AUTOMATIC_TAX` to `"true"`.

### Staying on the free plan

The free plan's limits are per Cloudflare account (shared with the account's other projects) and reset daily at 00:00 UTC:

| Limit (free) | What uses it |
| --- | --- |
| Workers: 100k requests, 10 ms CPU each | API calls and WebSocket connects. Static assets are free. Password hashing and practice scoring run in the Compute Durable Object instead, since they need more CPU. |
| Durable Objects: 100k requests, 13,000 GB-s | WebSocket messages count 1 request per 20. Racing sends ~10/s per player; idle keepalives are free. The one Hub awake around the clock would use ~10,800 GB-s. |
| D1: 5M rows read, 100k rows written, 5 GB | A ranked race writes ~15 rows. Sessions only rewrite `last_seen_at` hourly; guests and WebSocket tickets are signed, not stored; replays are packed. |

Check usage in the Cloudflare dashboard (Workers & Pages → mtranked → Metrics, and D1 → mtranked). D1 keeps 30 days of point-in-time recovery (`cf d1 time-travel`), so there's no separate backup job.

</details>
