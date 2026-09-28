-- Dice: the first Original.
--
-- The rules this file keeps (see CLAUDE.md and /fairness):
--   * A roll is a whole number of hundredths from 0 (0.00) to 9999 (99.99):
--     10,000 rolls, each equally likely. roll = floor(number x 10,000),
--     where number is the spin's first fair number from take_spin.
--   * "under T" wins when roll < T. "over T" wins when roll > T. So the
--     number of winning rolls is T (under) or 9999 - T (over), and the win
--     chance is that divided by 10,000. It must be 1 to 9,800 rolls
--     (0.01% to 98%).
--   * A win pays bet x 9,900 / winning rolls, rounded down to the whole
--     hundredth of a coin. That is 99% of a fair payout: a 1% house edge.
--     A loss pays nothing.
--   * play_dice does the whole round in one transaction: take the bet
--     (place_bet), take the next spin (take_spin), roll, pay any win into
--     the ledger, and remember the round. A repeated key hands back the
--     remembered round and changes nothing.
--   * The browser (anon / authenticated) can touch none of this.
--
-- src/lib/dice.ts has the same maths for the page and the verifier.
-- tests/cheat/dice.test.ts proves the two always agree.

-- ---------------------------------------------------------------------------
-- Payouts are always positive, so a payout line can never take coins.
-- ---------------------------------------------------------------------------

alter table public.ledger
  drop constraint ledger_amount_matches_kind,
  add constraint ledger_amount_matches_kind check (
    case kind
      when 'welcome' then amount = 500000        -- 5,000 coins
      when 'faucet_hourly' then amount = 20000   -- 200 coins
      when 'faucet_daily' then amount = 100000   -- 1,000 coins
      when 'bet' then amount < 0
      when 'payout' then amount > 0
      else false
    end
  );

-- ---------------------------------------------------------------------------
-- The maths
-- ---------------------------------------------------------------------------

-- How many of the 10,000 rolls win. Refuses anything outside 1 to 9,800.
create function public.dice_winning_rolls(p_target int, p_direction text) returns int
language plpgsql immutable set search_path = '' as $$
declare
  v_rolls int;
begin
  if p_direction = 'under' then
    v_rolls := p_target;
  elsif p_direction = 'over' then
    v_rolls := 9999 - p_target;
  else
    raise exception 'invalid_direction';
  end if;

  if v_rolls is null or v_rolls < 1 or v_rolls > 9800 then
    raise exception 'invalid_target';
  end if;
  return v_rolls;
end $$;

-- A fair number (0 up to, not including, 1) becomes a roll from 0 to 9999.
-- The number is k / 2^32 for a whole k, so number x 10,000 is exact.
create function public.dice_roll(p_number double precision) returns int
language plpgsql immutable set search_path = '' as $$
begin
  if p_number is null or p_number < 0 or p_number >= 1 then
    raise exception 'invalid_number';
  end if;
  return floor(p_number * 10000)::int;
end $$;

-- What a roll pays, in hundredths. 0 on a loss.
create function public.dice_payout(p_amount bigint, p_target int, p_direction text, p_roll int)
returns bigint
language plpgsql immutable set search_path = '' as $$
declare
  v_rolls int := public.dice_winning_rolls(p_target, p_direction);
begin
  if (p_direction = 'under' and p_roll < p_target) or (p_direction = 'over' and p_roll > p_target) then
    -- Whole-number division rounds down.
    return (p_amount * 9900) / v_rolls;
  end if;
  return 0;
end $$;

-- ---------------------------------------------------------------------------
-- Every round, remembered forever
-- ---------------------------------------------------------------------------

