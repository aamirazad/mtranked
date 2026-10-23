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
- **Queue**: Redis sorted set by rating. Every second the matcher pairs the closest players whose ranges overlap. Ranked range: ±50, +25 every 5s, max ±400. Casual searches wider. Back-to-back rematches are avoided unless the queue is nearly empty.
- **Ready check**: 20s. Whoever declines or misses it is taken out of the queue and given a warning; the player who accepted is put back in the queue.
- **Strikes**: declining, missing a ready check, or forfeiting a ranked or casual race (leaving it, or disconnecting past the 15s grace) is a strike. Three strikes in 10 minutes means a 5-minute queue timeout. A player who forfeits by closing the tab sees the warning when they come back.
- **Ghost races**: after 60 seconds in a ranked queue you can race a recorded replay from a player near your rating to practice while you wait
- **Race**: 3s countdown against a server timestamp (client clocks are synced by ping). Keystrokes stream in 100 ms batches. Positions stream out 10×/s, and opponent carets glide between updates.
- **Finish time** is server receipt time minus your measured one-way latency, capped at 150 ms. The final key is sent immediately.
- **Disconnects**: 15 s grace to reconnect and resume. After that, or after 25s idle, it's a forfeit, which counts as a loss in ranked. If the server restarts mid-race, the match is voided with no rating change.
- **Ratings**: Glicko-2, starting at 1500/350. The first 5 ranked races are placements. Tiers: Bronze <1200, Silver, Gold, Platinum, Diamond, Master ≥2000.
- **Anti-cheat**: only trusted keyboard events count, and paste or multi-character insertion is ignored. Races with very uniform key timing or bursts of impossibly fast keys are flagged, and the account moves to the shadow queue. Results above 250 WPM are held for review before ratings change. Large jumps over recent form are flagged, and shared signup IPs are a soft flag. Every race keeps its seed plus keystroke log as a replay. Moderators handle reports, held results and flags at `/mod`. A ban gives back the rating that recent opponents lost.
- **Friends**: requests need the other player to accept. Presence (online, queued, racing, in a private room) lives in Redis and is pushed to friends live. "Race" opens a private room with that friend invited; creating any room offers to invite every friend who's around. Friends in a private room can ask to join, and a host lets them in. Rooms can have several hosts: any host can promote players and remove the host role from any host, themselves included, as long as one is left. Friends can watch each other's ranked, casual and private-room races (not locked rooms); spectators are listed in the room. Players who join a private room mid-race watch it and play the next one.
- **Progression**: XP per race (bonus for wins) unlocks caret colors and shapes, win animations and profile banners. Tier rewards are granted at season peaks. Supporter cosmetics are separate. Nothing affects play.

</details>

## Technical Details

<details>
<summary>Running locally</summary>

## Running locally

### Layout

```
frontend/                 SvelteKit (Svelte 5) static SPA, Tailwind
api/                      Express + ts-rest: auth, profiles, leaderboard, reports, moderation, Stripe
realtime/                 WebSocket server (ws): matchmaking, rooms, races, ratings, anti-cheat
packages/engine           typing engine shared by browser and server (seeded text, keystroke replay, wpm/acc)
packages/race-protocol    Zod schemas for every WebSocket message
packages/contracts        ts-rest HTTP contract
packages/shared           tiers, Glicko-2, XP/levels, cosmetics catalog
packages/db               Postgres client, SQL migrations, seed and maintenance scripts
```

Postgres is the system of record (accounts, sessions, ratings, matches, replays, reports). Redis holds the matchmaking queues, live room snapshots, WebSocket tickets and rate limits.

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

</details>

<details>
<summary>Hosting publically</summary>

## Hosting publicly

The simplest setup is one VPS running everything with Docker Compose. Caddy terminates HTTPS and serves the site, the API and the WebSocket from one domain, so cookies stay first-party.

### 1. Prerequisites

1. **Lawyer check on GPL obligations** before you charge money (selling subscriptions is allowed under GPL, but get a quick read).
2. **Push this repo to a public Git host** (GitHub etc.) and note the URL for `PUBLIC_SOURCE_URL`.
3. **A domain**, e.g. `mtranked.com`.
4. **A VPS** in US East, e.g. Hetzner Ashburn CPX21 (3 vCPU / 4 GB) or a DigitalOcean/Vultr equivalent. That's plenty for launch. Install Docker: `curl -fsSL https://get.docker.com | sh`.
5. **A transactional email provider** with SMTP: Resend, Postmark or Amazon SES. Verify your sending domain (SPF/DKIM DNS records) in their dashboard.

### 2. DNS

