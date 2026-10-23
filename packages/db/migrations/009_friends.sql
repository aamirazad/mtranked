-- Friends. One row per pair of accounts: pending until the addressee accepts.
-- Declining, canceling and unfriending all delete the row.
create table friendships (
  requester_id uuid not null references users(id) on delete cascade,
  addressee_id uuid not null references users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);
-- a pair is one friendship whichever side asked first
create unique index friendships_pair_idx on friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_addressee_idx on friendships (addressee_id);
