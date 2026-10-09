-- Ghost opponent lookup (realtime matchmaker startGhostRace): the most recent finished
-- 50-word English races. The predicate must match the query's where clause exactly.
create index matches_ghost_pool_idx on matches (finished_at desc)
  where mode in ('ranked', 'casual', 'seed') and status = 'finished'
    and text_settings @> '{"mode":"words","words":50,"language":"english","punctuation":false,"numbers":false}';