Create an `A` record (and `AAAA` if you have IPv6) for your domain pointing at the VPS IP. If you use Cloudflare, start with the proxy **off** (gray cloud) so Caddy can get its certificate. You can turn it on later with SSL mode "Full (strict)"; WebSockets work through Cloudflare's proxy.

### 3. Deploy

The whole app (migrations, API, realtime server, frontend and Caddy) ships as one image, `ghcr.io/aamirazad/mtranked`, built by GitHub Actions (see [Releases and images](#releases-and-images)). Postgres, Redis and the backup job run next to it as stock images.

```sh
ssh you@your-server
git clone https://github.com/your-name/mt-ranked.git && cd mt-ranked
cp .env.production.example .env.production
nano .env.production        # DOMAIN, APP_URL, POSTGRES_PASSWORD, SMTP_URL, MAIL_FROM, MTR_TAG
mkdir -p backups             # daily database dumps land here (see Backups below)
echo "$GHCR_TOKEN" | docker login ghcr.io -u your-github-user --password-stdin   # only while the package is private
docker compose --env-file .env.production -f docker-compose.prod.yml pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

This starts Postgres, Redis, the backup job and the `app` container on ports 80/443. On every start the app applies migrations and the idempotent seed, then runs the API, the realtime server and Caddy. Open `https://your-domain`. Caddy obtains and renews the TLS certificate automatically. If you put the container behind another reverse proxy instead, set `SITE_ADDRESS=:80` so Caddy serves plain HTTP.

Then:

```sh
# make yourself a moderator after signing up on the site
docker compose --env-file .env.production -f docker-compose.prod.yml exec app node packages/db/dist/make-moderator.js you@example.com
```

To update later: `docker compose --env-file .env.production -f docker-compose.prod.yml pull && docker compose --env-file .env.production -f docker-compose.prod.yml up -d`. The realtime server lets races in progress finish (up to 150 s) before the old container stops.

Before public launch, wipe the beta (Season 0) by running the season rollover:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml exec app node packages/db/dist/season-rollover.js 3
```

Run the same command from cron every ~3 months to start each new season (`3` = length in months).

### 4. Stripe (subscriptions)

For now every new account is an **early supporter**: supporter perks for life, and they're never shown the price. To start selling supporter to new signups, set `EARLY_SUPPORTER_SIGNUPS = false` in `packages/shared/src/constants.ts`. Accounts that are already early supporters keep their perks.

1. In the Stripe dashboard, create a product "MT Ranked Supporter" with a monthly and a yearly recurring price. Put the price IDs in `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY`.
2. Add a webhook endpoint `https://your-domain/api/billing/webhook` with the events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
3. Set `STRIPE_SECRET_KEY`. Enable the Customer Portal (Settings → Billing → Customer portal) so users can cancel or switch plans.
4. Selling outside the US: turn on Stripe Tax and set `STRIPE_AUTOMATIC_TAX=true`.
5. Restart: `docker compose … up -d`.

Perks follow `users.is_subscriber`, which the webhook keeps in sync. Canceled plans stay active until the paid period ends.

### 5. Backups

The `backup` service dumps the database with `pg_dump -Fc` when the stack starts and then once a day. Dumps go to `./backups` in the repo checkout on the VPS, named like `mtr-2026-01-31T030000Z.dump`. Dumps from the last 14 days are kept; older ones are deleted only after a new dump succeeds, so a failing backup never removes good ones. The files are owned by whoever owns the directory, so run `mkdir -p backups` as your SSH user before the first `up` (if Docker creates it, it and the dumps belong to root). Change the location with `BACKUP_DIR` and the retention with `BACKUP_KEEP_DAYS` in `.env.production`, then run `docker compose … up -d`.

Check that it's working:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml logs backup   # "ok: mtr-....dump (1.2M)" per run
ls -lh backups/
```

**Restore** (this **overwrites** the live database with the dump):

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml stop app
deploy/restore.sh backups/mtr-2026-01-31T030000Z.dump
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

The restore runs `pg_restore --clean --if-exists` in a single transaction, so it either fully succeeds or changes nothing. Tables that were added after the dump was taken are left in place.

**Copy backups off the VPS.** Dumps stored on the VPS are lost along with it if the server dies, is deleted or is compromised. Pull them to another machine every day, for example from a home server or laptop with cron:

```sh
# crontab -e on another machine: daily at 04:30
30 4 * * * rsync -a you@your-server:mt-ranked/backups/ ~/mt-ranked-backups/
```

`rclone copy` to S3/R2/Backblaze works the same way. Turning on your VPS provider's backup or snapshot feature (Hetzner, DigitalOcean and Vultr all offer it for a small fee) adds a second safety net. Test a restore now and then.

If you point `DATABASE_URL` at a managed Postgres (Neon, Supabase, RDS), use its built-in backups instead; the `backup` service only dumps the bundled `postgres` container.

### 6. Operations

- **Managed Redis** (optional): set `REDIS_URL` (Upstash/Redis Cloud). The bundled Redis uses an append-only file.
- **Logs**: `docker compose -f docker-compose.prod.yml logs -f app`.
- **Health**: `https://your-domain/api/health`. The realtime server exposes `/health` on port 4002 inside the container; Docker's healthcheck polls both.
- **Replays**: keystroke logs live in Postgres (a few KB per race). Move them to S3/R2 when that table gets large.

### Alternative: behind a Cloudflare Tunnel

If the server already runs other services and reaches the internet through `cloudflared`, let Cloudflare handle HTTPS and have Caddy serve plain HTTP on a local port:

1. In `.env.production`, set `SITE_ADDRESS=:80` and `TRUST_PROXY=loopback,uniquelocal`. The second makes the API take the visitor's IP from `X-Forwarded-For` instead of seeing every request as coming from `cloudflared`, which would put the whole site in one rate-limit bucket.
2. Start the stack with `docker-compose.tunnel.yml` added. It replaces the 80/443 ports with `127.0.0.1:${APP_PORT:-8085}`, so only the tunnel can reach the app (and nobody can fake `X-Forwarded-For`):
   ```sh
   docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.tunnel.yml up -d
   ```
   Use the same `-f` pair for every other `docker compose` command. `!override` needs Docker Compose 2.24.4 or newer.
3. In the tunnel, add one public hostname, `your-domain` → `http://localhost:8085`. That covers the site, `/api` and the `/ws` WebSocket (the frontend uses `wss://` automatically on HTTPS). If `cloudflared` runs in a container on a bridge network, attach it to the `mt-ranked_default` network and use `http://app:80` instead.
4. In Cloudflare, turn on SSL/TLS → Edge Certificates → **Always Use HTTPS** (the session cookie is `Secure`) and keep **Network → WebSockets** on. Leave Rocket Loader off.

To check the client IP setup, sign in and look at your sessions in Settings: the IP should be yours, not a `172.x` address.

### Alternative: static frontend on Cloudflare Pages

You can host `frontend/build` on Cloudflare Pages or Vercel (build command `pnpm install && pnpm --filter @mtr/frontend build`, output `frontend/build`, SPA fallback `200.html`). Run the API and realtime server on `api.your-domain`, and route `/api/*` and `/ws` on the site's domain to that host (for example with a Cloudflare Worker or Pages Functions proxy) so the session cookie stays first-party. Keeping everything behind the single Caddy domain is simpler.

### Scaling later

Live room state is mirrored to Redis, the matcher runs under a Redis lock, and nodes forward room messages over Redis pub/sub. You can therefore add more `realtime` replicas behind a load balancer with sticky sessions. Rooms run on the node that created them.

### Releases and images

GitHub Actions (`.github/workflows/`) tests every change and publishes the image to `ghcr.io/aamirazad/mtranked`:

| Event                                   | Runs                                                       | Image tags                                  |
| --------------------------------------- | ---------------------------------------------------------- | ------------------------------------------- |
| Pull request                            | frontend check + build; backend check, tests, build, migrations against Postgres | none                 |
| Pull request titled with the `ci` scope, e.g. `feat(ci): …` | the above, plus a Docker build and smoke test | none                           |
| Push to `main`                          | tests in parallel with build + smoke test, then push                            | `main`, `sha-<short sha>`                   |
| Tag `v1.2.3`                            | same as main                                                                     | `1.2.3`, `1.2`, `1`, `latest`, `sha-<short sha>` |
| Tag `v1.2.3-rc.1`                       | same as main                                                                     | `1.2.3-rc.1`, `sha-<short sha>`             |

Set `MTR_TAG` in `.env.production` to choose what the server runs: `main` follows every commit on main, `latest` the newest release, and `1.2.3` (or `sha-abc1234`) pins one build. To cut a release, create a tag such as `v1.2.3` (or a GitHub release, which creates the tag).

`scripts/smoke-test.sh <image>` boots an image against throwaway Postgres and Redis containers and checks it the same way CI does.

The frontend has its public settings baked in at build time. Set them as repository **variables** (Settings → Secrets and variables → Actions): `PUBLIC_CONTACT_EMAIL`, `PUBLIC_SENTRY_DSN`, and optionally `PUBLIC_SOURCE_URL` (defaults to this repository's URL). Add a `SENTRY_AUTH_TOKEN` repository **secret** to upload frontend source maps to Sentry.

</details>
