-- Wheel: a wheel. It spins. Most of it pays less than you bet.
--
-- The rules this file keeps (see CLAUDE.md and /fairness):
--   * 30 segments. The spin's first fair number x 30, rounded down, is the
--     segment it lands on: 0 to 29, each equally likely.
--   * Each risk level (low, medium, high) has a fixed table of 30
--     multipliers in whole hundredths (150 means 1.50x):
--       low:    8 x 0, 15 x 1.20, 6 x 1.50, 1 x 2.70
--       medium: 15 x 0, 6 x 1.50, 6 x 2.00, 2 x 3.00, 1 x 2.70
--       high:   29 x 0, 1 x 29.70
--     Each table adds up to 99 x 30, so every risk level pays back exactly
--     99% of what is bet: a 1% house edge.
--   * A landing pays bet x multiplier / 100, rounded down to the whole
--     hundredth of a coin. A 0x segment pays nothing.
--   * play_wheel does the whole round in one transaction, exactly like
--     play_dice: take the bet (place_bet), take the next spin (take_spin),
--     find the segment, pay any win into the ledger, and remember the round.
--     A repeated key hands back the remembered round and changes nothing.
--   * The browser (anon / authenticated) can touch none of this.
--
-- src/lib/wheel.ts has the same tables for the page and the verifier.
-- tests/cheat/wheel.test.ts proves the two always agree, segment by segment.

-- ---------------------------------------------------------------------------
-- The maths
-- ---------------------------------------------------------------------------

