-- Keno: pick up to ten numbers. Watch most of them miss.
--
-- The rules this file keeps (see CLAUDE.md and /fairness):
--   * 40 numbers, 10 drawn. The spin gives 10 fair numbers (take_spin with
--     a count of 10: one spin number, two HMAC blocks). Each fair number
--     picks from the numbers still left, lowest first: position =
--     floor(number x how many are left). So every number is equally likely
--     and none is drawn twice.
--   * A player picks 1 to 10 different numbers from 1 to 40. Hits = how
--     many of them were drawn.
--   * A round pays bet x the table's multiplier for (picks, hits) / 100,
--     rounded down to the whole hundredth of a coin. The table below is
--     the one Asher approved in session 07. Its multipliers are rounded
--     down to 0.01x, so each pick count returns just under 99%: a house
--     edge from 1.00% (1 pick) to 1.22% (4 picks).
--   * play_keno does the whole round in one transaction, exactly like
--     play_dice: take the bet (place_bet), take the next spin (take_spin),
--     draw, pay any win into the ledger, and remember the round. A repeated
--     key hands back the remembered round and changes nothing.
--   * The browser (anon / authenticated) can touch none of this.
--
-- src/lib/keno.ts has the same maths and table for the page and the
-- verifier. tests/cheat/keno.test.ts proves the two always agree.

-- ---------------------------------------------------------------------------
-- The maths
-- ---------------------------------------------------------------------------

-- The pay table for a pick count, 0 hits first, in hundredths.
create function public.keno_table(p_picks int) returns int[]
language plpgsql immutable set search_path = '' as $$
begin
  return case p_picks
    when 1 then array[0, 396]
    when 2 then array[0, 147, 735]
    when 3 then array[0, 0, 383, 3835]
    when 4 then array[0, 0, 178, 1192, 5963]
    when 5 then array[0, 0, 84, 505, 3370, 8426]
    when 6 then array[0, 0, 0, 278, 1854, 9274, 23187]
    when 7 then array[0, 0, 0, 168, 842, 4213, 16852, 42131]
    when 8 then array[0, 0, 0, 0, 498, 3118, 14966, 49888, 124720]
    when 9 then array[0, 0, 0, 0, 284, 1518, 7592, 28470, 75922, 189805]
    when 10 then array[0, 0, 0, 0, 166, 833, 4165, 16662, 55543, 138857, 277715]
  end;
end $$;

-- Picks sorted lowest first. Refuses anything but 1 to 10 different whole
-- numbers from 1 to 40.
create function public.keno_clean_picks(p_picks int[]) returns int[]
language plpgsql immutable set search_path = '' as $$
declare
  v_sorted int[];
begin
  if p_picks is null
     or cardinality(p_picks) < 1 or cardinality(p_picks) > 10
     or array_position(p_picks, null) is not null
     or exists (select 1 from unnest(p_picks) p where p < 1 or p > 40)
  then
    raise exception 'invalid_picks';
  end if;
  select array_agg(distinct p order by p) into v_sorted from unnest(p_picks) p;
  if cardinality(v_sorted) <> cardinality(p_picks) then
    raise exception 'invalid_picks';
  end if;
  return v_sorted;
end $$;

-- Ten fair numbers (each 0 up to, not including, 1) become ten different
-- numbers from 1 to 40, in the order drawn. Each number is k / 2^32 for a
-- whole k, so number x (how many are left) is exact.
create function public.keno_draw(p_numbers double precision[]) returns int[]
language plpgsql immutable set search_path = '' as $$
declare
  v_left int[] := array(select generate_series(1, 40));
  v_drawn int[] := '{}';
  v_at int;
  i int;
begin
  if p_numbers is null or cardinality(p_numbers) < 10 then
    raise exception 'invalid_number';
  end if;
  for i in 1..10 loop
    if p_numbers[i] is null or p_numbers[i] < 0 or p_numbers[i] >= 1 then
      raise exception 'invalid_number';
    end if;
    -- Postgres arrays count from 1.
    v_at := floor(p_numbers[i] * cardinality(v_left))::int + 1;
    v_drawn := v_drawn || v_left[v_at];
    v_left := v_left[1:v_at - 1] || v_left[v_at + 1:];
  end loop;
  return v_drawn;
end $$;

create function public.keno_hits(p_picks int[], p_drawn int[]) returns int
language sql immutable set search_path = '' as $$
  select count(*)::int from unnest(p_picks) p where p = any (p_drawn)
$$;

-- The multiplier for (picks, hits), in hundredths.
create function public.keno_multiplier(p_picks int, p_hits int) returns int
language plpgsql immutable set search_path = '' as $$
begin
  if p_picks is null or p_picks < 1 or p_picks > 10 then
    raise exception 'invalid_picks';
  end if;
  if p_hits is null or p_hits < 0 or p_hits > p_picks then
    raise exception 'invalid_hits';
  end if;
  return (public.keno_table(p_picks))[p_hits + 1];
end $$;

-- What a round pays, in hundredths. 0 when the line pays nothing.
create function public.keno_payout(p_amount bigint, p_picks int, p_hits int) returns bigint
language plpgsql immutable set search_path = '' as $$
begin
  -- Whole-number division rounds down.
  return (p_amount * public.keno_multiplier(p_picks, p_hits)) / 100;
