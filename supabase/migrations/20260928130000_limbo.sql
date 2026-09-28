-- Limbo: name a multiplier, hope the result clears it.
--
-- The rules this file keeps (see CLAUDE.md and /fairness):
--   * Targets and results are whole hundredths of a multiplier: 200 means
--     2.00x. A target must be 101 (1.01x) to 100,000,000 (1,000,000.00x).
--   * The spin's first fair number is k / 2^32 for a whole k from 0 to
--     2^32 - 1. The result is 99 x 2^32 / (2^32 - k), rounded down: at
--     least 99 (0.99x), and higher the rarer.
--   * A result at or above the target wins. That happens on
--     floor(99 x 2^32 / target) of the 2^32 numbers: a 0.99 / target
--     chance. A win pays bet x target / 100, rounded down to the whole
--     hundredth of a coin. That is 99% of a fair payout: a 1% house edge.
--     A loss pays nothing.
--   * play_limbo does the whole round in one transaction, exactly like
--     play_dice: take the bet (place_bet), take the next spin (take_spin),
--     draw the result, pay any win into the ledger, and remember the round.
--     A repeated key hands back the remembered round and changes nothing.
--   * The browser (anon / authenticated) can touch none of this.
--
-- src/lib/limbo.ts has the same maths for the page and the verifier.
-- tests/cheat/limbo.test.ts proves the two always agree.

-- ---------------------------------------------------------------------------
-- The maths
-- ---------------------------------------------------------------------------

-- Refuses any target outside 1.01x to 1,000,000.00x.
create function public.limbo_check_target(p_target int) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_target is null or p_target < 101 or p_target > 100000000 then
    raise exception 'invalid_target';
  end if;
end $$;

-- A fair number (0 up to, not including, 1) becomes a result.
-- The number is k / 2^32 for a whole k, so number x 2^32 is exact.
create function public.limbo_result(p_number double precision) returns bigint
language plpgsql immutable set search_path = '' as $$
declare
  v_k bigint;
begin
  if p_number is null or p_number < 0 or p_number >= 1 then
    raise exception 'invalid_number';
  end if;
  v_k := (p_number * 4294967296)::bigint;
  -- Whole-number division rounds down.
  return (99 * 4294967296::bigint) / (4294967296::bigint - v_k);
end $$;

-- What a result pays, in hundredths. 0 on a loss.
create function public.limbo_payout(p_amount bigint, p_target int, p_result bigint)
returns bigint
language plpgsql immutable set search_path = '' as $$
begin
  perform public.limbo_check_target(p_target);
  if p_result >= p_target then
    -- Whole-number division rounds down.
    return (p_amount * p_target) / 100;
  end if;
  return 0;
end $$;

-- ---------------------------------------------------------------------------
-- Every round, remembered forever
-- ---------------------------------------------------------------------------

create table public.limbo_rounds (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts (id) on delete restrict,
  -- The bet's ledger line. Its idempotency key is the round's key.
  bet_ledger_id bigint not null unique references public.ledger (id) on delete restrict,
  -- The win's ledger line; null on a loss.
  payout_ledger_id bigint unique references public.ledger (id) on delete restrict,
  seed_pair_id bigint not null references public.seed_pairs (id) on delete restrict,
  spin bigint not null,
  amount bigint not null check (amount > 0),
  target int not null check (target between 101 and 100000000),
  result bigint not null check (result >= 99),
  payout bigint not null check (payout >= 0),
  created_at timestamptz not null default now(),

  -- A spin is used once, ever.
  unique (seed_pair_id, spin),
  constraint limbo_round_payout_line check ((payout > 0) = (payout_ledger_id is not null))
);

create index limbo_rounds_account_idx on public.limbo_rounds (account_id, id desc);

create function public.limbo_rounds_are_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'limbo_rounds_are_append_only';
end $$;

create trigger limbo_rounds_no_update before update on public.limbo_rounds
for each row execute function public.limbo_rounds_are_append_only();
create trigger limbo_rounds_no_delete before delete on public.limbo_rounds
for each row execute function public.limbo_rounds_are_append_only();
create trigger limbo_rounds_no_truncate before truncate on public.limbo_rounds
for each statement execute function public.limbo_rounds_are_append_only();

-- ---------------------------------------------------------------------------
-- A round
-- ---------------------------------------------------------------------------

create function public.play_limbo(
  p_account uuid,
  p_amount bigint,
  p_target int,
  p_key text
)
returns table (
  round_id bigint,
  seed_pair_id bigint,
  spin bigint,
  result bigint,
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
  v_round public.limbo_rounds;
  v_result bigint;
  v_payout bigint;
  v_payout_id bigint;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;
  -- Refuses a bad target before anything is taken.
  perform public.limbo_check_target(p_target);

  -- Locks the player, checks the key and the balance, takes the bet.
  select * into v_bet from public.place_bet(p_account, p_amount, p_key);

  -- Seen this key before? Hand back that round. place_bet has already
  -- checked the amount; the target must match too.
  if v_bet.replayed then
    select * into v_round from public.limbo_rounds l where l.bet_ledger_id = v_bet.ledger_id;
    if not found or v_round.target <> p_target then
      raise exception 'idempotency_key_reused';
    end if;
    return query select
      v_round.id, v_round.seed_pair_id, v_round.spin, v_round.result,
      v_round.payout > 0, v_round.payout, public.get_balance(p_account), true;
    return;
  end if;

  select * into v_spin from public.take_spin(p_account, 1);
  v_result := public.limbo_result(v_spin.numbers[1]);
  v_payout := public.limbo_payout(p_amount, p_target, v_result);

  if v_payout > 0 then
    insert into public.ledger (account_id, amount, kind, idempotency_key)
    values (p_account, v_payout, 'payout', 'payout:' || v_bet.ledger_id)
    returning id into v_payout_id;
  end if;

  insert into public.limbo_rounds (
    account_id, bet_ledger_id, payout_ledger_id, seed_pair_id, spin,
    amount, target, result, payout
  ) values (
    p_account, v_bet.ledger_id, v_payout_id, v_spin.seed_pair_id, v_spin.spin,
    p_amount, p_target, v_result, v_payout
  )
  returning * into v_round;

  return query select
    v_round.id, v_round.seed_pair_id, v_round.spin, v_round.result,
    v_payout > 0, v_payout, public.get_balance(p_account), false;
end $$;

-- ---------------------------------------------------------------------------
-- Who may do what
-- ---------------------------------------------------------------------------

alter table public.limbo_rounds enable row level security;

revoke all on public.limbo_rounds from public, anon, authenticated;
revoke all on function
  public.limbo_check_target(int),
  public.limbo_result(double precision),
  public.limbo_payout(bigint, int, bigint),
  public.limbo_rounds_are_append_only(),
  public.play_limbo(uuid, bigint, int, text)
from public, anon, authenticated;

revoke update, delete, truncate on public.limbo_rounds from service_role;
