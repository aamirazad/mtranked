-- Email-first sign-in: a one-time code emailed to the address signs in (or starts an account).
-- Codes are keyed by the lowercased email, so one works before an account exists. Accounts
-- that only ever sign in with codes store '' as users.password_hash (it never verifies).
create table email_codes (
  email text primary key,
  code_hash text not null,
  -- wrong guesses so far; the code stops working at 5
  attempts integer not null default 0,
  expires_at integer not null
) without rowid;
