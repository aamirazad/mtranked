-- Early supporters: accounts created while signups grant supporter for free.
-- They keep supporter perks for life, independent of any Stripe subscription.
alter table users add column early_supporter boolean not null default false;
update users set early_supporter = true, is_subscriber = true where not is_bot;
