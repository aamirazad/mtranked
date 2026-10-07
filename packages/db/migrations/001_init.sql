create extension if not exists citext;
create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext unique not null,
  password_hash text not null,
  email_verified_at timestamptz,
  created_at timestamptz not null default now(),
  display_name citext unique not null,
  country text,
  is_subscriber boolean not null default false,
  is_moderator boolean not null default false,
  is_bot boolean not null default false,
  banned_at timestamptz,
  flagged_at timestamptz,
  xp integer not null default 0,
  equipped jsonb not null default '{}',
  signup_ip text
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text unique not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text,
  ip text
);
create index on sessions (user_id);

create table email_tokens (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('verify', 'reset')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table seasons (
  id integer primary key,
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reset_params jsonb not null default '{"pull":0.5,"rd":250}'
);

create table ratings (
  user_id uuid not null references users(id) on delete cascade,
  season_id integer not null references seasons(id),
  rating double precision not null default 1500,
  rd double precision not null default 350,
  volatility double precision not null default 0.06,
  races integer not null default 0,
  wins integer not null default 0,
  peak double precision not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, season_id)
);
create index on ratings (season_id, rating desc);

create table matches (
  id uuid primary key,
  mode text not null,
  seed text not null,
  text_settings jsonb not null,
  text text not null,
  season_id integer references seasons(id),
  status text not null default 'finished' check (status in ('finished', 'held', 'void')),
  ghost_of uuid,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  rating_deltas jsonb
);
create index on matches (mode, finished_at desc);

create table match_players (
  match_id uuid not null references matches(id) on delete cascade,
  slot smallint not null,
  user_id uuid references users(id) on delete set null,
  guest_name text,
  placement smallint not null,
  wpm real not null,
  raw real not null,
  accuracy real not null,
  finished_at_ms integer,
  finished boolean not null,
  forfeit boolean not null default false,
  rating_before real,
  rating_after real,
  rating_delta real,
  xp integer not null default 0,
  primary key (match_id, slot)
);
create index on match_players (user_id, match_id);

create table replays (
  match_id uuid not null references matches(id) on delete cascade,
  slot smallint not null,
  keystrokes jsonb not null,
  primary key (match_id, slot)
);

create table reports (
  id bigserial primary key,
  reporter_id uuid references users(id) on delete set null,
  match_id uuid not null references matches(id) on delete cascade,
  reported_user_id uuid references users(id) on delete cascade,
  reason text not null,
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  moderator_notes text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references users(id)
);
create index on reports (status, created_at);

create table flags (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  match_id uuid references matches(id) on delete cascade,
  reason text not null,
  details jsonb,
  created_at timestamptz not null default now()
);
create index on flags (user_id);

create table subscriptions (
  user_id uuid primary key references users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  status text not null default 'inactive',
  renews_at timestamptz,
  updated_at timestamptz not null default now()
);

create table cosmetics (
  id text primary key,
  type text not null,
  unlock_rule jsonb not null
);

create table user_cosmetics (
  user_id uuid not null references users(id) on delete cascade,
  cosmetic_id text not null references cosmetics(id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (user_id, cosmetic_id)
);
