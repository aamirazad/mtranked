-- Synced preferences: { key: { v: value, t: ms timestamp of the change } }.
-- Each key resolves on its own; the most recent change wins.
alter table users add column prefs jsonb not null default '{}';
