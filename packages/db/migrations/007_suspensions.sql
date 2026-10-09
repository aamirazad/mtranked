-- Moderator suspensions. A ban (banned_at) locks the account out entirely; a timeout
-- (timed_out_until) keeps the account usable but blocks ranked and casual matchmaking.
-- ban_ips holds the addresses a banned account used, so new signups from them can be
-- flagged as possible ban evaders (never blocked: shared networks are common).
alter table users
  add column timed_out_until timestamptz,
  add column suspension_reason text,
  add column ban_ips text[] not null default '{}';
create index users_banned_idx on users (banned_at) where banned_at is not null;
