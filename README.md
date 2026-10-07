# MT Ranked

Competitive typing races built on [monkeytype](https://github.com/monkeytypegame/monkeytype)'s typing engine:

- **Ranked 1v1**: matchmaking by Glicko-2 rating, placements, tiers, seasons
- **Casual 1v1**: unrated quick match, guests welcome
- **Private rooms**: invite link or 6-character code, host picks the text, running scoreboard

The server is the referee. It generates the text from a seed, replays every keystroke and computes the result with monkeytype's WPM and accuracy formulas. Nothing the browser reports about its own speed is trusted.

## Credits and license

MT Ranked is a fork of [monkeytype](https://github.com/monkeytypegame/monkeytype) by Miodec and contributors. Its WPM and accuracy formulas, typing behaviour, word lists, quotes, fonts and the serika dark theme come from that project. Monkeytype's backend, accounts, branding, ads and links are not used.

Licensed under **GPL-3.0** (see `LICENSE`), like monkeytype. Because the frontend JavaScript is sent to every visitor, publish this repository openly and set `PUBLIC_SOURCE_URL` so the footer links to your source. Not affiliated with monkeytype.com.

## Layout

```
frontend/                 SvelteKit (Svelte 5) static SPA, Tailwind
api/                      Express + ts-rest: auth, profiles, leaderboard, reports, moderation, Stripe
realtime/                 WebSocket server (ws): matchmaking, rooms, races, ratings, anti-cheat
packages/engine           typing engine shared by browser and server (seeded text, keystroke replay, wpm/acc)
packages/race-protocol    Zod schemas for every WebSocket message
packages/contracts        ts-rest HTTP contract
packages/shared           tiers, Glicko-2, XP/levels, cosmetics catalogue
packages/db               Postgres client, SQL migrations, seed and maintenance scripts
```

Postgres is the system of record (accounts, sessions, ratings, matches, replays, reports). Redis holds the matchmaking queues, live room snapshots, WebSocket tickets and rate limits.

## Running locally

Requirements: Node 22+, pnpm 11, Docker.

```sh
pnpm install
cp .env.example .env
pnpm services:up          # Postgres :5433, Redis :6380, Mailpit :8025
pnpm db:migrate
pnpm db:seed              # Season 0, cosmetics and 12 "ghost" bots with replays
pnpm dev                  # api :4001, realtime :4002, site http://localhost:5173
```

- Emails (verification, password reset) land in Mailpit at http://localhost:8025.
- `RANKED_MIN_ACCOUNT_AGE_HOURS=0` in `.env` lets new accounts play ranked straight away (production uses 24).
- With no Stripe keys, the settings page has a **dev: toggle supporter** button so you can try supporter perks.
- Give an account moderator rights: `pnpm make-moderator you@example.com` (adds the shield icon and `/mod`).

### Racing on your own

The dev bot signs up, queues and types at a chosen speed:

```sh
pnpm bot --mode ranked --wpm 70              # ranked opponent for you
pnpm bot --mode casual --wpm 50 --races 5
pnpm bot --room ABC123 --wpm 90 --count 3    # fill a private room with 3 bots
```

You can also open a second browser profile (or a private window) and play against yourself. Each identity can have one active tab.

### Useful commands

| Command                    | What it does                                         |
| -------------------------- | ---------------------------------------------------- |
| `pnpm build`               | production builds of every package                   |
| `pnpm check`               | type-check everything                                |
| `pnpm test`                | engine unit tests                                    |
| `pnpm season:rollover`     | end the current season, start the next (soft reset)  |
| `pnpm services:down`       | stop the local Docker services                       |

## How the game works

- **Ranked format**: 50 words from the 200 most common English words, no punctuation.
- **Queue**: Redis sorted set by rating. Every second the matcher pairs the closest players whose ranges overlap. Ranked range: ±50, +25 every 5 s, max ±400. Casual searches wider. Back-to-back rematches are avoided unless the queue is nearly empty.
- **Ready check**: 10 s. Two declines or misses in 10 minutes means a 5-minute queue timeout. The player who accepted is put back in the queue.
- **Ghost races**: after 60 s in the ranked queue you can race a recorded replay from a player near your rating while staying in the queue.
- **Race**: 3 s countdown against a server timestamp (client clocks are synced by ping). Keystrokes stream in 100 ms batches. Positions stream out 10×/s, and opponent carets glide between updates.
- **Finish time** is server receipt time minus your measured one-way latency, capped at 150 ms. The final key is sent immediately.
- **Disconnects**: 15 s grace to reconnect and resume. After that, or after 25 s idle, it's a forfeit, which counts as a loss in ranked. If a realtime node restarts mid-race, the match is voided with no rating change.
- **Ratings**: Glicko-2, starting at 1500/350. The first 5 ranked races are placements. Tiers: Bronze <1200, Silver, Gold, Platinum, Diamond, Master ≥2000.
- **Anti-cheat**: only trusted keyboard events count, and paste or multi-character insertion is ignored. Races with very uniform key timing or bursts of impossibly fast keys are flagged and the account moves to the shadow queue. Results above 250 WPM are held for review before ratings change. Large jumps over recent form are flagged, and shared signup IPs are a soft flag. Every race keeps its seed plus keystroke log as a replay. Moderators handle reports, held results and flags at `/mod`. A ban gives back the rating that recent opponents lost.
- **Progression**: XP per race (bonus for wins) unlocks caret colours and shapes, win animations and profile banners. Tier rewards are granted at season peaks. Supporter cosmetics are separate. Nothing affects play.

## Hosting publicly

The simplest setup is one VPS running everything with Docker Compose. Caddy terminates HTTPS and serves the site, the API and the WebSocket from one domain, so cookies stay first-party.

### 1. Prerequisites

1. **Lawyer check on GPL obligations** before you charge money (selling subscriptions is allowed under GPL, but get a quick read).
2. **Push this repo to a public Git host** (GitHub etc.) and note the URL for `PUBLIC_SOURCE_URL`.
3. **A domain**, e.g. `mtranked.com`.
4. **A VPS** in US East, e.g. Hetzner Ashburn CPX21 (3 vCPU / 4 GB) or a DigitalOcean/Vultr equivalent. That's plenty for launch. Install Docker: `curl -fsSL https://get.docker.com | sh`.
5. **A transactional email provider** with SMTP: Resend, Postmark or Amazon SES. Verify your sending domain (SPF/DKIM DNS records) in their dashboard.

### 2. DNS

Create an `A` record (and `AAAA` if you have IPv6) for your domain pointing at the VPS IP. If you use Cloudflare, start with the proxy **off** (grey cloud) so Caddy can get its certificate. You can turn it on later with SSL mode "Full (strict)"; WebSockets work through Cloudflare's proxy.

### 3. Deploy

```sh
ssh you@your-server
git clone https://github.com/your-name/mt-ranked.git && cd mt-ranked
cp .env.production.example .env.production
nano .env.production        # DOMAIN, APP_URL, POSTGRES_PASSWORD, SMTP_URL, MAIL_FROM, PUBLIC_SOURCE_URL
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

This builds two images and starts Postgres, Redis, a one-off `migrate` job (migrations plus idempotent seed), the API, the realtime server and Caddy on ports 80/443. Open `https://your-domain`. Caddy obtains and renews the TLS certificate automatically.

Then:

```sh
# make yourself a moderator after signing up on the site
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm migrate node packages/db/dist/make-moderator.js you@example.com
```

To update later: `git pull && docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build`.

Before public launch, wipe the beta (Season 0) by running the season rollover:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm migrate node packages/db/dist/season-rollover.js 3
```

Run the same command from cron every ~3 months to start each new season (`3` = length in months).

### 4. Stripe (subscriptions)

1. In the Stripe dashboard, create a product "MT Ranked Supporter" with a monthly and a yearly recurring price. Put the price IDs in `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY`.
2. Add a webhook endpoint `https://your-domain/api/billing/webhook` with the events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
3. Set `STRIPE_SECRET_KEY`. Enable the Customer Portal (Settings → Billing → Customer portal) so users can cancel or switch plans.
4. Selling outside the US: turn on Stripe Tax and set `STRIPE_AUTOMATIC_TAX=true`.
5. Restart: `docker compose ... up -d`.

Perks follow `users.is_subscriber`, which the webhook keeps in sync. Cancelled plans stay active until the paid period ends.

### 5. Backups and operations

- **Database backups**: either point `DATABASE_URL` at a managed Postgres (Neon, Supabase or RDS, with daily backups and PITR) or add a nightly cron on the VPS:
  `docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U mtr mtr | gzip > /backups/mtr-$(date +%F).sql.gz` and copy the files off the box.
- **Managed Redis** (optional): set `REDIS_URL` (Upstash/Redis Cloud). The bundled Redis uses an append-only file.
- **Logs**: `docker compose -f docker-compose.prod.yml logs -f api realtime`.
- **Health**: `https://your-domain/api/health`. The realtime server exposes `/health` inside the Docker network.
- **Replays**: keystroke logs live in Postgres (a few KB per race). Move them to S3/R2 when that table gets large.

### Alternative: static frontend on Cloudflare Pages

You can host `frontend/build` on Cloudflare Pages or Vercel (build command `pnpm install && pnpm --filter @mtr/frontend build`, output `frontend/build`, SPA fallback `200.html`). Run the API and realtime server on `api.your-domain`, and route `/api/*` and `/ws` on the site's domain to that host (for example with a Cloudflare Worker or Pages Functions proxy) so the session cookie stays first-party. Keeping everything behind the single Caddy domain is simpler.

### Scaling later

Live room state is mirrored to Redis, the matcher runs under a Redis lock, and nodes forward room messages over Redis pub/sub. You can therefore add more `realtime` replicas behind a load balancer with sticky sessions. Rooms run on the node that created them.
