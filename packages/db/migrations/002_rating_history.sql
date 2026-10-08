-- One row per change to a player's season rating, written by a trigger on `ratings`
-- so every path (races, approved held matches, ban refunds, season rollover) is covered.
create table rating_history (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  season_id integer not null references seasons(id),
  rating double precision not null,
  races integer not null,
  created_at timestamptz not null default now()
);
create index on rating_history (user_id, season_id, created_at);

-- backfill: a season-start baseline, then the rating after each rated race
insert into rating_history (user_id, season_id, rating, races, created_at)
select r.user_id, r.season_id,
  coalesce(
    (select mp.rating_before from match_players mp join matches m on m.id = mp.match_id
      where mp.user_id = r.user_id and m.season_id = r.season_id and m.status = 'finished'
        and mp.rating_after is not null
      order by m.finished_at limit 1),
    case when r.races = 0 then r.rating else 1500 end),
  0, s.starts_at
from ratings r join seasons s on s.id = r.season_id;

insert into rating_history (user_id, season_id, rating, races, created_at)
select mp.user_id, m.season_id, mp.rating_after,
  row_number() over (partition by mp.user_id, m.season_id order by m.finished_at), m.finished_at
from match_players mp join matches m on m.id = mp.match_id
where mp.user_id is not null and m.season_id is not null and m.status = 'finished' and mp.rating_after is not null;

-- end on the stored rating when later adjustments (refunds, approvals) moved it
insert into rating_history (user_id, season_id, rating, races, created_at)
select r.user_id, r.season_id, r.rating, r.races, greatest(r.updated_at, s.starts_at)
from ratings r join seasons s on s.id = r.season_id
where round(r.rating) is distinct from (
  select round(h.rating) from rating_history h where h.user_id = r.user_id and h.season_id = r.season_id
  order by h.created_at desc, h.id desc limit 1);

create function log_rating_change() returns trigger language plpgsql as $$
begin
  insert into rating_history (user_id, season_id, rating, races)
  values (new.user_id, new.season_id, new.rating, new.races);
  return null;
end $$;

create trigger ratings_history_insert after insert on ratings
  for each row execute function log_rating_change();
create trigger ratings_history_update after update of rating on ratings
  for each row when (old.rating is distinct from new.rating) execute function log_rating_change();
