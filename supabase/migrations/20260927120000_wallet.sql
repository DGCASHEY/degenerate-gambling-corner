-- Accounts, the ledger, the faucet and the bet debit.
--
-- The rules this file enforces (see CLAUDE.md):
--   * A balance is never stored. It is the sum of the ledger, every time.
--   * The ledger is append-only. Rows are never edited or deleted.
--   * Every coin movement runs inside one transaction that first locks the
--     player's account row, so two requests for one player take turns.
--   * Every movement carries an idempotency key. A repeat returns the first
--     result and changes nothing.
--   * No balance can ever go below zero, even if something skips the
--     functions and writes to the table directly.
--   * The browser (anon / authenticated) can touch none of this. Only the
--     server (service_role) can call these functions.
--
-- Money: none. Coins are play money stored as whole hundredths
-- (1 coin = 100 units) so there is never any rounding.

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

create table public.accounts (
  id uuid primary key references auth.users (id) on delete restrict,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  -- When the player ticked "I am 18 or older" at sign-up.
  age_confirmed_at timestamptz not null,
  -- Incognito: three separate switches.
  show_in_feed boolean not null default true,
  show_on_leaderboard boolean not null default true,
  public_profile boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------

create type public.ledger_kind as enum ('welcome', 'faucet_hourly', 'faucet_daily', 'bet');

create table public.ledger (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts (id) on delete restrict,
  amount bigint not null,
  kind public.ledger_kind not null,
  idempotency_key text not null check (length(idempotency_key) between 8 and 100),
  created_at timestamptz not null default now(),

  -- A key can only ever be used once per player.
  unique (account_id, idempotency_key),

  -- Each kind moves coins in one direction, and the faucet kinds only ever
  -- pay their fixed amount, so nothing can mint a made-up sum.
  constraint ledger_amount_matches_kind check (
    case kind
      when 'welcome' then amount = 500000        -- 5,000 coins
      when 'faucet_hourly' then amount = 20000   -- 200 coins
      when 'faucet_daily' then amount = 100000   -- 1,000 coins
      when 'bet' then amount < 0
    end
  )
);

create index ledger_account_idx on public.ledger (account_id);
create index ledger_account_kind_time_idx on public.ledger (account_id, kind, created_at desc);

-- One welcome grant per account, ever.
create unique index ledger_one_welcome on public.ledger (account_id) where kind = 'welcome';

-- Append-only: editing or deleting a line is refused outright.
create function public.ledger_is_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'ledger_is_append_only';
end $$;

create trigger ledger_no_update before update on public.ledger
for each row execute function public.ledger_is_append_only();
create trigger ledger_no_delete before delete on public.ledger
for each row execute function public.ledger_is_append_only();
create trigger ledger_no_truncate before truncate on public.ledger
for each statement execute function public.ledger_is_append_only();

-- Safety net: after any new line, lock the player and re-add their balance.
-- Taking the lock here means even two direct writes at once must take
-- turns, and the second one sees the first.
create function public.ledger_never_negative() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform 1 from public.accounts where id = new.account_id for update;
  if (select sum(amount) from public.ledger where account_id = new.account_id) < 0 then
    raise exception 'negative_balance';
  end if;
  return null;
end $$;

create trigger ledger_never_negative after insert on public.ledger
for each row execute function public.ledger_never_negative();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function public.get_balance(p_account uuid) returns bigint
language sql stable set search_path = '' as $$
  select coalesce(sum(amount), 0)::bigint from public.ledger where account_id = p_account
$$;

-- Locks the player's account row until the transaction ends. Every coin
-- movement calls this first, so requests for one player run one at a time.
create function public.lock_account(p_account uuid) returns void
language plpgsql set search_path = '' as $$
begin
  perform 1 from public.accounts where id = p_account for update;
  if not found then
    raise exception 'no_such_account';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Sign-up: create the account and pay the welcome grant, all or nothing
-- ---------------------------------------------------------------------------

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((new.raw_user_meta_data ->> 'age_confirmed')::boolean, false) is not true then
    raise exception 'age_not_confirmed';
  end if;

  insert into public.accounts (id, username, age_confirmed_at)
  values (new.id, lower(new.raw_user_meta_data ->> 'username'), now());

  insert into public.ledger (account_id, amount, kind, idempotency_key)
  values (new.id, 500000, 'welcome', 'welcome:' || new.id);

  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Bet: take coins for a wager
-- ---------------------------------------------------------------------------

create function public.place_bet(p_account uuid, p_amount bigint, p_key text)
returns table (ledger_id bigint, balance bigint, replayed boolean)
language plpgsql set search_path = '' as $$
declare
  v_existing public.ledger;
  v_id bigint;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  perform public.lock_account(p_account);

  -- Seen this key before? Hand back the first result, change nothing.
  select * into v_existing from public.ledger l
  where l.account_id = p_account and l.idempotency_key = p_key;
  if found then
    if v_existing.kind <> 'bet' or v_existing.amount <> -p_amount then
      raise exception 'idempotency_key_reused';
    end if;
    return query select v_existing.id, public.get_balance(p_account), true;
    return;
  end if;

  if public.get_balance(p_account) < p_amount then
    raise exception 'insufficient_balance';
  end if;

  insert into public.ledger (account_id, amount, kind, idempotency_key)
  values (p_account, -p_amount, 'bet', p_key)
  returning id into v_id;

  return query select v_id, public.get_balance(p_account), false;
end $$;

-- ---------------------------------------------------------------------------
-- Faucet: the hourly tap (200) and the daily tap (1,000), claimed separately
-- ---------------------------------------------------------------------------

create function public.claim_faucet(p_account uuid, p_tap text, p_key text)
returns table (ledger_id bigint, amount bigint, balance bigint, replayed boolean)
language plpgsql set search_path = '' as $$
declare
  v_kind public.ledger_kind;
  v_amount bigint;
  v_wait interval;
  v_existing public.ledger;
  v_id bigint;
begin
  case p_tap
    when 'hourly' then v_kind := 'faucet_hourly'; v_amount := 20000; v_wait := interval '1 hour';
    when 'daily' then v_kind := 'faucet_daily'; v_amount := 100000; v_wait := interval '24 hours';
    else raise exception 'invalid_tap';
  end case;

  perform public.lock_account(p_account);

  select * into v_existing from public.ledger l
  where l.account_id = p_account and l.idempotency_key = p_key;
  if found then
    if v_existing.kind <> v_kind then
      raise exception 'idempotency_key_reused';
    end if;
    return query select v_existing.id, v_existing.amount, public.get_balance(p_account), true;
    return;
  end if;

  if exists (
    select 1 from public.ledger l
    where l.account_id = p_account and l.kind = v_kind and l.created_at > now() - v_wait
  ) then
    raise exception 'faucet_not_ready';
  end if;

  insert into public.ledger (account_id, amount, kind, idempotency_key)
  values (p_account, v_amount, v_kind, p_key)
  returning id into v_id;

  return query select v_id, v_amount, public.get_balance(p_account), false;
end $$;

-- When each tap can next be claimed (null = ready now).
create function public.faucet_status(p_account uuid)
returns table (hourly_ready_at timestamptz, daily_ready_at timestamptz)
language sql stable set search_path = '' as $$
  select
    (select max(created_at) + interval '1 hour' from public.ledger
      where account_id = p_account and kind = 'faucet_hourly'
      having max(created_at) + interval '1 hour' > now()),
    (select max(created_at) + interval '24 hours' from public.ledger
      where account_id = p_account and kind = 'faucet_daily'
      having max(created_at) + interval '24 hours' > now())
$$;

-- ---------------------------------------------------------------------------
-- Privacy switches
-- ---------------------------------------------------------------------------

create function public.set_privacy(p_account uuid, p_feed boolean, p_board boolean, p_profile boolean)
returns void language sql set search_path = '' as $$
  update public.accounts
  set show_in_feed = p_feed, show_on_leaderboard = p_board, public_profile = p_profile
  where id = p_account
$$;

-- ---------------------------------------------------------------------------
-- Who may do what
-- ---------------------------------------------------------------------------

-- Row level security on, with no policies: the browser can read or write
-- nothing here. The server (service_role) is exempt.
alter table public.accounts enable row level security;
alter table public.ledger enable row level security;

-- Take away everything Supabase hands out by default...
revoke all on public.accounts, public.ledger from public, anon, authenticated;
revoke all on function
  public.get_balance(uuid),
  public.lock_account(uuid),
  public.place_bet(uuid, bigint, text),
  public.claim_faucet(uuid, text, text),
  public.faucet_status(uuid),
  public.set_privacy(uuid, boolean, boolean, boolean),
  public.handle_new_user(),
  public.ledger_is_append_only(),
  public.ledger_never_negative()
from public, anon, authenticated;

-- ...and nobody, not even the server, may edit or delete ledger lines.
revoke update, delete, truncate on public.ledger from service_role;
