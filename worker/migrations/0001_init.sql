-- MT Ranked schema for Cloudflare D1 (SQLite), ported from the original Postgres migrations.
-- Timestamps are integer milliseconds since the epoch, booleans are 0/1, JSON is stored as text.
-- Keep it lean: the free plan counts every row (and index entry) written.

create table users (
  id text primary key,
  email text not null unique collate nocase,
  password_hash text not null,
  email_verified_at integer,
  created_at integer not null,
  display_name text not null unique collate nocase,
  country text,
  is_subscriber integer not null default 0,
  -- accounts created while signups grant supporter for free keep the perks for life
  early_supporter integer not null default 0,
  is_moderator integer not null default 0,
  is_bot integer not null default 0,
  banned_at integer,
  -- a timeout keeps the account usable but blocks ranked and casual matchmaking
  timed_out_until integer,
  suspension_reason text,
  -- JSON array of the addresses a banned account used, so signups from them get flagged
  ban_ips text not null default '[]',
  flagged_at integer,
  xp integer not null default 0,
  equipped text not null default '{}',
  -- synced preferences: { key: { v: value, t: ms timestamp of the change } }
  prefs text not null default '{}',
  signup_ip text,
  -- display names can only be changed once every 30 days; null means never changed
  name_changed_at integer
);
create index users_banned_idx on users (banned_at) where banned_at is not null;
-- shared-IP and ban-evader checks
create index users_signup_ip_idx on users (signup_ip) where signup_ip is not null;

create table sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  token_hash text not null unique,
  created_at integer not null,
  last_seen_at integer not null,
  expires_at integer not null,
  user_agent text,
  ip text
);
create index sessions_user_idx on sessions (user_id);

create table email_tokens (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  kind text not null check (kind in ('verify', 'reset')),
  expires_at integer not null
);

create table seasons (
  id integer primary key,
  name text not null,
  starts_at integer not null,
  ends_at integer not null,
  reset_params text not null default '{"pull":0.5,"rd":250}'
);

create table ratings (
  user_id text not null references users(id) on delete cascade,
  season_id integer not null references seasons(id),
  rating real not null default 1500,
  rd real not null default 350,
  volatility real not null default 0.06,
  races integer not null default 0,
  wins integer not null default 0,
  peak real not null default 0,
  updated_at integer not null,
  primary key (user_id, season_id)
) without rowid;
create index ratings_ladder_idx on ratings (season_id, rating desc);

-- one row per change to a season rating, written by triggers so every path is covered
create table rating_history (
  id integer primary key,
  user_id text not null references users(id) on delete cascade,
  season_id integer not null,
  rating real not null,
  races integer not null,
  created_at integer not null
);
create index rating_history_idx on rating_history (user_id, season_id, created_at);

create trigger ratings_history_insert after insert on ratings begin
  insert into rating_history (user_id, season_id, rating, races, created_at)
  values (new.user_id, new.season_id, new.rating, new.races, new.updated_at);
end;
create trigger ratings_history_update after update of rating on ratings
  when old.rating is not new.rating begin
  insert into rating_history (user_id, season_id, rating, races, created_at)
  values (new.user_id, new.season_id, new.rating, new.races, new.updated_at);
end;

create table matches (
  id text primary key,
  mode text not null,
  seed text not null,
  text_settings text not null,
  text text not null,
  season_id integer,
  status text not null default 'finished' check (status in ('finished', 'held', 'void')),
  ghost_of text,
  started_at integer not null,
  finished_at integer not null,
  -- pending rating changes of a held match, applied if a moderator approves it
  rating_deltas text,
  players integer
);
create index matches_mode_idx on matches (mode, finished_at desc);
create index matches_status_idx on matches (status) where status <> 'finished';
-- ghost opponent lookup (hub/matchmaker.ts startGhostRace): the predicate must match the query's exactly
create index matches_ghost_pool_idx on matches (finished_at desc)
  where mode in ('ranked', 'casual', 'seed') and status = 'finished'
    and text_settings ->> '$.mode' = 'words' and text_settings ->> '$.words' = 50
    and text_settings ->> '$.language' = 'english' and text_settings ->> '$.punctuation' = 0
    and text_settings ->> '$.numbers' = 0;

