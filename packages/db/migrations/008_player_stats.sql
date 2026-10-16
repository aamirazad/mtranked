-- Player statistics: richer per-result data, persisted practice tests and one view
-- over every result a player owns, which the profile's stats are derived from.

-- per-result detail computed by the server when a race is scored
alter table match_players
  add column duration_ms integer,
  -- consistency of the per-second raw speed (0-100, monkeytype's definition)
  add column consistency real,
  -- [correct, incorrect, extra, missed] characters
  add column chars integer[];

-- how long each player typed for: the finish time, else the length of the race
update match_players mp set duration_ms = coalesce(mp.finished_at_ms,
    least(120000, greatest(0, round(extract(epoch from (m.finished_at - m.started_at)) * 1000))))
  from matches m where m.id = mp.match_id;

-- number of players in the race, so a win can be told from a solo run without a count
alter table matches add column players smallint;
update matches m set players = (select count(*) from match_players mp where mp.match_id = m.id);

-- Solo practice tests. The text is regenerated on the server from the seed and the
-- result is computed by replaying the keystrokes, like a race; keystrokes are not kept.
create table practice_results (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  text_settings jsonb not null,
  seed text not null,
  wpm real not null,
  raw real not null,
  accuracy real not null,
  consistency real,
  chars integer[],
  duration_ms integer not null,
  created_at timestamptz not null default now()
);
create index practice_results_user_idx on practice_results (user_id, created_at desc);

-- Every counted result of a player: finished (non-void, non-held) races plus practice.
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
select p.user_id, 'practice', 'practice', null, p.text_settings, true, false, 1, 1,
  p.wpm, p.raw, p.accuracy, p.consistency, p.duration_ms, p.chars, null, p.created_at
from practice_results p;