end $$;

-- ---------------------------------------------------------------------------
-- Every round, remembered forever
-- ---------------------------------------------------------------------------

create table public.keno_rounds (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts (id) on delete restrict,
  -- The bet's ledger line. Its idempotency key is the round's key.
  bet_ledger_id bigint not null unique references public.ledger (id) on delete restrict,
  -- The win's ledger line; null when nothing was paid.
  payout_ledger_id bigint unique references public.ledger (id) on delete restrict,
  seed_pair_id bigint not null references public.seed_pairs (id) on delete restrict,
  spin bigint not null,
  amount bigint not null check (amount > 0),
  -- Sorted lowest first.
  picks int[] not null check (cardinality(picks) between 1 and 10),
  -- In the order drawn.
  drawn int[] not null check (cardinality(drawn) = 10),
  hits int not null check (hits between 0 and 10),
  multiplier int not null check (multiplier >= 0),
  payout bigint not null check (payout >= 0),
  created_at timestamptz not null default now(),

  -- A spin is used once, ever.
  unique (seed_pair_id, spin),
  constraint keno_round_payout_line check ((payout > 0) = (payout_ledger_id is not null))
);

create index keno_rounds_account_idx on public.keno_rounds (account_id, id desc);

create function public.keno_rounds_are_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'keno_rounds_are_append_only';
end $$;

create trigger keno_rounds_no_update before update on public.keno_rounds
for each row execute function public.keno_rounds_are_append_only();
create trigger keno_rounds_no_delete before delete on public.keno_rounds
for each row execute function public.keno_rounds_are_append_only();
create trigger keno_rounds_no_truncate before truncate on public.keno_rounds
for each statement execute function public.keno_rounds_are_append_only();

-- ---------------------------------------------------------------------------
-- A round
-- ---------------------------------------------------------------------------

create function public.play_keno(
  p_account uuid,
  p_amount bigint,
  p_picks int[],
  p_key text
)
returns table (
  round_id bigint,
  seed_pair_id bigint,
  spin bigint,
  drawn int[],
  hits int,
  multiplier int,
  won boolean,
  payout bigint,
  balance bigint,
  replayed boolean
)
language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare
  v_picks int[];
  v_bet record;
  v_spin record;
  v_round public.keno_rounds;
  v_drawn int[];
  v_hits int;
  v_payout bigint;
  v_payout_id bigint;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;
  -- Refuses bad picks before anything is taken.
  v_picks := public.keno_clean_picks(p_picks);

  -- Locks the player, checks the key and the balance, takes the bet.
  select * into v_bet from public.place_bet(p_account, p_amount, p_key);

  -- Seen this key before? Hand back that round. place_bet has already
  -- checked the amount; the picks must match too (in any order).
  if v_bet.replayed then
    select * into v_round from public.keno_rounds k where k.bet_ledger_id = v_bet.ledger_id;
    if not found or v_round.picks <> v_picks then
      raise exception 'idempotency_key_reused';
    end if;
    return query select
      v_round.id, v_round.seed_pair_id, v_round.spin, v_round.drawn, v_round.hits,
      v_round.multiplier, v_round.payout > 0, v_round.payout, public.get_balance(p_account), true;
    return;
  end if;

  select * into v_spin from public.take_spin(p_account, 10);
  v_drawn := public.keno_draw(v_spin.numbers);
  v_hits := public.keno_hits(v_picks, v_drawn);
  v_payout := public.keno_payout(p_amount, cardinality(v_picks), v_hits);

  if v_payout > 0 then
    insert into public.ledger (account_id, amount, kind, idempotency_key)
    values (p_account, v_payout, 'payout', 'payout:' || v_bet.ledger_id)
    returning id into v_payout_id;
  end if;

  insert into public.keno_rounds (
    account_id, bet_ledger_id, payout_ledger_id, seed_pair_id, spin,
    amount, picks, drawn, hits, multiplier, payout
  ) values (
    p_account, v_bet.ledger_id, v_payout_id, v_spin.seed_pair_id, v_spin.spin,
    p_amount, v_picks, v_drawn, v_hits, public.keno_multiplier(cardinality(v_picks), v_hits), v_payout
  )
  returning * into v_round;

  return query select
    v_round.id, v_round.seed_pair_id, v_round.spin, v_round.drawn, v_round.hits,
    v_round.multiplier, v_payout > 0, v_payout, public.get_balance(p_account), false;
end $$;

-- ---------------------------------------------------------------------------
-- Who may do what
-- ---------------------------------------------------------------------------

alter table public.keno_rounds enable row level security;

revoke all on public.keno_rounds from public, anon, authenticated;
revoke all on function
  public.keno_table(int),
  public.keno_clean_picks(int[]),
  public.keno_draw(double precision[]),
  public.keno_hits(int[], int[]),
  public.keno_multiplier(int, int),
  public.keno_payout(bigint, int, int),
  public.keno_rounds_are_append_only(),
  public.play_keno(uuid, bigint, int[], text)
from public, anon, authenticated;

revoke update, delete, truncate on public.keno_rounds from service_role;