-- The table for a risk level, segment 0 first. Refuses anything else.
create function public.wheel_table(p_risk text) returns int[]
language plpgsql immutable set search_path = '' as $$
begin
  if p_risk = 'low' then
    return array[
      0, 120, 150, 120, 0, 120, 120, 150, 0, 120, 120, 150, 0, 120, 270,
      120, 0, 120, 150, 120, 0, 120, 120, 150, 0, 120, 150, 120, 0, 120];
  elsif p_risk = 'medium' then
    return array[
      0, 150, 0, 200, 0, 150, 0, 300, 0, 200, 0, 150, 0, 200, 0,
      270, 0, 150, 0, 200, 0, 300, 0, 150, 0, 200, 0, 150, 0, 200];
  elsif p_risk = 'high' then
    return array[
      2970, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  end if;
  raise exception 'invalid_risk';
end $$;

-- A fair number (0 up to, not including, 1) becomes a segment from 0 to 29.
-- The number is k / 2^32 for a whole k, so number x 30 is exact.
create function public.wheel_segment(p_number double precision) returns int
language plpgsql immutable set search_path = '' as $$
begin
  if p_number is null or p_number < 0 or p_number >= 1 then
    raise exception 'invalid_number';
  end if;
  return floor(p_number * 30)::int;
end $$;

-- The multiplier at a segment, in hundredths.
create function public.wheel_multiplier(p_risk text, p_segment int) returns int
language plpgsql immutable set search_path = '' as $$
declare
  v_table int[] := public.wheel_table(p_risk);
begin
  if p_segment is null or p_segment < 0 or p_segment > 29 then
    raise exception 'invalid_segment';
  end if;
  -- Postgres arrays count from 1.
  return v_table[p_segment + 1];
end $$;

-- What a landing pays, in hundredths. 0 on a 0x segment.
create function public.wheel_payout(p_amount bigint, p_risk text, p_segment int) returns bigint
language plpgsql immutable set search_path = '' as $$
begin
  -- Whole-number division rounds down.
  return (p_amount * public.wheel_multiplier(p_risk, p_segment)) / 100;
end $$;

-- ---------------------------------------------------------------------------
-- Every round, remembered forever
-- ---------------------------------------------------------------------------

create table public.wheel_rounds (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts (id) on delete restrict,
  -- The bet's ledger line. Its idempotency key is the round's key.
  bet_ledger_id bigint not null unique references public.ledger (id) on delete restrict,
  -- The win's ledger line; null when nothing was paid.
  payout_ledger_id bigint unique references public.ledger (id) on delete restrict,
  seed_pair_id bigint not null references public.seed_pairs (id) on delete restrict,
  spin bigint not null,
  amount bigint not null check (amount > 0),
  risk text not null check (risk in ('low', 'medium', 'high')),
  segment int not null check (segment between 0 and 29),
  multiplier int not null check (multiplier >= 0),
  payout bigint not null check (payout >= 0),
  created_at timestamptz not null default now(),

  -- A spin is used once, ever.
  unique (seed_pair_id, spin),
  constraint wheel_round_payout_line check ((payout > 0) = (payout_ledger_id is not null))
);

create index wheel_rounds_account_idx on public.wheel_rounds (account_id, id desc);

create function public.wheel_rounds_are_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'wheel_rounds_are_append_only';
end $$;

create trigger wheel_rounds_no_update before update on public.wheel_rounds
for each row execute function public.wheel_rounds_are_append_only();
create trigger wheel_rounds_no_delete before delete on public.wheel_rounds
for each row execute function public.wheel_rounds_are_append_only();
create trigger wheel_rounds_no_truncate before truncate on public.wheel_rounds
for each statement execute function public.wheel_rounds_are_append_only();

-- ---------------------------------------------------------------------------
-- A round
-- ---------------------------------------------------------------------------

create function public.play_wheel(
  p_account uuid,
  p_amount bigint,
  p_risk text,
  p_key text
)
returns table (
  round_id bigint,
  seed_pair_id bigint,
  spin bigint,
  segment int,
  multiplier int,
  won boolean,
  payout bigint,
  balance bigint,
  replayed boolean
)
language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare
  v_bet record;
  v_spin record;
  v_round public.wheel_rounds;
  v_segment int;
  v_payout bigint;
  v_payout_id bigint;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;
  -- Refuses a bad risk level before anything is taken.
  perform public.wheel_table(p_risk);

  -- Locks the player, checks the key and the balance, takes the bet.
  select * into v_bet from public.place_bet(p_account, p_amount, p_key);

  -- Seen this key before? Hand back that round. place_bet has already
  -- checked the amount; the risk level must match too.
  if v_bet.replayed then
    select * into v_round from public.wheel_rounds w where w.bet_ledger_id = v_bet.ledger_id;
    if not found or v_round.risk <> p_risk then
      raise exception 'idempotency_key_reused';
    end if;
    return query select
      v_round.id, v_round.seed_pair_id, v_round.spin, v_round.segment, v_round.multiplier,
      v_round.payout > 0, v_round.payout, public.get_balance(p_account), true;
    return;
  end if;

  select * into v_spin from public.take_spin(p_account, 1);
  v_segment := public.wheel_segment(v_spin.numbers[1]);
  v_payout := public.wheel_payout(p_amount, p_risk, v_segment);

  if v_payout > 0 then
    insert into public.ledger (account_id, amount, kind, idempotency_key)
    values (p_account, v_payout, 'payout', 'payout:' || v_bet.ledger_id)
    returning id into v_payout_id;
  end if;

  insert into public.wheel_rounds (
    account_id, bet_ledger_id, payout_ledger_id, seed_pair_id, spin,
    amount, risk, segment, multiplier, payout
  ) values (
    p_account, v_bet.ledger_id, v_payout_id, v_spin.seed_pair_id, v_spin.spin,
    p_amount, p_risk, v_segment, public.wheel_multiplier(p_risk, v_segment), v_payout
  )
  returning * into v_round;

  return query select
    v_round.id, v_round.seed_pair_id, v_round.spin, v_round.segment, v_round.multiplier,
    v_payout > 0, v_payout, public.get_balance(p_account), false;
end $$;

-- ---------------------------------------------------------------------------
-- Who may do what
-- ---------------------------------------------------------------------------

alter table public.wheel_rounds enable row level security;

revoke all on public.wheel_rounds from public, anon, authenticated;
revoke all on function
  public.wheel_table(text),
  public.wheel_segment(double precision),
  public.wheel_multiplier(text, int),
  public.wheel_payout(bigint, text, int),
  public.wheel_rounds_are_append_only(),
  public.play_wheel(uuid, bigint, text, text)
from public, anon, authenticated;

revoke update, delete, truncate on public.wheel_rounds from service_role;