create table match_players (
  match_id text not null references matches(id) on delete cascade,
  slot integer not null,
  user_id text references users(id) on delete set null,
  guest_name text,
  placement integer not null,
  wpm real not null,
  raw real not null,
  accuracy real not null,
  finished_at_ms integer,
  finished integer not null,
  forfeit integer not null default 0,
  rating_before real,
  rating_after real,
  rating_delta real,
  xp integer not null default 0,
  -- how long the player typed for: the finish, forfeit or end of the race
  duration_ms integer,
  -- consistency of the per-second raw speed (0-100, monkeytype's definition)
  consistency real,
  -- JSON [correct, incorrect, extra, missed] characters
  chars text,
  primary key (match_id, slot)
) without rowid;
create index match_players_user_idx on match_players (user_id) where user_id is not null;

-- keystroke logs, packed as JSON [[key, ms since the previous key], ...] (see src/keys.ts)
create table replays (
  match_id text not null references matches(id) on delete cascade,
  slot integer not null,
  keystrokes text not null,
  primary key (match_id, slot)
) without rowid;

create table reports (
  id integer primary key,
  reporter_id text references users(id) on delete set null,
  match_id text not null references matches(id) on delete cascade,
  reported_user_id text references users(id) on delete cascade,
  reason text not null,
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  moderator_notes text,
  created_at integer not null,
  resolved_at integer,
  resolved_by text references users(id) on delete set null
);
create index reports_status_idx on reports (status, created_at);

create table flags (
  id integer primary key,
  user_id text not null references users(id) on delete cascade,
  match_id text references matches(id) on delete cascade,
  reason text not null,
  details text,
  created_at integer not null
);
create index flags_user_idx on flags (user_id);
create index flags_created_idx on flags (created_at);

create table subscriptions (
  user_id text primary key references users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  status text not null default 'inactive',
  renews_at integer,
  updated_at integer not null
);

-- cosmetics granted outright (tier rewards); level and supporter unlocks are computed from the
-- catalog in @mtr/shared, which is the only copy of it
create table user_cosmetics (
  user_id text not null references users(id) on delete cascade,
  cosmetic_id text not null,
  primary key (user_id, cosmetic_id)
) without rowid;

-- solo practice tests, scored on the server by replaying the keystrokes (which are not kept)
create table practice_results (
  id integer primary key,
  user_id text not null references users(id) on delete cascade,
  text_settings text not null,
  wpm real not null,
  raw real not null,
  accuracy real not null,
  consistency real,
  chars text,
  duration_ms integer not null,
  created_at integer not null
);
create index practice_results_user_idx on practice_results (user_id, created_at desc);

-- one row per pair of accounts: pending until the addressee accepts; declining, canceling and
-- unfriending all delete it
create table friendships (
  requester_id text not null references users(id) on delete cascade,
  addressee_id text not null references users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at integer not null,
  accepted_at integer,
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
) without rowid;
-- a pair is one friendship whichever side asked first
create unique index friendships_pair_idx on friendships (min(requester_id, addressee_id), max(requester_id, addressee_id));
create index friendships_addressee_idx on friendships (addressee_id);

-- every counted result of a player: finished (non-void, non-held) races plus practice.
-- kind groups modes the way the profile shows them (ghost races count as casual).
create view user_results as
select mp.user_id,
  case m.mode when 'ghost' then 'casual' else m.mode end as kind,
  m.mode,
  m.id as match_id,
  m.text_settings as settings,
  mp.finished,
  mp.forfeit,
  mp.placement,
  coalesce(m.players, 1) as players,
  mp.wpm,
  mp.raw,
  mp.accuracy,
  mp.consistency,
  coalesce(mp.duration_ms, mp.finished_at_ms, 0) as duration_ms,
  mp.chars,
  mp.rating_after,
  m.finished_at as at
from match_players mp join matches m on m.id = mp.match_id
where mp.user_id is not null and m.status = 'finished' and m.mode in ('ranked', 'casual', 'ghost', 'private')
union all
select p.user_id, 'practice', 'practice', null, p.text_settings, 1, 0, 1, 1,
  p.wpm, p.raw, p.accuracy, p.consistency, p.duration_ms, p.chars, null, p.created_at
from practice_results p;

-- the first season; the daily cron starts the next one when it ends (src/cron.ts)
insert into seasons (id, name, starts_at, ends_at)
values (0, 'Season 0 (Beta)', cast(unixepoch('subsec') * 1000 as integer) - 86400000,
  cast(unixepoch('subsec', '+3 months') * 1000 as integer));
