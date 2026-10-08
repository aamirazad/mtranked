-- Display names can only be changed once every 30 days; null means never changed.
alter table users add column name_changed_at timestamptz;