create table public.dice_rounds (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts (id) on delete restrict,
  -- The bet's ledger line. Its idempotency key is the round's key.
  bet_ledger_id bigint not null unique references public.ledger (id) on delete restrict,
  -- The win's ledger line; null on a loss.
  payout_ledger_id bigint unique references public.ledger (id) on delete restrict,
  seed_pair_id bigint not null references public.seed_pairs (id) on delete restrict,
  spin bigint not null,
  amount bigint not null check (amount > 0),
  target int not null,
  direction text not null check (direction in ('under', 'over')),
  roll int not null check (roll between 0 and 9999),
  payout bigint not null check (payout >= 0),
  created_at timestamptz not null default now(),

  -- A spin is used once, ever.
  unique (seed_pair_id, spin),
  constraint dice_round_payout_line check ((payout > 0) = (payout_ledger_id is not null))
);

create index dice_rounds_account_idx on public.dice_rounds (account_id, id desc);

create function public.dice_rounds_are_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'dice_rounds_are_append_only';
end $$;

create trigger dice_rounds_no_update before update on public.dice_rounds
for each row execute function public.dice_rounds_are_append_only();
create trigger dice_rounds_no_delete before delete on public.dice_rounds
for each row execute function public.dice_rounds_are_append_only();
create trigger dice_rounds_no_truncate before truncate on public.dice_rounds
for each statement execute function public.dice_rounds_are_append_only();

-- ---------------------------------------------------------------------------
-- A round
-- ---------------------------------------------------------------------------

create function public.play_dice(
  p_account uuid,
  p_amount bigint,
  p_target int,
  p_direction text,
  p_key text
)
returns table (
  round_id bigint,
  seed_pair_id bigint,
  spin bigint,
  roll int,
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
  v_round public.dice_rounds;
  v_roll int;
  v_payout bigint;
  v_payout_id bigint;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;
  -- Refuses a bad target or direction before anything is taken.
  perform public.dice_winning_rolls(p_target, p_direction);

  -- Locks the player, checks the key and the balance, takes the bet.
  select * into v_bet from public.place_bet(p_account, p_amount, p_key);

  -- Seen this key before? Hand back that round. place_bet has already
  -- checked the amount; the rest must match too.
  if v_bet.replayed then
    select * into v_round from public.dice_rounds d where d.bet_ledger_id = v_bet.ledger_id;
    if not found or v_round.target <> p_target or v_round.direction <> p_direction then
      raise exception 'idempotency_key_reused';
    end if;
    return query select
      v_round.id, v_round.seed_pair_id, v_round.spin, v_round.roll,
      v_round.payout > 0, v_round.payout, public.get_balance(p_account), true;
    return;
  end if;

  select * into v_spin from public.take_spin(p_account, 1);
  v_roll := public.dice_roll(v_spin.numbers[1]);
  v_payout := public.dice_payout(p_amount, p_target, p_direction, v_roll);

  if v_payout > 0 then
    insert into public.ledger (account_id, amount, kind, idempotency_key)
    values (p_account, v_payout, 'payout', 'payout:' || v_bet.ledger_id)
    returning id into v_payout_id;
  end if;

  insert into public.dice_rounds (
    account_id, bet_ledger_id, payout_ledger_id, seed_pair_id, spin,
    amount, target, direction, roll, payout
  ) values (
    p_account, v_bet.ledger_id, v_payout_id, v_spin.seed_pair_id, v_spin.spin,
    p_amount, p_target, p_direction, v_roll, v_payout
  )
  returning * into v_round;

  return query select
    v_round.id, v_round.seed_pair_id, v_round.spin, v_round.roll,
    v_payout > 0, v_payout, public.get_balance(p_account), false;
end $$;

-- ---------------------------------------------------------------------------
-- Who may do what
-- ---------------------------------------------------------------------------

alter table public.dice_rounds enable row level security;

revoke all on public.dice_rounds from public, anon, authenticated;
revoke all on function
  public.dice_winning_rolls(int, text),
  public.dice_roll(double precision),
  public.dice_payout(bigint, int, text, int),
  public.dice_rounds_are_append_only(),
  public.play_dice(uuid, bigint, int, text, text)
from public, anon, authenticated;

revoke update, delete, truncate on public.dice_rounds from service_role;
